/**
 * Live "day ahead" market briefing for the preparation page, powered by
 * Financial Modeling Prep (free API key). The key is stored locally and
 * requests go straight from the trader's browser to FMP — no middleman.
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

/** The risk-sense dashboard: index, vol, rates, dollar, metals, energy. */
const QUOTE_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'Nasdaq' },
  { symbol: '^RUT', label: 'Russell' },
  { symbol: '^VIX', label: 'VIX' },
  { symbol: '^TNX', label: '10y yield' },
  { symbol: 'EURUSD', label: 'EUR/USD' },
  { symbol: 'GCUSD', label: 'Gold' },
  { symbol: 'SIUSD', label: 'Silver' },
  { symbol: 'CLUSD', label: 'WTI Crude' },
  { symbol: 'NGUSD', label: 'Nat Gas' },
];

const MAJOR_COUNTRIES = new Set(['US', 'EA', 'EU', 'EMU', 'GB', 'UK', 'DE', 'JP', 'CA', 'CH', 'CN']);

function fmtVal(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

export async function fetchBriefing(date: string): Promise<Briefing> {
  const key = getMarketApiKey();
  if (!key) throw new Error('no-key');

  const calUrl = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${date}&to=${date}&apikey=${key}`;
  const quotesUrl = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(QUOTE_SYMBOLS.map((q) => q.symbol).join(','))}?apikey=${key}`;

  const [calRes, quoteRes] = await Promise.all([fetch(calUrl), fetch(quotesUrl)]);
  if (calRes.status === 401 || quoteRes.status === 401) throw new Error('Invalid API key — check it on the briefing panel');
  if (!calRes.ok && !quoteRes.ok) throw new Error(`Market data request failed (${calRes.status})`);

  let events: EconEvent[] = [];
  if (calRes.ok) {
    const raw = (await calRes.json()) as Record<string, unknown>[];
    events = (Array.isArray(raw) ? raw : [])
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
  }

  let quotes: QuoteRow[] = [];
  if (quoteRes.ok) {
    const raw = (await quoteRes.json()) as Record<string, unknown>[];
    const bySymbol = new Map((Array.isArray(raw) ? raw : []).map((q) => [String(q.symbol), q]));
    quotes = QUOTE_SYMBOLS.filter((s) => bySymbolHas(bySymbol, s.symbol)).map((s) => {
      const q = bySymbol.get(s.symbol)!;
      return {
        symbol: s.symbol,
        label: s.label,
        price: Number(q.price ?? 0),
        changePct: Number(q.changesPercentage ?? 0),
      };
    });
  }

  const briefing: Briefing = { events, quotes, fetchedAt: new Date().toISOString() };
  try {
    localStorage.setItem(CACHE_PREFIX + date, JSON.stringify(briefing));
  } catch {
    // cache is best-effort
  }
  return briefing;
}

function bySymbolHas(map: Map<string, Record<string, unknown>>, sym: string): boolean {
  const q = map.get(sym);
  return !!q && q.price != null;
}

export function cachedBriefing(date: string): Briefing | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + date);
    return raw ? (JSON.parse(raw) as Briefing) : null;
  } catch {
    return null;
  }
}
