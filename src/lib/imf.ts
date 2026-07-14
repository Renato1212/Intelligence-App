/*
 * IMF connection — the global-macro layer, fully automatic.
 *
 * Two IMF sources, both free and keyless, wired with a fallback chain so the
 * trader never configures anything:
 *
 *  - WEO (World Economic Outlook): real GDP growth and inflation for the
 *    major economies, INCLUDING the IMF's forward forecasts. Primary source
 *    is the IMF DataMapper API (imf.org/external/datamapper/api); if that is
 *    unreachable from the browser, the DBnomics mirror of the same dataset
 *    answers instead.
 *  - PCPS (Primary Commodity Price System): the IMF's monthly commodity
 *    price indices (energy, gold, copper, crude) via DBnomics — the
 *    medium-term demand/supply context behind CL, GC and HG.
 *
 * Why a day trader cares: WEO growth differentials are the slow current under
 * FX and index-spread trades (6E, NQ/ES vs DAX), world growth sets which way
 * commodity data surprises get traded (CL), and the disinflation glide path
 * decides which release (CPI vs claims) owns the quarter. The panel turns the
 * numbers into those reads.
 *
 * All parsing/analytics are pure functions — testable without the network —
 * and every fetch degrades to cache with an inline note.
 */

export interface Economy {
  code: string; // WEO / DataMapper country code
  label: string;
  /** the futures most sensitive to this economy's growth surprise */
  affects: string[];
}

export const WEO_ECONOMIES: Economy[] = [
  { code: 'USA', label: 'United States', affects: ['ES', 'NQ', 'ZN'] },
  { code: 'CHN', label: 'China', affects: ['CL', 'HG', '6A'] },
  { code: 'DEU', label: 'Germany', affects: ['FDAX', '6E'] },
  { code: 'JPN', label: 'Japan', affects: ['6J', 'NKD'] },
  { code: 'GBR', label: 'United Kingdom', affects: ['6B'] },
  { code: 'WEOWORLD', label: 'World', affects: ['CL', 'HG'] },
];

export interface WeoCell {
  year: number;
  value: number;
}

export interface WeoRow {
  economy: Economy;
  /** annual real GDP growth %, ascending years (history + forecast) */
  gdp: WeoCell[];
  /** annual CPI inflation %, ascending years */
  inflation: WeoCell[];
}

export interface WeoBoard {
  rows: WeoRow[];
  fetchedAt: string;
  source: 'imf-datamapper' | 'dbnomics-mirror';
  stale?: boolean;
}

/* ------------------------------- parsing --------------------------------- */

/**
 * Parse an IMF DataMapper response:
 * { values: { NGDP_RPCH: { USA: { "2025": 1.8, "2026": 2.0, ... } } } }
 */
export function parseDataMapper(json: unknown, indicator: string): Record<string, WeoCell[]> {
  const values = (json as { values?: Record<string, Record<string, Record<string, unknown>>> })?.values?.[indicator];
  if (!values || typeof values !== 'object') return {};
  const out: Record<string, WeoCell[]> = {};
  for (const [country, byYear] of Object.entries(values)) {
    if (!byYear || typeof byYear !== 'object') continue;
    const cells: WeoCell[] = [];
    for (const [y, v] of Object.entries(byYear)) {
      const year = Number(y);
      const value = Number(v);
      if (Number.isInteger(year) && year > 1900 && year < 2100 && isFinite(value)) cells.push({ year, value });
    }
    if (cells.length) out[country] = cells.sort((a, b) => a.year - b.year);
  }
  return out;
}

/** Parse a DBnomics response with ANNUAL periods ("2026") into WeoCells. */
export function parseAnnualSeries(doc: { period?: unknown[]; value?: unknown[] } | null | undefined): WeoCell[] {
  if (!doc || !Array.isArray(doc.period) || !Array.isArray(doc.value)) return [];
  const out: WeoCell[] = [];
  for (let i = 0; i < doc.period.length; i++) {
    const year = Number(String(doc.period[i] ?? '').slice(0, 4));
    const value = Number(doc.value[i]);
    if (Number.isInteger(year) && year > 1900 && year < 2100 && isFinite(value)) out.push({ year, value });
  }
  return out.sort((a, b) => a.year - b.year);
}

