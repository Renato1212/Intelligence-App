import type { Execution, Side, Trade } from '../domain/types';
import { domainFromLabel } from '../domain/taxonomy';
import { toISODateTime, toNumber } from './csv';
import { db } from './db';
import { extractExecutionsFromTable, importCSV, makeImportKey, normalizeOrderType } from './importers';
import { pointValue, symbolRoot } from './contracts';

/**
 * "Edge Capture" — the screen-extraction path for platforms with no API and
 * no CSV export (e.g. Trader One). A bookmarklet run on the logged-in page
 * reads every data table in the DOM (plus row images) and produces this JSON
 * payload; here it is parsed with the same header-alias engine as CSV
 * imports, so trade stats, tags, descriptions and photos come across.
 */
export interface CapturePayload {
  source: 'edge-capture';
  version: number;
  url?: string;
  title?: string;
  capturedAt?: string;
  tables: {
    headers: string[];
    rows: string[][];
    rowImages?: { row: number; src: string; dataUrl?: string }[];
  }[];
  /** v2+: JSON API responses recorded while the user browsed the platform */
  requests?: { url: string; body: string }[];
  /** v2+: page structure hints for debugging unsupported layouts */
  diagnostics?: {
    tables?: number;
    ariaGrids?: number;
    iframes?: number;
    crossOriginFrames?: number;
    canvases?: number;
    flutter?: boolean;
    jsonResponses?: number;
    /** v3: how many scan passes ran while recording (~1 per 800ms) */
    scans?: number;
    /** v3: distinct header signatures / total rows accumulated across all scans */
    accumulatedTables?: number;
    accumulatedRows?: number;
    textSample?: string;
  };
}

/** Structured diagnostics shown in the app when a capture yields zero trades. */
export interface CaptureDiagnostics {
  hint: string;
  raw?: CapturePayload['diagnostics'];
  /** Header row + one sample row for every table found, even ones that didn't parse as trades */
  tableSamples: { headers: string[]; sampleRow?: string[] }[];
  /** Flattened field names seen in JSON API responses, even ones rejected as non-trade arrays */
  jsonKeySamples: string[][];
}

export class CaptureError extends Error {
  diagnostics: CaptureDiagnostics;
  constructor(diagnostics: CaptureDiagnostics) {
    super(diagnostics.hint);
    this.name = 'CaptureError';
    this.diagnostics = diagnostics;
  }
}

export interface CaptureItem {
  trade: Trade;
  /** Same-origin images captured as data URLs → become photo attachments */
  images: { name: string; dataUrl: string }[];
  /** Cross-origin images that could not be inlined → become links */
  imageLinks: string[];
  /** Individual fills matched to this trade (scale-in/out detail) */
  executions: Execution[];
}

export interface CaptureParseResult {
  items: CaptureItem[];
  warnings: string[];
  sourceUrl: string;
  /** total fills matched across all trades */
  fillsFound: number;
  /**
   * When no fills were found: field-name samples of every JSON array the
   * capture recorded, so the execution structure can be seen/shared and
   * mapped precisely if the shape detector still missed it.
   */
  structureSamples: { url: string; keys: string[]; sampleRow: Record<string, unknown> }[];
}

