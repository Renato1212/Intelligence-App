/*
 * Live print extension — keeps the release history CURRENT.
 *
 * The free official mirror (DBnomics) is the long-history backbone, but its
 * BLS crawler has stalled in the past (e.g. series frozen at Jan-2025 while
 * the real world kept printing). This module closes that gap: with the
 * trader's free FMP key it pulls the provider's HISTORICAL economic-calendar
 * rows — each carrying the actual print as released — normalizes them into
 * the same units as the official series, and splices them on top. The result
 * is a print history that always reaches the latest release, with the
 * provenance of every segment kept explicit so the UI can say exactly where
 * official data ends and the live layer begins.
 *
 * Everything except the fetch is a pure function over rows, so period
 * attribution, unit normalization, revision dedupe and the merge are all
 * unit-testable offline.
 */
import { fmpUrls, type LiveEventRow } from './market';
import { fetchFfRows } from './ffcal';
import type { IndicatorSpec, PrintPoint } from './econData';

/* ------------------------- matching & attribution ------------------------ */

interface LiveMatcher {
  test: RegExp;
  reject?: RegExp;
  /** release month minus N months = the month the data is FOR (default 1) */
  periodLag?: number;
  /** plausibility window AFTER normalization — rows outside are unit junk */
  min: number;
  max: number;
}

/** Provider event-name → indicator mapping (covers FMP's two naming styles). */
export const LIVE_PRINT_MATCHERS: Record<string, LiveMatcher> = {
  // both provider styles: "Non Farm Payrolls" (FMP) / "Non-Farm Employment Change" (weekly feed)
  'nfp-payrolls': { test: /non.?farm payrolls|non.?farm employment change/i, reject: /private|manufactur|revis/i, min: -25000, max: 25000 },
  'nfp-unemployment': { test: /unemployment rate/i, reject: /u-?6|youth|long/i, min: 0, max: 30 },
  'nfp-ahe': { test: /average hourly earnings/i, reject: /yoy|y\/y/i, min: -2, max: 3 },
  'cpi-headline': { test: /(inflation rate|cpi)\s*(mom|m\/m)/i, reject: /core|median|trimmed/i, min: -3, max: 3 },
  'cpi-yoy': { test: /(inflation rate|cpi)\s*(yoy|y\/y)/i, reject: /core|median|trimmed/i, min: -3, max: 25 },
  'cpi-core': { test: /core (inflation rate|cpi)\s*(mom|m\/m)/i, min: -3, max: 3 },
  'cpi-core-yoy': { test: /core (inflation rate|cpi)\s*(yoy|y\/y)/i, min: -2, max: 20 },
  'ppi-fd': { test: /(ppi|producer price)/i, reject: /core|yoy|y\/y|input|services/i, min: -5, max: 5 },
  'jolts-openings': { test: /jolts?|job openings/i, reject: /quits|layoffs|hires/i, periodLag: 2, min: 1, max: 25 },
  'ism-mfg': { test: /ism manufacturing/i, reject: /employment|prices|new orders/i, min: 20, max: 80 },
  'ism-svc': { test: /ism (services|non.?manufacturing)/i, reject: /employment|prices|new orders/i, min: 20, max: 80 },
  'retail-mm': { test: /retail sales\s*(mom|m\/m)/i, reject: /core|ex|yoy|y\/y|control/i, min: -20, max: 20 },
  'pce-core-mm': { test: /core pce.*(mom|m\/m)/i, min: -2, max: 2 },
  'pce-core-yoy': { test: /core pce.*(yoy|y\/y)/i, min: 0, max: 15 },
  'pce-headline-yoy': { test: /pce price index.*(yoy|y\/y)/i, reject: /core/i, min: -2, max: 15 },
  'ppi-yoy': { test: /(ppi|producer price).*(yoy|y\/y)/i, reject: /core|input|services/i, min: -10, max: 25 },
};

/** "0.3%" / "147K" / "7.769M" / "-12.5" → number in the ROW's units. */
function rawValue(v: string | null): number | null {
  if (v == null) return null;
  const m = String(v).replace(/[,\s]/g, '').match(/^(-?\d+(?:\.\d+)?)(%|K|M|B)?$/i);
  if (!m) return null;
  const mult = m[2]?.toUpperCase() === 'K' ? 1e3 : m[2]?.toUpperCase() === 'M' ? 1e6 : m[2]?.toUpperCase() === 'B' ? 1e9 : 1;
  return Number(m[1]) * mult;
}

/** Harmonize a raw calendar value into the indicator's display units. */
export function normalizeLiveValue(indicatorId: string, raw: number): number {
  if (indicatorId === 'nfp-payrolls') {
    // display unit: thousands of jobs. "147K" parses to 147000 → 147.
    return Math.abs(raw) >= 20000 ? raw / 1000 : raw;
  }
  if (indicatorId === 'jolts-openings') {
    // display unit: millions. "7.769M" → 7.769; "7769K" → 7.769; "7.77" stays.
    if (Math.abs(raw) >= 1e6) return raw / 1e6;
    if (Math.abs(raw) >= 1000) return raw / 1000;
    return raw;
  }
  return raw; // percents and index levels arrive in display units
}

