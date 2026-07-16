/*
 * R | Protocol wire codec — an ORIGINAL, minimal Protocol Buffers reader/writer
 * plus a hand-written field registry for the Rithmic messages this app uses.
 *
 * Rithmic's R | Protocol API is "a wire line spec, not compiled software": it
 * is Google Protocol Buffers over WebSockets, one message per binary frame.
 * The protobuf WIRE FORMAT is an open, documented standard — this file
 * implements just the slice of it the messages need (varint, length-delimited,
 * fixed64) with no dependency and no generated code. The field NUMBERS below
 * are the protocol's interface (like API endpoint names), transcribed so the
 * app can interoperate; none of Rithmic's licensed source or .proto files are
 * bundled.
 *
 * Everything here is pure and unit-tested with known-byte vectors.
 */

/* ------------------------------ wire writer ------------------------------- */

class Writer {
  private buf: number[] = [];
  private varint(n: number): void {
    let v = n >>> 0 === n ? n : Math.floor(n); // non-negative ints in our schema
    while (v > 0x7f) {
      this.buf.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.buf.push(v & 0x7f);
  }
  tag(fieldNo: number, wire: number): void {
    this.varint(fieldNo * 8 + wire);
  }
  int(fieldNo: number, v: number): void {
    this.tag(fieldNo, 0);
    this.varint(v);
  }
  bool(fieldNo: number, v: boolean): void {
    this.tag(fieldNo, 0);
    this.varint(v ? 1 : 0);
  }
  double(fieldNo: number, v: number): void {
    this.tag(fieldNo, 1);
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v, true); // little-endian
    for (let i = 0; i < 8; i++) this.buf.push(dv.getUint8(i));
  }
  string(fieldNo: number, v: string): void {
    this.tag(fieldNo, 2);
    const bytes = new TextEncoder().encode(v);
    this.varint(bytes.length);
    for (const b of bytes) this.buf.push(b);
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

/* ------------------------------ wire reader ------------------------------- */

class Reader {
  private pos = 0;
  constructor(private readonly b: Uint8Array) {}
  get done(): boolean {
    return this.pos >= this.b.length;
  }
  varint(): number {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.b[this.pos++];
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) break;
      shift *= 128;
    }
    return result;
  }
  double(): number {
    const dv = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 8);
    this.pos += 8;
    return dv.getFloat64(0, true);
  }
  lenBytes(): Uint8Array {
    const len = this.varint();
    const out = this.b.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  string(): string {
    return new TextDecoder().decode(this.lenBytes());
  }
  /** advance past a field of the given wire type we don't model */
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
  }
}

/* ----------------------------- field registry ----------------------------- */

export type FieldType = 'int' | 'bool' | 'double' | 'string';
export interface FieldSpec {
  no: number;
  type: FieldType;
  repeated?: boolean;
}
export type Schema = Record<string, FieldSpec>;

// field numbers common to every message
const TEMPLATE_ID = 154467;
const F = {
  templateId: { no: TEMPLATE_ID, type: 'int' as const },
  userMsg: { no: 132760, type: 'string' as const, repeated: true },
  rpCode: { no: 132766, type: 'string' as const, repeated: true },
  fcmId: { no: 154013, type: 'string' as const },
  ibId: { no: 154014, type: 'string' as const },
  accountId: { no: 154008, type: 'string' as const },
  symbol: { no: 110100, type: 'string' as const },
  exchange: { no: 110101, type: 'string' as const },
};

/**
 * The messages the app speaks, keyed by template_id. Only the fields the UI
 * needs are modeled; unknown fields on the wire are skipped safely.
 */
