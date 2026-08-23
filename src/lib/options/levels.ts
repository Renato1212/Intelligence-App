/*
 * Options-derived levels engine.
 *
 * Dealer option hedging creates mechanical support and resistance in the
 * futures. This module turns an option chain into those levels, converted to
 * the futures price, with the strength and the mechanical meaning of each.
 *
 * Pure functions only — no I/O, no fetching, no storage. Everything here is
 * deterministic given a chain, so it can be unit-tested and re-run over history.
 *
 * It never says buy or sell. It says where to look.
 */

/* ------------------------------- inputs ---------------------------------- */

export interface ChainContract {
  /** YYYY-MM-DD */
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  openInterest: number;
  /** decimal, e.g. 0.18 for 18% */
  iv: number | null;
  /** only used if IV is missing; we prefer to compute gamma ourselves */
  gamma?: number | null;
  volume?: number;
}

export interface EngineConfig {
  /** index option contract multiplier (100 for SPX/NDX/RUT) */
  multiplier: number;
  /** risk-free rate, decimal */
  rate: number;
  /** dividend yield, decimal */
  dividendYield: number;
  /** strength thresholds — recalibrate against logged sessions, not code */
  strength: {
    highShare: number;
    highDistEm: number;
    medShare: number;
    medDistEm: number;
  };
  /** walls inside this many EM of spot are excluded (gamma always peaks ATM) */
  wallDeadZoneEm: number;
  /** two levels within this many EM upgrade one notch */
  confluenceEm: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  multiplier: 100,
  rate: 0.04,
  dividendYield: 0.013,
  strength: { highShare: 0.07, highDistEm: 1.0, medShare: 0.035, medDistEm: 1.75 },
  wallDeadZoneEm: 0.2,
  confluenceEm: 0.15,
};

/**
 * Dealer positioning assumption: dealers are long calls and short puts.
 *
 * This is an ASSUMPTION, not a measurement — no free source publishes actual
 * dealer inventory. It is the market-standard convention and it is exported by
 * name so it is never a stray sign buried in a loop, and so the UI can say so.
 */
export const DEALER_LONG_CALLS_SHORT_PUTS = true;
export function dealerSign(right: 'C' | 'P'): 1 | -1 {
  if (!DEALER_LONG_CALLS_SHORT_PUTS) return right === 'C' ? -1 : 1;
  return right === 'C' ? 1 : -1;
}

/* ------------------------------ black-scholes ---------------------------- */

const SQRT_2PI = Math.sqrt(2 * Math.PI);
/** Standard normal pdf. */
export function phi(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Minimum time to expiry, in years, ≈ 4 hours. Below this, gamma diverges
 * (it carries a 1/√τ term) and a 0DTE strike would swamp the whole profile.
 */
export const TAU_FLOOR = 4 / (24 * 365);

/** Years between two dates, floored so 0DTE cannot blow up. */
export function yearsToExpiry(expiry: string, asOf: Date): number {
  const end = new Date(`${expiry}T21:00:00Z`).getTime(); // ~US cash close
  const tau = (end - asOf.getTime()) / (365 * 24 * 3600 * 1000);
  return Math.max(TAU_FLOOR, tau);
}

/**
 * Black-Scholes gamma: Γ = φ(d₁) / (S·σ·√τ).
 *
 * Computed from the chain's implied volatility rather than trusting whatever
 * greek the source hands back — sources disagree, and a wrong gamma silently
 * corrupts every level downstream.
 */
export function bsGamma(S: number, K: number, tau: number, sigma: number, r = 0, q = 0): number {
  if (!(S > 0) || !(K > 0) || !(sigma > 0) || !(tau > 0)) return 0;
  const sqrtT = Math.sqrt(tau);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * tau) / (sigma * sqrtT);
  return phi(d1) / (S * sigma * sqrtT);
}

/** Dollar gamma exposure per 1% move: Γ × OI × multiplier × S² × 0.01. */
export function dollarGamma(gamma: number, openInterest: number, multiplier: number, S: number): number {
  return gamma * openInterest * multiplier * S * S * 0.01;
}

/* --------------------------------- profile -------------------------------- */

export type ExpiryBucket = 'zero' | 'week' | 'month' | 'all';

