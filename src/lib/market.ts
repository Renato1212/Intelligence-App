/**
 * Live "day ahead" market briefing for the preparation page, powered by
 * Financial Modeling Prep (free API key). The key is stored locally and
 * requests go straight from the trader's browser to FMP — no middleman.
 *
 * The overnight watchlist uses US-listed ETF proxies (SPY, QQQ, GLD, USO …)
 * rather than raw index/forex/commodity symbols (^GSPC, EURUSD, GCUSD),
 * because FMP's free tier includes US equities/ETFs but returns 403 for the
 * index/forex/commodity feeds. The ETFs track the same underlyings, so the
 * risk-sense read is preserved while working on a free key.
 */
import { fetchFfRows } from './ffcal';
import { fmtLisbon } from './tz';

export interface EconEvent {
  time: string; // HH:MM local
  dateTime: string;
  name: string;
  country: string;
  impact: 'High' | 'Medium' | 'Low' | string;
  consensus: string | null;
  previous: string | null;
  actual: string | null;
}

export interface QuoteRow {
  symbol: string;
  label: string;
  price: number;
  changePct: number;
}

export interface Briefing {
  events: EconEvent[];
  quotes: QuoteRow[];
  /** Per-section problems, shown inline instead of failing the whole panel. */
  eventsError: string | null;
  quotesError: string | null;
  fetchedAt: string;
}

const KEY_STORAGE = 'ei-fmp-key';
const CACHE_PREFIX = 'ei-briefing-';

export function getMarketApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? '';
}

/**
 * Candidate URLs for one FMP path, tried in order:
 *  1. direct with the browser key (when one is pasted in Settings),
 *  2. the deployment's /api/fmp relay (works when FMP_API_KEY is set as a
 *     Vercel env var — connect once, every device works with no browser key).
 * The relay answers 501 instantly when no server key is configured, so the
 * fall-through is cheap.
 */
export function fmpUrls(pathWithQuery: string): string[] {
  const key = getMarketApiKey();
  const urls: string[] = [];
  if (key) urls.push(`https://financialmodelingprep.com/${pathWithQuery}${pathWithQuery.includes('?') ? '&' : '?'}apikey=${key}`);
  urls.push(`/api/fmp?p=${encodeURIComponent(pathWithQuery)}`);
  return urls;
}

export function setMarketApiKey(key: string): void {
  if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
}

/** The risk-sense dashboard as free-tier-accessible ETF proxies. */
const QUOTE_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq' },
  { symbol: 'IWM', label: 'Russell' },
  { symbol: 'DIA', label: 'Dow' },
  { symbol: 'VIXY', label: 'VIX (fut)' },
  { symbol: 'TLT', label: '20y+ Bonds' },
  { symbol: 'UUP', label: 'US Dollar' },
  { symbol: 'FXE', label: 'Euro' },
  { symbol: 'GLD', label: 'Gold' },
  { symbol: 'SLV', label: 'Silver' },
  { symbol: 'USO', label: 'WTI Crude' },
  { symbol: 'UNG', label: 'Nat Gas' },
];

const MAJOR_COUNTRIES = new Set(['US', 'EA', 'EU', 'EMU', 'GB', 'UK', 'DE', 'JP', 'CA', 'CH', 'CN']);

/** Provider values are numeric with a separate unit field — reattach it so
 * "215" + "K" reads (and parses) as "215K", "4.2" + "%" as "4.2%". */
function fmtVal(v: unknown, unit?: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  const u = typeof unit === 'string' ? unit.trim() : '';
  if (u && ['%', 'K', 'M', 'B', 'T'].includes(u) && /^-?\d+(\.\d+)?$/.test(s)) return `${s}${u}`;
  return s;
}

function planError(status: number, what: string): string {
  if (status === 401) return 'Invalid API key — check it and reconnect.';
  if (status === 403) return `Your FMP plan doesn't include ${what}. The free plan covers US stocks/ETFs; the economic calendar may require an upgrade.`;
  if (status === 429) return 'Rate limit reached on your FMP plan — try again shortly.';
  return `Request failed (${status}).`;
}