function toCSVText(headers: string[], rows: string[][]): string {
  // quote anything the CSV layer could treat as a separator (it also splits on ; and tab)
  const cell = (v: string) => (/[",;\t\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers, ...rows].map((r) => r.map((c) => cell(c ?? '')).join(',')).join('\n');
}

export function isCapturePayload(text: string): boolean {
  if (!text.trimStart().startsWith('{')) return false;
  try {
    return JSON.parse(text)?.source === 'edge-capture';
  } catch {
    return false;
  }
}

/* ---------- JSON API response extraction (v2 network recording) ---------- */

const JSON_KEYS: Record<string, string[]> = {
  symbol: ['symbol', 'instrument', 'contract', 'market', 'ticker', 'inst', 'sym', 'symbolname', 'instrumentname', 'product', 'productcode', 'productname'],
  date: ['date', 'tradedate', 'day', 'sessiondate'],
  entryTime: ['entrytime', 'opentime', 'entrydate', 'opened', 'openedat', 'openat', 'entryts', 'entryat', 'starttime', 'open', 'entry'],
  exitTime: ['exittime', 'closetime', 'exitdate', 'closed', 'closedat', 'closeat', 'endtime', 'close', 'exit'],
  entryPrice: ['entryprice', 'openprice', 'avgentryprice', 'pricein', 'avgopen', 'entryavg', 'openingprice', 'avgopenprice'],
  exitPrice: ['exitprice', 'closeprice', 'avgexitprice', 'priceout', 'avgclose', 'exitavg', 'closingprice', 'avgcloseprice'],
  qty: ['qty', 'quantity', 'size', 'contracts', 'volume', 'lots', 'totalsize', 'filledqty', 'positionsize'],
  side: ['side', 'direction', 'position', 'buysell', 'longshort', 'positiontype', 'tradeside', 'tradedirection'],
  pnl: [
    'pnl', 'profit', 'profitloss', 'realizedpnl', 'netpnl', 'pl', 'realized', 'netprofit', 'grosspnl',
    'result', 'totalpnl', 'closedpnl', 'tradepnl', 'netamount', 'gainloss',
  ],
  fees: ['commission', 'commissions', 'fees', 'fee'],
  tags: ['tags', 'labels', 'level3'],
  domain: ['tag', 'domain', 'primarytag', 'edgedomain'],
  category: ['subtag', 'category', 'subcategory'],
  description: ['description', 'notes', 'note', 'comment', 'comments', 'journal', 'text', 'debrief'],
  learned: ['learned', 'lesson', 'whatdidyoulearn'],
  applyNext: ['apply', 'howtoapply', 'application'],
  video: ['video', 'videourl', 'recording', 'videolink'],
  images: ['images', 'screenshots', 'photos', 'attachments', 'image', 'screenshot', 'imageurls'],
  account: ['account', 'accountid', 'accountname'],
  executions: ['executions', 'fills', 'orders', 'legs', 'fillslist'],
};

/* ---------- shape-based fill detection (field-name agnostic) ---------- */
// Trader One's exact API field names are unknown, so instead of matching a
// fixed alias list we detect a "fill" by its SHAPE: one price, a quantity,
// and a side or a timestamp — and crucially NOT a round-trip trade (which
// carries a pnl or an entry+exit price pair).

function fuzzy(flat: Record<string, unknown>, needles: string[], exclude: string[] = []): unknown {
  for (const [k, v] of Object.entries(flat)) {
    if (v == null || v === '') continue;
    if (exclude.some((x) => k.includes(x))) continue;
    if (needles.some((n) => k.includes(n))) return v;
  }
  return undefined;
}

function fuzzyNum(flat: Record<string, unknown>, needles: string[], exclude: string[] = []): number | null {
  for (const [k, v] of Object.entries(flat)) {
    if (v == null || v === '') continue;
    if (exclude.some((x) => k.includes(x))) continue;
    if (needles.some((n) => k.includes(n))) {
      const n = toNum(v);
      if (n != null) return n;
    }
  }
  return null;
}

const SIDE_VALUE = /^(buy|sell|b|s|long|short|bot|sld|bought|sold|bid|ask|bo|so)$/i;

/** Find a buy/sell side by scanning VALUES (field names for side vary wildly). */
function findSide(flat: Record<string, unknown>): 'BUY' | 'SELL' | null {
  // prefer a field whose NAME hints at side, else any field whose VALUE is a side word
  const named = fuzzy(flat, ['side', 'action', 'direction', 'buysell', 'aggressor', 'way']);
  const candidates = named != null ? [named] : Object.values(flat);
  for (const v of candidates) {
    if (typeof v !== 'string') continue;
    const s = v.trim().toLowerCase();
    if (!SIDE_VALUE.test(s)) continue;
    if (/^(s|sell|short|sld|sold|ask|so)/.test(s)) return 'SELL';
    if (/^(b|buy|long|bot|bought|bid|bo)/.test(s)) return 'BUY';
  }
  return null;
}

function looksLikeTimeValue(v: unknown): boolean {
  if (typeof v === 'number') return v > 1e12 && v < 4e12; // epoch ms
  if (typeof v !== 'string') return false;
  return /\d{4}-\d{2}-\d{2}/.test(v) || /\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(v) || /^\d{13}$/.test(v);
}

/** Find a fill timestamp: by field-name hint first, else any timestamp-looking value. */
function findTime(flat: Record<string, unknown>, dateHint?: string): string | null {
  const named = fuzzy(flat, ['filledat', 'executedat', 'transacttime', 'filltime', 'executiontime', 'createdat', 'created', 'time', 'date', 'updatedat', 'timestamp', 'ts', 'when', 'at']);
  if (named != null) {
    const t = toWhen(named, dateHint);
    if (t) return t;
  }
  for (const v of Object.values(flat)) {
    if (looksLikeTimeValue(v)) {
      const t = toWhen(v, dateHint);
      if (t) return t;
    }
  }
  return null;
}

/** Does this object look like a single fill (not a completed round-trip trade)? */
function looksLikeFill(flat: Record<string, unknown>): boolean {
  // a completed trade has a pnl, or both an entry and an exit price → not a fill
  const hasPnl = fuzzyNum(flat, ['pnl', 'profit', 'realized', 'gainloss']) != null;
  const hasEntry = fuzzyNum(flat, ['entryprice', 'openprice', 'avgopen', 'avgentry']) != null;
  const hasExit = fuzzyNum(flat, ['exitprice', 'closeprice', 'avgclose', 'avgexit']) != null;
  if (hasPnl || (hasEntry && hasExit)) return false;
  const price = fuzzyNum(flat, ['price', 'px', 'rate'], ['entryprice', 'exitprice', 'stopprice', 'targetprice']);
  const qty = fuzzyNum(flat, ['qty', 'quantity', 'size', 'lots', 'contracts', 'volume', 'filled', 'amount'], ['pnl']);
  if (price == null || qty == null || qty === 0) return false;
  return findSide(flat) != null || findTime(flat) != null;
}

/** Extract a fill from any fill-shaped object, by shape (field names ignored). */
function fillFromObject(raw: Record<string, unknown>, dateHint?: string): { instrument: string | null; exec: Execution } | null {
  const flat = flatten(raw);
  const status = String(fuzzy(flat, ['status', 'state']) ?? '').toLowerCase();
  if (status && /cancel|reject|working|pending|open|new|expired/.test(status) && !/partiallyfilled|filled/.test(status)) return null;
  if (!looksLikeFill(flat)) return null;
  const price = fuzzyNum(flat, ['price', 'px', 'rate'], ['entryprice', 'exitprice', 'stopprice', 'targetprice'])!;
  const qtySigned = fuzzyNum(flat, ['qty', 'quantity', 'size', 'lots', 'contracts', 'volume', 'filled', 'amount'], ['pnl'])!;
  const time = findTime(flat, dateHint);
  if (!time || !qtySigned) return null;
  const action: 'BUY' | 'SELL' = findSide(flat) ?? (qtySigned < 0 ? 'SELL' : 'BUY');
  const typeRaw = fuzzy(flat, ['ordertype', 'ordkind', 'type']);
  const symRaw = fuzzy(flat, ['symbol', 'instrument', 'contract', 'product', 'ticker', 'market', 'sym']);
  return {
    instrument: typeof symRaw === 'string' && symRaw.trim() && symRaw.length <= 24 ? symbolRoot(symRaw.trim()) : null,
    exec: { time, action, qty: Math.abs(qtySigned), price, orderType: normalizeOrderType(typeof typeRaw === 'string' ? typeRaw : null) },
  };
}

/** Does an array look like a list of fills (majority fill-shaped, none pnl-bearing)? */
function arrayLooksLikeFills(arr: Record<string, unknown>[]): boolean {
  if (arr.length < 1) return false;
  let fills = 0;
  for (const o of arr.slice(0, 30)) if (looksLikeFill(flatten(o))) fills++;
  const sampled = Math.min(arr.length, 30);
  return fills >= Math.max(1, sampled * 0.6);
}

const execKey = (e: Execution) => [e.time, e.action, e.qty, e.price].join('|');

/** Attach pooled executions to trades by instrument + time window (entry −15m … exit +5m). */
function attachExecutions(items: CaptureItem[], pool: { instrument: string; exec: Execution }[]): void {
  if (!pool.length) return;
  const byInst = new Map<string, Execution[]>();
  for (const p of pool) {
    if (!byInst.has(p.instrument)) byInst.set(p.instrument, []);
    byInst.get(p.instrument)!.push(p.exec);
  }
  for (const item of items) {
    const group = byInst.get(item.trade.instrument);
    if (!group) continue;
    const start = new Date(item.trade.entryTime).getTime() - 15 * 60000;
    const end = new Date(item.trade.exitTime).getTime() + 5 * 60000;
    const matched = group.filter((e) => {
      const t = new Date(e.time).getTime();
      return t >= start && t <= end;
    });
    if (!matched.length) continue;
    const seenExecs = new Set(item.executions.map(execKey));
    for (const e of matched) {
      if (!seenExecs.has(execKey(e))) {
        seenExecs.add(execKey(e));
        item.executions.push(e);
      }
    }
    item.executions.sort((a, b) => a.time.localeCompare(b.time));
    if (item.executions.length > 60) item.executions = item.executions.slice(0, 60);
  }
}

/** When only executions were captured (no trade log), build round-trip trades FIFO. */
function tradesFromExecutionPool(pool: { instrument: string; exec: Execution }[]): CaptureItem[] {
  const byInst = new Map<string, Execution[]>();
  for (const p of pool) {
    if (!byInst.has(p.instrument)) byInst.set(p.instrument, []);
    byInst.get(p.instrument)!.push(p.exec);
  }
  const items: CaptureItem[] = [];
  for (const [instrument, execs] of byInst) {
    execs.sort((a, b) => a.time.localeCompare(b.time));
    const pv = pointValue(instrument);
    let position = 0;
    let leg: Execution[] = [];
    for (const e of execs) {
      leg.push(e);
      position += e.action === 'BUY' ? e.qty : -e.qty;
      if (position === 0 && leg.length > 1) {
        const buys = leg.filter((x) => x.action === 'BUY');
        const sells = leg.filter((x) => x.action === 'SELL');
        const buyQty = buys.reduce((s, x) => s + x.qty, 0);
        const sellQty = sells.reduce((s, x) => s + x.qty, 0);
        const avg = (xs: Execution[], q: number) => (q ? xs.reduce((s, x) => s + x.price * x.qty, 0) / q : 0);
        const avgBuy = avg(buys, buyQty);
        const avgSell = avg(sells, sellQty);
        const side: Side = leg[0].action === 'BUY' ? 'LONG' : 'SHORT';
        const t: Trade = {
          date: leg[0].time.slice(0, 10),
          instrument,
          side,
          entryTime: leg[0].time,
          exitTime: leg[leg.length - 1].time,
          entryPrice: side === 'LONG' ? avgBuy : avgSell,
          exitPrice: side === 'LONG' ? avgSell : avgBuy,
          qty: Math.max(buyQty, sellQty),
          pnl: (avgSell - avgBuy) * pv * Math.min(buyQty, sellQty),
          fees: 0,
          source: 'capture',
          account: '',
          ...blankJournal(),
        };
        t.executions = [...leg];
        t.importKey = makeImportKey(t);
        items.push({ trade: t, images: [], imageLinks: [], executions: [...leg] });
        leg = [];
      }
    }
  }
  return items;
}

function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Flatten one level of nesting: {entry:{price:1}} → {'entryprice':1}. */
function flatten(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out[normKey(k + k2)] = v2;
    }
    out[normKey(k)] = v;
  }
  return out;
}

