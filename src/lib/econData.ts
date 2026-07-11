/*
 * Release intelligence — the printed history behind every scheduled catalyst.
 *
 * A discretionary trader preparing for NFP or CPI needs more than the release
 * time: what has this series actually been printing, is it accelerating or
 * rolling over, how volatile are the surprises, and is the latest print an
 * outlier? Paid terminals sell exactly this. Here it comes from DBnomics
 * (db.nomics.world) — a free, keyless, CORS-open aggregator of the official
 * sources (BLS, ISM, …) — so the print history loads straight into the
 * trader's browser with no account.
 *
 * Design mirrors cot.ts: a registry with FALLBACK series IDs per indicator
 * (official IDs occasionally change), tolerant parsing, per-indicator errors
 * surfaced inline instead of failing the panel, localStorage caching so the
 * page keeps working offline, and pure analytics functions that are
 * unit-testable without the network.
 */

import { getMarketApiKey } from './market';
import { fetchRecentPrints, mergePrints, staleGapMonths } from './econLive';

export type Transform = 'diff' | 'pct1' | 'pct12' | 'level';

export interface IndicatorSpec {
  id: string;
  /** matches CalendarEvent.short from calendar.ts */
  eventShort: string;
  label: string;
  /** unit of the TRANSFORMED value, e.g. 'k jobs', '% m/m', '%' */
  unit: string;
  transform: Transform;
  /** multiplier applied AFTER the transform (e.g. thousands → millions) */
  scale?: number;
  decimals: number;
  /** tried in order until one returns data */
  sources: { provider: string; dataset: string; series: string }[];
}

/** Print-history sources for the calendar's tier-1 events (US, official). */
export const INDICATORS: IndicatorSpec[] = [
  {
    id: 'nfp-payrolls', eventShort: 'NFP', label: 'Payrolls change', unit: 'k jobs', transform: 'diff', decimals: 0,
    sources: [{ provider: 'BLS', dataset: 'ce', series: 'CES0000000001' }, { provider: 'BLS', dataset: 'CES', series: 'CES0000000001' }],
  },
  {
    id: 'nfp-unemployment', eventShort: 'NFP', label: 'Unemployment rate', unit: '%', transform: 'level', decimals: 1,
    sources: [{ provider: 'BLS', dataset: 'ln', series: 'LNS14000000' }, { provider: 'BLS', dataset: 'LN', series: 'LNS14000000' }],
  },
  {
    id: 'nfp-ahe', eventShort: 'NFP', label: 'Avg hourly earnings', unit: '% m/m', transform: 'pct1', decimals: 2,
    sources: [{ provider: 'BLS', dataset: 'ce', series: 'CES0500000003' }, { provider: 'BLS', dataset: 'CES', series: 'CES0500000003' }],
  },
  {
    id: 'cpi-headline', eventShort: 'CPI', label: 'CPI headline', unit: '% m/m', transform: 'pct1', decimals: 2,
    sources: [{ provider: 'BLS', dataset: 'cu', series: 'CUSR0000SA0' }, { provider: 'BLS', dataset: 'CU', series: 'CUSR0000SA0' }],
  },
  {
    id: 'cpi-core', eventShort: 'CPI', label: 'Core CPI', unit: '% m/m', transform: 'pct1', decimals: 2,
    sources: [{ provider: 'BLS', dataset: 'cu', series: 'CUSR0000SA0L1E' }, { provider: 'BLS', dataset: 'CU', series: 'CUSR0000SA0L1E' }],
  },
  {
    id: 'cpi-core-yoy', eventShort: 'CPI', label: 'Core CPI YoY', unit: '% y/y', transform: 'pct12', decimals: 1,
    sources: [{ provider: 'BLS', dataset: 'cu', series: 'CUSR0000SA0L1E' }, { provider: 'BLS', dataset: 'CU', series: 'CUSR0000SA0L1E' }],
  },
  {
    id: 'ppi-fd', eventShort: 'PPI', label: 'PPI final demand', unit: '% m/m', transform: 'pct1', decimals: 2,
    sources: [
      { provider: 'BLS', dataset: 'wp', series: 'WPSFD4' },
      { provider: 'BLS', dataset: 'WP', series: 'WPSFD4' },
      { provider: 'BLS', dataset: 'wp', series: 'WPUFD4' },
    ],
  },
  {
    // BLS reports openings in thousands; displayed in millions
    id: 'jolts-openings', eventShort: 'JOLTS', label: 'Job openings', unit: 'M', transform: 'level', scale: 0.001, decimals: 2,
    sources: [
      { provider: 'BLS', dataset: 'jt', series: 'JTS000000000000000JOL' },
      { provider: 'BLS', dataset: 'JT', series: 'JTS000000000000000JOL' },
      { provider: 'BLS', dataset: 'jt', series: 'JTS00000000JOL' },
    ],
  },
  {
    id: 'ism-mfg', eventShort: 'ISM Mfg', label: 'ISM Manufacturing PMI', unit: 'index', transform: 'level', decimals: 1,
    sources: [{ provider: 'ISM', dataset: 'pmi', series: 'pmi' }],
  },
  {
    id: 'ism-svc', eventShort: 'ISM Svcs', label: 'ISM Services PMI', unit: 'index', transform: 'level', decimals: 1,
    sources: [
      { provider: 'ISM', dataset: 'nmi', series: 'nmi' },
      { provider: 'ISM', dataset: 'nm-pmi', series: 'nm-pmi' },
    ],
  },
  // live-only series: no free keyless mirror exists, but the market-data key's
  // historical calendar actuals reconstruct the recent print history
  {
    id: 'retail-mm', eventShort: 'Retail Sales', label: 'Retail sales', unit: '% m/m', transform: 'level', decimals: 1,
    sources: [],
  },
  {
    id: 'pce-core-mm', eventShort: 'PCE', label: 'Core PCE', unit: '% m/m', transform: 'level', decimals: 2,
    sources: [],
  },
  {
    id: 'pce-core-yoy', eventShort: 'PCE', label: 'Core PCE YoY', unit: '% y/y', transform: 'level', decimals: 1,
    sources: [],
  },
];

