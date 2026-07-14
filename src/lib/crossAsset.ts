/*
 * Cross-asset map — "same movement across markets, or one alone?"
 *
 * That question opens every AXIA day preparation, and answering it well is a
 * skill. This module computes it: rolling correlations across the core
 * futures proxies (equities, bonds, dollar, gold, crude…), which pairs have
 * BROKEN from their normal relationship recently (regime information), and
 * each asset's trend/volatility state — from daily closes on the trader's
 * free FMP key (ETF proxies, same as the day-ahead briefing).
 */
import { fmpDailyBarUrls, parseFmpDaily } from './market';

export const CROSS_ASSETS: { symbol: string; label: string; short: string }[] = [
  { symbol: 'SPY', label: 'S&P 500', short: 'SPX' },
  { symbol: 'QQQ', label: 'Nasdaq', short: 'NDX' },
  { symbol: 'IWM', label: 'Russell', short: 'RTY' },
  { symbol: 'TLT', label: 'Bonds 20y+', short: 'BOND' },
  { symbol: 'UUP', label: 'US Dollar', short: 'USD' },
  { symbol: 'GLD', label: 'Gold', short: 'GOLD' },
  { symbol: 'USO', label: 'WTI Crude', short: 'OIL' },
  { symbol: 'FXE', label: 'Euro', short: 'EUR' },
];

export interface AssetSeries {
  symbol: string;
  /** ascending daily closes */
  closes: { date: string; close: number }[];
}

export interface AssetState {
  symbol: string;
  label: string;
  short: string;
  /** 20-day return % */
  ret20: number;
  /** 20d realized vol, annualized % */
  vol20: number;
  /** vol20 vs its trailing-120d distribution, 0–100 */
  volPctile: number | null;
}

export interface PairCorr {
  a: string;
  b: string;
  /** rolling 20d correlation of daily returns */
  c20: number;
  /** longer 60d baseline */
  c60: number;
  /** |c20 − c60| — how far the pair has moved off its recent norm */
  break_: number;
}

export interface CrossAssetRead {
  asOf: string;
  states: AssetState[];
  pairs: PairCorr[];
  /** biggest correlation regime changes, sorted */
  breaks: PairCorr[];
}

function returns(closes: { date: string; close: number }[]): { date: string; r: number }[] {
  const out: { date: string; r: number }[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1].close > 0) out.push({ date: closes[i].date, r: closes[i].close / closes[i - 1].close - 1 });
  }
  return out;
}

export function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return 0;
  const mx = xs.slice(-n).reduce((s, x) => s + x, 0) / n;
  const my = ys.slice(-n).reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[xs.length - n + i] - mx;
    const dy = ys[ys.length - n + i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Pure: the whole cross-asset read from daily close series. */
export function analyzeCrossAsset(series: AssetSeries[]): CrossAssetRead | null {
  const usable = series.filter((s) => s.closes.length >= 80);
  if (usable.length < 4) return null;

  // align on common dates
  const dateSets = usable.map((s) => new Set(s.closes.map((c) => c.date)));
  const common = usable[0].closes.map((c) => c.date).filter((d) => dateSets.every((set) => set.has(d)));
  const aligned = usable.map((s) => ({
    symbol: s.symbol,
    closes: s.closes.filter((c) => common.includes(c.date)),
  }));

  const rets = new Map(aligned.map((s) => [s.symbol, returns(s.closes).map((x) => x.r)]));
  const asOf = common[common.length - 1] ?? '';

  const states: AssetState[] = [];
  for (const s of aligned) {
    const meta = CROSS_ASSETS.find((a) => a.symbol === s.symbol);
    if (!meta) continue;
    const r = rets.get(s.symbol)!;
    if (r.length < 60) continue;
    const c = s.closes;
    const ret20 = (c[c.length - 1].close / c[Math.max(0, c.length - 21)].close - 1) * 100;
    const volWindow = (end: number) => {
      const w = r.slice(Math.max(0, end - 20), end);
      const m = w.reduce((x, y) => x + y, 0) / w.length;
      return Math.sqrt(w.reduce((x, y) => x + (y - m) * (y - m), 0) / (w.length - 1)) * Math.sqrt(252) * 100;
    };
    const vol20 = volWindow(r.length);
    const history: number[] = [];
    for (let e = 40; e <= r.length; e += 5) history.push(volWindow(e));
    const volPctile = history.length >= 10 ? Math.round((history.filter((v) => v <= vol20).length / history.length) * 100) : null;
    states.push({ symbol: s.symbol, label: meta.label, short: meta.short, ret20, vol20, volPctile });
  }

  const pairs: PairCorr[] = [];
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const ra = rets.get(states[i].symbol)!;
      const rb = rets.get(states[j].symbol)!;
      const c20 = correlation(ra.slice(-20), rb.slice(-20));
      const c60 = correlation(ra.slice(-60), rb.slice(-60));
      pairs.push({ a: states[i].short, b: states[j].short, c20, c60, break_: Math.abs(c20 - c60) });
    }
  }
  const breaks = [...pairs].sort((x, y) => y.break_ - x.break_).slice(0, 4).filter((p) => p.break_ >= 0.35);

  return { asOf, states, pairs, breaks };
}