async function fetchEvents(date: string): Promise<{ events: EconEvent[]; error: string | null }> {
  // FMP first (browser key, then the /api/fmp server-key relay), both paths
  const urls = [
    ...fmpUrls(`stable/economic-calendar?from=${date}&to=${date}`),
    ...fmpUrls(`api/v3/economic_calendar?from=${date}&to=${date}`),
  ];
  let lastStatus = 0;
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (res.ok) {
      const raw = (await res.json()) as Record<string, unknown>[];
      const events = (Array.isArray(raw) ? raw : [])
        .filter((e) => {
          const country = String(e.country ?? '').toUpperCase();
          const impact = String(e.impact ?? '');
          return MAJOR_COUNTRIES.has(country) && (impact === 'High' || impact === 'Medium');
        })
        .map((e) => {
          const dt = String(e.date ?? '');
          // provider timestamps are UTC — render in Lisbon
          const instant = dt.length >= 16 ? new Date(dt.replace(' ', 'T') + 'Z') : null;
          const local = instant && !isNaN(instant.getTime()) ? fmtLisbon(instant) : dt.slice(11, 16);
          return {
            time: local,
            dateTime: dt,
            name: String(e.event ?? ''),
            country: String(e.country ?? '').toUpperCase(),
            impact: String(e.impact ?? ''),
            consensus: fmtVal(e.estimate, e.unit),
            previous: fmtVal(e.previous, e.unit),
            actual: fmtVal(e.actual, e.unit),
          };
        })
        .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
      if (events.length) return { events, error: null };
    } else {
      lastStatus = res.status;
      if (res.status === 401) break; // bad key won't fix on the fallback
    }
  }

  // keyless fallback: the weekly feed (US rows, with real release times)
  const ff = await fetchFfRows();
  const todays = ff.filter((r) => r.date === date);
  if (todays.length) {
    const events = todays
      .map((r) => ({
        time: r.instant ? fmtLisbon(r.instant) : '',
        dateTime: r.instant ?? `${r.date} 00:00:00`,
        name: r.name,
        country: 'US',
        impact: 'Medium',
        consensus: r.consensus,
        previous: r.previous,
        actual: r.actual,
      }))
      .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
    return { events, error: null };
  }
  return { events: [], error: planError(lastStatus, 'the economic calendar') };
}

async function fetchQuotes(): Promise<{ quotes: QuoteRow[]; error: string | null }> {
  const symbols = QUOTE_SYMBOLS.map((q) => q.symbol).join(',');
  let res: Response | null = null;
  for (const url of fmpUrls(`api/v3/quote/${symbols}`)) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        res = r;
        break;
      }
      res = r;
      if (r.status === 401) break;
    } catch {
      // try the next candidate
    }
  }
  if (!res) return { quotes: [], error: 'Could not reach the market-data service (network/CORS).' };
  if (!res.ok) return { quotes: [], error: res.status === 501 ? 'Quotes need an FMP key — paste one in Settings, or set FMP_API_KEY on the deployment (one-time, works everywhere).' : planError(res.status, 'live quotes') };
  const raw = (await res.json()) as Record<string, unknown>[];
  const bySymbol = new Map((Array.isArray(raw) ? raw : []).map((q) => [String(q.symbol), q]));
  const quotes = QUOTE_SYMBOLS.filter((s) => {
    const q = bySymbol.get(s.symbol);
    return !!q && q.price != null;
  }).map((s) => {
    const q = bySymbol.get(s.symbol)!;
    return { symbol: s.symbol, label: s.label, price: Number(q.price ?? 0), changePct: Number(q.changesPercentage ?? 0) };
  });
  if (!quotes.length) return { quotes: [], error: 'No quotes returned for the watchlist on this plan.' };
  return { quotes, error: null };
}

