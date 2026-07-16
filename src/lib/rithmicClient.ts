/*
 * R | Protocol client — the live connection to Rithmic's R | Trade Execution
 * Platform, in the browser.
 *
 * Rithmic's API is WebSockets + protobuf, one message per binary frame, and is
 * explicitly designed to run in web browsers — so this connects DIRECTLY, no
 * server relay. The handshake mirrors Rithmic's own sample: connect → optional
 * RequestRithmicSystemInfo (list systems) → RequestLogin(infra_type) →
 * heartbeats on the interval the server returns → RequestLoginInfo /
 * RequestAccountList / RequestTradeRoutes → subscribe to market data and order
 * updates → RequestNewOrder. Server pushes (LastTrade, BestBidOffer, order
 * notifications) are routed by template_id.
 *
 * Safety is built in, not bolted on: order submission is a separate, explicitly
 * gated method — the UI must arm live trading and confirm each order. The codec
 * (rithmicWire) is pure and byte-tested; this module is the thin stateful
 * transport around it, with an injectable WebSocket for offline tests.
 */
import type { RithmicConn } from './rithmic';
import {
  encode,
  decode,
  INFRA,
  UPDATE_BITS,
  MD_REQUEST,
  SIDE,
  DURATION,
  PRICE_TYPE,
  MANUAL_AUTO,
  type DecodedMessage,
} from './rithmicWire';

export type ConnState = 'idle' | 'connecting' | 'systems' | 'logging-in' | 'ready' | 'error' | 'closed';

export interface Quote {
  symbol: string;
  exchange: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  netChange: number | null;
  volume: number | null;
  at: number;
}

export interface Account {
  accountId: string;
  accountName: string;
  currency: string;
  fcmId: string;
  ibId: string;
}

export interface TradeRoute {
  exchange: string;
  tradeRoute: string;
  isDefault: boolean;
}

export interface OrderUpdate {
  at: number;
  templateId: number;
  notifyType: number | null;
  status: string;
  symbol: string;
  exchange: string;
  side: number | null;
  quantity: number | null;
  price: number | null;
  avgFillPrice: number | null;
  totalFillSize: number | null;
  text: string;
  basketId: string;
}

export interface OrderTicket {
  accountId: string;
  symbol: string;
  exchange: string;
  tradeRoute: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  priceType: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT';
  price?: number;
  triggerPrice?: number;
  duration: 'DAY' | 'GTC' | 'IOC' | 'FOK';
}

type Ev =
  | { type: 'state'; state: ConnState; detail?: string }
  | { type: 'systems'; systems: string[] }
  | { type: 'login'; fcmId: string; ibId: string; userId: string }
  | { type: 'account'; account: Account }
  | { type: 'route'; route: TradeRoute }
  | { type: 'quote'; quote: Quote }
  | { type: 'order'; update: OrderUpdate }
  | { type: 'log'; message: string };

type Listener = (e: Ev) => void;

/** The minimal WebSocket surface the client needs — real or faked in tests. */
export interface WSLike {
  binaryType: string;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
}
export type WSFactory = (url: string) => WSLike;

const APP_NAME = 'EdgeIntelligence';
const APP_VERSION = '1.0';
const TEMPLATE_VERSION = '5.29'; // R|Protocol template family; server tolerates minor drift