function pickKey(flat: Record<string, unknown>, field: string): unknown {
  for (const alias of JSON_KEYS[field]) {
    if (alias in flat && flat[alias] != null && flat[alias] !== '') return flat[alias];
  }
  return undefined;
}

function toWhen(v: unknown, dateHint?: string): string | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
    if (isNaN(ms)) return null;
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  const s = String(v).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s) && dateHint) return toISODateTime(`${dateHint} ${s}`);
  if (/^\d{10}(\d{3})?$/.test(s)) return toWhen(Number(s));
  return toISODateTime(s);
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  return toNumber(String(v ?? ''));
}

/** Recursively collect arrays of plain objects from a parsed JSON value. */
function collectArrays(node: unknown, out: Record<string, unknown>[][], depth = 0): void {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      out.push(node as Record<string, unknown>[]);
    }
    for (const x of node.slice(0, 50)) collectArrays(x, out, depth + 1);
  } else if (typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) collectArrays(v, out, depth + 1);
  }
}

function blankJournal() {
  return {
    plannedRisk: null,
    domain: null,
    category: null,
    tags: [] as string[],
    strategyId: null,
    description: '',
    learned: '',
    applyNext: '',
    videoUrl: '',
    grades: {},
  };
}

function objectToItem(raw: Record<string, unknown>): CaptureItem | null {
  const flat = flatten(raw);
  const symbolRaw = pickKey(flat, 'symbol');
  if (typeof symbolRaw !== 'string' || !symbolRaw.trim() || symbolRaw.length > 20) return null;
  const dateHint = pickKey(flat, 'date') != null ? String(pickKey(flat, 'date')) : undefined;
  const entryTime = toWhen(pickKey(flat, 'entryTime'), dateHint) ?? (dateHint ? toISODateTime(dateHint) : null);
  if (!entryTime) return null;
  const pnl = toNum(pickKey(flat, 'pnl'));
  const entryPrice = toNum(pickKey(flat, 'entryPrice'));
  const exitPrice = toNum(pickKey(flat, 'exitPrice'));
  if (pnl == null && entryPrice == null) return null;

  const exitTime = toWhen(pickKey(flat, 'exitTime'), dateHint) ?? entryTime;
  let qty = toNum(pickKey(flat, 'qty')) ?? 1;
  const sideRaw = String(pickKey(flat, 'side') ?? '').toLowerCase();
  let side: Side;
  if (sideRaw.startsWith('l') || sideRaw.startsWith('b')) side = 'LONG';
  else if (sideRaw.startsWith('s')) side = 'SHORT';
  else if (qty < 0) side = 'SHORT';
  else if (pnl != null && entryPrice != null && exitPrice != null && exitPrice !== entryPrice) {
    side = Math.sign(exitPrice - entryPrice) === Math.sign(pnl) ? 'LONG' : 'SHORT';
  } else side = 'LONG';
  qty = Math.abs(qty) || 1;

  const tagsRaw = pickKey(flat, 'tags');
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((x) => String(x).trim()).filter(Boolean)
    : typeof tagsRaw === 'string'
      ? tagsRaw.split(/[;,·|×]/).map((x) => x.trim()).filter(Boolean)
      : [];
  const imagesRaw = pickKey(flat, 'images');
  const imageList = Array.isArray(imagesRaw) ? imagesRaw : typeof imagesRaw === 'string' ? [imagesRaw] : [];
  const imageLinks = imageList.map((x) => String(x)).filter((u) => /^https?:/.test(u));

  const t: Trade = {
    date: entryTime.slice(0, 10),
    instrument: symbolRoot(symbolRaw.trim()),
    side,
    entryTime,
    exitTime,
    entryPrice: entryPrice ?? 0,
    exitPrice: exitPrice ?? 0,
    qty,
    pnl: pnl ?? 0,
    fees: Math.abs(toNum(pickKey(flat, 'fees')) ?? 0),
    source: 'capture',
    account: String(pickKey(flat, 'account') ?? '').slice(0, 40),
    ...blankJournal(),
  };
  t.domain = domainFromLabel(typeof pickKey(flat, 'domain') === 'string' ? (pickKey(flat, 'domain') as string) : null);
  const cat = pickKey(flat, 'category');
  t.category = typeof cat === 'string' && cat.trim() ? cat.trim().toLowerCase() : null;
  t.tags = tags;
  const str = (f: string) => {
    const v = pickKey(flat, f);
    return typeof v === 'string' ? v.trim() : '';
  };
  t.description = str('description');
  t.learned = str('learned');
  t.applyNext = str('applyNext');
  t.videoUrl = str('video');
  // fills embedded on the trade object: scan EVERY array-valued property
  // (any name) for one whose objects are fill-shaped — Trader One may nest
  // the fills under a key we can't predict.
  const executions: Execution[] = [];
  for (const v of Object.values(raw)) {
    if (!Array.isArray(v) || !v.length) continue;
    const objs = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[];
    if (objs.length && arrayLooksLikeFills(objs)) {
      for (const o of objs.slice(0, 80)) {
        const f = fillFromObject(o, dateHint);
        if (f) executions.push(f.exec);
      }
    }
  }
  executions.sort((a, b) => a.time.localeCompare(b.time));
  if (executions.length) t.executions = executions;
  t.importKey = makeImportKey(t);
  return { trade: t, images: [], imageLinks, executions };
}