/* -------------------------------- breadth -------------------------------- */

export const SECTORS: { symbol: string; label: string }[] = [
  { symbol: 'XLK', label: 'Tech' },
  { symbol: 'XLF', label: 'Financials' },
  { symbol: 'XLE', label: 'Energy' },
  { symbol: 'XLV', label: 'Health' },
  { symbol: 'XLI', label: 'Industrials' },
  { symbol: 'XLY', label: 'Discretionary' },
  { symbol: 'XLP', label: 'Staples' },
  { symbol: 'XLU', label: 'Utilities' },
  { symbol: 'XLB', label: 'Materials' },
  { symbol: 'XLRE', label: 'Real Estate' },
  { symbol: 'XLC', label: 'Comm Svcs' },
];

export interface SectorState {
  symbol: string;
  label: string;
  ret20: number;
  above50: boolean;
  /** % distance from the 50DMA */
  dist50: number;
}

export interface BreadthRead {
  asOf: string;
  sectors: SectorState[];
  /** how many of the 11 sectors trade above their 50DMA */
  above50Count: number;
  /** equal-weight vs cap-weight S&P, 20-day relative return (% — + = broad participation) */
  rspSpy20: number | null;
  read: string;
}

/** Pure: sector-rotation + participation read from daily closes. */
export function analyzeBreadth(series: AssetSeries[]): BreadthRead | null {
  const bySym = new Map(series.map((s) => [s.symbol, s.closes]));
  const sectors: SectorState[] = [];
  let asOf = '';
  for (const spec of SECTORS) {
    const closes = bySym.get(spec.symbol);
    if (!closes || closes.length < 55) continue;
    const last = closes[closes.length - 1];
    asOf = last.date > asOf ? last.date : asOf;
    const ma50 = closes.slice(-50).reduce((s, c) => s + c.close, 0) / Math.min(50, closes.length);
    const ret20 = (last.close / closes[Math.max(0, closes.length - 21)].close - 1) * 100;
    sectors.push({
      symbol: spec.symbol,
      label: spec.label,
      ret20,
      above50: last.close >= ma50,
      dist50: (last.close / ma50 - 1) * 100,
    });
  }
  if (sectors.length < 6) return null;
  sectors.sort((a, b) => b.ret20 - a.ret20);
  const above50Count = sectors.filter((s) => s.above50).length;

  let rspSpy20: number | null = null;
  const rsp = bySym.get('RSP');
  const spy = bySym.get('SPY');
  if (rsp && spy && rsp.length > 21 && spy.length > 21) {
    const r = rsp[rsp.length - 1].close / rsp[Math.max(0, rsp.length - 21)].close - 1;
    const s = spy[spy.length - 1].close / spy[Math.max(0, spy.length - 21)].close - 1;
    rspSpy20 = (r - s) * 100;
  }

  const frac = above50Count / sectors.length;
  const lead = sectors.slice(0, 2).map((s) => s.label).join(' & ');
  const lag = sectors[sectors.length - 1].label;
  const read =
    frac >= 0.72
      ? `Broad advance: ${above50Count}/${sectors.length} sectors above their 50DMA, led by ${lead}. Rallies with this breadth are hard to fade — dips are entries, not warnings.`
      : frac <= 0.35
        ? `Narrow tape: only ${above50Count}/${sectors.length} sectors hold their 50DMA (weakest: ${lag}). Index strength here rides a few names — breaks travel further and bounces need confirmation.`
        : `Split tape: ${above50Count}/${sectors.length} sectors above the 50DMA — rotation (${lead} leading, ${lag} lagging) rather than direction. Relative-value moves beat index bets until this resolves.`;

  return {
    asOf,
    sectors,
    above50Count,
    rspSpy20,
    read: rspSpy20 != null ? `${read} Equal-weight vs cap-weight is ${rspSpy20 >= 0 ? 'out' : 'under'}performing by ${Math.abs(rspSpy20).toFixed(1)}% over 20 days${rspSpy20 < -1 ? ' — the average stock is NOT confirming the index.' : '.'}` : read,
  };
}

