/*
 * flows.ts — the cross-asset flow engine.
 *
 * Correlation tables are common; reading FLOW from them is not. This module
 * carries the handful of transforms a macro desk actually runs to answer
 * "where is the money going, and what does that imply":
 *
 *   rebase        overlay instruments on one axis (percentage space, not price)
 *   ratio         the pair series that IS the flow (SPY/TLT, HG/GC, XLY/XLP…)
 *   rolling corr  when a relationship changes, the regime changed first
 *   lead-lag      which of the two moves FIRST, and by how many sessions
 *   beta          how much of a move is just the market
 *   dispersion    average pairwise correlation — the systemic-risk dial
 *   rotation      cross-sectional relative strength across horizons
 *
 * Everything is pure and null-tolerant. Series are daily closes, ascending.
 */

import { correlation } from './crossAsset';

export interface Close {
  date: string;
  close: number;
}

export interface NamedSeries {
  symbol: string;
  label: string;
  closes: Close[];
}

/* ------------------------------ primitives -------------------------------- */

/** Simple returns from closes, aligned to the LATER date of each pair. */
export function returns(closes: Close[]): { date: string; r: number }[] {
  const out: { date: string; r: number }[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1].close;
    if (prev > 0) out.push({ date: closes[i].date, r: closes[i].close / prev - 1 });
  }
  return out;
}

/**
 * Restrict every series to the dates ALL of them share.
 * Overlaying unaligned series is the classic way to invent a divergence that
 * is really just one market having been closed for a holiday.
 */
export function alignSeries(series: NamedSeries[]): { dates: string[]; aligned: NamedSeries[] } {
  const usable = series.filter((s) => s.closes.length > 1);
  if (!usable.length) return { dates: [], aligned: [] };
  const sets = usable.map((s) => new Set(s.closes.map((c) => c.date)));
  const dates = usable[0].closes
    .map((c) => c.date)
    .filter((d) => sets.every((set) => set.has(d)))
    .sort();
  const aligned = usable.map((s) => {
    const byDate = new Map(s.closes.map((c) => [c.date, c.close]));
    return { ...s, closes: dates.map((d) => ({ date: d, close: byDate.get(d)! })) };
  });
  return { dates, aligned };
}

/**
 * Rebase to a common start (default 100) — the only honest way to overlay
 * instruments whose prices differ by orders of magnitude. The shape is
 * preserved; the units become "percent since the start of the window".
 */
export function rebase(closes: Close[], base = 100): Close[] {
  if (!closes.length || !(closes[0].close > 0)) return [];
  const first = closes[0].close;
  return closes.map((c) => ({ date: c.date, close: (c.close / first) * base }));
}

/** Z-score each point against the window's own mean/σ — comparable extremes. */
export function zScoreSeries(closes: Close[]): Close[] {
  if (closes.length < 3) return [];
  const vals = closes.map((c) => c.close);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (vals.length - 1));
  if (!(sd > 0)) return closes.map((c) => ({ date: c.date, close: 0 }));
  return closes.map((c) => ({ date: c.date, close: (c.close - mean) / sd }));
}

/** The ratio series a/b on shared dates — the pair trade as one line. */
export function ratioSeries(a: Close[], b: Close[]): Close[] {
  const byDate = new Map(b.map((c) => [c.date, c.close]));
  const out: Close[] = [];
  for (const c of a) {
    const d = byDate.get(c.date);
    if (d != null && d > 0) out.push({ date: c.date, close: c.close / d });
  }
  return out;
}

/** Total return over the last n sessions, in %. */
export function periodReturn(closes: Close[], n: number): number | null {
  if (closes.length < 2) return null;
  const end = closes[closes.length - 1].close;
  const startIdx = Math.max(0, closes.length - 1 - n);
  const start = closes[startIdx].close;
  return start > 0 ? (end / start - 1) * 100 : null;
}

/** Annualised realised vol (%) from the last n daily returns. */
export function realisedVol(closes: Close[], n = 20): number | null {
  const r = returns(closes).slice(-n).map((x) => x.r);
  if (r.length < 5) return null;
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - m) * (x - m), 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

