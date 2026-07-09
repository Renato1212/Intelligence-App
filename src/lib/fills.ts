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
