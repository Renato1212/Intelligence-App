/*
 * Commitments of Traders (COT) positioning intelligence — free, keyless.
 *
 * The CFTC publishes every trader-group's futures positioning weekly through a
 * public Socrata API (publicreporting.cftc.gov) that requires no API key and
 * allows browser (CORS) requests. This module pulls the Legacy futures-only
 * report — Large Speculators (non-commercials) vs Commercials — for the
 * futures a discretionary trader actually trades, and turns it into the
 * classic COT read:
 *
 *  - Net positioning per group, and its week-over-week change
 *  - Where today's net sits in the 1-year and 3-year range (percentile) —
 *    the "crowdedness" measure behind every paid COT service
 *  - Extremes and big weekly shifts, flagged as discovery signals
 *
 * Data is cached locally so the board keeps working offline; the report is
 * weekly (published Friday ~15:30 ET for Tuesday's positions), so a cache is
 * fresh for days, not minutes. Everything analytic is a pure function over
 * the fetched series, so it is unit-testable without the network.
 */

export type CotGroup = 'Equity' | 'Rates' | 'FX' | 'Energy' | 'Metals' | 'Ags' | 'Crypto' | 'Vol';

export interface CotMarket {
  /** trading symbol root, matches symbolRoot() of the trader's fills */
  symbol: string;
  label: string;
  group: CotGroup;
  /** CFTC contract market code in the Legacy report */
  code: string;
  /** micro/alternate roots that map to the same underlying report */
  aliases?: string[];
}

/** The futures universe worth watching, keyed by CFTC legacy contract codes. */
export const COT_MARKETS: CotMarket[] = [
  { symbol: 'ES', label: 'S&P 500 E-mini', group: 'Equity', code: '13874A', aliases: ['MES'] },
  { symbol: 'NQ', label: 'Nasdaq 100 E-mini', group: 'Equity', code: '209742', aliases: ['MNQ'] },
  { symbol: 'RTY', label: 'Russell 2000 E-mini', group: 'Equity', code: '239742', aliases: ['M2K'] },
  { symbol: 'YM', label: 'Dow E-mini ($5)', group: 'Equity', code: '12460P', aliases: ['MYM'] },
  { symbol: 'VX', label: 'VIX Futures', group: 'Vol', code: '1170E1' },
  { symbol: 'ZT', label: '2-Year Note', group: 'Rates', code: '042601' },
  { symbol: 'ZF', label: '5-Year Note', group: 'Rates', code: '044601' },
  { symbol: 'ZN', label: '10-Year Note', group: 'Rates', code: '043602' },
  { symbol: 'ZB', label: '30-Year Bond', group: 'Rates', code: '020601' },
  { symbol: 'UB', label: 'Ultra Bond', group: 'Rates', code: '020604' },
  { symbol: 'SR3', label: 'SOFR 3-Month', group: 'Rates', code: '134741' },
  { symbol: 'FF', label: 'Fed Funds 30-Day', group: 'Rates', code: '045601' },
  { symbol: '6E', label: 'Euro FX', group: 'FX', code: '099741', aliases: ['M6E'] },
  { symbol: '6B', label: 'British Pound', group: 'FX', code: '096742', aliases: ['M6B'] },
  { symbol: '6J', label: 'Japanese Yen', group: 'FX', code: '097741' },
  { symbol: '6C', label: 'Canadian Dollar', group: 'FX', code: '090741' },
  { symbol: '6A', label: 'Australian Dollar', group: 'FX', code: '232741', aliases: ['M6A'] },
  { symbol: '6S', label: 'Swiss Franc', group: 'FX', code: '092741' },
  { symbol: '6N', label: 'NZ Dollar', group: 'FX', code: '112741' },
  { symbol: 'DX', label: 'US Dollar Index', group: 'FX', code: '098662' },
  { symbol: 'CL', label: 'WTI Crude Oil', group: 'Energy', code: '067651', aliases: ['MCL', 'QM'] },
  { symbol: 'NG', label: 'Natural Gas', group: 'Energy', code: '023651', aliases: ['QG'] },
  { symbol: 'RB', label: 'RBOB Gasoline', group: 'Energy', code: '111659' },
  { symbol: 'HO', label: 'Heating Oil', group: 'Energy', code: '022651' },
  { symbol: 'GC', label: 'Gold', group: 'Metals', code: '088691', aliases: ['MGC'] },
  { symbol: 'SI', label: 'Silver', group: 'Metals', code: '084691', aliases: ['SIL'] },
  { symbol: 'HG', label: 'Copper', group: 'Metals', code: '085692', aliases: ['MHG'] },
  { symbol: 'PL', label: 'Platinum', group: 'Metals', code: '076651' },
  { symbol: 'ZC', label: 'Corn', group: 'Ags', code: '002602' },
  { symbol: 'ZS', label: 'Soybeans', group: 'Ags', code: '005602' },
  { symbol: 'ZW', label: 'Wheat (SRW)', group: 'Ags', code: '001602' },
  { symbol: 'BTC', label: 'Bitcoin (CME)', group: 'Crypto', code: '133741', aliases: ['MBT'] },
];