/** Synchronous bytes for the common case (binaryType='arraybuffer'). */
function bytesSync(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

export class RProtocolClient {
  private ws: WSLike | null = null;
  private state: ConnState = 'idle';
  private listeners = new Set<Listener>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private quotes = new Map<string, Quote>();
  readonly accounts: Account[] = [];
  readonly routes: TradeRoute[] = [];
  fcmId = '';
  ibId = '';
  /** live order submission is refused unless the caller explicitly arms it */
  private armed = false;

  constructor(
    private readonly conn: RithmicConn,
    private readonly wsFactory: WSFactory = (url) => new WebSocket(url) as unknown as WSLike,
  ) {}

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: Ev): void {
    for (const fn of this.listeners) fn(e);
  }
  private setState(state: ConnState, detail?: string): void {
    this.state = state;
    this.emit({ type: 'state', state, detail });
  }
  getState(): ConnState {
    return this.state;
  }
  /** Arming is a deliberate, revocable gate the UI toggles before live orders. */
  arm(on: boolean): void {
    this.armed = on;
    this.emit({ type: 'log', message: on ? 'Live order submission ARMED' : 'Live order submission disarmed' });
  }
  isArmed(): boolean {
    return this.armed;
  }

  /**
   * Connect to the gateway. With `systemsOnly`, request the available system
   * list and stop — no credentials are sent, so it works even before login is
   * sorted out and is the safe way to discover the exact system name for your
   * account (Rithmic closes the socket after answering).
   */
  connect(systemsOnly = false): void {
    if (!/^wss:\/\//i.test(this.conn.gatewayUrl.trim())) {
      this.setState('error', 'Gateway must be a wss:// address.');
      return;
    }
    this.setState('connecting');
    let ws: WSLike;
    try {
      ws = this.wsFactory(this.conn.gatewayUrl.trim());
    } catch {
      this.setState('error', 'The browser refused to open the socket.');
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (systemsOnly) {
        this.setState('systems');
        this.send(16, { userMsg: ['list'] });
        return;
      }
      this.setState('logging-in');
      this.send(10, this.loginFields());
    };
    ws.onerror = () => this.setState('error', 'WebSocket error — gateway unreachable or refused the connection.');
    ws.onclose = (e) => {
      this.stopHeartbeat();
      this.setState('closed', e?.reason || `closed${e?.code ? ` (${e.code})` : ''}`);
    };
    ws.onmessage = (e) => {
      this.onFrame(e.data);
    };
  }

  /** Request the list of available systems (server closes the socket after). */
  listSystems(): void {
    this.setState('systems');
    this.send(16, { userMsg: ['list'] });
  }

  disconnect(): void {
    this.stopHeartbeat();
    try {
      if (this.ws && this.state === 'ready') this.send(12, {});
      this.ws?.close(1000, 'client disconnect');
    } catch {
      // already closed
    }
    this.ws = null;
    this.setState('closed');
  }

  private loginFields(): Record<string, unknown> {
    return {
      templateVersion: TEMPLATE_VERSION,
      user: this.conn.user,
      password: this.conn.password,
      // Rithmic permissions on (user, system, app). A blank appName uses ours;
      // set the broker/Rithmic-authorized one to clear "permission denied".
      appName: this.conn.appName?.trim() || APP_NAME,
      appVersion: APP_VERSION,
      systemName: this.conn.systemName || 'Rithmic Test',
      infraType: INFRA.ORDER_PLANT, // order plant carries orders, accounts, and pushes
      userMsg: ['login'],
    };
  }

  private send(templateId: number, fields: Record<string, unknown>): void {
    if (!this.ws) return;
    this.ws.send(encode(templateId, fields));
  }

  private startHeartbeat(intervalSec: number): void {
    this.stopHeartbeat();
    const ms = Math.max(1000, Math.min(60000, (intervalSec || 60) * 1000) - 1000);
    this.heartbeatTimer = setInterval(() => this.send(18, {}), ms);
  }
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** Route one decoded server frame. Exposed pure via handleDecoded for tests. */
  private onFrame(data: unknown): void {
    // arraybuffer path is synchronous (what browsers deliver here); a Blob
    // fallback resolves asynchronously but is never hit with binaryType set
    const sync = bytesSync(data);
    if (sync) {
      const msg = decode(sync);
      if (msg) this.handleDecoded(msg);
      return;
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      void data.arrayBuffer().then((ab) => {
        const msg = decode(new Uint8Array(ab));
        if (msg) this.handleDecoded(msg);
      });
    }
  }

  /** Pure-ish router: takes a decoded message, updates state, emits events. */
  handleDecoded(msg: DecodedMessage): void {
    switch (msg.templateId) {
      case 17: { // ResponseRithmicSystemInfo
        this.emit({ type: 'systems', systems: (msg.systemName as string[]) ?? [] });
        break;
      }
      case 11: { // ResponseLogin
        const rp = (msg.rpCode as string[]) ?? [];
        if (rp[0] && rp[0] !== '0') {
          // Rithmic explains the denial in user_msg (e.g. "permission denied",
          // "invalid system name") — surface the full text, not just the code
          const reason = [...((msg.userMsg as string[]) ?? []), ...rp.slice(1)].filter(Boolean).join(' · ');
          this.setState('error', `Login rejected${reason ? `: ${reason}` : ` (code ${rp[0]})`}`);
          return;
        }
        this.fcmId = String(msg.fcmId ?? '');
        this.ibId = String(msg.ibId ?? '');
        this.emit({ type: 'login', fcmId: this.fcmId, ibId: this.ibId, userId: String(msg.uniqueUserId ?? '') });
        this.startHeartbeat(Number(msg.heartbeatInterval) || 60);
        this.setState('ready');
        // pull the account context needed to trade
        this.send(300, {}); // login info
        this.send(302, { fcmId: this.fcmId, ibId: this.ibId, userType: 3 }); // account list (trader)
        this.send(310, { subscribeForUpdates: true }); // trade routes
        break;
      }
      case 303: { // ResponseAccountList
        const accountId = String(msg.accountId ?? '');
        if (accountId) {
          const account: Account = {
            accountId,
            accountName: String(msg.accountName ?? accountId),
            currency: String(msg.accountCurrency ?? ''),
            fcmId: String(msg.fcmId ?? this.fcmId),
            ibId: String(msg.ibId ?? this.ibId),
          };
          if (!this.accounts.some((a) => a.accountId === accountId)) this.accounts.push(account);
          this.emit({ type: 'account', account });
        }
        break;
      }
      case 311: { // ResponseTradeRoutes
        const tr = String(msg.tradeRoute ?? '');
        if (tr) {
          const route: TradeRoute = { exchange: String(msg.exchange ?? ''), tradeRoute: tr, isDefault: Boolean(msg.isDefault) };
          if (!this.routes.some((r) => r.tradeRoute === tr && r.exchange === route.exchange)) this.routes.push(route);
          this.emit({ type: 'route', route });
        }
        break;
      }
      case 150: { // LastTrade
        this.mergeQuote(msg, { last: msg.tradePrice, netChange: msg.netChange, volume: msg.volume });
        break;
      }
      case 151: { // BestBidOffer
        this.mergeQuote(msg, { bid: msg.bidPrice, ask: msg.askPrice });
        break;
      }
      case 351: // RithmicOrderNotification
      case 352: { // ExchangeOrderNotification
        this.emit({ type: 'order', update: {
          at: Date.now(),
          templateId: msg.templateId,
          notifyType: msg.notifyType != null ? Number(msg.notifyType) : null,
          status: String(msg.status ?? ''),
          symbol: String(msg.symbol ?? ''),
          exchange: String(msg.exchange ?? ''),
          side: msg.transactionType != null ? Number(msg.transactionType) : null,
          quantity: msg.quantity != null ? Number(msg.quantity) : null,
          price: msg.price != null ? Number(msg.price) : null,
          avgFillPrice: msg.avgFillPrice != null ? Number(msg.avgFillPrice) : (msg.fillPrice != null ? Number(msg.fillPrice) : null),
          totalFillSize: msg.totalFillSize != null ? Number(msg.totalFillSize) : (msg.fillSize != null ? Number(msg.fillSize) : null),
          text: String(msg.text ?? ''),
          basketId: String(msg.basketId ?? ''),
        } });
        break;
      }
      case 19: // heartbeat response — liveness only
      case 101: // market-data ack
      case 301: // login info
      case 309: // order-updates subscribe ack
        break;
      default:
        this.emit({ type: 'log', message: `unhandled ${msg.name} (${msg.templateId})` });
    }
  }

  private mergeQuote(msg: DecodedMessage, patch: Record<string, unknown>): void {
    const symbol = String(msg.symbol ?? '');
    const exchange = String(msg.exchange ?? '');
    if (!symbol) return;
    const key = `${symbol}.${exchange}`;
    const prev = this.quotes.get(key) ?? { symbol, exchange, last: null, bid: null, ask: null, netChange: null, volume: null, at: 0 };
    const next: Quote = {
      ...prev,
      last: patch.last != null ? Number(patch.last) : prev.last,
      bid: patch.bid != null ? Number(patch.bid) : prev.bid,
      ask: patch.ask != null ? Number(patch.ask) : prev.ask,
      netChange: patch.netChange != null ? Number(patch.netChange) : prev.netChange,
      volume: patch.volume != null ? Number(patch.volume) : prev.volume,
      at: Date.now(),
    };
    this.quotes.set(key, next);
    this.emit({ type: 'quote', quote: next });
  }

  subscribeQuote(symbol: string, exchange: string): void {
    this.send(100, { symbol, exchange, request: MD_REQUEST.SUBSCRIBE, updateBits: UPDATE_BITS.LAST_TRADE | UPDATE_BITS.BBO });
  }
  unsubscribeQuote(symbol: string, exchange: string): void {
    this.send(100, { symbol, exchange, request: MD_REQUEST.UNSUBSCRIBE, updateBits: UPDATE_BITS.LAST_TRADE | UPDATE_BITS.BBO });
  }
  subscribeOrders(accountId: string): void {
    this.send(308, { fcmId: this.fcmId, ibId: this.ibId, accountId });
  }

  /**
   * Build the RequestNewOrder fields from a ticket. Pure + exported logic so
   * the exact wire an order would send is unit-testable WITHOUT a connection.
   */
  buildOrder(t: OrderTicket): Record<string, unknown> {
    const priceType = PRICE_TYPE[t.priceType];
    const fields: Record<string, unknown> = {
      fcmId: this.fcmId,
      ibId: this.ibId,
      accountId: t.accountId,
      symbol: t.symbol,
      exchange: t.exchange,
      tradeRoute: t.tradeRoute,
      quantity: Math.max(1, Math.round(t.quantity)),
      transactionType: t.side === 'BUY' ? SIDE.BUY : SIDE.SELL,
      duration: DURATION[t.duration],
      priceType,
      manualOrAuto: MANUAL_AUTO.MANUAL,
      userTag: 'edge-intel',
      userMsg: ['edge-intelligence order'],
    };
    if (t.priceType === 'LIMIT' || t.priceType === 'STOP_LIMIT') fields.price = t.price;
    if (t.priceType === 'STOP_MARKET' || t.priceType === 'STOP_LIMIT') fields.triggerPrice = t.triggerPrice;
    return fields;
  }

  /**
   * Submit a live order. Refuses unless (a) the connection is ready and (b)
   * live submission was explicitly armed. Returns an error string or null.
   * The UI must additionally confirm each order before calling this.
   */
  submitOrder(t: OrderTicket): string | null {
    if (this.state !== 'ready') return 'Not connected to Rithmic.';
    if (!this.armed) return 'Live order submission is not armed. Toggle "Arm live trading" first.';
    const guard = validateTicket(t);
    if (guard) return guard;
    this.send(312, this.buildOrder(t));
    this.emit({ type: 'log', message: `order sent: ${t.side} ${t.quantity} ${t.symbol} ${t.priceType}${t.price ? ` @ ${t.price}` : ''}` });
    return null;
  }
}

