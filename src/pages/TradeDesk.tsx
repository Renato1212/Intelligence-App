import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Connects } from '../components/Connects';
import { Principle, useToast } from '../components/ui';
import { loadConn, RITHMIC_ENVS } from '../lib/rithmic';
import {
  notifyLabel,
  RProtocolClient,
  validateTicket,
  type Account,
  type ConnState,
  type OrderTicket,
  type OrderUpdate,
  type Quote,
  type TradeRoute,
} from '../lib/rithmicClient';

/*
 * Trade Desk — live trading against Rithmic's R | Trade Execution Platform,
 * directly from the browser via the R | Protocol client. Connect, watch live
 * quotes, see your accounts and trade routes, and place orders — with live
 * submission gated behind an explicit arm switch and a per-order confirm.
 *
 * The page is deliberately conservative: it defaults to the credentials saved
 * on this device (Settings → Trading connection), never sends an order without
 * arming + confirming, and shows the full order/fill notification stream so
 * nothing happens invisibly.
 */

const STATE_LABEL: Record<ConnState, { text: string; color: string }> = {
  idle: { text: 'Not connected', color: 'var(--muted)' },
  connecting: { text: 'Connecting…', color: 'var(--gold)' },
  systems: { text: 'Listing systems…', color: 'var(--gold)' },
  'logging-in': { text: 'Logging in…', color: 'var(--gold)' },
  ready: { text: 'Connected · live', color: 'var(--profit)' },
  error: { text: 'Error', color: 'var(--loss)' },
  closed: { text: 'Disconnected', color: 'var(--muted)' },
};