export const INDICATORS_BY_EVENT = new Map<string, IndicatorSpec[]>();
for (const ind of INDICATORS) {
  if (!INDICATORS_BY_EVENT.has(ind.eventShort)) INDICATORS_BY_EVENT.set(ind.eventShort, []);
  INDICATORS_BY_EVENT.get(ind.eventShort)!.push(ind);
}

/** Events with scheduled releases but no free keyless history source. */
export const NO_HISTORY_NOTE: Record<string, string> = {
  'Jobless Claims': 'Weekly claims history has no free keyless API; live consensus/actual still appears when a market-data key is connected.',
  FOMC: 'Rate decisions are discrete policy events — see the Playbook and Market Intel positioning instead of a print chart.',
  'FOMC Minutes': 'Minutes are qualitative — no data series. Prepare with the statement, positioning and your event-day record.',
};

export interface PrintPoint {
  /** period the data is FOR (e.g. 2026-05 for the May NFP), YYYY-MM */
  period: string;
  value: number;
}

export interface IndicatorSeries {
  spec: IndicatorSpec;
  points: PrintPoint[]; // ascending, transformed
  fetchedAt: string;
  stale?: boolean;
  /** last period covered by the OFFICIAL source (null = live-only series) */
  officialThrough?: string | null;
  /** points appended from the live calendar layer beyond the official history */
  liveCount?: number;
}

/* ------------------------------ transforms ------------------------------ */

export function applyTransform(raw: PrintPoint[], t: Transform): PrintPoint[] {
  if (t === 'level') return raw;
  if (t === 'diff') {
    const out: PrintPoint[] = [];
    for (let i = 1; i < raw.length; i++) out.push({ period: raw[i].period, value: raw[i].value - raw[i - 1].value });
    return out;
  }
  const lag = t === 'pct1' ? 1 : 12;
  const out: PrintPoint[] = [];
  for (let i = lag; i < raw.length; i++) {
    const base = raw[i - lag].value;
    if (base !== 0) out.push({ period: raw[i].period, value: (raw[i].value / base - 1) * 100 });
  }
  return out;
}