/* ---------------------------- rolling measures ---------------------------- */

export interface RollingPoint {
  date: string;
  value: number;
}

/** Rolling correlation of daily returns. The regime tell. */
export function rollingCorrelation(a: Close[], b: Close[], window = 20): RollingPoint[] {
  const ra = returns(a);
  const rb = returns(b);
  const byDate = new Map(rb.map((x) => [x.date, x.r]));
  const pairs: { date: string; x: number; y: number }[] = [];
  for (const p of ra) {
    const y = byDate.get(p.date);
    if (y != null) pairs.push({ date: p.date, x: p.r, y });
  }
  const out: RollingPoint[] = [];
  for (let i = window; i <= pairs.length; i++) {
    const slice = pairs.slice(i - window, i);
    out.push({ date: slice[slice.length - 1].date, value: correlation(slice.map((p) => p.x), slice.map((p) => p.y)) });
  }
  return out;
}

/** Rolling beta of a to b (how much of a's move is explained by b). */
export function rollingBeta(a: Close[], b: Close[], window = 60): RollingPoint[] {
  const ra = returns(a);
  const rb = returns(b);
  const byDate = new Map(rb.map((x) => [x.date, x.r]));
  const pairs: { date: string; x: number; y: number }[] = [];
  for (const p of ra) {
    const y = byDate.get(p.date);
    if (y != null) pairs.push({ date: p.date, x: p.r, y });
  }
  const out: RollingPoint[] = [];
  for (let i = window; i <= pairs.length; i++) {
    const slice = pairs.slice(i - window, i);
    const my = slice.reduce((s, p) => s + p.y, 0) / slice.length;
    const mx = slice.reduce((s, p) => s + p.x, 0) / slice.length;
    let cov = 0;
    let varY = 0;
    for (const p of slice) {
      cov += (p.x - mx) * (p.y - my);
      varY += (p.y - my) * (p.y - my);
    }
    out.push({ date: slice[slice.length - 1].date, value: varY > 0 ? cov / varY : 0 });
  }
  return out;
}

/* -------------------------------- lead-lag -------------------------------- */

export interface LeadLag {
  /** correlation at each tested lag, lag in sessions */
  curve: { lag: number; corr: number }[];
  /** the lag with the strongest |correlation| */
  bestLag: number;
  bestCorr: number;
  /** correlation with no lag, for comparison */
  zeroCorr: number;
  /** plain statement of which one moves first */
  read: string;
}

/**
 * Cross-correlation across lags: does A's move today show up in B tomorrow?
 *
 * corr at lag L pairs a[i] with b[i+L], so a POSITIVE best lag means A leads B
 * by that many sessions. The honest caveat is built into the read: a lead only
 * means something when it beats the contemporaneous correlation by a margin,
 * otherwise it is noise fitted after the fact.
 */
export function leadLag(a: NamedSeries, b: NamedSeries, maxLag = 10): LeadLag | null {
  const ra = returns(a.closes);
  const rb = returns(b.closes);
  const byDate = new Map(rb.map((x) => [x.date, x.r]));
  const x: number[] = [];
  const y: number[] = [];
  for (const p of ra) {
    const v = byDate.get(p.date);
    if (v != null) {
      x.push(p.r);
      y.push(v);
    }
  }
  if (x.length < maxLag * 3 + 10) return null;

  const curve: { lag: number; corr: number }[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < x.length; i++) {
      const j = i + lag;
      if (j >= 0 && j < y.length) {
        xs.push(x[i]);
        ys.push(y[j]);
      }
    }
    curve.push({ lag, corr: xs.length >= 10 ? correlation(xs, ys) : 0 });
  }

  const best = curve.reduce((bst, p) => (Math.abs(p.corr) > Math.abs(bst.corr) ? p : bst), curve[0]);
  const zero = curve.find((p) => p.lag === 0)?.corr ?? 0;
  const margin = Math.abs(best.corr) - Math.abs(zero);

  let read: string;
  if (best.lag === 0 || margin < 0.03) {
    read = `${a.label} and ${b.label} move together with no reliable lead — their contemporaneous correlation (${zero.toFixed(2)}) is as strong as anything the lag search found. Treat them as one exposure, not as a signal chain.`;
  } else if (best.lag > 0) {
    read = `${a.label} leads ${b.label} by about ${best.lag} session${best.lag > 1 ? 's' : ''} (corr ${best.corr.toFixed(2)} at that lag vs ${zero.toFixed(2)} same-day). Moves in ${a.label} are the earlier read; watch it for the turn in ${b.label}.`;
  } else {
    read = `${b.label} leads ${a.label} by about ${Math.abs(best.lag)} session${Math.abs(best.lag) > 1 ? 's' : ''} (corr ${best.corr.toFixed(2)} vs ${zero.toFixed(2)} same-day). ${b.label} is the earlier read here.`;
  }
  return { curve, bestLag: best.lag, bestCorr: best.corr, zeroCorr: zero, read };
}