export async function fetchBriefing(date: string): Promise<Briefing> {
  const [ev, qt] = await Promise.all([fetchEvents(date), fetchQuotes()]);
  const briefing: Briefing = {
    events: ev.events,
    quotes: qt.quotes,
    eventsError: ev.error,
    quotesError: qt.error,
    fetchedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(CACHE_PREFIX + date, JSON.stringify(briefing));
  } catch {
    // cache is best-effort
  }
  return briefing;
}

/* ---------- live week calendar for the Catalysts page ---------- */

export interface LiveEventRow {
  /** YYYY-MM-DD (as reported by the provider) */
  date: string;
  name: string;
  consensus: string | null;
  previous: string | null;
  actual: string | null;
  /** optional release instant (ISO), when the source carries a time */
  instant?: string;
  /** optional impact tag from the source (High / Medium / Low / Holiday) */
  impact?: string;
  /** optional currency code (USD, EUR …) when the source is multi-currency */
  currency?: string;
}

/* Cached provider rows per fetched range, so date reconciliation (reconcile.ts)
 * works everywhere in the app without extra requests. Kept small (last 8 ranges). */
const LIVECAL_CACHE_KEY = 'ei-livecal-cache-v1';
const LIVECAL_FRESH_MS = 18 * 3600 * 1000;

interface LiveCalRange {
  fetchedAt: string;
  from: string;
  to: string;
  rows: LiveEventRow[];
}

let liveCalMemo: { at: number; value: LiveCalRange[] } | null = null;

function readLiveCalCache(): LiveCalRange[] {
  if (liveCalMemo && Date.now() - liveCalMemo.at < 5000) return liveCalMemo.value;
  let value: LiveCalRange[] = [];
  try {
    const v = JSON.parse(localStorage.getItem(LIVECAL_CACHE_KEY) ?? '[]') as LiveCalRange[];
    value = Array.isArray(v) ? v : [];
  } catch {
    value = [];
  }
  liveCalMemo = { at: Date.now(), value };
  return value;
}

function storeLiveCalRange(entry: LiveCalRange): void {
  try {
    const rest = readLiveCalCache().filter((r) => !(r.from === entry.from && r.to === entry.to));
    rest.push(entry);
    rest.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    localStorage.setItem(LIVECAL_CACHE_KEY, JSON.stringify(rest.slice(0, 8)));
    liveCalMemo = null;
  } catch {
    // best effort
  }
}

/**
 * Cached provider rows covering a date, if a fresh fetched range includes it.
 * `covered: false` means we simply don't know — never treat it as "no events".
 */
export function cachedRowsCovering(dateISO: string): { covered: boolean; from: string; to: string; rows: LiveEventRow[] } {
  for (const r of readLiveCalCache()) {
    if (r.from <= dateISO && dateISO <= r.to && Date.now() - new Date(r.fetchedAt).getTime() < LIVECAL_FRESH_MS && r.rows.length >= 8) {
      return { covered: true, from: r.from, to: r.to, rows: r.rows };
    }
  }
  return { covered: false, from: '', to: '', rows: [] };
}

/**
 * Raw US calendar rows for a date range (all impacts), used to attach live
 * consensus / previous / actual readings to the deterministic calendar.
 */
export async function fetchUSCalendarRange(fromISO: string, toISO: string): Promise<{ rows: LiveEventRow[]; error: string | null }> {
  const urls = [
    ...fmpUrls(`stable/economic-calendar?from=${fromISO}&to=${toISO}`),
    ...fmpUrls(`api/v3/economic_calendar?from=${fromISO}&to=${toISO}`),
  ];
  let lastStatus = 0;
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (res.ok) {
      const raw = (await res.json()) as Record<string, unknown>[];
      const rows = (Array.isArray(raw) ? raw : [])
        .filter((e) => ['US', 'USA', 'UNITED STATES'].includes(String(e.country ?? '').toUpperCase()))
        .map((e) => ({
          date: String(e.date ?? '').slice(0, 10),
          name: String(e.event ?? ''),
          consensus: fmtVal(e.estimate, e.unit),
          previous: fmtVal(e.previous, e.unit),
          actual: fmtVal(e.actual, e.unit),
        }))
        .filter((e) => e.date && e.name);
      if (rows.length >= 8) {
        storeLiveCalRange({ fetchedAt: new Date().toISOString(), from: fromISO, to: toISO, rows });
        return { rows, error: null };
      }
      if (rows.length) return { rows, error: null };
    } else {
      lastStatus = res.status;
      if (res.status === 401) break;
    }
  }

  // keyless fallback: the weekly feed covers this week + next
  const ff = (await fetchFfRows()).filter((r) => r.date >= fromISO && r.date <= toISO);
  if (ff.length) {
    if (ff.length >= 8) storeLiveCalRange({ fetchedAt: new Date().toISOString(), from: fromISO, to: toISO, rows: ff });
    return { rows: ff, error: null };
  }
  return { rows: [], error: planError(lastStatus, 'the economic calendar') };
}

