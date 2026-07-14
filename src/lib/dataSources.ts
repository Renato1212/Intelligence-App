/*
 * Live data connections — the health surface for every external feed.
 *
 * The app pulls from several free APIs straight from the browser. Whether a
 * feed is actually LIVE depends on things only the browser can see: the host's
 * CORS policy, the network, and (for the market-data key) whether a key is
 * connected. This module pings each source from the user's own browser and
 * classifies the result, so "is my data live?" becomes a green/red answer in
 * Settings instead of a guess — and so a CORS/endpoint problem shows itself
 * with a reason instead of a blank panel.
 *
 * The classification logic is a pure function (testable offline); the fetch is
 * a thin wrapper with a hard timeout.
 */
import { getMarketApiKey } from './market';

export type SourceStatus = 'live' | 'error' | 'blocked' | 'nokey';

export interface SourceResult {
  status: SourceStatus;
  httpStatus?: number;
  latencyMs?: number;
  detail: string;
  sample?: string | null;
}

export interface DataSource {
  id: string;
  label: string;
  /** which part of the app this feed powers */
  powers: string;
  host: string;
  needsKey: boolean;
  keyless: boolean;
  url: (key: string) => string;
  /** pull a tiny human sample (a value / freshness marker) from the response */
  parseSample?: (json: unknown) => string | null;
}

/* ------------------------------ the registry ----------------------------- */

function n(v: unknown): number | null {
  const x = Number(v);
  return isFinite(x) ? x : null;
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: 'bls',
    label: 'BLS (official) — via your deployment',
    powers: 'Catalysts current prints (CPI, NFP, PPI, JOLTS)',
    host: '/api/bls (serverless proxy)',
    needsKey: false,
    keyless: true,
    url: () => '/api/bls?series=CUSR0000SA0',
    parseSample: (j) => {
      const arr = (j as { series?: { CUSR0000SA0?: { period?: string }[] } })?.series?.CUSR0000SA0;
      const last = Array.isArray(arr) && arr.length ? arr[arr.length - 1]?.period : null;
      return last ? `CPI thru ${last}` : null;
    },
  },
  {
    id: 'fred',
    label: 'FRED (official PCE/retail) — via your deployment',
    powers: 'Catalysts PCE & Retail Sales history · inflation cross-read',
    host: '/api/fred (serverless proxy)',
    needsKey: false,
    keyless: true,
    url: () => '/api/fred?id=PCEPILFE',
    parseSample: (j) => {
      const arr = (j as { series?: { PCEPILFE?: { period?: string }[] } })?.series?.PCEPILFE;
      const last = Array.isArray(arr) && arr.length ? arr[arr.length - 1]?.period : null;
      return last ? `Core PCE thru ${last}` : null;
    },
  },
  {
    id: 'cftc',
    label: 'CFTC — COT positioning',
    powers: 'Market Intel',
    host: 'publicreporting.cftc.gov',
    needsKey: false,
    keyless: true,
    url: () => 'https://publicreporting.cftc.gov/resource/6dca-aqww.json?$limit=1&$select=report_date_as_yyyy_mm_dd',
    parseSample: (j) => {
      const row = Array.isArray(j) ? (j[0] as Record<string, unknown>) : null;
      const d = row?.report_date_as_yyyy_mm_dd;
      return d ? `latest report ${String(d).slice(0, 10)}` : null;
    },
  },
  {
    id: 'dbnomics',
    label: 'DBnomics — official econ mirror',
    powers: 'Catalysts history · Rates · IMF fallback',
    host: 'api.db.nomics.world',
    needsKey: false,
    keyless: true,
    url: () => 'https://api.db.nomics.world/v22/providers/IMF',
    parseSample: (j) => {
      const code = (j as { provider?: { code?: string } })?.provider?.code;
      return code ? 'reachable' : 'reachable';
    },
  },
  {
    id: 'gdelt',
    label: 'GDELT — global news attention',
    powers: 'Macro Map narrative monitor',
    host: 'api.gdeltproject.org',
    needsKey: false,
    keyless: true,
    url: () => 'https://api.gdeltproject.org/api/v2/doc/doc?query=markets&mode=timelinevol&format=json&timespan=1d',
    parseSample: (j) => {
      const t = (j as { timeline?: unknown[] })?.timeline;
      return Array.isArray(t) ? 'reachable' : 'reachable';
    },
  },
  {
    id: 'cboe',
    label: 'CBOE — VIX & option chains (via your deployment)',
    powers: 'Options & Vol',
    host: '/api/cboe (serverless proxy)',
    needsKey: false,
    keyless: true,
    url: () => '/api/cboe?kind=quote&symbol=_VIX',
    parseSample: (j) => {
      const p = n((j as { data?: { current_price?: unknown } })?.data?.current_price);
      return p != null ? `VIX ${p.toFixed(2)}` : null;
    },
  },
  {
    id: 'imf',
    label: 'IMF — DataMapper (WEO)',
    powers: 'Macro Map global growth',
    host: 'www.imf.org',
    needsKey: false,
    keyless: true,
    url: () => 'https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/USA',
    parseSample: (j) => {
      const us = (j as { values?: { NGDP_RPCH?: { USA?: Record<string, unknown> } } })?.values?.NGDP_RPCH?.USA;
      if (!us) return null;
      const years = Object.keys(us).map(Number).filter((y) => y > 1900).sort((a, b) => b - a);
      return years.length ? `US GDP thru ${years[0]}` : 'reachable';
    },
  },
  {
    id: 'ffcal',
    label: 'Weekly calendar feed — via your deployment',
    powers: 'Keyless consensus & calendar (Catalysts, briefing fallback)',
    host: '/api/ffcal (serverless proxy)',
    needsKey: false,
    keyless: true,
    url: () => '/api/ffcal?week=this',
    parseSample: (j) => (Array.isArray(j) && j.length ? `${j.length} events this week` : null),
  },
  {
    id: 'fmp',
    label: 'Financial Modeling Prep (browser key or FMP_API_KEY env)',
    powers: 'Live calendar/actuals · Breadth · Cross-asset · recent prints',
    host: 'financialmodelingprep.com',
    needsKey: false,
    keyless: false,
    url: (key) => (key ? `https://financialmodelingprep.com/api/v3/quote/SPY?apikey=${key}` : '/api/fmp?p=api%2Fv3%2Fquote%2FSPY'),
    parseSample: (j) => {
      const row = Array.isArray(j) ? (j[0] as Record<string, unknown>) : null;
      const p = n(row?.price);
      return p != null ? `SPY ${p.toFixed(2)}` : null;
    },
  },
];