/* ------------------------------- dispersion ------------------------------- */

export interface DispersionPoint {
  date: string;
  /** average pairwise correlation across the whole basket */
  value: number;
}

/**
 * Average pairwise correlation over time — the systemic-risk dial.
 *
 * When everything correlates to 1 the market has stopped pricing individual
 * assets and is pricing one factor (liquidity/fear): diversification stops
 * working exactly when it is needed, and index-level risk is the only risk.
 * When it falls, relative-value and rotation trades work again.
 */
export function dispersionSeries(series: NamedSeries[], window = 20): DispersionPoint[] {
  const { aligned } = alignSeries(series);
  if (aligned.length < 2) return [];
  const rets = aligned.map((s) => returns(s.closes));
  const n = Math.min(...rets.map((r) => r.length));
  if (n < window + 1) return [];
  const out: DispersionPoint[] = [];
  for (let end = window; end <= n; end++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < rets.length; i++) {
      for (let j = i + 1; j < rets.length; j++) {
        sum += correlation(
          rets[i].slice(end - window, end).map((x) => x.r),
          rets[j].slice(end - window, end).map((x) => x.r),
        );
        count++;
      }
    }
    out.push({ date: rets[0][end - 1].date, value: count ? sum / count : 0 });
  }
  return out;
}

export function dispersionRead(latest: number, prior: number | null): string {
  const dir = prior == null ? '' : latest > prior + 0.05 ? ' and rising' : latest < prior - 0.05 ? ' and falling' : ' and stable';
  if (latest >= 0.7) {
    return `Average pairwise correlation is ${latest.toFixed(2)}${dir} — the basket is trading as ONE asset. Diversification is not working: cutting exposure means cutting size, not spreading it. Index hedges are efficient here, relative-value is not.`;
  }
  if (latest >= 0.4) {
    return `Average pairwise correlation is ${latest.toFixed(2)}${dir} — a normal, mixed regime. Macro sets the tone but individual markets still have their own stories; both index and relative-value expressions work.`;
  }
  if (latest >= 0.15) {
    return `Average pairwise correlation is ${latest.toFixed(2)}${dir} — low. The market is pricing assets on their own merits: rotation, pair trades and relative strength are where the edge lives, and index-level bets are the weaker expression.`;
  }
  return `Average pairwise correlation is ${latest.toFixed(2)}${dir} — very low, near the limits of the normal range. Either genuine stock/market-picking conditions, or the calm that precedes a correlation shock; size relative-value trades knowing the correlation can snap back to 1 in a session.`;
}

/* -------------------------------- rotation -------------------------------- */

export interface RotationRow {
  symbol: string;
  label: string;
  /** total returns over each horizon, in % */
  ret5: number | null;
  ret20: number | null;
  ret60: number | null;
  /** return relative to the benchmark over 20 sessions, in points */
  rs20: number | null;
  /** annualised 20-day realised vol, % */
  vol: number | null;
  /** 20d return per unit of vol — the honest leadership measure */
  riskAdjusted: number | null;
  /** true when short-horizon strength is BETTER than the longer one (accelerating) */
  accelerating: boolean;
}