function itemsFromRequests(requests: { url: string; body: string }[]): {
  items: CaptureItem[];
  execPool: { instrument: string; exec: Execution }[];
} {
  const items: CaptureItem[] = [];
  const execPool: { instrument: string; exec: Execution }[] = [];
  for (const req of requests) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(req.body);
    } catch {
      continue;
    }
    const arrays: Record<string, unknown>[][] = [];
    collectArrays(parsed, arrays);
    for (const arr of arrays) {
      const converted = arr.map(objectToItem).filter((x): x is CaptureItem => x != null);
      // only trust arrays where most objects look like trades — filters out
      // config lists, watchlists, user settings etc.
      if (converted.length && converted.length >= arr.length * 0.5) {
        items.push(...converted);
        continue;
      }
      // not trades — maybe an order-history / executions/fills array. Detect
      // by shape so field naming doesn't matter, and require an instrument so
      // the fills can be matched back to a trade.
      if (arrayLooksLikeFills(arr)) {
        for (const o of arr) {
          const f = fillFromObject(o);
          if (f && f.instrument) execPool.push({ instrument: f.instrument, exec: f.exec });
        }
      }
    }
  }
  return { items, execPool };
}

export function parseCapture(text: string): CaptureParseResult {
  const payload = JSON.parse(text) as CapturePayload;
  if (payload?.source !== 'edge-capture' || !Array.isArray(payload.tables)) {
    throw new Error('Not an Edge Capture file — run the bookmarklet on the platform page first');
  }
  const warnings: string[] = [];
  const items: CaptureItem[] = [];
  const seen = new Set<string>();
  const execPool: { instrument: string; exec: Execution }[] = [];
  const seenPool = new Set<string>();

  for (const table of payload.tables) {
    if (!table?.headers?.length || !table?.rows?.length) continue;
    // order-history / fills tables become execution detail for the trades
    const execs = extractExecutionsFromTable(table.headers, table.rows);
    if (execs.length) {
      for (const e of execs) {
        const k = e.instrument + '|' + execKey(e.exec);
        if (!seenPool.has(k)) {
          seenPool.add(k);
          execPool.push(e);
        }
      }
      continue;
    }
    let parsed;
    try {
      parsed = importCSV(toCSVText(table.headers, table.rows));
    } catch {
      continue; // not a trade table (nav, stats grid, ...) — skip silently
    }
    if (parsed.format !== 'trade-log') continue;
    const imagesByRow = new Map<number, { src: string; dataUrl?: string }[]>();
    for (const rec of table.rowImages ?? []) {
      if (!imagesByRow.has(rec.row)) imagesByRow.set(rec.row, []);
      imagesByRow.get(rec.row)!.push(rec);
    }
    parsed.trades.forEach((trade, i) => {
      if (trade.importKey && seen.has(trade.importKey)) return;
      if (trade.importKey) seen.add(trade.importKey);
      trade.source = 'capture';
      const rowRecs = imagesByRow.get(parsed.sourceRows[i]) ?? [];
      items.push({
        trade,
        images: rowRecs
          .filter((r) => r.dataUrl?.startsWith('data:image'))
          .map((r, j) => ({ name: `capture-${trade.date}-${j + 1}.jpg`, dataUrl: r.dataUrl! })),
        imageLinks: rowRecs.filter((r) => !r.dataUrl?.startsWith('data:image') && /^https?:/.test(r.src)).map((r) => r.src),
        executions: [],
      });
    });
  }

  // v2: trades recorded from the page's own JSON API traffic
  if (payload.requests?.length) {
    const fromReqs = itemsFromRequests(payload.requests);
    for (const item of fromReqs.items) {
      if (item.trade.importKey && seen.has(item.trade.importKey)) continue;
      if (item.trade.importKey) seen.add(item.trade.importKey);
      items.push(item);
    }
    for (const e of fromReqs.execPool) {
      const k = e.instrument + '|' + execKey(e.exec);
      if (!seenPool.has(k)) {
        seenPool.add(k);
        execPool.push(e);
      }
    }
  }

  // attach scale-in/out detail to the trades; if ONLY executions were
  // captured (user opened just the order history), build trades from them
  attachExecutions(items, execPool);
  if (!items.length && execPool.length) {
    for (const item of tradesFromExecutionPool(execPool)) {
      if (item.trade.importKey && seen.has(item.trade.importKey)) continue;
      if (item.trade.importKey) seen.add(item.trade.importKey);
      items.push(item);
    }
    if (items.length) {
      warnings.push(
        'Trades were reconstructed from raw executions (no trade-log table was captured) — P&L is computed from point values and tags are not available on this view.',
      );
    }
  }
  for (const item of items) {
    if (item.executions.length) item.trade.executions = item.executions;
  }

  if (!items.length) {
    const d = payload.diagnostics;
    const noTraffic = (d?.jsonResponses ?? 0) === 0 && (d?.accumulatedRows ?? d?.tables ?? 0) === 0;
    let hint: string;
    if (noTraffic) {
      hint =
        'Nothing was captured at all — no tables and no recorded network traffic. Click the bookmarklet BEFORE opening the trade log (so it can start recording), then browse your trades, then click the gold badge to finish.';
    } else if ((d?.accumulatedRows ?? 0) === 0 && (d?.jsonResponses ?? 0) > 0) {
      hint =
        'Data traffic was recorded but no trade rows were recognised in it. Import this file anyway — the diagnostics below show the actual field names, which is enough to add support for them.';
    } else {
      hint =
        'Rows were captured but none matched the trade shape closely enough. Import this file anyway — the diagnostics below show what was found.';
    }

    const tableSamples = (payload.tables ?? []).slice(0, 5).map((t) => ({ headers: t.headers, sampleRow: t.rows[0] }));
    const jsonKeySamples: string[][] = [];
    for (const req of payload.requests ?? []) {
      if (jsonKeySamples.length >= 5) break;
      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body);
      } catch {
        continue;
      }
      const arrays: Record<string, unknown>[][] = [];
      collectArrays(parsed, arrays);
      for (const arr of arrays) {
        if (jsonKeySamples.length >= 5) break;
        if (arr[0]) jsonKeySamples.push(Object.keys(flatten(arr[0])));
      }
    }

    throw new CaptureError({ hint, raw: d, tableSamples, jsonKeySamples });
  }

  const fillsFound = items.reduce((s, i) => s + i.executions.length, 0);
  // when no fills came through, surface the structure of every captured JSON
  // array so the execution data can be seen (and mapped if the detector missed)
  const structureSamples: CaptureParseResult['structureSamples'] = [];
  if (!fillsFound) {
    for (const req of payload.requests ?? []) {
      if (structureSamples.length >= 8) break;
      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body);
      } catch {
        continue;
      }
      const arrays: Record<string, unknown>[][] = [];
      collectArrays(parsed, arrays);
      for (const arr of arrays) {
        if (structureSamples.length >= 8) break;
        if (arr[0] && typeof arr[0] === 'object') {
          structureSamples.push({ url: req.url.slice(0, 120), keys: Object.keys(flatten(arr[0])), sampleRow: arr[0] });
        }
      }
    }
  }

  return { items, warnings, sourceUrl: payload.url ?? '', fillsFound, structureSamples };
}