/* ------------------------------ analytics ------------------------------- */

export interface PrintStats {
  latest: PrintPoint;
  prev: PrintPoint | null;
  delta: number | null;
  /** mean/sd of the 24 prints BEFORE the latest */
  mean24: number | null;
  sd24: number | null;
  /** how unusual the latest print is vs the prior 2 years */
  z: number | null;
  /** percentile of the latest within the last 5 years (0–100) */
  pctile5y: number | null;
  /** short-run vs long-run average — is the data accelerating or rolling over */
  avg3: number;
  avg12: number | null;
  /** consecutive prints moving the same direction (+ up / − down) */
  streak: number;
  /** sd of last 12 vs sd of the 24 before — >1.3 = the series got noisier */
  volRegime: number | null;
}

export function analyzePrints(points: PrintPoint[]): PrintStats | null {
  const n = points.length;
  if (n < 4) return null;
  const latest = points[n - 1];
  const prev = points[n - 2] ?? null;

  const prior24 = points.slice(Math.max(0, n - 25), n - 1).map((p) => p.value);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = (xs: number[]) => {
    if (xs.length < 4) return null;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
  };

  const mean24 = prior24.length >= 8 ? mean(prior24) : null;
  const sd24 = prior24.length >= 8 ? sd(prior24) : null;
  const z = mean24 != null && sd24 != null && sd24 > 0 ? (latest.value - mean24) / sd24 : null;

  const last5y = points.slice(Math.max(0, n - 60)).map((p) => p.value);
  const pctile5y = last5y.length >= 12 ? Math.round((last5y.filter((v) => v <= latest.value).length / last5y.length) * 100) : null;

  const avg3 = mean(points.slice(Math.max(0, n - 3)).map((p) => p.value));
  const last12 = points.slice(Math.max(0, n - 12)).map((p) => p.value);
  const avg12 = last12.length >= 6 ? mean(last12) : null;

  let streak = 0;
  for (let i = n - 1; i > 0; i--) {
    const d = points[i].value - points[i - 1].value;
    if (d === 0) break;
    const s = Math.sign(d);
    if (streak === 0) streak = s;
    else if (Math.sign(streak) === s) streak += s;
    else break;
  }

  const sd12 = sd(last12);
  const sdPrior = sd(points.slice(Math.max(0, n - 36), n - 12).map((p) => p.value));
  const volRegime = sd12 != null && sdPrior != null && sdPrior > 0 ? sd12 / sdPrior : null;

  return { latest, prev, delta: prev ? latest.value - prev.value : null, mean24, sd24, z, pctile5y, avg3, avg12, streak, volRegime };
}

export function fmtPrint(v: number, spec: IndicatorSpec, sign = false): string {
  const s = v.toFixed(spec.decimals);
  const withSign = sign && v > 0 ? `+${s}` : s;
  return spec.unit.startsWith('%') ? `${withSign}%` : withSign;
}