/** Release date YYYY-MM-DD → the YYYY-MM the print is FOR. */
export function periodForRelease(dateISO: string, periodLag = 1): string {
  const y = Number(dateISO.slice(0, 4));
  const m = Number(dateISO.slice(5, 7));
  const total = y * 12 + (m - 1) - periodLag;
  const py = Math.floor(total / 12);
  const pm = (total % 12) + 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

/**
 * Turn provider calendar rows into print points for one indicator. Pure.
 * Revisions/duplicates collapse per period (latest release wins).
 */
export function recentPrintsFromRows(indicatorId: string, rows: LiveEventRow[]): PrintPoint[] {
  const m = LIVE_PRINT_MATCHERS[indicatorId];
  if (!m) return [];
  const byPeriod = new Map<string, PrintPoint & { releaseDate: string }>();
  for (const r of rows) {
    if (!r.actual || !m.test.test(r.name) || (m.reject && m.reject.test(r.name))) continue;
    const raw = rawValue(r.actual);
    if (raw == null) continue;
    const value = normalizeLiveValue(indicatorId, raw);
    if (!isFinite(value) || value < m.min || value > m.max) continue;
    const period = periodForRelease(r.date, m.periodLag ?? 1);
    const prev = byPeriod.get(period);
    if (prev && r.date <= prev.releaseDate) continue;
    // carry the calendar context so the UI can show actual vs forecast vs
    // previous exactly like the calendar sites do
    const cRaw = rawValue(r.consensus);
    const pRaw = rawValue(r.previous);
    const consensus = cRaw != null ? normalizeLiveValue(indicatorId, cRaw) : undefined;
    const previous = pRaw != null ? normalizeLiveValue(indicatorId, pRaw) : undefined;
    byPeriod.set(period, { period, value, releaseDate: r.date, ...(consensus != null && isFinite(consensus) ? { consensus } : {}), ...(previous != null && isFinite(previous) ? { previous } : {}) });
  }
  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/* -------------------------------- archive -------------------------------- */

const ARCHIVE_KEY = 'ei-print-archive-v1';

type Archive = Record<string, PrintPoint[]>;

function archiveLoad(): Archive {
  try {
    const a = JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? '{}') as Archive;
    return a && typeof a === 'object' ? a : {};
  } catch {
    return {};
  }
}

/**
 * Persist prints per indicator and return the union (by period, newest value
 * wins), capped to the last 60 points. This is how series WITHOUT a working
 * free mirror (ISM, PCE, Retail — and any series while no FMP key is
 * connected) accumulate real history over time: every actual the keyless
 * weekly feed or the FMP calendar ever shows gets remembered locally.
 * Safe without localStorage (SSR/tests): falls back to a pure union.
 */
export function archiveMerge(indicatorId: string, points: PrintPoint[]): PrintPoint[] {
  let stored: PrintPoint[] = [];
  let canPersist = true;
  try {
    stored = archiveLoad()[indicatorId] ?? [];
  } catch {
    canPersist = false;
  }
  const byPeriod = new Map<string, PrintPoint>();
  for (const p of stored) byPeriod.set(p.period, p);
  for (const p of points) byPeriod.set(p.period, p); // fresh point (with consensus/previous) wins
  const merged = [...byPeriod.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-60);
  if (canPersist && points.length) {
    try {
      const a = archiveLoad();
      a[indicatorId] = merged;
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(a));
    } catch {
      // best effort
    }
  }
  return merged;
}

/* --------------------------------- merge --------------------------------- */

export interface MergedPrints {
  points: PrintPoint[];
  /** last period covered by the official series (null = live-only) */
  officialThrough: string | null;
  /** live points appended beyond the official history */
  liveCount: number;
}

/** Official history is the base (it carries revisions); live extends it. */
export function mergePrints(official: PrintPoint[], recent: PrintPoint[]): MergedPrints {
  const officialThrough = official.length ? official[official.length - 1].period : null;
  const extension = recent.filter((p) => officialThrough == null || p.period > officialThrough);
  return {
    points: [...official, ...extension],
    officialThrough,
    liveCount: extension.length,
  };
}

/** Months between the series' last period and the newest period we'd expect. */
export function staleGapMonths(lastPeriod: string | null, now = new Date()): number {
  // by the time a month is over, its print is out within ~1 month
  const expY = now.getFullYear();
  const expM = now.getMonth(); // 0-based → "previous month" as 1-based index
  const expected = expY * 12 + (expM - 1);
  if (!lastPeriod) return 999;
  const y = Number(lastPeriod.slice(0, 4));
  const m = Number(lastPeriod.slice(5, 7));
  return Math.max(0, expected - (y * 12 + (m - 1)));
}