/* ------------------------------ analytics -------------------------------- */

/** value for a specific year, if present */
export function cellFor(cells: WeoCell[], year: number): number | null {
  return cells.find((c) => c.year === year)?.value ?? null;
}

/** The computed read of the WEO board for the current year. */
export function weoRead(rows: WeoRow[], thisYear: number): string {
  const parts: string[] = [];
  const us = rows.find((r) => r.economy.code === 'USA');
  const world = rows.find((r) => r.economy.code === 'WEOWORLD');
  const others = rows.filter((r) => !['USA', 'WEOWORLD'].includes(r.economy.code));

  const usNow = us ? cellFor(us.gdp, thisYear) : null;
  const usNext = us ? cellFor(us.gdp, thisYear + 1) : null;
  if (usNow != null && usNext != null) {
    parts.push(
      usNext > usNow + 0.2
        ? `The IMF sees US growth ACCELERATING into next year (${usNow.toFixed(1)}% → ${usNext.toFixed(1)}%) — a tailwind for cyclical longs and a headwind for aggressive cut pricing`
        : usNext < usNow - 0.2
          ? `The IMF sees US growth SLOWING into next year (${usNow.toFixed(1)}% → ${usNext.toFixed(1)}%) — growth-scare prints will be traded harder as the year ages`
          : `US growth is forecast steady (${usNow.toFixed(1)}% this year, ${usNext.toFixed(1)}% next)`,
    );
  }

  if (usNow != null && others.length) {
    const gaps = others
      .map((r) => ({ label: r.economy.label, gap: (cellFor(r.gdp, thisYear) ?? NaN) - usNow }))
      .filter((g) => isFinite(g.gap));
    const weakest = gaps.reduce((b, g) => (g.gap < (b?.gap ?? Infinity) ? g : b), null as { label: string; gap: number } | null);
    if (weakest && weakest.gap < -0.5) {
      parts.push(`${weakest.label} lags US growth by ${Math.abs(weakest.gap).toFixed(1)}pp — growth differentials of that size are what keep the dollar bid on dips (6E, 6J context)`);
    } else {
      parts.push('growth differentials vs the US are narrow — less one-way pressure on the dollar from the growth channel');
    }
  }

  const wNow = world ? cellFor(world.gdp, thisYear) : null;
  if (wNow != null) {
    parts.push(
      wNow >= 3.2
        ? `world growth at ${wNow.toFixed(1)}% supports the commodity-demand side — fade crude growth-scares cautiously`
        : wNow < 2.8
          ? `world growth at ${wNow.toFixed(1)}% is below the ~3% stall line — commodity demand rallies need supply stories, not demand hope`
          : `world growth near ${wNow.toFixed(1)}% is trend-ish — commodities trade their own supply news`,
    );
  }

  const infl = rows
    .filter((r) => ['USA', 'DEU', 'GBR'].includes(r.economy.code))
    .map((r) => cellFor(r.inflation, thisYear))
    .filter((v): v is number => v != null);
  if (infl.length >= 2) {
    const max = Math.max(...infl);
    parts.push(
      max <= 2.5
        ? 'advanced-economy inflation is forecast at target — central banks have room, so growth data outranks inflation data this year'
        : 'advanced-economy inflation is still forecast above target — inflation prints keep their power to move rates',
    );
  }

  return parts.join('. ') + '.';
}

/* ---------------------------- commodities (PCPS) -------------------------- */

export interface CommoditySpec {
  id: string;
  label: string;
  affects: string;
  /** DBnomics IMF/PCPS series codes, tried in order */
  candidates: string[];
}

export const COMMODITIES: CommoditySpec[] = [
  { id: 'energy', label: 'Energy index', affects: 'CL NG', candidates: ['M.W00.PNRG.IX'] },
  { id: 'crude', label: 'Crude oil (APSP)', affects: 'CL', candidates: ['M.W00.POILAPSP.USD', 'M.W00.POILAPSP.IX'] },
  { id: 'gold', label: 'Gold', affects: 'GC', candidates: ['M.W00.PGOLD.USD', 'M.W00.PGOLD.IX'] },
  { id: 'copper', label: 'Copper', affects: 'HG', candidates: ['M.W00.PCOPP.USD', 'M.W00.PCOPP.IX'] },
];