/** Pure ticket validation — shared by the client and the UI. */
export function validateTicket(t: OrderTicket): string | null {
  if (!t.accountId) return 'Choose an account.';
  if (!t.symbol.trim()) return 'Enter a contract symbol (e.g. ESZ6).';
  if (!t.exchange.trim()) return 'Enter the exchange (e.g. CME).';
  if (!t.tradeRoute.trim()) return 'No trade route available for this account/exchange yet.';
  if (!Number.isFinite(t.quantity) || t.quantity < 1) return 'Quantity must be at least 1.';
  if ((t.priceType === 'LIMIT' || t.priceType === 'STOP_LIMIT') && !(Number(t.price) > 0)) return 'Limit orders need a limit price.';
  if ((t.priceType === 'STOP_MARKET' || t.priceType === 'STOP_LIMIT') && !(Number(t.triggerPrice) > 0)) return 'Stop orders need a trigger price.';
  return null;
}

/** Human label for an order-notification notify_type (RithmicOrderNotification). */
export function notifyLabel(n: number | null): string {
  const map: Record<number, string> = {
    1: 'received', 2: 'modify received', 3: 'cancel received', 4: 'open pending', 5: 'modify pending',
    6: 'cancel pending', 7: 'at gateway', 10: 'sent to exch', 13: 'working', 14: 'modified',
    15: 'complete', 16: 'modify failed', 17: 'cancel failed', 18: 'trigger pending', 19: 'generic',
  };
  return n != null && map[n] ? map[n] : 'update';
}
