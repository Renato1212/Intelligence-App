/*
 * Regime engine + session classifier (build spec §6.1, §6.2).
 *
 * Two questions the routine asks every morning, answered from daily bars:
 *
 *  - "Current volume and volatility — understand seasonality and recent
 *    dominating behavior (trending, news driven, ranging, calm, agitated,
 *    respecting structure, erratic)."  → the regime tag.
 *  - "Previous day and previous session type — what to expect for the current
 *    day and session based on the previous day and session."  → the day type.
 *
 * Law 3: no metric without a distribution behind it. Every axis reports the
 * percentile it sits at within its own lookback, and every classification
 * carries the evidence that produced it, so the UI can always explain itself.
 */

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/* ---------------------------------- math --------------------------------- */

/**
 * Percentile rank (0..1) of `value` within `sample`, using the mid-rank for
 * ties. Mid-ranking matters: a degenerate sample (every window identical)
 * returns 0.5 — "no information" — instead of 1.0, which would otherwise read
 * as an extreme and flip a regime axis on nothing.
 */
export function pctRank(sample: number[], value: number): number {
  const clean = sample.filter((v) => Number.isFinite(v));
  if (!clean.length) return 0.5;
  const below = clean.filter((v) => v < value).length;
  const equal = clean.filter((v) => v === value).length;
  return (below + equal / 2) / clean.length;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

/** Annualised realised volatility from close-to-close log returns. */
function realisedVol(bars: Bar[]): number {
  if (bars.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1].close;
    const b = bars[i].close;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return 0;
  const m = mean(rets);
  const varr = rets.reduce((s, r) => s + (r - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * Math.sqrt(252);
}

/**
 * Efficiency ratio (Kaufman): net displacement ÷ total path travelled.
 * High = the market went somewhere in a straight line (trending); low = it
 * covered a lot of ground and ended up nowhere (rotational).
 */
function efficiency(bars: Bar[]): number {
  if (bars.length < 3) return 0;
  const net = Math.abs(bars[bars.length - 1].close - bars[0].close);
  let path = 0;
  for (let i = 1; i < bars.length; i++) path += Math.abs(bars[i].close - bars[i - 1].close);
  return path > 0 ? net / path : 0;
}

/* --------------------------------- regime -------------------------------- */

export type TrendAxis = 'trending' | 'rotational';
export type EnergyAxis = 'calm' | 'agitated';
export type StructureAxis = 'structure-respecting' | 'erratic';

export interface RegimeAxis<T extends string> {
  value: T;
  /** Percentile of the driving metric within its lookback, 0..1 */
  pct: number;
  /** Human-readable evidence — never show the tag without this. */
  evidence: string;
}

export interface Regime {
  trend: RegimeAxis<TrendAxis>;
  energy: RegimeAxis<EnergyAxis>;
  structure: RegimeAxis<StructureAxis>;
  /** e.g. "Rotational · agitated · structure-respecting" */
  label: string;
  /** bars actually used */
  sample: number;
  asOf: string;
}

const RECENT = 20;
const LOOKBACK = 252;

/**
 * Classify the current regime from daily bars (most recent last).
 *
 * - trend: 20d efficiency ratio vs its own 1y distribution
 * - energy: 20d realised vol vs its own 1y distribution
 * - structure: how often closes land inside the prior day's range. A market
 *   that keeps resolving outside prior ranges in both directions is erratic;
 *   one that accepts and rejects prior ranges cleanly is respecting structure.
 */
export function classifyRegime(bars: Bar[]): Regime | null {
  if (bars.length < RECENT + 5) return null;
  const hist = bars.slice(-LOOKBACK);
  const recent = hist.slice(-RECENT);

  // --- trend axis
  const er = efficiency(recent);
  const erSample: number[] = [];
  for (let i = RECENT; i <= hist.length; i++) erSample.push(efficiency(hist.slice(i - RECENT, i)));
  const erPct = pctRank(erSample, er);
  // The efficiency ratio is already normalised 0..1, so it is comparable across
  // markets and across time — classify on the absolute value and report the
  // percentile as context. A purely relative read cannot tell a market that is
  // *always* rotational from one that is trending.
  const isTrending = er >= 0.35;
  const trend: RegimeAxis<TrendAxis> = {
    value: isTrending ? 'trending' : 'rotational',
    pct: erPct,
    evidence: `20-day efficiency ratio ${er.toFixed(2)} (trending above 0.35) — ${Math.round(erPct * 100)}th percentile of the last year. ${
      isTrending
        ? 'Moves are travelling in a line: continuation has been paying.'
        : 'Ground is being covered without displacement: fades and rotations have been paying.'
    }`,
  };

  // --- energy axis
  const rv = realisedVol(recent);
  const rvSample: number[] = [];
  for (let i = RECENT; i <= hist.length; i++) rvSample.push(realisedVol(hist.slice(i - RECENT, i)));
  const rvPct = pctRank(rvSample, rv);
  const energy: RegimeAxis<EnergyAxis> = {
    value: rvPct >= 0.5 ? 'agitated' : 'calm',
    pct: rvPct,
    evidence: `20-day realised volatility ${(rv * 100).toFixed(1)}% annualised — ${Math.round(rvPct * 100)}th percentile. ${
      rvPct >= 0.5 ? 'Expect wider stops and faster resolution.' : 'Expect compression: size down or wait for a catalyst.'
    }`,
  };

  // --- structure axis
  const inside = (window: Bar[]) => {
    let n = 0;
    for (let i = 1; i < window.length; i++) {
      const p = window[i - 1];
      if (window[i].close <= p.high && window[i].close >= p.low) n++;
    }
    return window.length > 1 ? n / (window.length - 1) : 0;
  };
  const acc = inside(recent);
  const accSample: number[] = [];
  for (let i = RECENT; i <= hist.length; i++) accSample.push(inside(hist.slice(i - RECENT, i)));
  const accPct = pctRank(accSample, acc);
  const structure: RegimeAxis<StructureAxis> = {
    value: accPct >= 0.4 ? 'structure-respecting' : 'erratic',
    pct: accPct,
    evidence: `${Math.round(acc * 100)}% of closes landed inside the prior day's range — ${Math.round(accPct * 100)}th percentile. ${
      accPct >= 0.4
        ? 'Prior-day levels are being respected: reference-based entries are reliable.'
        : 'Prior ranges keep breaking in both directions: levels are less reliable, lean on catalysts.'
    }`,
  };

  const label = `${trend.value === 'trending' ? 'Trending' : 'Rotational'} · ${energy.value} · ${structure.value}`;
  return { trend, energy, structure, label, sample: recent.length, asOf: bars[bars.length - 1].date };
}

/* ---------------------------- session classifier -------------------------- */

export type DayType =
  | 'trend-up'
  | 'trend-down'
  | 'double-distribution'
  | 'normal'
  | 'normal-variation'
  | 'neutral';

export interface DayClassification {
  date: string;
  type: DayType;
  label: string;
  /** 0..1 */
  confidence: number;
  evidence: string[];
  /** where the close sat in the day's range, 0 = low, 1 = high */
  closePosition: number;
  rangePct: number;
}

const DAY_LABEL: Record<DayType, string> = {
  'trend-up': 'Trend day up',
  'trend-down': 'Trend day down',
  'double-distribution': 'Double distribution',
  normal: 'Normal day',
  'normal-variation': 'Normal variation',
  neutral: 'Neutral day',
};

/**
 * Classify one session from its daily bar, using the range relative to recent
 * days and where the close finished within it.
 *
 * This is a bar-level approximation of the profile-based definition: a true
 * classification needs intraday TPO. It states its own confidence so it is
 * never mistaken for the real thing.
 */
export function classifyDay(bars: Bar[], index = bars.length - 1): DayClassification | null {
  if (index < 5 || index >= bars.length) return null;
  const b = bars[index];
  const prior = bars.slice(Math.max(0, index - 20), index);
  const range = b.high - b.low;
  if (range <= 0) return null;

  const priorRanges = prior.map((x) => x.high - x.low).filter((r) => r > 0);
  const rangePct = pctRank(priorRanges, range);
  const closePos = (b.close - b.low) / range;
  const openPos = (b.open - b.low) / range;
  const ev: string[] = [
    `Range ${range.toFixed(2)} — ${Math.round(rangePct * 100)}th percentile of the last 20 sessions.`,
    `Close finished ${Math.round(closePos * 100)}% up the day's range (open at ${Math.round(openPos * 100)}%).`,
  ];

  let type: DayType;
  let confidence: number;
  if (rangePct >= 0.7 && closePos >= 0.75 && openPos <= 0.35) {
    type = 'trend-up';
    confidence = 0.55 + 0.4 * Math.min(1, (rangePct - 0.7) / 0.3);
    ev.push('Opened near the low, expanded, and closed on the high — one-timeframe buying.');
  } else if (rangePct >= 0.7 && closePos <= 0.25 && openPos >= 0.65) {
    type = 'trend-down';
    confidence = 0.55 + 0.4 * Math.min(1, (rangePct - 0.7) / 0.3);
    ev.push('Opened near the high, expanded, and closed on the low — one-timeframe selling.');
  } else if (rangePct >= 0.8 && closePos > 0.35 && closePos < 0.65) {
    type = 'double-distribution';
    confidence = 0.5;
    ev.push('Large range but the close came back to the middle — two areas of acceptance with a gap between.');
  } else if (rangePct <= 0.3) {
    type = 'normal';
    confidence = 0.5 + 0.3 * (0.3 - rangePct) / 0.3;
    ev.push('Range well below normal — the initial balance contained the session.');
  } else if (closePos > 0.4 && closePos < 0.6) {
    type = 'neutral';
    confidence = 0.45;
    ev.push('Both extremes explored and the close settled mid-range — two-sided, unresolved.');
  } else {
    type = 'normal-variation';
    confidence = 0.45;
    ev.push('Range extended beyond the initial balance without becoming one-directional.');
  }

  return {
    date: b.date,
    type,
    label: DAY_LABEL[type],
    confidence: Math.min(0.95, confidence),
    evidence: ev,
    closePosition: closePos,
    rangePct,
  };
}

/** What the previous session implies for today — the routine's own question. */
export function priorSessionRead(day: DayClassification | null): string {
  if (!day) return 'Not enough history to read the previous session.';
  switch (day.type) {
    case 'trend-up':
      return 'After a trend day up, expect either continuation on an open-drive or a full retrace of the final push. Fading it early is the classic mistake.';
    case 'trend-down':
      return 'After a trend day down, expect continuation or a sharp responsive bounce into the prior value area. Let the open resolve first.';
    case 'double-distribution':
      return 'After a double distribution, the low-volume gap between the two areas is the key reference — it tends to be revisited and defended.';
    case 'normal':
      return 'After a quiet, contained day, energy is stored. Range expansion is more likely, especially on a catalyst.';
    case 'neutral':
      return 'After a neutral day, the market is unresolved. The first clean break of yesterday’s extremes usually sets the tone.';
    default:
      return 'After a normal-variation day, treat yesterday’s extremes as the references and trade the reaction to them.';
  }
}
