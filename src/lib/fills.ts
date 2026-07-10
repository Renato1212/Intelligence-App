/*
 * Fill mathematics — the single source of truth for turning a list of
 * executions (every add, partial and exit) into the position story and the
 * trade summary. Pure and unit-tested, shared by the read-only ladder and the
 * manual Execution Logger so a hand-entered fill and a captured fill behave
 * identically.
 *
 * This is what lets a discretionary trader keep track of every decision:
 * enter, scale in on a limit, add on a stop, take a partial, exit — each fill
 * with its own order type, price, size and time, with the running position
 * and evolving average price computed the same way a risk desk would.
 */
import type { Execution, OrderType, Side, Trade } from '../domain/types';
import { pointValue } from './contracts';

export type FillRole = 'Entry' | 'Scale-in' | 'Scale-out' | 'Exit';

export interface LadderRow {
  e: Execution;
  role: FillRole;
  /** unsigned contracts held after this fill */
  position: number;
  /** average price of the open position after this fill (0 when flat) */
  avgPrice: number;
  /** realized P&L contribution of this fill, in points (before point value) */
  realizedPts: number;
}

/** Chronological order, ties broken by keeping input order stable. */
export function sortFills(execs: Execution[]): Execution[] {
  return execs
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.time.localeCompare(b.e.time) || a.i - b.i)
    .map((x) => x.e);
}

/**
 * Walk the fills, computing role, running position, average open price and
 * realized P&L per fill. `side` sets which direction counts as "adding".
 */
export function computeLadder(execs: Execution[], side: Side): LadderRow[] {
  const dir = side === 'LONG' ? 1 : -1;
  const sorted = sortFills(execs);
  let position = 0; // signed contracts (+ long / − short)
  let avgPrice = 0; // avg price of the open position
  const rows: LadderRow[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const qty = Math.abs(e.qty) || 0;
    const delta = (e.action === 'BUY' ? 1 : -1) * qty;
    const before = position;
    const increasing = before === 0 ? Math.sign(delta) === dir : Math.sign(delta) === Math.sign(before);

    let realizedPts = 0;
    if (increasing) {
      // adding to (or opening) the position — blend the average price
      avgPrice = (Math.abs(before) * avgPrice + qty * e.price) / (Math.abs(before) + qty || 1);
      position += delta;
    } else {
      // reducing the position — realize P&L on the closed portion
      const closing = Math.min(qty, Math.abs(before));
      const sign = before > 0 ? 1 : -1; // long closes on sells (price − avg), short on buys (avg − price)
      realizedPts = sign * (e.price - avgPrice) * closing;
      position += delta;
      if (Math.sign(position) !== Math.sign(before) && position !== 0) {
        // flipped through zero — the overshoot opens a fresh position at this price
        avgPrice = e.price;
      } else if (position === 0) {
        avgPrice = 0;
      }
    }

    const role: FillRole =
      increasing && before === 0 ? 'Entry' : increasing ? 'Scale-in' : position === 0 ? 'Exit' : 'Scale-out';

    rows.push({ e, role, position: Math.abs(position), avgPrice: Math.abs(position) > 0 ? avgPrice : 0, realizedPts });
  }
  return rows;
}

export interface FillSummary {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  /** max position held (the size the trade actually ran) */
  qty: number;
  /** realized P&L in points, if the position nets flat; else null */
  realizedPts: number | null;
  /** true when buys and sells net to zero (a fully-closed round trip) */
  flat: boolean;
}

const wavg = (xs: Execution[]) => {
  const q = xs.reduce((s, x) => s + Math.abs(x.qty), 0);
  return q ? xs.reduce((s, x) => s + x.price * Math.abs(x.qty), 0) / q : 0;
};