const BY_CODE = new Map(COT_MARKETS.map((m) => [m.code, m]));
const BY_SYMBOL = new Map<string, CotMarket>();
for (const m of COT_MARKETS) {
  BY_SYMBOL.set(m.symbol, m);
  for (const a of m.aliases ?? []) BY_SYMBOL.set(a, m);
}

/** COT market for a trading symbol root (ES, MES, 6E …), if covered. */
export function cotMarketFor(symbolRoot: string): CotMarket | null {
  return BY_SYMBOL.get(symbolRoot.toUpperCase()) ?? null;
}

/**
 * COT market for a human market label as used in day preparation —
 * "Gold (GC)", "Dollar / DXY", "VIX", "10y Notes (ZN)" …
 */
export function cotMarketForLabel(label: string): CotMarket | null {
  const paren = label.match(/\(([A-Z0-9]{1,4})\)/i);
  if (paren) {
    const m = cotMarketFor(paren[1]);
    if (m) return m;
  }
  const upper = label.toUpperCase().trim();
  if (upper.includes('DXY') || upper.includes('DOLLAR')) return cotMarketFor('DX');
  if (upper.includes('VIX')) return cotMarketFor('VX');
  return cotMarketFor(upper);
}

export interface CotWeek {
  /** report (Tuesday) date, YYYY-MM-DD */
  date: string;
  /** large speculators (non-commercial) long/short, contracts */
  specLong: number;
  specShort: number;
  /** commercials long/short, contracts */
  commLong: number;
  commShort: number;
  openInterest: number;
}

export interface CotSeries {
  market: CotMarket;
  /** ascending by date */
  weeks: CotWeek[];
}

export interface CotSnapshot {
  fetchedAt: string;
  /** newest report date across markets */
  reportDate: string | null;
  series: CotSeries[];
  /** true when served from cache after a failed refresh */
  stale?: boolean;
}

/* ------------------------------ analytics ------------------------------ */

export interface CotAnalysis {
  market: CotMarket;
  reportDate: string;
  /** large-spec net (long − short), latest and week-over-week change */
  specNet: number;
  specWow: number;
  commNet: number;
  commWow: number;
  openInterest: number;
  oiWow: number;
  /** where the latest spec net sits in its 1y / 3y range, 0–100 */
  pctile1y: number | null;
  pctile3y: number | null;
  /** |this week's spec change| vs the 1y distribution of weekly changes, 0–100 */
  shiftPctile: number | null;
  flags: CotFlag[];
  weeks: CotWeek[];
}

export type CotFlag = 'extreme-high' | 'extreme-low' | 'big-shift' | 'flip';

/** Percentile rank (0–100) of v within values (inclusive of equal values). */
export function percentileRank(values: number[], v: number): number | null {
  if (values.length < 8) return null; // too few weeks to call it a range
  const below = values.filter((x) => x <= v).length;
  return Math.round((below / values.length) * 100);
}

/** 1 → "1st", 38 → "38th" … */
export function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  const suffix = rem100 >= 11 && rem100 <= 13 ? 'th' : rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

function lastN<T>(arr: T[], n: number): T[] {
  return arr.length <= n ? arr : arr.slice(arr.length - n);
}