/**
 * Cross-sectional relative strength: who is leading, who is lagging, and who is
 * changing gear. Ranked by 20-day relative strength against the benchmark,
 * because that is the horizon rotation actually shows up on.
 */
export function rotationTable(series: NamedSeries[], benchmarkSymbol: string): RotationRow[] {
  const bench = series.find((s) => s.symbol === benchmarkSymbol);
  const benchRet20 = bench ? periodReturn(bench.closes, 20) : null;
  const rows = series.map((s) => {
    const ret5 = periodReturn(s.closes, 5);
    const ret20 = periodReturn(s.closes, 20);
    const ret60 = periodReturn(s.closes, 60);
    const vol = realisedVol(s.closes, 20);
    return {
      symbol: s.symbol,
      label: s.label,
      ret5,
      ret20,
      ret60,
      rs20: ret20 != null && benchRet20 != null ? ret20 - benchRet20 : null,
      vol,
      riskAdjusted: ret20 != null && vol != null && vol > 0 ? ret20 / vol : null,
      // scale the short horizon to the long one before comparing gears
      accelerating: ret5 != null && ret20 != null && ret5 * 4 > ret20,
    };
  });
  return rows.sort((a, b) => (b.rs20 ?? -Infinity) - (a.rs20 ?? -Infinity));
}

/** Label for the rotation table's "gear" column. */
export function rateOfChangeLabel(accelerating: boolean): string {
  return accelerating ? '▲ accelerating' : '— steady/fading';
}

/* --------------------------- the money-flow map --------------------------- */

export interface FlowPair {
  id: string;
  numerator: string;
  denominator: string;
  label: string;
  /** what a RISING ratio means */
  rising: string;
  /** what a FALLING ratio means */
  falling: string;
  why: string;
}

/**
 * The canonical ratios a macro desk keeps on one screen. Each is a flow, not a
 * price: the numerator is what money is moving INTO when the line rises.
 */
export const FLOW_PAIRS: FlowPair[] = [
  {
    id: 'spy-tlt', numerator: 'SPY', denominator: 'TLT', label: 'Stocks / Bonds',
    rising: 'Risk appetite expanding — money leaving the safety of duration for equity risk.',
    falling: 'Risk appetite contracting — money paying up for duration. In a growth scare this leads equity weakness.',
    why: 'The master risk dial. Everything else on this list is a refinement of it.',
  },
  {
    id: 'qqq-spy', numerator: 'QQQ', denominator: 'SPY', label: 'Growth / Broad market',
    rising: 'Long-duration equity leadership — falling real yields, or a narrow mega-cap bid.',
    falling: 'Rotation out of duration-sensitive growth, usually alongside rising real yields.',
    why: 'Separates "stocks are up" from "the rate-sensitive part of stocks is up" — a completely different trade.',
  },
  {
    id: 'iwm-spy', numerator: 'IWM', denominator: 'SPY', label: 'Small caps / Large caps',
    rising: 'Genuine domestic risk appetite — small caps carry credit and cyclical risk, so this rises when the economy is trusted.',
    falling: 'Narrowing market. Money hiding in size and liquidity; the average stock is being sold.',
    why: 'The honest breadth read. An index making highs while this falls is a handful of names, not a bull market.',
  },
  {
    id: 'xly-xlp', numerator: 'XLY', denominator: 'XLP', label: 'Cyclical / Defensive consumer',
    rising: 'The consumer is being bet on — discretionary over staples is a pure risk-on rotation.',
    falling: 'Defensive rotation. This one tends to turn BEFORE the index does.',
    why: 'The cleanest sector-level expression of risk appetite, free of rate-sensitivity noise.',
  },
  {
    id: 'cper-gld', numerator: 'CPER', denominator: 'GLD', label: 'Copper / Gold',
    rising: 'Global growth being priced — copper is industrial demand, gold is fear. Historically tracks the direction of long yields.',
    falling: 'Growth being marked down and fear bid. A leading indicator for the rates market.',
    why: 'The macro market\'s own growth-versus-fear vote, with no central bank in the way.',
  },
  {
    id: 'hyg-ief', numerator: 'HYG', denominator: 'IEF', label: 'High yield / Treasuries',
    rising: 'Credit appetite healthy — spreads compressing, the financing side of the economy is open.',
    falling: 'Credit stress. Credit leads equity at turns far more often than the reverse.',
    why: 'When equities and credit disagree, credit is usually right. This is the disagreement, in one line.',
  },
  {
    id: 'smh-spy', numerator: 'SMH', denominator: 'SPY', label: 'Semis / Market',
    rising: 'The cycle\'s most forward-looking group is leading — usually early-cycle or an AI-capex impulse.',
    falling: 'The leadership group is rolling; historically an early warning for the broad tape.',
    why: 'Semiconductors sit at the front of the global manufacturing cycle.',
  },
  {
    id: 'eem-spy', numerator: 'EEM', denominator: 'SPY', label: 'Emerging markets / US',
    rising: 'Dollar-liquidity easing and global growth being bought outside the US.',
    falling: 'Dollar strength and US exceptionalism — capital repatriating.',
    why: 'The clearest read on whether the dollar is a headwind or a tailwind for global risk.',
  },
];