export const TEMPLATES: Record<number, { name: string; schema: Schema }> = {
  10: { name: 'RequestLogin', schema: {
    templateId: F.templateId, templateVersion: { no: 153634, type: 'string' }, userMsg: F.userMsg,
    user: { no: 131003, type: 'string' }, password: { no: 130004, type: 'string' },
    appName: { no: 130002, type: 'string' }, appVersion: { no: 131803, type: 'string' },
    systemName: { no: 153628, type: 'string' }, infraType: { no: 153621, type: 'int' },
  } },
  11: { name: 'ResponseLogin', schema: {
    templateId: F.templateId, userMsg: F.userMsg, rpCode: F.rpCode, fcmId: F.fcmId, ibId: F.ibId,
    uniqueUserId: { no: 153428, type: 'string' }, heartbeatInterval: { no: 153633, type: 'double' },
  } },
  12: { name: 'RequestLogout', schema: { templateId: F.templateId, userMsg: F.userMsg } },
  13: { name: 'ResponseLogout', schema: { templateId: F.templateId, rpCode: F.rpCode } },
  16: { name: 'RequestRithmicSystemInfo', schema: { templateId: F.templateId, userMsg: F.userMsg } },
  17: { name: 'ResponseRithmicSystemInfo', schema: {
    templateId: F.templateId, userMsg: F.userMsg, rpCode: F.rpCode,
    systemName: { no: 153628, type: 'string', repeated: true },
  } },
  18: { name: 'RequestHeartbeat', schema: { templateId: F.templateId } },
  19: { name: 'ResponseHeartbeat', schema: { templateId: F.templateId } },
  100: { name: 'RequestMarketDataUpdate', schema: {
    templateId: F.templateId, userMsg: F.userMsg, symbol: F.symbol, exchange: F.exchange,
    request: { no: 100000, type: 'int' }, updateBits: { no: 154211, type: 'int' },
  } },
  101: { name: 'ResponseMarketDataUpdate', schema: { templateId: F.templateId, rpCode: F.rpCode } },
  150: { name: 'LastTrade', schema: {
    templateId: F.templateId, symbol: F.symbol, exchange: F.exchange,
    tradePrice: { no: 100006, type: 'double' }, tradeSize: { no: 100178, type: 'int' },
    netChange: { no: 100011, type: 'double' }, percentChange: { no: 100056, type: 'double' },
    volume: { no: 100032, type: 'int' },
  } },
  151: { name: 'BestBidOffer', schema: {
    templateId: F.templateId, symbol: F.symbol, exchange: F.exchange,
    bidPrice: { no: 100022, type: 'double' }, bidSize: { no: 100030, type: 'int' },
    askPrice: { no: 100025, type: 'double' }, askSize: { no: 100031, type: 'int' },
  } },
  300: { name: 'RequestLoginInfo', schema: { templateId: F.templateId } },
  301: { name: 'ResponseLoginInfo', schema: {
    templateId: F.templateId, rpCode: F.rpCode, fcmId: F.fcmId, ibId: F.ibId,
    user: { no: 131003, type: 'string' }, firstName: { no: 154216, type: 'string' },
    lastName: { no: 154217, type: 'string' }, userType: { no: 154036, type: 'int' },
  } },
  302: { name: 'RequestAccountList', schema: {
    templateId: F.templateId, userMsg: F.userMsg, fcmId: F.fcmId, ibId: F.ibId,
    userType: { no: 154036, type: 'int' },
  } },
  303: { name: 'ResponseAccountList', schema: {
    templateId: F.templateId, rpCode: F.rpCode, fcmId: F.fcmId, ibId: F.ibId,
    accountId: F.accountId, accountName: { no: 154002, type: 'string' },
    accountCurrency: { no: 154383, type: 'string' },
  } },
  308: { name: 'RequestSubscribeForOrderUpdates', schema: {
    templateId: F.templateId, userMsg: F.userMsg, fcmId: F.fcmId, ibId: F.ibId, accountId: F.accountId,
  } },
  309: { name: 'ResponseSubscribeForOrderUpdates', schema: { templateId: F.templateId, rpCode: F.rpCode } },
  310: { name: 'RequestTradeRoutes', schema: {
    templateId: F.templateId, userMsg: F.userMsg, subscribeForUpdates: { no: 154352, type: 'bool' },
  } },
  311: { name: 'ResponseTradeRoutes', schema: {
    templateId: F.templateId, rpCode: F.rpCode, fcmId: F.fcmId, ibId: F.ibId, exchange: F.exchange,
    tradeRoute: { no: 112016, type: 'string' }, status: { no: 131407, type: 'string' },
    isDefault: { no: 154689, type: 'bool' },
  } },
  312: { name: 'RequestNewOrder', schema: {
    templateId: F.templateId, userMsg: F.userMsg, userTag: { no: 154119, type: 'string' },
    fcmId: F.fcmId, ibId: F.ibId, accountId: F.accountId, symbol: F.symbol, exchange: F.exchange,
    quantity: { no: 112004, type: 'int' }, price: { no: 110306, type: 'double' },
    triggerPrice: { no: 149247, type: 'double' }, transactionType: { no: 112003, type: 'int' },
    duration: { no: 112005, type: 'int' }, priceType: { no: 112008, type: 'int' },
    tradeRoute: { no: 112016, type: 'string' }, manualOrAuto: { no: 154710, type: 'int' },
  } },
  313: { name: 'ResponseNewOrder', schema: {
    templateId: F.templateId, userMsg: F.userMsg, rpCode: F.rpCode, userTag: { no: 154119, type: 'string' },
    basketId: { no: 110300, type: 'string' },
  } },
  351: { name: 'RithmicOrderNotification', schema: {
    templateId: F.templateId, notifyType: { no: 153625, type: 'int' }, status: { no: 110303, type: 'string' },
    symbol: F.symbol, exchange: F.exchange, accountId: F.accountId,
    transactionType: { no: 112003, type: 'int' }, quantity: { no: 112004, type: 'int' },
    price: { no: 110306, type: 'double' }, avgFillPrice: { no: 110322, type: 'double' },
    totalFillSize: { no: 154111, type: 'int' }, totalUnfilledSize: { no: 154112, type: 'int' },
    completionReason: { no: 149273, type: 'string' }, text: { no: 120008, type: 'string' },
    basketId: { no: 110300, type: 'string' },
  } },
  352: { name: 'ExchangeOrderNotification', schema: {
    templateId: F.templateId, notifyType: { no: 153625, type: 'int' }, status: { no: 110303, type: 'string' },
    symbol: F.symbol, exchange: F.exchange, accountId: F.accountId,
    transactionType: { no: 112003, type: 'int' }, quantity: { no: 112004, type: 'int' },
    price: { no: 110306, type: 'double' }, fillPrice: { no: 110322, type: 'double' },
    fillSize: { no: 112012, type: 'int' }, text: { no: 120008, type: 'string' },
    basketId: { no: 110300, type: 'string' },
  } },
};