export interface CommodityRow {
  spec: CommoditySpec;
  /** last ~25 monthly points, ascending */
  points: { period: string; value: number }[];
  chg3m: number | null;
  chg12m: number | null;
  trend: 'rising' | 'falling' | 'flat';
}

export function commodityRow(spec: CommoditySpec, points: { period: string; value: number }[]): CommodityRow | null {
  if (points.length < 6) return null;
  const last = points[points.length - 1].value;
  const at = (back: number) => (points.length > back ? points[points.length - 1 - back].value : null);
  const m3 = at(3);
  const m12 = at(12);
  const chg3m = m3 != null && m3 !== 0 ? ((last - m3) / m3) * 100 : null;
  const chg12m = m12 != null && m12 !== 0 ? ((last - m12) / m12) * 100 : null;
  const trend = chg3m == null ? 'flat' : chg3m > 2 ? 'rising' : chg3m < -2 ? 'falling' : 'flat';
  return { spec, points: points.slice(-25), chg3m, chg12m, trend };
}

/* -------------------------------- fetching -------------------------------- */

const DATAMAPPER = 'https://www.imf.org/external/datamapper/api/v1';
const DBN = 'https://api.db.nomics.world/v22/series';
const WEO_KEY = 'ei-imf-weo-v1';
const WEO_TTL = 7 * 24 * 3600 * 1000; // WEO updates twice a year
const PCPS_KEY = 'ei-imf-pcps-v1';
const PCPS_TTL = 24 * 3600 * 1000;

const GDP_IND = 'NGDP_RPCH';
const INFL_IND = 'PCPIPCH';

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** DataMapper via the deployment's /api/imf relay first (the IMF host is not
 * reliably CORS-open from every network), direct as the dev-server fallback. */
async function fetchDatamapper(pathAfterV1: string): Promise<unknown | null> {
  return (await fetchJson(`/api/imf?path=${encodeURIComponent(pathAfterV1)}`)) ?? (await fetchJson(`${DATAMAPPER}/${pathAfterV1}`));
}

/** keep the cache small: recent history + all forecast years */
function trimCells(cells: WeoCell[], fromYear: number): WeoCell[] {
  return cells.filter((c) => c.year >= fromYear);
}

async function fetchWeoDataMapper(fromYear: number): Promise<WeoRow[] | null> {
  const path = WEO_ECONOMIES.map((e) => e.code).join('/');
  const [gdpJson, inflJson] = await Promise.all([
    fetchDatamapper(`${GDP_IND}/${path}`),
    fetchDatamapper(`${INFL_IND}/${path}`),
  ]);
  if (!gdpJson || !inflJson) return null;
  const gdp = parseDataMapper(gdpJson, GDP_IND);
  const infl = parseDataMapper(inflJson, INFL_IND);
  const rows = WEO_ECONOMIES.map((economy) => ({
    economy,
    gdp: trimCells(gdp[economy.code] ?? [], fromYear),
    inflation: trimCells(infl[economy.code] ?? [], fromYear),
  })).filter((r) => r.gdp.length >= 2);
  return rows.length >= 4 ? rows : null;
}