const BREADTH_CACHE_KEY = 'ei-breadth-cache-v1';

/** Cached-first breadth load (sector ETFs + RSP/SPY via the FMP key). */
export async function loadBreadth(force = false): Promise<{ read: BreadthRead | null; error: string | null }> {
  let cached: CacheShape | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(BREADTH_CACHE_KEY) ?? 'null') as CacheShape | null;
  } catch {
    cached = null;
  }
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < FRESH_MS) {
    return { read: analyzeBreadth(cached.series), error: null };
  }
  const wanted = [...SECTORS.map((s) => s.symbol), 'RSP', 'SPY'];
  const series: AssetSeries[] = [];
  let lastErr: string | null = null;
  await Promise.all(
    wanted.map(async (symbol) => {
      for (const url of fmpDailyBarUrls(symbol, { timeseries: 90 })) {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            lastErr = res.status === 501 ? 'no-key' : `Market-data service returned ${res.status}.`;
            continue;
          }
          const closes = parseFmpDaily(await res.json());
          if (closes.length >= 55) {
            series.push({ symbol, closes });
            return;
          }
        } catch {
          lastErr = 'Could not reach the market-data service (network/CORS).';
        }
      }
    }),
  );
  if (series.length >= 8) {
    const cache: CacheShape = { fetchedAt: new Date().toISOString(), series };
    try {
      localStorage.setItem(BREADTH_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // best effort
    }
    return { read: analyzeBreadth(series), error: null };
  }
  if (cached) return { read: analyzeBreadth(cached.series), error: lastErr ?? 'Refresh failed.' };
  return { read: null, error: lastErr ?? 'Refresh failed.' };
}

/* ------------------------------- fetching ------------------------------- */

const CACHE_KEY = 'ei-crossasset-cache-v1';
const FRESH_MS = 4 * 3600 * 1000;

export interface CrossAssetLoad {
  read: CrossAssetRead | null;
  error: string | null;
  stale?: boolean;
}

interface CacheShape {
  fetchedAt: string;
  series: AssetSeries[];
}

export async function loadCrossAsset(force = false): Promise<CrossAssetLoad> {
  let cached: CacheShape | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as CacheShape | null;
  } catch {
    cached = null;
  }
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < FRESH_MS) {
    return { read: analyzeCrossAsset(cached.series), error: null };
  }

  const series: AssetSeries[] = [];
  let lastErr: string | null = null;
  await Promise.all(
    CROSS_ASSETS.map(async (a) => {
      for (const url of fmpDailyBarUrls(a.symbol, { timeseries: 140 })) {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            lastErr = res.status === 501 ? 'no-key' : `Market-data service returned ${res.status}.`;
            continue;
          }
          const closes = parseFmpDaily(await res.json());
          if (closes.length >= 80) {
            series.push({ symbol: a.symbol, closes });
            return;
          }
        } catch {
          lastErr = 'Could not reach the market-data service (network/CORS).';
        }
      }
    }),
  );

  if (series.length >= 4) {
    const cache: CacheShape = { fetchedAt: new Date().toISOString(), series };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // best effort
    }
    return { read: analyzeCrossAsset(series), error: null };
  }
  if (cached) return { read: analyzeCrossAsset(cached.series), error: lastErr ?? 'Refresh failed.', stale: true };
  return { read: null, error: lastErr ?? 'Refresh failed.' };
}