/** Rows for one calendar short across a whole row set (any date). */
export function rowsMatching(short: string, rows: LiveEventRow[]): LiveEventRow[] {
  const rx = LIVE_MATCHERS[short];
  return rx ? rows.filter((r) => rx.test(r.name)) : [];
}

/** Whether the provider feed can confirm/deny this event type at all. */
export function hasLiveMatcher(short: string): boolean {
  return !!LIVE_MATCHERS[short];
}

/** Match provider event names to the deterministic calendar's shorts. */
const LIVE_MATCHERS: Record<string, RegExp> = {
  // covers both provider styles: "Non Farm Payrolls" (FMP) and
  // "Non-Farm Employment Change" (weekly feed)
  NFP: /non.?farm payrolls(?! private)|nonfarm payrolls$|non.?farm employment change/i,
  CPI: /\bcpi\b|consumer price/i,
  PPI: /\bppi\b|producer price/i,
  'Jobless Claims': /initial jobless|initial claims|unemployment claims/i,
  JOLTS: /jolts?/i,
  'ISM Mfg': /ism manufacturing/i,
  'ISM Svcs': /ism (non.?manufacturing|services)/i,
  'Retail Sales': /retail sales/i,
  PCE: /\bpce\b/i,
  FOMC: /fed(eral)? (funds )?(interest )?rate decision|federal funds rate|fomc.*(decision|statement)/i,
  'FOMC Minutes': /fomc minutes/i,
};

/** Live readings for one calendar event on one date (max 3, most specific first). */
export function liveReadingsFor(short: string, dateISO: string, rows: LiveEventRow[]): LiveEventRow[] {
  const rx = LIVE_MATCHERS[short];
  if (!rx) return [];
  return rows
    .filter((r) => r.date === dateISO && rx.test(r.name))
    .sort((a, b) => {
      // prefer rows that already have an actual, then MoM/core variants, then shorter names
      const act = Number(!!b.actual) - Number(!!a.actual);
      if (act) return act;
      const rank = (n: string) => (/mom|m\/m/i.test(n) ? 0 : /core/i.test(n) ? 1 : 2);
      return rank(a.name) - rank(b.name) || a.name.length - b.name.length;
    })
    .slice(0, 3);
}

/** "0.3%" / "185K" / "-12.5" → number (K/M/B multipliers applied), or null. */
export function parseReading(v: string | null): number | null {
  if (v == null) return null;
  const m = String(v).replace(/[,\s]/g, '').match(/^(-?\d+(?:\.\d+)?)(%|K|M|B)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = m[2]?.toUpperCase() === 'K' ? 1e3 : m[2]?.toUpperCase() === 'M' ? 1e6 : m[2]?.toUpperCase() === 'B' ? 1e9 : 1;
  return n * mult;
}

export function cachedBriefing(date: string): Briefing | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + date);
    if (!raw) return null;
    const b = JSON.parse(raw) as Partial<Briefing>;
    return {
      events: b.events ?? [],
      quotes: b.quotes ?? [],
      eventsError: b.eventsError ?? null,
      quotesError: b.quotesError ?? null,
      fetchedAt: b.fetchedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