/** Derive the averaged trade summary from the fills. */
export function summaryFromFills(execs: Execution[], side: Side): FillSummary | null {
  const sorted = sortFills(execs);
  if (!sorted.length) return null;
  const dir = side === 'LONG' ? 1 : -1;
  const entries = sorted.filter((e) => (e.action === 'BUY' ? 1 : -1) === dir);
  const exits = sorted.filter((e) => (e.action === 'BUY' ? 1 : -1) !== dir);

  const rows = computeLadder(sorted, side);
  const qty = Math.max(...rows.map((r) => r.position), 0);
  const netContracts = sorted.reduce((s, e) => s + (e.action === 'BUY' ? 1 : -1) * Math.abs(e.qty), 0);
  const flat = netContracts === 0 && exits.length > 0;
  const realizedPts = flat ? rows.reduce((s, r) => s + r.realizedPts, 0) : null;

  return {
    entryTime: sorted[0].time,
    exitTime: sorted[sorted.length - 1].time,
    entryPrice: entries.length ? Number(wavg(entries).toFixed(8)) : sorted[0].price,
    exitPrice: exits.length ? Number(wavg(exits).toFixed(8)) : sorted[sorted.length - 1].price,
    qty,
    realizedPts,
    flat,
  };
}

/**
 * Merge a fill summary into a trade, keeping everything else intact. P&L is
 * recomputed from the fills (× contract point value) only when the position
 * nets flat; otherwise the existing P&L is preserved so a still-open or
 * partially-logged trade is never silently zeroed.
 */
export function applyFillsToTrade(trade: Trade, execs: Execution[]): Trade {
  const sorted = sortFills(execs).map((e) => ({ ...e, qty: Math.abs(e.qty) }));
  const summary = summaryFromFills(sorted, trade.side);
  if (!summary) return { ...trade, executions: [] };

  const next: Trade = {
    ...trade,
    executions: sorted,
    entryTime: summary.entryTime,
    exitTime: summary.exitTime,
    entryPrice: summary.entryPrice,
    exitPrice: summary.exitPrice,
    qty: summary.qty || trade.qty,
  };
  if (summary.realizedPts != null) {
    const gross = summary.realizedPts * pointValue(trade.instrument);
    next.pnl = Number((gross - (trade.fees || 0)).toFixed(2));
  }
  return next;
}

export const ORDER_TYPES: { id: OrderType; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit' },
  { id: 'stop', label: 'Stop' },
  { id: 'stop-limit', label: 'Stop-limit' },
];

/* ----------------------------- paste import ----------------------------- */