/** Days between an expiry and a date, calendar days. */
export function daysToExpiry(expiry: string, asOf: Date): number {
  const end = new Date(`${expiry}T00:00:00Z`).getTime();
  const start = new Date(asOf.toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((end - start) / 86400000);
}

export function inBucket(expiry: string, asOf: Date, bucket: ExpiryBucket): boolean {
  if (bucket === 'all') return true;
  const d = daysToExpiry(expiry, asOf);
  if (d < 0) return false;
  if (bucket === 'zero') return d === 0;
  if (bucket === 'week') return d <= 7;
  return d <= 35;
}

export interface StrikeGamma {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  callOI: number;
  putOI: number;
}

/**
 * Net dealer gamma exposure at a hypothetical spot price.
 *
 * Repricing the WHOLE profile at each candidate spot is the point: gamma is a
 * function of moneyness, so every strike's contribution changes as spot moves.
 */
export function netGexAtSpot(
  contracts: ChainContract[],
  spot: number,
  asOf: Date,
  cfg: EngineConfig = DEFAULT_CONFIG,
): number {
  let total = 0;
  for (const c of contracts) {
    const sigma = c.iv && c.iv > 0 ? c.iv : null;
    const tau = yearsToExpiry(c.expiry, asOf);
    const g = sigma != null ? bsGamma(spot, c.strike, tau, sigma, cfg.rate, cfg.dividendYield) : c.gamma ?? 0;
    if (!g) continue;
    total += dealerSign(c.right) * dollarGamma(g, c.openInterest, cfg.multiplier, spot);
  }
  return total;
}

/** Per-strike gamma exposure at the current spot. */
export function strikeProfile(
  contracts: ChainContract[],
  spot: number,
  asOf: Date,
  cfg: EngineConfig = DEFAULT_CONFIG,
): StrikeGamma[] {
  const map = new Map<number, StrikeGamma>();
  for (const c of contracts) {
    const sigma = c.iv && c.iv > 0 ? c.iv : null;
    const tau = yearsToExpiry(c.expiry, asOf);
    const g = sigma != null ? bsGamma(spot, c.strike, tau, sigma, cfg.rate, cfg.dividendYield) : c.gamma ?? 0;
    const gex = dollarGamma(g, c.openInterest, cfg.multiplier, spot);
    let row = map.get(c.strike);
    if (!row) {
      row = { strike: c.strike, callGex: 0, putGex: 0, netGex: 0, callOI: 0, putOI: 0 };
      map.set(c.strike, row);
    }
    if (c.right === 'C') {
      row.callGex += gex;
      row.callOI += c.openInterest;
    } else {
      row.putGex += gex;
      row.putOI += c.openInterest;
    }
    row.netGex += dealerSign(c.right) * gex;
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike);
}

/**
 * Gamma flip: the spot price at which net dealer gamma crosses zero.
 *
 * Computed by repricing the entire profile across a grid of hypothetical spot
 * prices and interpolating the crossing nearest current spot.
 *
 * NOT the cumulative-sum-by-strike shortcut. That shortcut sums each strike's
 * gamma *measured at today's spot* and asks where the running total crosses
 * zero — which answers a different question and gives a materially wrong flip.
 * This is the single most common error in public implementations.
 */
export function gammaFlip(
  contracts: ChainContract[],
  spot: number,
  asOf: Date,
  cfg: EngineConfig = DEFAULT_CONFIG,
  span = 0.08,
  steps = 121,
): number | null {
  if (!contracts.length || !(spot > 0)) return null;
  const lo = spot * (1 - span);
  const hi = spot * (1 + span);
  const dx = (hi - lo) / (steps - 1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < steps; i++) {
    const s = lo + i * dx;
    xs.push(s);
    ys.push(netGexAtSpot(contracts, s, asOf, cfg));
  }
  let best: number | null = null;
  for (let i = 1; i < steps; i++) {
    const y0 = ys[i - 1];
    const y1 = ys[i];
    if (y0 === 0) {
      if (best == null || Math.abs(xs[i - 1] - spot) < Math.abs(best - spot)) best = xs[i - 1];
      continue;
    }
    if (Math.sign(y0) !== Math.sign(y1) && y1 !== 0) {
      // linear interpolation of the zero crossing between the two grid points
      const cross = xs[i - 1] + (xs[i] - xs[i - 1]) * (Math.abs(y0) / (Math.abs(y0) + Math.abs(y1)));
      if (best == null || Math.abs(cross - spot) < Math.abs(best - spot)) best = cross;
    }
  }
  return best;
}

/* ----------------------------- expected move ------------------------------ */

/** ATM implied volatility — the IV of the strike nearest spot. */
export function atmIv(contracts: ChainContract[], spot: number): number | null {
  let best: { d: number; iv: number } | null = null;
  for (const c of contracts) {
    if (!c.iv || c.iv <= 0) continue;
    const d = Math.abs(c.strike - spot);
    if (!best || d < best.d) best = { d, iv: c.iv };
  }
  return best?.iv ?? null;
}

/** One-session expected move: S × ATM_IV × √(1/252). */
export function expectedMove(spot: number, iv: number): number {
  return spot * iv * Math.sqrt(1 / 252);
}

/* -------------------------------- levels ---------------------------------- */

export type LevelKind = 'regime' | 'wall' | 'magnet' | 'envelope';
export type Strength = 'HIGH' | 'HIGH*' | 'MEDIUM' | 'LOW';

export interface OptionLevel {
  name: string;
  kind: LevelKind;
  indexPrice: number;
  futuresPrice: number;
  strength: Strength;
  /** this strike's share of total absolute gamma, 0..1 */
  share: number;
  /** distance from spot in expected-move units */
  distEm: number;
  expiryTag: ExpiryBucket;
  /** the mechanical meaning — what dealers must do here and why it matters */
  note: string;
  confluence: string[];
}

/** Tick sizes for futures rounding. */
export const TICKS: Record<string, number> = {
  ES: 0.25, MES: 0.25, NQ: 0.25, MNQ: 0.25, RTY: 0.1, M2K: 0.1, YM: 1, MYM: 1,
};

export function roundToTick(price: number, tick: number): number {
  if (!(tick > 0)) return price;
  return Math.round(price / tick) * tick;
}

/** futures = index + basis. Basis is sampled, never hardcoded or cached. */
export function toFutures(indexPrice: number, basis: number, tick: number): number {
  return roundToTick(indexPrice + basis, tick);
}

export function scoreStrength(share: number, distEm: number, isZeroDte: boolean, cfg: EngineConfig = DEFAULT_CONFIG): Strength {
  const s = cfg.strength;
  let base: Strength;
  if (share >= s.highShare && distEm <= s.highDistEm) base = 'HIGH';
  else if (share >= s.medShare && distEm <= s.medDistEm) base = 'MEDIUM';
  else base = 'LOW';
  if (base === 'HIGH' && isZeroDte) return 'HIGH*';
  return base;
}

const ORDER: Strength[] = ['LOW', 'MEDIUM', 'HIGH', 'HIGH*'];
/** Upgrade one notch (HIGH* is already the top). */
export function upgrade(s: Strength): Strength {
  const i = ORDER.indexOf(s);
  return i < 0 || i >= ORDER.length - 1 ? s : ORDER[i + 1];
}

/**
 * Apply confluence: any two independent levels within `confluenceEm` of each
 * other are each upgraded one notch, and record what they stacked with.
 */
export function applyConfluence(levels: OptionLevel[], em: number, cfg: EngineConfig = DEFAULT_CONFIG): OptionLevel[] {
  if (!(em > 0)) return levels;
  const out = levels.map((l) => ({ ...l, confluence: [...l.confluence] }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const gap = Math.abs(out[i].indexPrice - out[j].indexPrice) / em;
      if (gap <= cfg.confluenceEm) {
        out[i].confluence.push(out[j].name);
        out[j].confluence.push(out[i].name);
      }
    }
  }
  for (const l of out) if (l.confluence.length) l.strength = upgrade(l.strength);
  return out;
}

/**
 * Theoretical futures basis from cost of carry: F = S·e^((r−q)T), so
 * basis = F − S. Last-resort estimate only — the real basis must be sampled
 * from a quote, because carry assumptions drift and the basis resets at roll.
 */
export function carryBasis(spot: number, daysToContractExpiry: number, rate: number, dividendYield: number): number {
  const T = Math.max(0, daysToContractExpiry) / 365;
  return spot * (Math.exp((rate - dividendYield) * T) - 1);
}

/** Calendar days to the next quarterly (Mar/Jun/Sep/Dec) futures expiry. */
export function daysToQuarterlyExpiry(asOf: Date): number {
  const y = asOf.getUTCFullYear();
  const months = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec (0-indexed)
  for (const m of months) {
    // third Friday
    let count = 0;
    for (let day = 1; day <= 31; day++) {
      const dt = new Date(Date.UTC(y, m, day));
      if (dt.getUTCMonth() !== m) break;
      if (dt.getUTCDay() === 5 && ++count === 3) {
        const diff = Math.round((dt.getTime() - asOf.getTime()) / 86400000);
        if (diff >= 0) return diff;
      }
    }
  }
  return Math.round((new Date(Date.UTC(y + 1, 2, 20)).getTime() - asOf.getTime()) / 86400000);
}