export interface FlowReading {
  pair: FlowPair;
  /** ratio change over the window, in % */
  change: number;
  /** where the current ratio sits in its own window range, 0–100 */
  percentile: number | null;
  direction: 'rising' | 'falling' | 'flat';
  meaning: string;
  /** one leg stopped updating — the number is not comparable to the others */
  stale: boolean;
  /** how many calendar days behind the basket this ratio's last point is */
  staleDays: number;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return isFinite(a) && isFinite(b) ? Math.round((b - a) / 86400000) : 0;
}

/**
 * Score each canonical ratio over the window.
 *
 * The staleness check matters more than it looks: a ratio only needs ONE leg to
 * stop updating for it to start comparing today's numerator against a
 * months-old denominator, which produces a huge, entirely fictitious "flow".
 * Such pairs are marked stale, kept visible so the gap is obvious, and excluded
 * from the risk-on/risk-off vote.
 */
export function readFlowPairs(bySymbol: Map<string, NamedSeries>, lookback = 20, maxStaleDays = 5): FlowReading[] {
  const out: FlowReading[] = [];
  const newest = [...bySymbol.values()]
    .map((s) => s.closes[s.closes.length - 1]?.date)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  for (const pair of FLOW_PAIRS) {
    const a = bySymbol.get(pair.numerator);
    const b = bySymbol.get(pair.denominator);
    if (!a || !b) continue;
    const ratio = ratioSeries(a.closes, b.closes);
    if (ratio.length < Math.max(6, lookback / 2)) continue;
    const change = periodReturn(ratio, lookback);
    if (change == null) continue;
    const staleDays = newest ? daysBetween(ratio[ratio.length - 1].date, newest) : 0;
    const stale = staleDays > maxStaleDays;
    const vals = ratio.slice(-Math.max(lookback * 3, 60)).map((c) => c.close);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const cur = ratio[ratio.length - 1].close;
    const percentile = hi > lo ? Math.round(((cur - lo) / (hi - lo)) * 100) : null;
    const direction: FlowReading['direction'] = change > 0.75 ? 'rising' : change < -0.75 ? 'falling' : 'flat';
    out.push({
      pair,
      change,
      percentile,
      direction,
      stale,
      staleDays,
      meaning: stale
        ? `STALE — one leg stopped updating ${staleDays} days ago, so this ratio is comparing prices from different dates. Ignore the number until the feed catches up.`
        : direction === 'rising'
          ? pair.rising
          : direction === 'falling'
            ? pair.falling
            : `Flat over the window — no flow either way in ${pair.label.toLowerCase()}.`,
    });
  }
  return out.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
}

/* --------------------------------- synthesis ------------------------------- */

