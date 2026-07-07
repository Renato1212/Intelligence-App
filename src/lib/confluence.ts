/*
 * The confluence board — where trade ideas come from.
 *
 * A discretionary idea is strongest where three independent reads agree:
 *   1. POSITIONING — large specs at an extreme, flipping, or repositioning
 *      hard (from the free CFTC COT feed)
 *   2. CATALYSTS — scheduled tier-1 volatility hitting that market this week
 *      (from the zero-API calendar)
 *   3. YOUR EDGE — whether YOU have demonstrated positive expectancy on that
 *      instrument (from the trader's own history)
 *
 * This module crosses the three per instrument and ranks the week's focus
 * list, with every reason stated explicitly — a transparent checklist, not a
 * black-box score.
 */
import type { Trade } from '../domain/types';
import { upcomingEvents, type CalendarEvent } from './calendar';
import { symbolRoot } from './contracts';
import { analyzeSeries, cotMarketFor, FLAG_LABEL, ordinal, type CotAnalysis, type CotSnapshot } from './cot';
import { computeStats } from './stats';

export interface EdgeRead {
  count: number;
  netPnl: number;
  expectancy: number;
  winRate: number;
}

export interface FocusRow {
  /** COT registry symbol when covered, else the trader's own root */
  symbol: string;
  label: string;
  /** reasons in display order — the whole point is transparency */
  reasons: string[];
  cot: CotAnalysis | null;
  events: CalendarEvent[];
  edge: EdgeRead | null;
  /** how many of the three reads fire (0–3) */
  confluence: number;
  /** true when the trader has actually traded this market */
  traded: boolean;
}

/** Per-instrument stats from the trader's history, keyed by COT symbol/root. */
export function edgeByMarket(trades: Trade[]): Map<string, EdgeRead & { label: string }> {
  const buckets = new Map<string, Trade[]>();
  const labels = new Map<string, string>();
  for (const t of trades) {
    const root = symbolRoot(t.instrument);
    const m = cotMarketFor(root);
    const key = m?.symbol ?? root;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
    labels.set(key, m?.label ?? root);
  }
  const out = new Map<string, EdgeRead & { label: string }>();
  for (const [key, ts] of buckets) {
    const s = computeStats(ts);
    out.set(key, { count: s.count, netPnl: s.netPnl, expectancy: s.expectancy, winRate: s.winRate, label: labels.get(key) ?? key });
  }
  return out;
}

/** Upcoming high-impact events grouped by affected market symbol. */
function eventsByMarket(fromISO: string, days: number): Map<string, CalendarEvent[]> {
  const out = new Map<string, CalendarEvent[]>();
  for (const e of upcomingEvents(fromISO, days)) {
    if (e.impact !== 'high') continue;
    for (const sym of e.affects) {
      if (!out.has(sym)) out.set(sym, []);
      out.get(sym)!.push(e);
    }
  }
  return out;
}

const EDGE_MIN_TRADES = 5;

/**
 * Build the ranked focus list for the week.
 * Covers every market that has at least one read firing; ranks by number of
 * agreeing reads, then by the strength of the positioning signal.
 */
export function buildFocus(trades: Trade[], cot: CotSnapshot | null, todayISO: string, horizonDays = 7): FocusRow[] {
  const edge = edgeByMarket(trades);
  const events = eventsByMarket(todayISO, horizonDays);

  const cotBySymbol = new Map<string, CotAnalysis>();
  for (const s of cot?.series ?? []) {
    const a = analyzeSeries(s);
    if (a) cotBySymbol.set(a.market.symbol, a);
  }

  const symbols = new Set<string>([...edge.keys(), ...events.keys(), ...cotBySymbol.keys()]);
  const rows: FocusRow[] = [];

  for (const sym of symbols) {
    const a = cotBySymbol.get(sym) ?? null;
    const ev = events.get(sym) ?? [];
    const eg = edge.get(sym) ?? null;
    const traded = !!eg;

    const reasons: string[] = [];
    let confluence = 0;

    if (a && a.flags.length) {
      confluence++;
      reasons.push(`Positioning: ${a.flags.map((f) => FLAG_LABEL[f].toLowerCase()).join(' + ')}${a.pctile3y != null ? ` (${ordinal(a.pctile3y)} pctile)` : ''}`);
    }
    if (ev.length) {
      confluence++;
      const names = [...new Set(ev.map((e) => e.short))];
      reasons.push(`Catalysts this week: ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}`);
    }
    if (eg && eg.count >= EDGE_MIN_TRADES && eg.expectancy > 0) {
      confluence++;
      reasons.push(`Your edge: ${eg.count} trades, ${eg.expectancy >= 0 ? '+' : ''}$${Math.abs(eg.expectancy).toFixed(0)}/trade expectancy`);
    } else if (eg && eg.count >= EDGE_MIN_TRADES && eg.expectancy < 0) {
      // a negative edge is a warning, not confluence — but say it out loud
      reasons.push(`Caution: your expectancy here is negative (${eg.count} trades) — demand A+ context`);
    }

    if (!reasons.length) continue;

    const label = a?.market.label ?? cotMarketFor(sym)?.label ?? eg?.label ?? sym;
    rows.push({ symbol: sym, label, reasons, cot: a, events: ev, edge: eg, confluence, traded });
  }

  const signalStrength = (r: FocusRow) => {
    const p = r.cot?.pctile3y;
    const fromMid = p == null ? 0 : Math.abs(p - 50);
    return fromMid + (r.cot?.flags.length ?? 0) * 10 + r.events.length * 2;
  };

  return rows.sort((x, y) => y.confluence - x.confluence || signalStrength(y) - signalStrength(x) || x.symbol.localeCompare(y.symbol));
}