/**
 * Merge captured items into the journal. Existing trades (same importKey)
 * are enriched — tags/notes/photos fill empty fields rather than overwrite.
 */
export async function importCapture(items: CaptureItem[]): Promise<{ added: number; enriched: number }> {
  let added = 0;
  let enriched = 0;
  for (const item of items) {
    const t = item.trade;
    const existing = t.importKey ? await db.trades.where('importKey').equals(t.importKey).first() : undefined;
    let id: number;
    if (existing) {
      const patch: Partial<Trade> = {};
      if (!existing.domain && t.domain) patch.domain = t.domain;
      if (!existing.category && t.category) patch.category = t.category;
      if (!existing.tags.length && t.tags.length) patch.tags = t.tags;
      if (!existing.description && t.description) patch.description = t.description;
      if (!existing.learned && t.learned) patch.learned = t.learned;
      if (!existing.videoUrl && t.videoUrl) patch.videoUrl = t.videoUrl;
      if (item.executions.length && item.executions.length > (existing.executions?.length ?? 0)) {
        patch.executions = item.executions;
      }
      if (item.imageLinks.length) {
        const links = existing.links ?? [];
        const fresh = item.imageLinks.filter((u) => !links.some((l) => l.url === u));
        if (fresh.length) patch.links = [...links, ...fresh.map((u, i) => ({ label: `Capture image ${i + 1}`, url: u }))];
      }
      if (Object.keys(patch).length) {
        await db.trades.update(existing.id!, patch);
        enriched++;
      }
      id = existing.id!;
    } else {
      if (item.imageLinks.length) {
        t.links = item.imageLinks.map((u, i) => ({ label: `Capture image ${i + 1}`, url: u }));
      }
      id = await db.trades.add(t);
      added++;
    }
    for (const img of item.images) {
      const dupe = await db.photos
        .where('[parentType+parentId]')
        .equals(['trade', id])
        .filter((p) => p.dataUrl === img.dataUrl)
        .first();
      if (!dupe) {
        await db.photos.add({ parentType: 'trade', parentId: id, name: img.name, dataUrl: img.dataUrl, createdAt: new Date().toISOString() });
      }
    }
  }
  return { added, enriched };
}