/** Turn a raw weekly series into the positioning read. Pure. */
export function analyzeSeries(s: CotSeries): CotAnalysis | null {
  const weeks = s.weeks;
  if (!weeks.length) return null;
  const cur = weeks[weeks.length - 1];
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;

  const specNetOf = (w: CotWeek) => w.specLong - w.specShort;
  const commNetOf = (w: CotWeek) => w.commLong - w.commShort;

  const specNet = specNetOf(cur);
  const commNet = commNetOf(cur);
  const specWow = prev ? specNet - specNetOf(prev) : 0;
  const commWow = prev ? commNet - commNetOf(prev) : 0;
  const oiWow = prev ? cur.openInterest - prev.openInterest : 0;

  const nets1y = lastN(weeks, 52).map(specNetOf);
  const nets3y = lastN(weeks, 156).map(specNetOf);
  const pctile1y = percentileRank(nets1y, specNet);
  const pctile3y = percentileRank(nets3y, specNet);

  const changes1y: number[] = [];
  const w1y = lastN(weeks, 53);
  for (let i = 1; i < w1y.length; i++) changes1y.push(Math.abs(specNetOf(w1y[i]) - specNetOf(w1y[i - 1])));
  const shiftPctile = prev ? percentileRank(changes1y, Math.abs(specWow)) : null;

  const flags: CotFlag[] = [];
  if (pctile3y != null && pctile3y >= 90) flags.push('extreme-high');
  if (pctile3y != null && pctile3y <= 10) flags.push('extreme-low');
  if (shiftPctile != null && shiftPctile >= 90 && Math.abs(specWow) > 0) flags.push('big-shift');
  if (prev && Math.sign(specNet) !== Math.sign(specNetOf(prev)) && specNet !== 0 && specNetOf(prev) !== 0) flags.push('flip');

  return {
    market: s.market,
    reportDate: cur.date,
    specNet,
    specWow,
    commNet,
    commWow,
    openInterest: cur.openInterest,
    oiWow,
    pctile1y,
    pctile3y,
    shiftPctile,
    flags,
    weeks,
  };
}

export const FLAG_LABEL: Record<CotFlag, string> = {
  'extreme-high': '3y positioning high',
  'extreme-low': '3y positioning low',
  'big-shift': 'Big weekly shift',
  flip: 'Net flip',
};

/** One-line interpretation of the positioning state, in trader language. */
export function positioningRead(a: CotAnalysis): string {
  const side = a.specNet >= 0 ? 'net long' : 'net short';
  const p = a.pctile3y;
  if (p == null) return `Large specs are ${side}; not enough history yet for a range read.`;
  if (a.flags.includes('flip')) {
    return `Large specs just flipped ${a.specNet >= 0 ? 'long' : 'short'} — a regime change in positioning worth a hypothesis.`;
  }
  if (p >= 90) {
    return a.specNet >= 0
      ? `Large specs are net long at the ${ordinal(p)} percentile of 3 years — a crowded long. Fuel for squeezes lower; late-trend breakouts get sold to.`
      : `Large specs are the least short they've been in 3 years (${ordinal(p)} percentile) — bearish conviction has drained out of this market.`;
  }
  if (p <= 10) {
    return a.specNet < 0
      ? `Large specs are net short at the ${ordinal(p)} percentile of 3 years — a crowded short. Short-covering rallies come fast from here.`
      : `Long positioning is the lightest in 3 years (${ordinal(p)} percentile) — the crowd has stepped away; trends from here start under-owned.`;
  }
  if (a.flags.includes('big-shift'))
    return `Positioning moved ${Math.abs(a.specWow).toLocaleString()} contracts this week — a top-decile shift. Someone repositioned hard; find out why.`;
  if (p >= 60) return `Large specs lean long (${ordinal(p)} pctile of 3y) — trend-following money is on board, but there's room before it's crowded.`;
  if (p <= 40) return `Large specs lean short (${ordinal(p)} pctile of 3y) — the speculative crowd is bearish but not at an extreme.`;
  return `Positioning is mid-range (${ordinal(p)} pctile of 3y) — no crowd to fade, no fuel story. Let price and catalysts lead.`;
}

/* ------------------------------- fetching ------------------------------- */

const API = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json'; // Legacy, futures only
const CACHE_KEY = 'ei-cot-cache-v2';
const FRESH_MS = 12 * 3600 * 1000; // report is weekly; refresh at most twice a day

function num(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v != null && v !== '') {
      const n = Number(v);
      if (isFinite(n)) return n;
    }
  }
  return 0;
}

