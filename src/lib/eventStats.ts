/*
 * Connect the economic calendar to the trader's own results.
 *
 * The whole point of a catalyst calendar for a discretionary trader isn't the
 * schedule — it's knowing how YOU trade around catalysts. These functions
 * cross the deterministic event calendar with the trade history to answer:
 *  - Do I make or lose money on tier-1 event days vs quiet days?
 *  - Which specific catalysts (NFP, CPI, FOMC…) are my edge — or my leak?
 *  - Am I better trading INTO the print, or waiting for the dust to settle?
 */
import type { Trade } from '../domain/types';
import { eventsForDate, type CalendarEvent } from './calendar';
import { computeStats, groupBy, type StatsSummary } from './stats';

/** Cache events per date so repeated lookups over a trade set stay cheap. */
const dayCache = new Map<string, CalendarEvent[]>();
function eventsOn(date: string): CalendarEvent[] {
  let e = dayCache.get(date);
  if (!e) {
    e = eventsForDate(date);
    dayCache.set(date, e);
  }
  return e;
}

export interface EventDaySplit {
  eventDays: StatsSummary;
  quietDays: StatsSummary;
  eventTrades: Trade[];
  quietTrades: Trade[];
}

/** Split trades by whether their day carried a HIGH-impact tier-1 event. */
export function eventDaySplit(trades: Trade[], impact: 'high' | 'any' = 'high'): EventDaySplit {
  const isEventDay = (date: string) => {
    const e = eventsOn(date);
    return impact === 'any' ? e.length > 0 : e.some((x) => x.impact === 'high');
  };
  const eventTrades = trades.filter((t) => isEventDay(t.date));
  const quietTrades = trades.filter((t) => !isEventDay(t.date));
  return {
    eventDays: computeStats(eventTrades),
    quietDays: computeStats(quietTrades),
    eventTrades,
    quietTrades,
  };
}

export interface PerEventStat {
  short: string;
  name: string;
  domain: string;
  days: number;
  count: number;
  netPnl: number;
  winRate: number;
  expectancy: number;
}

/** Performance on days carrying each specific catalyst (only high-impact). */
export function perEventStats(trades: Trade[]): PerEventStat[] {
  const byShort = new Map<string, { name: string; domain: string; trades: Trade[]; days: Set<string> }>();
  for (const t of trades) {
    for (const e of eventsOn(t.date)) {
      if (e.impact !== 'high') continue;
      let entry = byShort.get(e.short);
      if (!entry) {
        entry = { name: e.name, domain: e.domain, trades: [], days: new Set() };
        byShort.set(e.short, entry);
      }
      entry.trades.push(t);
      entry.days.add(t.date);
    }
  }
  return [...byShort.entries()]
    .map(([short, v]) => {
      const s = computeStats(v.trades);
      return {
        short,
        name: v.name,
        domain: v.domain,
        days: v.days.size,
        count: s.count,
        netPnl: s.netPnl,
        winRate: s.winRate,
        expectancy: s.expectancy,
      };
    })
    .sort((a, b) => b.netPnl - a.netPnl);
}

export interface ProximitySplit {
  windowMin: number;
  near: StatsSummary;
  clear: StatsSummary;
  nearCount: number;
  clearCount: number;
}

/**
 * Split trades by whether the ENTRY landed within `windowMin` of any scheduled
 * high-impact release — "trading into the catalyst" vs "trading the aftermath".
 */
export function proximitySplit(trades: Trade[], windowMin = 30): ProximitySplit {
  const w = windowMin * 60000;
  const near: Trade[] = [];
  const clear: Trade[] = [];
  for (const t of trades) {
    const entry = new Date(t.entryTime).getTime();
    if (!isFinite(entry)) {
      clear.push(t);
      continue;
    }
    const evs = eventsOn(t.date).filter((e) => e.impact === 'high');
    const isNear = evs.some((e) => Math.abs(new Date(e.instant).getTime() - entry) <= w);
    (isNear ? near : clear).push(t);
  }
  return {
    windowMin,
    near: computeStats(near),
    clear: computeStats(clear),
    nearCount: near.length,
    clearCount: clear.length,
  };
}

/** Count of distinct event days vs quiet days in the trade set (for context). */
export function dayCounts(trades: Trade[]): { eventDays: number; quietDays: number } {
  const byDay = groupBy(trades, (t) => t.date);
  let eventDays = 0;
  let quietDays = 0;
  for (const date of byDay.keys()) {
    if (eventsOn(date).some((e) => e.impact === 'high')) eventDays++;
    else quietDays++;
  }
  return { eventDays, quietDays };
}