/** Period label "2026-05" → "May 26". */
export function fmtPeriod(p: string): string {
  const [y, m] = p.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[(m ?? 1) - 1]} ${String(y).slice(2)}`;
}

/** The auto-generated read: what the data itself is telling you before the print. */
export function indicatorInsight(spec: IndicatorSpec, stats: PrintStats): string {
  const parts: string[] = [];
  const f = (v: number) => fmtPrint(v, spec, true);

  if (stats.z != null) {
    if (Math.abs(stats.z) >= 2) parts.push(`Last print (${f(stats.latest.value)}) was a ${Math.abs(stats.z).toFixed(1)}σ outlier vs the prior 2 years — the market may still be digesting it`);
    else if (Math.abs(stats.z) >= 1) parts.push(`Last print (${f(stats.latest.value)}) ran ${stats.z > 0 ? 'hot' : 'cold'} at ${stats.z.toFixed(1)}σ vs trend`);
    else parts.push(`Last print (${f(stats.latest.value)}) was in line with the 2-year trend`);
  } else {
    parts.push(`Last print: ${f(stats.latest.value)}`);
  }

  if (stats.avg12 != null) {
    const rel = stats.avg12 !== 0 ? (stats.avg3 - stats.avg12) / Math.max(Math.abs(stats.avg12), 1e-9) : 0;
    const dir = stats.avg3 > stats.avg12 ? 'above' : 'below';
    if (Math.abs(rel) >= 0.15 || Math.abs(stats.avg3 - stats.avg12) >= (stats.sd24 ?? 0) * 0.5) {
      parts.push(`3-month pace (${f(stats.avg3)}) is running ${dir} the 12-month average (${f(stats.avg12)}) — momentum is ${stats.avg3 > stats.avg12 ? 'building' : 'fading'}`);
    }
  }

  if (Math.abs(stats.streak) >= 3) {
    parts.push(`${Math.abs(stats.streak)} consecutive ${stats.streak > 0 ? 'higher' : 'lower'} prints — a break of the run would surprise`);
  }

  if (stats.volRegime != null && stats.volRegime >= 1.4) {
    parts.push(`print-to-print volatility is ${stats.volRegime.toFixed(1)}× the prior norm — expect wider surprises and size accordingly`);
  }

  return parts.join('. ') + '.';
}

/* ------------------------------- fetching ------------------------------- */

const API = 'https://api.db.nomics.world/v22/series';
const CACHE_KEY = 'ei-econ-cache-v3'; // v3: live extension + provenance
const FRESH_MS = 20 * 3600 * 1000;

interface CacheShape {
  [indicatorId: string]: { fetchedAt: string; points: PrintPoint[]; officialThrough?: string | null; liveCount?: number };
}

function readCache(): CacheShape {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as CacheShape;
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // best effort
  }
}

/** Parse a DBnomics v22 single-series response into raw ascending points. */
export function parseDbnomics(json: unknown, granularity: 'month' | 'day' = 'month'): PrintPoint[] {
  const docs = (json as { series?: { docs?: { period?: unknown[]; value?: unknown[] }[] } })?.series?.docs;
  const doc = Array.isArray(docs) ? docs[0] : null;
  if (!doc || !Array.isArray(doc.period) || !Array.isArray(doc.value)) return [];
  const keep = granularity === 'day' ? 10 : 7;
  const out: PrintPoint[] = [];
  for (let i = 0; i < doc.period.length; i++) {
    const v = Number(doc.value[i]);
    const p = String(doc.period[i] ?? '');
    if (!isFinite(v) || !/^\d{4}-\d{2}/.test(p)) continue;
    out.push({ period: p.slice(0, keep), value: v });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

async function fetchIndicator(spec: IndicatorSpec): Promise<PrintPoint[]> {
  let lastErr = 'No data source responded.';
  for (const src of spec.sources) {
    const url = `${API}/${src.provider}/${src.dataset}/${src.series}?observations=1&format=json`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      lastErr = 'Could not reach the data service (network).';
      continue;
    }
    if (!res.ok) {
      lastErr = `Data service returned ${res.status} for ${src.provider}/${src.series}.`;
      continue;
    }
    const raw = parseDbnomics(await res.json());
    if (raw.length >= 8) {
      // keep ~9 years raw so 8y of transformed history survives a YoY transform
      const trimmed = raw.slice(Math.max(0, raw.length - 108));
      let points = applyTransform(trimmed, spec.transform);
      if (spec.scale != null) points = points.map((p) => ({ period: p.period, value: p.value * spec.scale! }));
      if (points.length >= 4) return points;
    }
    lastErr = `Series ${src.provider}/${src.series} returned too little data.`;
  }
  throw new Error(lastErr);
}

export interface IndicatorLoad {
  series: IndicatorSeries | null;
  error: string | null;
}

/**
 * Cached-first load of one indicator's transformed print history.
 *
 * The official mirror provides the long backbone; whenever its tail is behind
 * the newest expected print (the mirror can stall for months), the live
 * calendar layer (trader's market-data key) reconstructs the missing recent
 * prints and splices them on — with provenance kept explicit.
 */
export async function loadIndicator(spec: IndicatorSpec, force = false): Promise<IndicatorLoad> {
  const cache = readCache();
  const hit = cache[spec.id];
  if (!force && hit && Date.now() - new Date(hit.fetchedAt).getTime() < FRESH_MS && hit.points.length >= 4) {
    return {
      series: { spec, points: hit.points, fetchedAt: hit.fetchedAt, officialThrough: hit.officialThrough ?? null, liveCount: hit.liveCount ?? 0 },
      error: null,
    };
  }

  let official: PrintPoint[] = [];
  let officialErr: string | null = null;
  if (spec.sources.length) {
    try {
      official = await fetchIndicator(spec);
    } catch (e) {
      officialErr = e instanceof Error ? e.message : 'Fetch failed.';
    }
  }

  let points = official;
  const officialThrough = official.length ? official[official.length - 1].period : null;
  let liveCount = 0;
  const gap = staleGapMonths(officialThrough);
  if (gap >= 1 && getMarketApiKey()) {
    try {
      const recent = await fetchRecentPrints(spec, gap);
      const merged = mergePrints(official, recent);
      points = merged.points;
      liveCount = merged.liveCount;
    } catch {
      // the live layer is best-effort — official history still renders
    }
  }

  if (points.length >= 4) {
    const fetchedAt = new Date().toISOString();
    cache[spec.id] = { fetchedAt, points, officialThrough, liveCount };
    writeCache(cache);
    return { series: { spec, points, fetchedAt, officialThrough, liveCount }, error: officialErr };
  }

  const msg =
    officialErr ??
    (spec.sources.length
      ? 'No data source responded.'
      : 'This series has no free keyless mirror — connect the free FMP key (Trading Day → Preparation) and its recent prints load from the live calendar.');
  if (hit && hit.points.length >= 4) {
    return {
      series: { spec, points: hit.points, fetchedAt: hit.fetchedAt, stale: true, officialThrough: hit.officialThrough ?? null, liveCount: hit.liveCount ?? 0 },
      error: msg,
    };
  }
  return { series: null, error: msg };
}

/* --------------------- the print study: implications --------------------- */

/**
 * How each release maps onto the instruments a futures day trader runs —
 * the FIRST-move mechanics for a hot (above-consensus) or cold print, the
 * regime in which that mapping inverts, and the principle that survives both.
 * Arrows are the typical knee-jerk, not a promise: the reaction to the
 * reaction is the tradeable information.
 */
export interface PrintPlaybook {
  /** the number inside the release that actually moves markets */
  driver: string;
  hot: Record<string, string>;
  cold: Record<string, string>;
  hotNote: string;
  coldNote: string;
  /** when the standard mapping flips */
  regimeFlip: string | null;
  principle: string;
}

export const PLAYBOOK_INSTRUMENTS = ['ES', 'NQ', 'ZN', '6E', 'GC', 'CL'] as const;

export const PRINT_PLAYBOOK: Record<string, PrintPlaybook> = {
  NFP: {
    driver: 'Payrolls vs consensus first, then the unemployment rate and AHE m/m — a beat with soft wages reads very differently from a beat with hot wages.',
    hot: { ES: '↓', NQ: '↓', ZN: '↓↓', '6E': '↓', GC: '↓', CL: '↑' },
    cold: { ES: '↑', NQ: '↑', ZN: '↑↑', '6E': '↑', GC: '↑', CL: '↓' },
    hotNote: 'Strong jobs → fewer cuts priced → yields up, dollar up. Rates feel it hardest; equities follow the rates move.',
    coldNote: 'Weak jobs → cuts repriced in → bonds rally, dollar softens, gold bid.',
    regimeFlip:
      'In a GROWTH-SCARE regime the equity legs invert: weak payrolls stop being "more cuts = buy stocks" and become "recession = sell stocks". Decide before 8:30 which regime you are in — the bond leg is the reliable one, the equity leg is regime-dependent.',
    principle:
      'Trade the SECOND move. The 8:30 spike is algorithmic and often wrong-footed by revisions and AHE; the 9:30 cash open shows you which interpretation real money bought.',
  },
  CPI: {
    driver: 'CORE m/m to two decimals is the market mover — 0.2 vs 0.3 repricess the whole cut path. Headline mostly matters through energy.',
    hot: { ES: '↓', NQ: '↓↓', ZN: '↓↓', '6E': '↓', GC: '↓', CL: '≈' },
    cold: { ES: '↑', NQ: '↑↑', ZN: '↑↑', '6E': '↑', GC: '↑', CL: '≈' },
    hotNote: 'Hot core → real yields jump → long-duration assets (NQ, gold) get hit hardest; dollar bid.',
    coldNote: 'Cool core → cut odds up → duration rips; NQ outperforms ES; gold and euro bid.',
    regimeFlip:
      'When inflation is already back at target, a hot print is a one-day wobble, not a regime change — the fade gets faster each month the trend holds.',
    principle:
      'CPI days are gap-and-extend OR gap-and-fade days, decided in the first 30 minutes by whether 10-year yields HOLD their move. Watch ZN, not ES, for the truth.',
  },
  PPI: {
    driver: 'The components that feed PCE (portfolio management, airfares, healthcare) — economists rebuild their PCE forecast from them the same morning.',
    hot: { ES: '↓', NQ: '↓', ZN: '↓', '6E': '↓', GC: '↓', CL: '≈' },
    cold: { ES: '↑', NQ: '↑', ZN: '↑', '6E': '↑', GC: '↑', CL: '≈' },
    hotNote: 'Same direction as CPI but usually half the magnitude — unless it CONTRADICTS yesterday’s CPI.',
    coldNote: 'A soft PPI right after a soft CPI compounds the disinflation trade instead of repeating it.',
    regimeFlip: null,
    principle:
      'PPI is a revision to the CPI trade, not a new event. If CPI already moved the market, PPI confirms or unwinds that move via the PCE-relevant components.',
  },
  JOLTS: {
    driver: 'Openings level vs consensus, plus the quits rate — quits are the wage-pressure signal the Fed actually quotes.',
    hot: { ES: '↓', NQ: '↓', ZN: '↓', '6E': '↓', GC: '↓', CL: '≈' },
    cold: { ES: '↑', NQ: '↑', ZN: '↑', '6E': '↑', GC: '↑', CL: '≈' },
    hotNote: 'More openings → labor still tight → yields up. A 10:00 release: it hits an open, thin book.',
    coldNote: 'Falling openings → labor cooling without layoffs → the soft-landing print; bonds and equities can rally TOGETHER.',
    regimeFlip:
      'Once claims start rising, a JOLTS miss stops being good news for equities — cooling becomes cracking.',
    principle:
      'JOLTS lands at 10:00 into the first reversal window — its move often sets the 10:00–11:30 leg. Lagging data (it is two months old): fade extremes when fresher data disagrees.',
  },
  'ISM Mfg': {
    driver: 'Headline above/below 50, then PRICES PAID (inflation read) and NEW ORDERS (leading demand).',
    hot: { ES: '↑', NQ: '↑', ZN: '↓', '6E': '↓', GC: '↓', CL: '↑' },
    cold: { ES: '↓', NQ: '↓', ZN: '↑', '6E': '↑', GC: '↑', CL: '↓' },
    hotNote: 'Growth beat → cyclicals and crude bid, bonds offered. Manufacturing is small but early.',
    coldNote: 'Sub-50 with weak new orders → growth-scare tape; bonds catch the bid.',
    regimeFlip:
      'When inflation is the fear, a HOT prices-paid subindex can turn a headline beat into an equity-negative print.',
    principle:
      'The subindices carry the tradeable surprise. A 10:00 release into an open book — expect the reaction to interact with the opening drive, and mark whether it confirms or fights it.',
  },
  'ISM Svcs': {
    driver: 'Headline vs 50 — services is ~80% of the economy, so this one outranks manufacturing. Prices paid = services inflation.',
    hot: { ES: '↑', NQ: '↑', ZN: '↓', '6E': '↓', GC: '↓', CL: '↑' },
    cold: { ES: '↓', NQ: '↓', ZN: '↑', '6E': '↑', GC: '↑', CL: '↓' },
    hotNote: 'Services running hot keeps the "no landing" narrative alive — yields up, but equities often absorb it.',
    coldNote: 'A services crack is the recession signal the market respects most — risk-off across the board.',
    regimeFlip:
      'In an inflation-fighting regime, hot services = sticky services inflation = equities DOWN with bonds. Same print, opposite equity sign.',
    principle:
      'Ask which fear owns the market this month — growth or inflation — and read the print through that lens. The bond leg tells you which lens the market chose.',
  },
  'Jobless Claims': {
    driver: 'The 4-week average and continuing claims trend — a single weekly print is noise until it breaks the range.',
    hot: { ES: '↓', NQ: '↓', ZN: '↑', '6E': '↑', GC: '↑', CL: '↓' },
    cold: { ES: '↑', NQ: '↑', ZN: '↓', '6E': '↓', GC: '↓', CL: '↑' },
    hotNote: 'Hot = MORE claims = labor cracking → bonds bid, equities offered (growth scare).',
    coldNote: 'Low claims = labor fine → the no-landing tape; yields drift up.',
    regimeFlip:
      'In a cutting cycle driven by disinflation (not recession), rising claims can be equity-POSITIVE for a while — more cuts, no crack yet. That window closes fast.',
    principle:
      'Claims are a Thursday 8:30 metronome. They rarely make the day alone, but a claims surprise the week before NFP repositions the whole street for it.',
  },
  'Retail Sales': {
    driver: 'The CONTROL GROUP (ex-autos, gas, building materials, food services) — it feeds GDP directly and strips the noise.',
    hot: { ES: '↑', NQ: '↑', ZN: '↓', '6E': '↓', GC: '↓', CL: '↑' },
    cold: { ES: '↓', NQ: '↓', ZN: '↑', '6E': '↑', GC: '↑', CL: '↓' },
    hotNote: 'Consumer spending = the US economy’s engine. A control-group beat lifts growth trades and yields together.',
    coldNote: 'A soft control group after soft jobs data compounds into the growth-scare trade.',
    regimeFlip:
      'When the market fears inflation more than recession, a hot consumer = hawkish = equities give back the pop.',
    principle:
      'Headline retail sales lie (autos and gas distort them). Read the control group before reacting — the first algo move is off the headline and often reverses on the detail.',
  },
  PCE: {
    driver: 'Core PCE m/m — the Fed’s actual target variable. Annualize the 3-month run rate and compare to 2%.',
    hot: { ES: '↓', NQ: '↓', ZN: '↓', '6E': '↓', GC: '↓', CL: '≈' },
    cold: { ES: '↑', NQ: '↑', ZN: '↑', '6E': '↑', GC: '↑', CL: '≈' },
    hotNote: 'Hot core PCE = the target itself is misbehaving — hawkish repricing with no interpretation needed.',
    coldNote: 'On-target PCE confirms the cut path; usually a small move because CPI/PPI already told the street.',
    regimeFlip: null,
    principle:
      'PCE is usually PRE-TRADED: CPI and PPI components let economists nail the forecast, so the surprise is small. A big PCE surprise means the components models missed — respect that move, it is real information.',
  },
  FOMC: {
    driver: 'The statement’s guidance language and the dot plot (quarterly) at 14:00; Powell’s presser tone at 14:30.',
    hot: { ES: '↓', NQ: '↓↓', ZN: '↓↓', '6E': '↓', GC: '↓', CL: '≈' },
    cold: { ES: '↑', NQ: '↑↑', ZN: '↑↑', '6E': '↑', GC: '↑', CL: '≈' },
    hotNote: 'Hawkish surprise (fewer cuts, higher dots) → duration sells, dollar bid, NQ underperforms.',
    coldNote: 'Dovish surprise → everything with duration rips; gold and euro squeeze.',
    regimeFlip: null,
    principle:
      'The 14:00–14:30 statement move is HALF the event. The presser regularly reverses it — the classic pattern is statement-spike, presser-unwind, and the 15:00–16:00 leg is the day’s true direction. Never judge an FOMC day before Powell finishes.',
  },
};