export interface FlowRead {
  headline: string;
  lines: string[];
  /** what the flows imply for positioning */
  implications: string[];
}

/**
 * Turn the ratio map + dispersion into a desk-level read. Risk-on and risk-off
 * votes are counted from the ratios that actually mean risk appetite, so the
 * headline is earned by agreement rather than by one line moving.
 */
export function synthesiseFlows(readings: FlowReading[], dispersion: number | null): FlowRead {
  const lines: string[] = [];
  const implications: string[] = [];

  // every pair on this list rises when risk appetite expands
  const riskOnIds = new Set(['spy-tlt', 'iwm-spy', 'xly-xlp', 'cper-gld', 'hyg-ief', 'smh-spy', 'eem-spy']);
  const fresh = readings.filter((r) => !r.stale);
  const votes = fresh.filter((r) => riskOnIds.has(r.pair.id) && r.direction !== 'flat');
  const on = votes.filter((r) => r.direction === 'rising').length;
  const off = votes.filter((r) => r.direction === 'falling').length;

  let headline: string;
  if (!votes.length) headline = 'NO FLOW — the cross-asset ratios are flat';
  else if (on >= off * 2 && on >= 3) headline = `RISK-ON — ${on} of ${votes.length} flow ratios pointing the same way`;
  else if (off >= on * 2 && off >= 3) headline = `RISK-OFF — ${off} of ${votes.length} flow ratios pointing the same way`;
  else headline = `MIXED FLOW — ${on} risk-on vs ${off} risk-off ratios`;

  for (const r of fresh.slice(0, 5)) {
    lines.push(`${r.pair.label} ${r.change >= 0 ? '+' : ''}${r.change.toFixed(1)}%${r.percentile != null ? ` (${r.percentile}th pctile of its own range)` : ''} — ${r.meaning}`);
  }

  // the disagreements are the information
  const credit = fresh.find((r) => r.pair.id === 'hyg-ief');
  const equity = fresh.find((r) => r.pair.id === 'spy-tlt');
  if (credit && equity && credit.direction !== 'flat' && equity.direction !== 'flat' && credit.direction !== equity.direction) {
    implications.push(
      `Credit and equity DISAGREE (${credit.pair.label} ${credit.direction}, ${equity.pair.label} ${equity.direction}). Credit is the more reliable of the two at turns — respect the credit signal and treat the equity move as the one that has to prove itself.`,
    );
  }
  const breadth = fresh.find((r) => r.pair.id === 'iwm-spy');
  if (breadth?.direction === 'falling' && equity?.direction === 'rising') {
    implications.push(
      'Index risk appetite is rising while small caps lag — the advance is narrowing. Narrow tapes trend longer than feels right and then break quickly: ride it, but never add on strength and keep the invalidation tight.',
    );
  }
  const semis = fresh.find((r) => r.pair.id === 'smh-spy');
  if (semis?.direction === 'falling' && equity?.direction === 'rising') {
    implications.push('Semiconductors are lagging a rising tape — the cycle\'s forward-looking group is not confirming. Historically an early warning rather than an immediate sell.');
  }
  const copper = fresh.find((r) => r.pair.id === 'cper-gld');
  if (copper?.direction === 'falling') {
    implications.push('Copper/gold falling prices growth down and fear up — it usually leads long yields lower. That supports duration and pressures cyclicals regardless of what the index does this week.');
  }
  if (dispersion != null && dispersion >= 0.7) {
    implications.push(`Average correlation at ${dispersion.toFixed(2)}: the basket is one trade. Express a view with size, not with spread — pair trades will not diversify you here.`);
  }
  if (dispersion != null && dispersion < 0.3) {
    implications.push(`Average correlation at ${dispersion.toFixed(2)}: assets are moving on their own stories. Relative-value and rotation expressions carry the edge; index bets are the blunter instrument.`);
  }
  if (!implications.length) {
    implications.push('No cross-asset contradiction to flag — the ratios broadly agree with each other, which is itself the read: trade the direction they point, and let the first disagreement be your warning.');
  }

  return { headline, lines, implications };
}