export default function TradeDesk() {
  const toast = useToast();
  const conn = loadConn();
  const clientRef = useRef<RProtocolClient | null>(null);

  const [state, setState] = useState<ConnState>('idle');
  const [detail, setDetail] = useState('');
  const [systems, setSystems] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [routes, setRoutes] = useState<TradeRoute[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [orders, setOrders] = useState<OrderUpdate[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);

  // order ticket
  const [account, setAccount] = useState('');
  const [symbol, setSymbol] = useState('ESZ6');
  const [exchange, setExchange] = useState('CME');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty] = useState(1);
  const [priceType, setPriceType] = useState<OrderTicket['priceType']>('LIMIT');
  const [price, setPrice] = useState('');
  const [trigger, setTrigger] = useState('');
  const [duration, setDuration] = useState<OrderTicket['duration']>('DAY');
  const [confirm, setConfirm] = useState<OrderTicket | null>(null);

  useEffect(() => () => clientRef.current?.disconnect(), []);

  const connect = () => {
    if (!conn) {
      toast('Save your Rithmic connection in Settings first.');
      return;
    }
    const client = new RProtocolClient(conn);
    clientRef.current = client;
    client.on((e) => {
      if (e.type === 'state') { setState(e.state); if (e.detail) setDetail(e.detail); }
      else if (e.type === 'systems') setSystems(e.systems);
      else if (e.type === 'account') setAccounts((a) => (a.some((x) => x.accountId === e.account.accountId) ? a : [...a, e.account]));
      else if (e.type === 'route') setRoutes((r) => (r.some((x) => x.tradeRoute === e.route.tradeRoute && x.exchange === e.route.exchange) ? r : [...r, e.route]));
      else if (e.type === 'quote') setQuotes((q) => ({ ...q, [`${e.quote.symbol}.${e.quote.exchange}`]: e.quote }));
      else if (e.type === 'order') setOrders((o) => [e.update, ...o].slice(0, 40));
      else if (e.type === 'log') setLog((l) => [e.message, ...l].slice(0, 12));
    });
    client.connect();
  };

  const disconnect = () => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setArmed(false);
  };

  const toggleArm = () => {
    const c = clientRef.current;
    if (!c) return;
    const next = !armed;
    c.arm(next);
    setArmed(next);
  };

  // default the ticket account/route once they arrive
  useEffect(() => {
    if (!account && accounts[0]) setAccount(accounts[0].accountId);
  }, [accounts, account]);
  const routeFor = useMemo(() => routes.find((r) => r.exchange === exchange) ?? routes.find((r) => r.isDefault) ?? routes[0] ?? null, [routes, exchange]);

  const ticket = (): OrderTicket => ({
    accountId: account,
    symbol: symbol.trim().toUpperCase(),
    exchange: exchange.trim().toUpperCase(),
    tradeRoute: routeFor?.tradeRoute ?? '',
    side,
    quantity: Number(qty),
    priceType,
    price: price ? Number(price) : undefined,
    triggerPrice: trigger ? Number(trigger) : undefined,
    duration,
  });

  const reviewOrder = () => {
    const t = ticket();
    const err = validateTicket(t);
    if (err) { toast(err); return; }
    if (!armed) { toast('Arm live trading first (top right).'); return; }
    setConfirm(t);
  };
  const sendConfirmed = () => {
    const c = clientRef.current;
    if (!c || !confirm) return;
    const err = c.submitOrder(confirm);
    setConfirm(null);
    if (err) toast(err);
    else toast('Order sent to Rithmic.');
  };

  const watched = () => {
    const c = clientRef.current;
    if (!c) { toast('Connect first.'); return; }
    c.subscribeQuote(symbol.trim().toUpperCase(), exchange.trim().toUpperCase());
    if (account) c.subscribeOrders(account);
  };

  const ready = state === 'ready';
  const sl = STATE_LABEL[state];
  const isLive = conn?.env === 'live';

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Trade Desk</h1>
          <div className="page-sub">
            Live trading on Rithmic&apos;s R&nbsp;|&nbsp;Trade Execution Platform, direct from the browser — quotes,
            accounts, order routing and execution, with hard safety gates.
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="chip" style={{ background: sl.color, color: '#141210', fontWeight: 700 }}>{sl.text}</span>
          {!ready ? (
            <button className="btn primary" onClick={connect} disabled={state === 'connecting' || state === 'logging-in'}>Connect</button>
          ) : (
            <button className="btn" onClick={disconnect}>Disconnect</button>
          )}
        </div>
      </div>

      {!conn && (
        <div className="card" style={{ borderLeft: '3px solid var(--gold)' }}>
          <b>No Rithmic connection saved.</b> Add your credentials, environment and gateway in{' '}
          <Link to="/settings" style={{ color: 'var(--gold)' }}>Settings → Trading connection</Link> first, then come back here to connect.
        </div>
      )}

      {detail && (state === 'error' || state === 'closed') && <div className="card small" style={{ color: state === 'error' ? 'var(--loss)' : 'var(--muted)' }}>{detail}</div>}

      {/* arm / environment banner */}
      {conn && (
        <div className="card" style={{ borderLeft: `4px solid ${armed ? 'var(--loss)' : 'var(--profit)'}` }}>
          <div className="spread" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div className="small">
              <b>{RITHMIC_ENVS.find((e) => e.id === conn.env)?.label ?? conn.env}</b> · {conn.gatewayUrl}
              {isLive && <span className="chip" style={{ marginLeft: 8, background: 'var(--loss)', color: '#141210', fontWeight: 700 }}>PRODUCTION — real money</span>}
              <div className="muted" style={{ marginTop: 3 }}>
                {armed
                  ? 'Live order submission is ARMED. Orders you confirm will be sent to the exchange.'
                  : 'Live order submission is disarmed. You can connect, watch quotes and stage orders safely; nothing is sent until you arm and confirm.'}
              </div>
            </div>
            <button className="btn" onClick={toggleArm} disabled={!ready} style={{ borderColor: armed ? 'var(--loss)' : undefined, color: armed ? 'var(--loss)' : undefined }}>
              {armed ? 'Disarm live trading' : 'Arm live trading'}
            </button>
          </div>
        </div>
      )}

      {systems.length > 0 && (
        <div className="card small">
          <b>Available systems:</b> {systems.join(' · ')} <span className="muted">— set the matching system name in Settings if login is rejected.</span>
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 14, alignItems: 'start' }}>
        {/* order ticket */}
        <div className="card">
          <div className="card-title">Order ticket <span className="hint">staged locally — armed + confirmed before anything is sent</span></div>
          <div className="stack" style={{ gap: 8 }}>
            <label className="small muted">Account
              <select value={account} onChange={(e) => setAccount(e.target.value)} className="input" style={selStyle}>
                {accounts.length === 0 && <option value="">— connect to load —</option>}
                {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.accountName} ({a.accountId}) {a.currency}</option>)}
              </select>
            </label>
            <div className="row" style={{ gap: 8 }}>
              <label className="small muted" style={{ flex: 1 }}>Symbol
                <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className="input" style={inpStyle} placeholder="ESZ6" />
              </label>
              <label className="small muted" style={{ width: 110 }}>Exchange
                <input value={exchange} onChange={(e) => setExchange(e.target.value)} className="input" style={inpStyle} placeholder="CME" />
              </label>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 4 }}>
                {(['BUY', 'SELL'] as const).map((s) => (
                  <span key={s} className={`chip clickable ${side === s ? 'selected' : ''}`} onClick={() => setSide(s)} style={side === s ? { background: s === 'BUY' ? 'var(--profit)' : 'var(--loss)', color: '#141210', borderColor: 'transparent', fontWeight: 700 } : undefined}>{s}</span>
                ))}
              </div>
              <label className="small muted" style={{ width: 90 }}>Qty
                <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="input" style={inpStyle} />
              </label>
              <label className="small muted" style={{ flex: 1 }}>Type
                <select value={priceType} onChange={(e) => setPriceType(e.target.value as OrderTicket['priceType'])} className="input" style={selStyle}>
                  <option value="MARKET">Market</option>
                  <option value="LIMIT">Limit</option>
                  <option value="STOP_MARKET">Stop</option>
                  <option value="STOP_LIMIT">Stop-limit</option>
                </select>
              </label>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {(priceType === 'LIMIT' || priceType === 'STOP_LIMIT') && (
                <label className="small muted" style={{ flex: 1 }}>Limit price
                  <input value={price} onChange={(e) => setPrice(e.target.value)} className="input" style={inpStyle} placeholder="5000.25" />
                </label>
              )}
              {(priceType === 'STOP_MARKET' || priceType === 'STOP_LIMIT') && (
                <label className="small muted" style={{ flex: 1 }}>Trigger price
                  <input value={trigger} onChange={(e) => setTrigger(e.target.value)} className="input" style={inpStyle} placeholder="4990.00" />
                </label>
              )}
              <label className="small muted" style={{ width: 110 }}>Duration
                <select value={duration} onChange={(e) => setDuration(e.target.value as OrderTicket['duration'])} className="input" style={selStyle}>
                  <option value="DAY">Day</option><option value="GTC">GTC</option><option value="IOC">IOC</option><option value="FOK">FOK</option>
                </select>
              </label>
            </div>
            <div className="small muted">Route: <b style={{ color: 'var(--text)' }}>{routeFor ? `${routeFor.tradeRoute} (${routeFor.exchange})` : '— none yet —'}</b></div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" onClick={watched} disabled={!ready}>Watch quote</button>
              <button className="btn primary" onClick={reviewOrder} disabled={!ready || !armed} style={{ flex: 1 }}>
                Review {side} {qty} {symbol}
              </button>
            </div>
          </div>
        </div>

        {/* live quotes + accounts */}
        <div className="stack" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-title">Live quotes</div>
            {Object.keys(quotes).length === 0 ? (
              <div className="muted small">Connect and press &quot;Watch quote&quot; to stream a contract&apos;s last / bid / ask live from Rithmic.</div>
            ) : (
              <table className="data" style={{ width: '100%' }}>
                <thead><tr><th>Contract</th><th style={{ textAlign: 'right' }}>Last</th><th style={{ textAlign: 'right' }}>Bid</th><th style={{ textAlign: 'right' }}>Ask</th><th style={{ textAlign: 'right' }}>Chg</th></tr></thead>
                <tbody>
                  {Object.values(quotes).map((q) => (
                    <tr key={`${q.symbol}.${q.exchange}`}>
                      <td className="mono">{q.symbol}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{q.last ?? '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{q.bid ?? '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{q.ask ?? '—'}</td>
                      <td className={`mono ${q.netChange != null && q.netChange > 0 ? 'pos' : q.netChange != null && q.netChange < 0 ? 'neg' : ''}`} style={{ textAlign: 'right' }}>{q.netChange ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <div className="card-title">Accounts & routes</div>
            {accounts.length === 0 ? <div className="muted small">Your Rithmic accounts and trade routes load here on connect.</div> : (
              <div className="stack" style={{ gap: 4 }}>
                {accounts.map((a) => <div key={a.accountId} className="small"><b>{a.accountName}</b> <span className="muted">{a.accountId} · {a.currency}</span></div>)}
                <div className="small muted" style={{ marginTop: 4 }}>Routes: {routes.length ? routes.map((r) => `${r.tradeRoute}/${r.exchange}`).join(' · ') : '—'}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* order / fill stream */}
      <div className="card">
        <div className="card-title">Order & fill stream <span className="hint">every notification Rithmic pushes — nothing happens invisibly</span></div>
        {orders.length === 0 ? <div className="muted small">Working orders, modifications and fills appear here in real time once you subscribe (Watch quote also subscribes order updates for the selected account).</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data" style={{ minWidth: 560 }}>
              <thead><tr><th>Time</th><th>Status</th><th>Side</th><th>Contract</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ textAlign: 'right' }}>Filled</th></tr></thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={`${o.basketId}-${o.at}-${i}`}>
                    <td className="mono small">{new Date(o.at).toLocaleTimeString()}</td>
                    <td className="small">{o.status || notifyLabel(o.notifyType)}</td>
                    <td className={`small ${o.side === 1 ? 'pos' : o.side === 2 ? 'neg' : ''}`}>{o.side === 1 ? 'BUY' : o.side === 2 ? 'SELL' : '—'}</td>
                    <td className="mono">{o.symbol}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{o.quantity ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{o.avgFillPrice ?? o.price ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{o.totalFillSize ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log.length > 0 && <div className="small muted mono" style={{ marginTop: 8 }}>{log[0]}</div>}
      </div>

      <div className="card">
        <Principle domain="Execution — the platform closes the loop">
          Every other section prepares the trade; the Trade Desk takes it. That is also why the guardrails are strict:
          orders are staged locally, require arming the live switch, and each one is confirmed before it leaves your
          browser — the same discipline the rest of the app teaches (decide before you click, size to your risk limit,
          never improvise mid-trade). Trade the Test/Paper system until the flow is second nature; the wire is
          identical to production, so nothing changes when you flip the switch except that it is real.
        </Principle>
      </div>

      <Connects id="tradedesk" />

      {confirm && (
        <div style={overlay} onClick={() => setConfirm(null)}>
          <div className="card" style={{ maxWidth: 420, width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <div className="card-title" style={{ color: confirm.side === 'BUY' ? 'var(--profit)' : 'var(--loss)' }}>Confirm order</div>
            <div className="small" style={{ lineHeight: 1.8 }}>
              <div><b style={{ fontSize: 16 }}>{confirm.side} {confirm.quantity} {confirm.symbol}</b> on {confirm.exchange}</div>
              <div>{confirm.priceType}{confirm.price ? ` @ ${confirm.price}` : ''}{confirm.triggerPrice ? ` trigger ${confirm.triggerPrice}` : ''} · {confirm.duration}</div>
              <div className="muted">Account {confirm.accountId} · route {confirm.tradeRoute}</div>
              {isLive && <div style={{ color: 'var(--loss)', fontWeight: 700, marginTop: 6 }}>This is a PRODUCTION order — real money.</div>}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setConfirm(null)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn primary" onClick={sendConfirmed} style={{ flex: 1, background: confirm.side === 'BUY' ? 'var(--profit)' : 'var(--loss)', color: '#141210' }}>Send order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inpStyle: React.CSSProperties = { width: '100%', padding: '7px 9px', marginTop: 3, background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--text)' };
const selStyle = inpStyle;
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