/** infra_type enum (RequestLogin.SysInfraType). */
export const INFRA = { TICKER_PLANT: 1, ORDER_PLANT: 2, HISTORY_PLANT: 3, PNL_PLANT: 4, REPOSITORY_PLANT: 5 } as const;
/** market-data UpdateBits. */
export const UPDATE_BITS = { LAST_TRADE: 1, BBO: 2 } as const;
export const MD_REQUEST = { SUBSCRIBE: 1, UNSUBSCRIBE: 2 } as const;
/** order enums. */
export const SIDE = { BUY: 1, SELL: 2 } as const;
export const DURATION = { DAY: 1, GTC: 2, IOC: 3, FOK: 4 } as const;
export const PRICE_TYPE = { LIMIT: 1, MARKET: 2, STOP_LIMIT: 3, STOP_MARKET: 4 } as const;
export const MANUAL_AUTO = { MANUAL: 1, AUTO: 2 } as const;

/* ------------------------------ encode/decode ----------------------------- */

/** Peek only the template_id from a frame (the base-class routing trick). */
export function peekTemplateId(bytes: Uint8Array): number | null {
  const r = new Reader(bytes);
  while (!r.done) {
    const tag = r.varint();
    const fieldNo = Math.floor(tag / 8);
    const wire = tag % 8;
    if (fieldNo === TEMPLATE_ID && wire === 0) return r.varint();
    r.skip(wire);
  }
  return null;
}

/** Encode a message object for the given template_id into a wire frame. */
export function encode(templateId: number, obj: Record<string, unknown>): Uint8Array {
  const tpl = TEMPLATES[templateId];
  if (!tpl) throw new Error(`unknown template ${templateId}`);
  const w = new Writer();
  // template_id first, always present
  w.int(TEMPLATE_ID, templateId);
  for (const [key, spec] of Object.entries(tpl.schema)) {
    if (key === 'templateId') continue;
    const val = obj[key];
    if (val == null) continue;
    const write = (v: unknown) => {
      if (spec.type === 'string') w.string(spec.no, String(v));
      else if (spec.type === 'double') w.double(spec.no, Number(v));
      else if (spec.type === 'bool') w.bool(spec.no, Boolean(v));
      else w.int(spec.no, Number(v));
    };
    if (spec.repeated && Array.isArray(val)) val.forEach(write);
    else write(val);
  }
  return w.bytes();
}

export interface DecodedMessage {
  templateId: number;
  name: string;
  [key: string]: unknown;
}

/** Decode a wire frame into a plain object using the registry. */
export function decode(bytes: Uint8Array): DecodedMessage | null {
  const templateId = peekTemplateId(bytes);
  if (templateId == null) return null;
  const tpl = TEMPLATES[templateId];
  if (!tpl) return { templateId, name: `Unknown(${templateId})` };
  const byNo = new Map<number, [string, FieldSpec]>();
  for (const entry of Object.entries(tpl.schema)) byNo.set(entry[1].no, entry);
  const out: DecodedMessage = { templateId, name: tpl.name };
  const r = new Reader(bytes);
  while (!r.done) {
    const tag = r.varint();
    const fieldNo = Math.floor(tag / 8);
    const wire = tag % 8;
    const field = byNo.get(fieldNo);
    if (!field) {
      r.skip(wire);
      continue;
    }
    const [key, spec] = field;
    let value: unknown;
    if (spec.type === 'string') value = r.string();
    else if (spec.type === 'double') value = r.double();
    else if (spec.type === 'bool') value = r.varint() !== 0;
    else value = r.varint();
    if (spec.repeated) {
      if (!Array.isArray(out[key])) out[key] = [];
      (out[key] as unknown[]).push(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