function orderTypeOf(raw: string): OrderType {
  const s = raw.toLowerCase();
  if (s.includes('stop') && s.includes('lim')) return 'stop-limit';
  if (s.includes('stop') || /\bstp\b/.test(s)) return 'stop';
  if (s.includes('lim') || /\blmt\b/.test(s)) return 'limit';
  if (s.includes('mkt') || s.includes('market')) return 'market';
  return 'unknown';
}
function numOf(raw: string): number | null {
  if (raw == null) return null;
  const m = String(raw).replace(/[$,\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return isFinite(n) ? n : null;
}
/** Turn a cell into an ISO instant, tolerating "HH:MM:SS", full dates, epoch ms. */
function timeOf(raw: string, fallbackDate: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  // epoch millis / seconds
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // time-only → attach the trade's date (or today)
  if (/^\d{1,2}:\d{2}(:\d{2})?(\s?[AaPp][Mm])?$/.test(s)) {
    const base = fallbackDate || new Date().toISOString().slice(0, 10);
    const d = new Date(`${base} ${s}`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function splitRow(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (line.includes(',') && !/\d,\d{3}\b/.test(line)) return line.split(',').map((c) => c.trim());
  return line.trim().split(/\s{2,}|\s(?=\d{1,2}:\d)|(?<=\d)\s(?=[A-Za-z])/).map((c) => c.trim()).filter(Boolean);
}

const HDR = {
  side: /\b(side|action|b\/s|buy\/sell|direction)\b/i,
  qty: /\b(qty|quantity|size|contracts|filled|lots|volume)\b/i,
  price: /\b(price|px|avg|fill price)\b/i,
  time: /\b(time|date|filled|executed|timestamp)\b/i,
  type: /\b(type|order type|ordertype)\b/i,
  sym: /\b(symbol|instrument|contract|product|ticker)\b/i,
};
function looksHeader(cells: string[]): boolean {
  const joined = cells.join(' ');
  const hits = [HDR.side, HDR.qty, HDR.price, HDR.time, HDR.type].filter((rx) => rx.test(joined)).length;
  const anyNumericPrice = cells.some((c) => /^\$?-?\d+\.\d+$/.test(c.replace(/,/g, '')));
  return hits >= 2 && !anyNumericPrice;
}
function sideOf(cell: string): 'BUY' | 'SELL' | null {
  const s = cell.trim().toLowerCase();
  if (/^(s|sell|short|sld|sold|so)/.test(s)) return 'SELL';
  if (/^(b|buy|long|bot|bought|bo)/.test(s)) return 'BUY';
  return null;
}

export interface PasteResult {
  fills: Execution[];
  symbol: string | null;
  matched: number;
  skipped: number;
}

/**
 * Parse a pasted block of order-history / fills rows into executions — so a
 * trader can select the fills grid in Trader One (or any broker), paste once,
 * and get every scale-in/out with its order type and price, without typing
 * each order. Handles tab / comma / multi-space columns, with or without a
 * header row, and positional detection when there is no header.
 */
export function parseFillsText(text: string, fallbackDate = ''): PasteResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[-=\s]+$/.test(l));
  if (!lines.length) return { fills: [], symbol: null, matched: 0, skipped: 0 };

  let headerCells: string[] | null = null;
  const firstCells = splitRow(lines[0]);
  if (looksHeader(firstCells)) headerCells = firstCells.map((c) => c.toLowerCase());
  const dataLines = headerCells ? lines.slice(1) : lines;

  const colIndex = (rx: RegExp) => (headerCells ? headerCells.findIndex((h) => rx.test(h)) : -1);
  const ci = headerCells
    ? { side: colIndex(HDR.side), qty: colIndex(HDR.qty), price: colIndex(HDR.price), time: colIndex(HDR.time), type: colIndex(HDR.type), sym: colIndex(HDR.sym) }
    : null;

  const fills: Execution[] = [];
  let symbol: string | null = null;
  let skipped = 0;

  for (const line of dataLines) {
    const cells = splitRow(line);
    if (!cells.length) continue;

    let side: 'BUY' | 'SELL' | null = null;
    let qty: number | null = null;
    let price: number | null = null;
    let time: string | null = null;
    let otype: OrderType = 'unknown';
    let sym: string | null = null;

    if (ci) {
      if (ci.side >= 0) side = sideOf(cells[ci.side] ?? '');
      if (ci.qty >= 0) qty = numOf(cells[ci.qty] ?? '');
      if (ci.price >= 0) price = numOf(cells[ci.price] ?? '');
      if (ci.time >= 0) time = timeOf(cells[ci.time] ?? '', fallbackDate);
      if (ci.type >= 0) otype = orderTypeOf(cells[ci.type] ?? '');
      if (ci.sym >= 0) sym = (cells[ci.sym] ?? '').trim() || null;
    } else {
      // positional heuristic: scan cells for each field
      for (const c of cells) {
        if (!side) { const sd = sideOf(c); if (sd) { side = sd; continue; } }
        if (otype === 'unknown') { const ot = orderTypeOf(c); if (ot !== 'unknown') { otype = ot; continue; } }
        if (!time) { const t = timeOf(c, fallbackDate); if (t && /[:\-/]/.test(c)) { time = t; continue; } }
      }
      // remaining numeric cells: the decimal is the price, a small integer is qty
      const nums = cells.map(numOf).filter((n): n is number => n != null);
      const decimal = cells.find((c) => /^\$?-?\d+\.\d+$/.test(c.replace(/,/g, '')));
      if (decimal) price = numOf(decimal);
      const intCell = nums.find((n) => Number.isInteger(n) && Math.abs(n) < 100000 && n !== price);
      if (intCell != null) qty = intCell;
      if (price == null && nums.length) price = nums[nums.length - 1];
      // symbol: a token of letters+digits like ESU5, MESU5, 6E
      sym = cells.find((c) => /^[A-Z]{1,4}[A-Z0-9]{0,4}\d?$/.test(c) && /[A-Z]/.test(c) && sideOf(c) == null && orderTypeOf(c) === 'unknown') ?? null;
    }

    if (price == null || qty == null || qty === 0) { skipped++; continue; }
    if (!side) { skipped++; continue; }
    if (sym && !symbol) symbol = sym.replace(/\s+/g, '');
    fills.push({
      time: time || (fallbackDate ? `${fallbackDate}T00:00:00.000Z` : new Date().toISOString()),
      action: side,
      qty: Math.abs(qty),
      price,
      orderType: otype,
    });
  }

  return { fills: sortFills(fills), symbol, matched: fills.length, skipped };
}