/* -------------------------------- fetching ------------------------------- */

const ROWS_KEY = 'ei-econlive-rows-v1';
const ROWS_FRESH_MS = 6 * 3600 * 1000;

interface RowsCache {
  fetchedAt: string;
  from: string;
  to: string;
  rows: LiveEventRow[];
}

let rowsMemo: RowsCache | null = null;
let rowsInflight: Promise<LiveEventRow[] | null> | null = null;

function fmtVal(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

async function fetchRangeRaw(fromISO: string, toISO: string): Promise<LiveEventRow[] | null> {
  const urls = [
    ...fmpUrls(`stable/economic-calendar?from=${fromISO}&to=${toISO}`),
    ...fmpUrls(`api/v3/economic_calendar?from=${fromISO}&to=${toISO}`),
  ];
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (!res.ok) {
      if (res.status === 401) return null;
      continue;
    }
    const raw = (await res.json()) as Record<string, unknown>[];
    const rows = (Array.isArray(raw) ? raw : [])
      .filter((e) => ['US', 'USA', 'UNITED STATES'].includes(String(e.country ?? '').toUpperCase()))
      .map((e) => {
        const unit = typeof e.unit === 'string' && ['%', 'K', 'M', 'B', 'T'].includes(e.unit.trim()) ? e.unit.trim() : '';
        const withUnit = (v: unknown) => {
          const s = fmtVal(v);
          return s != null && unit && /^-?\d+(\.\d+)?$/.test(s) ? `${s}${unit}` : s;
        };
        return {
          date: String(e.date ?? '').slice(0, 10),
          name: String(e.event ?? ''),
          consensus: withUnit(e.estimate),
          previous: withUnit(e.previous),
          actual: withUnit(e.actual),
        };
      })
      .filter((e) => e.date && e.name);
    if (rows.length) return rows;
  }
  return null;
}

/**
 * Historical US calendar rows for the last `monthsBack` months, chunked into
 * ≤3-month requests (the provider caps range size), cached 6h, deduped across
 * concurrent callers (all indicators share one row set).
 */
export async function getHistoricalRows(monthsBack: number): Promise<LiveEventRow[] | null> {
  const months = Math.min(24, Math.max(3, monthsBack));
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const fromISO = from.toISOString().slice(0, 10);
  const toISO = now.toISOString().slice(0, 10);

  const fresh = (c: RowsCache | null): c is RowsCache =>
    !!c && c.from <= fromISO && c.to >= toISO && Date.now() - new Date(c.fetchedAt).getTime() < ROWS_FRESH_MS && c.rows.length > 0;

  if (fresh(rowsMemo)) return rowsMemo.rows;
  try {
    const stored = JSON.parse(localStorage.getItem(ROWS_KEY) ?? 'null') as RowsCache | null;
    if (fresh(stored)) {
      rowsMemo = stored;
      return stored.rows;
    }
  } catch {
    // fall through to fetch
  }

  if (rowsInflight) return rowsInflight;
  rowsInflight = (async () => {
    const rows: LiveEventRow[] = [];
    let cursor = new Date(from);
    let anyOk = false;
    while (cursor < now) {
      const chunkEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 3, cursor.getDate());
      const end = chunkEnd < now ? chunkEnd : now;
      const part = await fetchRangeRaw(cursor.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
      if (part) {
        anyOk = true;
        rows.push(...part);
      }
      cursor = end;
      if (end >= now) break;
      cursor = new Date(end.getTime() + 86400000);
    }
    if (!anyOk) {
      // no FMP anywhere — the keyless weekly feed still carries this week's
      // (and next week's) rows with actuals; the archive makes them add up
      const ff = await fetchFfRows();
      return ff.length ? ff : null;
    }
    const cache: RowsCache = { fetchedAt: new Date().toISOString(), from: fromISO, to: toISO, rows };
    rowsMemo = cache;
    try {
      localStorage.setItem(ROWS_KEY, JSON.stringify(cache));
    } catch {
      // best effort
    }
    return rows;
  })();
  try {
    return await rowsInflight;
  } finally {
    rowsInflight = null;
  }
}

/**
 * Recent live prints for one indicator, covering at least the given gap —
 * unioned with the local archive, so every print the app has EVER seen keeps
 * counting (this is what builds keyless history for ISM/PCE/Retail over time).
 */
export async function fetchRecentPrints(spec: IndicatorSpec, gapMonths: number): Promise<PrintPoint[]> {
  const rows = await getHistoricalRows(gapMonths + 3);
  const fresh = rows ? recentPrintsFromRows(spec.id, rows) : [];
  return archiveMerge(spec.id, fresh);
}