/* ----------------------------- classification ---------------------------- */

/** Pure: turn an outcome into a status + message. Unit-testable without network. */
export function classifyResult(outcome: { threw: boolean; ok?: boolean; httpStatus?: number }): { status: SourceStatus; detail: string } {
  if (outcome.threw) {
    return { status: 'blocked', detail: 'Network/CORS — the browser could not reach this host from your machine' };
  }
  if (outcome.ok) return { status: 'live', detail: 'reachable' };
  const s = outcome.httpStatus ?? 0;
  if (s === 501) return { status: 'nokey', detail: 'No key anywhere yet — paste one below, or set FMP_API_KEY once on the deployment (Vercel → Settings → Environment Variables) and every device works.' };
  if (s === 401 || s === 403) return { status: 'error', detail: `HTTP ${s} — key rejected or access denied` };
  if (s === 429) return { status: 'error', detail: 'HTTP 429 — rate limited; try again shortly' };
  return { status: 'error', detail: `HTTP ${s || '?'} — endpoint responded with an error` };
}

/** One-line summary of a whole health run, for a headline chip. */
export function summarizeHealth(results: Record<string, SourceResult>): { live: number; total: number; text: string } {
  const vals = Object.values(results);
  const live = vals.filter((r) => r.status === 'live').length;
  const blocked = vals.filter((r) => r.status === 'blocked').length;
  const nokey = vals.filter((r) => r.status === 'nokey').length;
  const total = vals.length;
  let text = `${live}/${total} feeds live`;
  if (blocked) text += ` · ${blocked} unreachable`;
  if (nokey) text += ` · ${nokey} awaiting key`;
  return { live, total, text };
}

/* -------------------------------- checking ------------------------------- */

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function checkSource(src: DataSource, key = getMarketApiKey(), timeoutMs = 12000): Promise<SourceResult> {
  if (src.needsKey && !key) {
    return { status: 'nokey', detail: 'No market-data key connected — paste your free FMP key below to activate this feed.' };
  }
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const res = await fetchWithTimeout(src.url(key), timeoutMs);
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    const { status, detail } = classifyResult({ threw: false, ok: res.ok, httpStatus: res.status });
    let sample: string | null | undefined;
    if (status === 'live' && src.parseSample) {
      try {
        sample = src.parseSample(await res.json());
      } catch {
        sample = null;
      }
    }
    return { status, httpStatus: res.status, latencyMs, detail, sample };
  } catch {
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    const { status, detail } = classifyResult({ threw: true });
    return { status, latencyMs, detail };
  }
}

/** Check every source in parallel. */
export async function checkAllSources(key = getMarketApiKey()): Promise<Record<string, SourceResult>> {
  const entries = await Promise.all(DATA_SOURCES.map(async (s) => [s.id, await checkSource(s, key)] as const));
  return Object.fromEntries(entries);
}

/* --------------------------- cache housekeeping -------------------------- */

/**
 * localStorage prefixes that hold CACHED API DATA (safe to drop to force a
 * refetch). Deliberately excludes settings/user keys — above all the API key
 * (ei-fmp-key), ei-risk-config, ei-last-user, ei-local-only, ei-media.
 */
export const MARKET_CACHE_PREFIXES = [
  'ei-breadth-cache',
  'ei-briefing-',
  'ei-cboe-chain',
  'ei-cboe-quotes',
  'ei-cot-cache',
  'ei-crossasset-cache',
  'ei-econ-cache',
  'ei-econlive-rows',
  'ei-imf-pcps',
  'ei-imf-weo',
  'ei-livecal-cache',
  'ei-narrative-cache',
  'ei-rates-cache',
];

/** Keys that must NEVER be cleared by the market-data refresh. */
export const PROTECTED_KEYS = ['ei-fmp-key', 'ei-risk-config', 'ei-last-user', 'ei-local-only', 'ei-media', 'ei-print-archive-v1'];

/** Pure: which of the given keys the refresh would remove. Testable. */
export function cacheKeysToClear(allKeys: string[]): string[] {
  return allKeys.filter(
    (k) => !PROTECTED_KEYS.includes(k) && MARKET_CACHE_PREFIXES.some((p) => k.startsWith(p)),
  );
}

/** Drop every cached-API-data key so the next page visit refetches live. Returns count. */
export function clearMarketDataCaches(): number {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  const toClear = cacheKeysToClear(keys);
  for (const k of toClear) localStorage.removeItem(k);
  return toClear.length;
}
