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

function fmtVal(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

function planError(status: number, what: string): string {
  if (status === 401) return 'Invalid API key — check it and reconnect.';
  if (status === 403) return `Your FMP plan doesn't include ${what}. The free plan covers US stocks/ETFs; the economic calendar may require an upgrade.`;
  if (status === 429) return 'Rate limit reached on your FMP plan — try again shortly.';
  return `Request failed (${status}).`;
}

async function fetchEvents(date: string, key: string): Promise<{ events: EconEvent[]; error: string | null }> {
  // stable endpoint first, fall back to the legacy v3 path
  const urls = [
    `https://financialmodelingprep.com/stable/economic-calendar?from=${date}&to=${date}&apikey=${key}`,
    `https://financialmodelingprep.com/api/v3/economic_calendar?from=${date}&to=${date}&apikey=${key}`,
  ];
  let lastStatus = 0;
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      return { events: [], error: 'Could not reach the market-data service (network/CORS).' };
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
          return {
            time: dt.length >= 16 ? dt.slice(11, 16) : '',
            dateTime: dt,
            name: String(e.event ?? ''),
            country: String(e.country ?? '').toUpperCase(),
            impact: String(e.impact ?? ''),
            consensus: fmtVal(e.estimate),
            previous: fmtVal(e.previous),
            actual: fmtVal(e.actual),
          };
        })
        .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
      return { events, error: null };
    }
    lastStatus = res.status;
    if (res.status === 401) break; // bad key won't fix on the fallback
  }
  return { events: [], error: planError(lastStatus, 'the economic calendar') };
}

async function fetchQuotes(key: string): Promise<{ quotes: QuoteRow[]; error: string | null }> {
  const symbols = QUOTE_SYMBOLS.map((q) => q.symbol).join(',');
  const url = `https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${key}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { quotes: [], error: 'Could not reach the market-data service (network/CORS).' };
  }
  if (!res.ok) return { quotes: [], error: planError(res.status, 'live quotes') };
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
  const key = getMarketApiKey();
  if (!key) throw new Error('no-key');

  const [ev, qt] = await Promise.all([fetchEvents(date, key), fetchQuotes(key)]);
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
}

/**
 * Raw US calendar rows for a date range (all impacts), used to attach live
 * consensus / previous / actual readings to the deterministic calendar.
 */
export async function fetchUSCalendarRange(fromISO: string, toISO: string): Promise<{ rows: LiveEventRow[]; error: string | null }> {
  const key = getMarketApiKey();
  if (!key) return { rows: [], error: 'no-key' };
  const urls = [
    `https://financialmodelingprep.com/stable/economic-calendar?from=${fromISO}&to=${toISO}&apikey=${key}`,
    `https://financialmodelingprep.com/api/v3/economic_calendar?from=${fromISO}&to=${toISO}&apikey=${key}`,
  ];
  let lastStatus = 0;
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      return { rows: [], error: 'Could not reach the market-data service (network/CORS).' };
    }
    if (res.ok) {
      const raw = (await res.json()) as Record<string, unknown>[];
      const rows = (Array.isArray(raw) ? raw : [])
        .filter((e) => ['US', 'USA', 'UNITED STATES'].includes(String(e.country ?? '').toUpperCase()))
        .map((e) => ({
          date: String(e.date ?? '').slice(0, 10),
          name: String(e.event ?? ''),
          consensus: fmtVal(e.estimate),
          previous: fmtVal(e.previous),
          actual: fmtVal(e.actual),
        }))
        .filter((e) => e.date && e.name);
      return { rows, error: null };
    }
    lastStatus = res.status;
    if (res.status === 401) break;
  }
  return { rows: [], error: planError(lastStatus, 'the economic calendar') };
}

/** Match provider event names to the deterministic calendar's shorts. */
const LIVE_MATCHERS: Record<string, RegExp> = {
  NFP: /non.?farm payrolls(?! private)|nonfarm payrolls$/i,
  CPI: /\bcpi\b|consumer price/i,
  PPI: /\bppi\b|producer price/i,
  'Jobless Claims': /initial jobless|initial claims/i,
  JOLTS: /jolts?/i,
  'ISM Mfg': /ism manufacturing/i,
  'ISM Svcs': /ism (non.?manufacturing|services)/i,
  'Retail Sales': /retail sales/i,
  PCE: /\bpce\b/i,
  FOMC: /fed(eral)? (funds )?(interest )?rate decision|fomc.*(decision|statement)/i,
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
