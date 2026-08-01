/*
 * flowsData.ts — the basket loader behind the Flows section.
 *
 * Pulls daily closes for several symbols at once, cached, with the same
 * FMP-then-keyless-relay fallback the rest of the platform uses so the whole
 * section works without a paid data plan.
 */
import { dailyBarUrls, parseFmpDaily } from './market';
import type { Close, NamedSeries } from './flows';

/** The cross-asset universe: one liquid, RTH-clean instrument per exposure. */
export const FLOW_UNIVERSE: { symbol: string; label: string; group: string; why: string }[] = [
  { symbol: 'SPY', label: 'S&P 500', group: 'Equity', why: 'The benchmark — everything else is measured against it.' },
  { symbol: 'QQQ', label: 'Nasdaq 100', group: 'Equity', why: 'Long-duration equity: the most rate-sensitive index.' },
  { symbol: 'IWM', label: 'Russell 2000', group: 'Equity', why: 'Domestic, credit-sensitive risk — the honest breadth read.' },
  { symbol: 'SMH', label: 'Semiconductors', group: 'Equity', why: 'Front of the global manufacturing cycle; leads at turns.' },
  { symbol: 'XLY', label: 'Cons. discretionary', group: 'Sector', why: 'The cyclical half of the classic risk-appetite pair.' },
  { symbol: 'XLP', label: 'Cons. staples', group: 'Sector', why: 'The defensive half — rotation into it precedes index weakness.' },
  { symbol: 'XLF', label: 'Financials', group: 'Sector', why: 'Curve and credit expressed as equity.' },
  { symbol: 'XLE', label: 'Energy', group: 'Sector', why: 'The inflation-impulse sector; hedges the rest of the book.' },
  { symbol: 'TLT', label: '20y+ Treasuries', group: 'Rates', why: 'Pure duration — the other side of the master risk dial.' },
  { symbol: 'IEF', label: '7-10y Treasuries', group: 'Rates', why: 'The belly: the market\'s view on the policy path.' },
  { symbol: 'HYG', label: 'High yield credit', group: 'Credit', why: 'Credit appetite. Leads equity at turns more often than not.' },
  { symbol: 'GLD', label: 'Gold', group: 'Commodity', why: 'Real yields and fear, in one instrument.' },
  { symbol: 'CPER', label: 'Copper', group: 'Commodity', why: 'Industrial demand — the growth vote with no central bank in it.' },
  { symbol: 'USO', label: 'WTI crude', group: 'Commodity', why: 'The supply-shock channel into inflation expectations.' },
  { symbol: 'UUP', label: 'US dollar', group: 'FX', why: 'The global liquidity tide; a headwind or tailwind for everything.' },
  { symbol: 'EEM', label: 'Emerging markets', group: 'Equity', why: 'Dollar liquidity and non-US growth combined.' },
];

const CACHE_PREFIX = 'ei-flows-px-';
const FRESH_MS = 60 * 60 * 1000; // daily closes — hourly is plenty

async function fetchCloses(symbol: string, from: string, to: string): Promise<Close[] | null> {
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE_PREFIX + symbol) ?? 'null') as { at: number; from: string; closes: Close[] } | null;
    if (hit && Date.now() - hit.at < FRESH_MS && hit.from <= from && hit.closes.length) return hit.closes;
  } catch {
    /* no storage — go to network */
  }
  for (const url of dailyBarUrls(symbol, { from, to, range: '1y' })) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      continue; // a 200 carrying HTML is a failed candidate, not a crash
    }
    const closes = parseFmpDaily(json).map((b) => ({ date: b.date, close: b.close }));
    if (closes.length < 30) continue;
    try {
      localStorage.setItem(CACHE_PREFIX + symbol, JSON.stringify({ at: Date.now(), from, closes }));
    } catch {
      /* quota — serving from network is fine */
    }
    return closes;
  }
  return null;
}

export interface BasketLoad {
  series: NamedSeries[];
  /** symbols that returned nothing, so the UI can say which are missing */
  missing: string[];
}

/** Load daily closes for a set of symbols in parallel. */
export async function loadBasket(symbols: string[], days = 300): Promise<BasketLoad> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const wanted = [...new Set(symbols)];
  const results = await Promise.all(
    wanted.map(async (symbol) => {
      const closes = await fetchCloses(symbol, from, to);
      const meta = FLOW_UNIVERSE.find((u) => u.symbol === symbol);
      return { symbol, label: meta?.label ?? symbol, closes };
    }),
  );
  return {
    series: results.filter((r) => r.closes?.length).map((r) => ({ symbol: r.symbol, label: r.label, closes: r.closes! })),
    missing: results.filter((r) => !r.closes?.length).map((r) => r.symbol),
  };
}
