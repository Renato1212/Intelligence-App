import type { CriterionId, GradeLevel, Trade } from '../domain/types';

export interface StatsSummary {
  count: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  winRate: number;
  profitFactor: number;
  /** Expected value per trade, $ */
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  /** avgWin / |avgLoss| */
  payoff: number;
  maxDrawdown: number;
  maxWinStreak: number;
  maxLossStreak: number;
  bestTrade: number;
  worstTrade: number;
  avgR: number | null;
  /** count of trades carrying an R multiple */
  rCount: number;
  avgDurationMin: number;
  tradingDays: number;
  avgDailyPnl: number;
  /** annualized daily Sharpe-style ratio (mean/stdev of daily P&L, √252) */
  sharpe: number | null;
  taggedRate: number;
  gradedRate: number;
}

export function rMultiple(t: Trade): number | null {
  if (t.plannedRisk && t.plannedRisk > 0) return t.pnl / t.plannedRisk;
  return null;
}

export function computeStats(trades: Trade[]): StatsSummary {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = losses.reduce((s, t) => s + t.pnl, 0);
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0);

  // streaks + drawdown over trade sequence (sorted by exit time)
  const seq = [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime));
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let winStreak = 0;
  let lossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  for (const t of seq) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
    if (t.pnl > 0) {
      winStreak++;
      lossStreak = 0;
    } else if (t.pnl < 0) {
      lossStreak++;
      winStreak = 0;
    }
    maxWinStreak = Math.max(maxWinStreak, winStreak);
    maxLossStreak = Math.max(maxLossStreak, lossStreak);
  }

  const rs = trades.map(rMultiple).filter((r): r is number => r != null && isFinite(r));

  const byDay = groupBy(trades, (t) => t.date);
  const dailyPnls = [...byDay.values()].map((ts) => ts.reduce((s, t) => s + t.pnl, 0));
  const tradingDays = dailyPnls.length;
  const meanDaily = tradingDays ? dailyPnls.reduce((s, v) => s + v, 0) / tradingDays : 0;
  let sharpe: number | null = null;
  if (tradingDays >= 5) {
    const variance = dailyPnls.reduce((s, v) => s + (v - meanDaily) ** 2, 0) / (tradingDays - 1);
    const sd = Math.sqrt(variance);
    sharpe = sd > 0 ? (meanDaily / sd) * Math.sqrt(252) : null;
  }

  const durations = trades
    .map((t) => (new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 60000)
    .filter((d) => isFinite(d) && d >= 0);

  const graded = trades.filter((t) => Object.keys(t.grades ?? {}).length > 0);

  return {
    count: n,
    netPnl,
    grossProfit,
    grossLoss,
    winRate: n ? wins.length / n : 0,
    profitFactor: grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0,
    expectancy: n ? netPnl / n : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    payoff:
      wins.length && losses.length ? grossProfit / wins.length / Math.abs(grossLoss / losses.length) : NaN,
    maxDrawdown: maxDD,
    maxWinStreak,
    maxLossStreak,
    bestTrade: n ? Math.max(...trades.map((t) => t.pnl)) : 0,
    worstTrade: n ? Math.min(...trades.map((t) => t.pnl)) : 0,
    avgR: rs.length ? rs.reduce((s, v) => s + v, 0) / rs.length : null,
    rCount: rs.length,
    avgDurationMin: durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : 0,
    tradingDays,
    avgDailyPnl: meanDaily,
    sharpe,
    taggedRate: n ? trades.filter((t) => t.domain).length / n : 0,
    gradedRate: n ? graded.length / n : 0,
  };
}

export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export interface BucketStat {
  key: string;
  label: string;
  count: number;
  netPnl: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
}

export function bucketStats(trades: Trade[], key: (t: Trade) => string | null, label?: (k: string) => string): BucketStat[] {
  const groups = groupBy(
    trades.filter((t) => key(t) != null),
    (t) => key(t) as string,
  );
  return [...groups.entries()].map(([k, ts]) => {
    const s = computeStats(ts);
    return {
      key: k,
      label: label ? label(k) : k,
      count: s.count,
      netPnl: s.netPnl,
      winRate: s.winRate,
      expectancy: s.expectancy,
      profitFactor: s.profitFactor,
    };
  });
}

export interface EquityPoint {
  index: number;
  date: string;
  equity: number;
  pnl: number;
}

export function equityCurve(trades: Trade[]): EquityPoint[] {
  const seq = [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime));
  let equity = 0;
  return seq.map((t, i) => {
    equity += t.pnl;
    return { index: i + 1, date: t.date, equity, pnl: t.pnl };
  });
}

export function dailyPnlSeries(trades: Trade[]): { date: string; pnl: number; count: number }[] {
  const byDay = groupBy(trades, (t) => t.date);
  return [...byDay.entries()]
    .map(([date, ts]) => ({ date, pnl: ts.reduce((s, t) => s + t.pnl, 0), count: ts.length }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Rolling expectancy ($/trade) over a window of trades — shows edge developing or decaying. */
export function rollingExpectancy(trades: Trade[], window = 20): { index: number; date: string; value: number }[] {
  const seq = [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime));
  const out: { index: number; date: string; value: number }[] = [];
  for (let i = window - 1; i < seq.length; i++) {
    const slice = seq.slice(i - window + 1, i + 1);
    out.push({
      index: i + 1,
      date: seq[i].date,
      value: slice.reduce((s, t) => s + t.pnl, 0) / window,
    });
  }
  return out;
}

const GRADE_SCORE: Record<GradeLevel, number> = { below: 0, at: 1, above: 2 };

/** Average coach-grade score (0=below, 1=at, 2=above) per criterion across graded trades. */
export function gradeProfile(trades: Trade[]): { criterion: CriterionId; avg: number; count: number }[] {
  const criteria: CriterionId[] = ['trigger', 'sizing', 'exit', 'articulation', 'review'];
  return criteria.map((c) => {
    const scored = trades
      .map((t) => t.grades?.[c])
      .filter((g): g is GradeLevel => g != null)
      .map((g) => GRADE_SCORE[g]);
    return {
      criterion: c,
      avg: scored.length ? scored.reduce((s, v) => s + v, 0) / scored.length : 0,
      count: scored.length,
    };
  });
}

export function hourOfTrade(t: Trade): string {
  const h = new Date(t.entryTime).getHours();
  return `${String(h).padStart(2, '0')}:00`;
}

export function durationBucket(t: Trade): string {
  const min = (new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 60000;
  if (!isFinite(min) || min < 0) return 'unknown';
  if (min < 1) return '< 1m';
  if (min < 5) return '1–5m';
  if (min < 15) return '5–15m';
  if (min < 60) return '15–60m';
  if (min < 240) return '1–4h';
  return '> 4h';
}

export const DURATION_ORDER = ['< 1m', '1–5m', '5–15m', '15–60m', '1–4h', '> 4h'];