async function fetchWeoDbnomics(fromYear: number): Promise<WeoRow[] | null> {
  // the mirror keys series as {country}.{indicator}.{unit}
  const ids: string[] = [];
  for (const e of WEO_ECONOMIES) {
    for (const ind of [GDP_IND, INFL_IND]) {
      ids.push(`IMF/WEO:latest/${e.code}.${ind}.pcent_change`);
    }
  }
  const json = await fetchJson(`${DBN}?series_ids=${encodeURIComponent(ids.join(','))}&observations=1&format=json`);
  const docs = (json as { series?: { docs?: ({ series_code?: string; period?: unknown[]; value?: unknown[] } | null)[] } })?.series?.docs;
  if (!Array.isArray(docs)) return null;
  const byKey = new Map<string, WeoCell[]>();
  for (const doc of docs) {
    const code = String(doc?.series_code ?? '');
    const cells = parseAnnualSeries(doc);
    if (!cells.length) continue;
    for (const e of WEO_ECONOMIES) {
      for (const ind of [GDP_IND, INFL_IND]) {
        if (code.startsWith(`${e.code}.${ind}`)) byKey.set(`${e.code}|${ind}`, cells);
      }
    }
  }
  const rows = WEO_ECONOMIES.map((economy) => ({
    economy,
    gdp: trimCells(byKey.get(`${economy.code}|${GDP_IND}`) ?? [], fromYear),
    inflation: trimCells(byKey.get(`${economy.code}|${INFL_IND}`) ?? [], fromYear),
  })).filter((r) => r.gdp.length >= 2);
  return rows.length >= 4 ? rows : null;
}

export async function loadWeoBoard(force = false): Promise<{ board: WeoBoard | null; error: string | null }> {
  let cached: WeoBoard | null = null;
  try {
    const raw = JSON.parse(localStorage.getItem(WEO_KEY) ?? 'null') as WeoBoard | null;
    if (raw && Array.isArray(raw.rows)) cached = raw;
  } catch {
    cached = null;
  }
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < WEO_TTL) {
    return { board: cached, error: null };
  }
  const fromYear = new Date().getFullYear() - 3;
  const direct = await fetchWeoDataMapper(fromYear);
  const rows = direct ?? (await fetchWeoDbnomics(fromYear));
  if (rows) {
    const board: WeoBoard = { rows, fetchedAt: new Date().toISOString(), source: direct ? 'imf-datamapper' : 'dbnomics-mirror' };
    try {
      localStorage.setItem(WEO_KEY, JSON.stringify(board));
    } catch {
      // best effort
    }
    return { board, error: null };
  }
  if (cached) return { board: { ...cached, stale: true }, error: 'IMF sources unreachable — showing the cached outlook.' };
  return { board: null, error: 'Could not reach the IMF (direct or mirror). The panel fills in when a source answers.' };
}

export async function loadCommodities(force = false): Promise<{ rows: CommodityRow[]; error: string | null }> {
  interface PcpsCache {
    fetchedAt: string;
    rows: CommodityRow[];
  }
  let cached: PcpsCache | null = null;
  try {
    const raw = JSON.parse(localStorage.getItem(PCPS_KEY) ?? 'null') as PcpsCache | null;
    if (raw && Array.isArray(raw.rows)) cached = raw;
  } catch {
    cached = null;
  }
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < PCPS_TTL) {
    return { rows: cached.rows, error: null };
  }

  const rows: CommodityRow[] = [];
  for (const spec of COMMODITIES) {
    for (const code of spec.candidates) {
      const json = await fetchJson(`${DBN}/IMF/PCPS/${encodeURIComponent(code)}?observations=1&format=json`);
      const docs = (json as { series?: { docs?: { period?: unknown[]; value?: unknown[] }[] } })?.series?.docs;
      const doc = Array.isArray(docs) ? docs[0] : null;
      if (!doc || !Array.isArray(doc.period) || !Array.isArray(doc.value)) continue;
      const points: { period: string; value: number }[] = [];
      for (let i = 0; i < doc.period.length; i++) {
        const p = String(doc.period[i] ?? '');
        const v = Number(doc.value[i]);
        if (/^\d{4}-\d{2}/.test(p) && isFinite(v)) points.push({ period: p.slice(0, 7), value: v });
      }
      points.sort((a, b) => a.period.localeCompare(b.period));
      const row = commodityRow(spec, points);
      if (row) {
        rows.push(row);
        break;
      }
    }
  }

  if (rows.length) {
    try {
      localStorage.setItem(PCPS_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), rows }));
    } catch {
      // best effort
    }
    return { rows, error: rows.length < COMMODITIES.length ? 'Some commodity series are unavailable right now.' : null };
  }
  if (cached) return { rows: cached.rows, error: 'Commodity feed unreachable — showing cached prices.' };
  return { rows: [], error: 'Could not reach the IMF commodity price system.' };
}