function parseRows(raw: Record<string, unknown>[]): CotSeries[] {
  const byCode = new Map<string, CotWeek[]>();
  for (const row of raw) {
    const code = String(row.cftc_contract_market_code ?? '').trim();
    const market = BY_CODE.get(code);
    if (!market) continue;
    const dateRaw = String(row.report_date_as_yyyy_mm_dd ?? '');
    const date = dateRaw.slice(0, 10);
    if (!date) continue;
    let weeks = byCode.get(code);
    if (!weeks) {
      weeks = [];
      byCode.set(code, weeks);
    }
    weeks.push({
      date,
      // the dataset's own column names carry a historical typo in the spread
      // field ("postions"); longs/shorts are stable but we stay tolerant
      specLong: num(row, 'noncomm_positions_long_all', 'noncomm_positions_long'),
      specShort: num(row, 'noncomm_positions_short_all', 'noncomm_positions_short'),
      commLong: num(row, 'comm_positions_long_all', 'comm_positions_long'),
      commShort: num(row, 'comm_positions_short_all', 'comm_positions_short'),
      openInterest: num(row, 'open_interest_all', 'open_interest'),
    });
  }
  const series: CotSeries[] = [];
  for (const m of COT_MARKETS) {
    const weeks = byCode.get(m.code);
    if (!weeks) continue;
    // dedupe by date (combined revisions) keeping the last, then sort ascending
    const byDate = new Map(weeks.map((w) => [w.date, w]));
    series.push({ market: m, weeks: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  }
  return series;
}

function buildSnapshot(series: CotSeries[], stale = false): CotSnapshot {
  let reportDate: string | null = null;
  for (const s of series) {
    const last = s.weeks[s.weeks.length - 1];
    if (last && (!reportDate || last.date > reportDate)) reportDate = last.date;
  }
  return { fetchedAt: new Date().toISOString(), reportDate, series, stale };
}

function readCache(): CotSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as CotSnapshot;
    if (!Array.isArray(snap.series)) return null;
    // re-attach market objects (cache may predate registry edits)
    snap.series = snap.series
      .map((s) => {
        const market = BY_CODE.get(s.market?.code ?? '');
        return market ? { market, weeks: s.weeks ?? [] } : null;
      })
      .filter((s): s is CotSeries => !!s);
    return snap;
  } catch {
    return null;
  }
}

function writeCache(snap: CotSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch {
    // cache is best-effort (quota)
  }
}

/**
 * Fetch ~3 years of weekly reports for the whole registry in one request.
 * Uses $select to keep the payload small; falls back to full rows if the
 * column list is ever rejected.
 */
async function fetchFromCftc(): Promise<CotSeries[]> {
  const since = new Date(Date.now() - 3.2 * 365.25 * 86400000).toISOString().slice(0, 10);
  const codes = COT_MARKETS.map((m) => `'${m.code}'`).join(',');
  const where = encodeURIComponent(`cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd > '${since}T00:00:00'`);
  const select = encodeURIComponent(
    [
      'report_date_as_yyyy_mm_dd',
      'cftc_contract_market_code',
      'open_interest_all',
      'noncomm_positions_long_all',
      'noncomm_positions_short_all',
      'comm_positions_long_all',
      'comm_positions_short_all',
    ].join(','),
  );
  const urls = [
    `${API}?$where=${where}&$select=${select}&$limit=30000`,
    `${API}?$where=${where}&$limit=30000`, // fallback without $select
  ];
  let lastErr = '';
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('Could not reach the CFTC public reporting service (network).');
    }
    if (res.ok) {
      const raw = (await res.json()) as Record<string, unknown>[];
      return parseRows(Array.isArray(raw) ? raw : []);
    }
    lastErr = `CFTC request failed (${res.status}).`;
    if (res.status !== 400) break; // only a bad $select is worth retrying without it
  }
  throw new Error(lastErr || 'CFTC request failed.');
}

export interface CotLoadResult {
  snapshot: CotSnapshot | null;
  /** set when live refresh failed; snapshot may still carry cached data */
  error: string | null;
}

/** Cached-first load: serve fresh cache instantly, otherwise hit the API. */
export async function loadCot(force = false): Promise<CotLoadResult> {
  const cached = readCache();
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < FRESH_MS) {
    return { snapshot: cached, error: null };
  }
  try {
    const series = await fetchFromCftc();
    if (!series.length) throw new Error('The CFTC service returned no rows for the watch-list.');
    const snap = buildSnapshot(series);
    writeCache(snap);
    return { snapshot: snap, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'COT refresh failed.';
    if (cached) return { snapshot: { ...cached, stale: true }, error: msg };
    return { snapshot: null, error: msg };
  }
}

export function cachedCot(): CotSnapshot | null {
  return readCache();
}
