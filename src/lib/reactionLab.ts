/*
 * Reaction Lab — what the market ACTUALLY did on past prints.
 *
 * The implications playbook says what a hot CPI "should" do to ES/ZN/GC.
 * This module tests that map against reality: for every past release of an
 * event (actual vs consensus from the calendar history), it measures the
 * SAME-DAY move of six liquid proxies (SPY→ES, QQQ→NQ, TLT→ZN, GLD→GC,
 * USO→CL, UUP→USD, i.e. inverse 6E) from FMP daily bars, then scores how
 * often the playbook mapping held. Surprise → realized reaction, per
 * instrument — the study paid research desks sell, computed from the
 * trader's own free key.
 *
 * All analytics are pure functions (testable offline); fetching is thin,
 * cached, and shares the calendar row set the rest of the app already pulls.
 */
import type { PrintPoint } from './econData';
import { fmpDailyBarUrls, parseFmpDaily } from './market';

export interface DailyClose {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface ReactionProxy {
  sym: string;
  /** playbook instrument this proxy stands in for */
  inst: 'ES' | 'NQ' | 'ZN' | 'GC' | 'CL' | '6E';
  label: string;
  /** UUP rises when the dollar rises = inverse of the 6E (euro) leg */
  invert: boolean;
}

export const REACTION_PROXIES: ReactionProxy[] = [
  { sym: 'SPY', inst: 'ES', label: 'ES', invert: false },
  { sym: 'QQQ', inst: 'NQ', label: 'NQ', invert: false },
  { sym: 'TLT', inst: 'ZN', label: 'ZN', invert: false },
  { sym: 'GLD', inst: 'GC', label: 'GC', invert: false },
  { sym: 'USO', inst: 'CL', label: 'CL', invert: false },
  { sym: 'UUP', inst: '6E', label: 'USD', invert: true },
];

/* ------------------------------ pure analytics ---------------------------- */

/** Same-day close-over-prior-close return (%) for the release date. */
export function dayReturn(closes: DailyClose[], dateISO: string): number | null {
  if (!closes.length) return null;
  // the release date itself, or the first trading day after it
  let i = closes.findIndex((c) => c.date >= dateISO);
  if (i <= 0) return null;
  // don't wander more than 3 calendar days (weekend/holiday tolerance)
  const gapDays = (new Date(closes[i].date).getTime() - new Date(dateISO).getTime()) / 86400000;
  if (gapDays > 3) return null;
  const prev = closes[i - 1].close;
  if (!prev) return null;
  return (closes[i].close / prev - 1) * 100;
}

export interface ReactionRow {
  period: string;
  releaseDate: string;
  actual: number;
  consensus: number;
  surprise: number;
  /** same-day % move keyed by proxy symbol */
  rets: Record<string, number | null>;
}

/** Pair each past print (needs consensus + releaseDate) with proxy reactions. */
export function buildReactionRows(prints: PrintPoint[], closesBySym: Record<string, DailyClose[]>, cap = 12): ReactionRow[] {
  const rows: ReactionRow[] = [];
  for (const p of prints) {
    if (p.consensus == null || !p.releaseDate) continue;
    const rets: Record<string, number | null> = {};
    for (const proxy of REACTION_PROXIES) rets[proxy.sym] = dayReturn(closesBySym[proxy.sym] ?? [], p.releaseDate);
    rows.push({ period: p.period, releaseDate: p.releaseDate, actual: p.value, consensus: p.consensus, surprise: p.value - p.consensus, rets });
  }
  return rows.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).slice(0, cap);
}

const ARROW_SIGN: Record<string, number> = { '↑↑': 1, '↑': 1, '≈': 0, '↓': -1, '↓↓': -1 };

export interface ProxyScore {
  sym: string;
  label: string;
  /** average same-day % move on hot / cold surprises */
  hotAvg: number | null;
  coldAvg: number | null;
  /** how often the playbook direction held (hot + cold combined) */
  agree: number;
  scored: number;
}

/**
 * Score the playbook's hot-print direction map against realized reactions.
 * Cold surprises are expected to move each leg the OPPOSITE way. In-line
 * prints (|surprise| < eps) don't count for or against.
 */
export function reactionStats(rows: ReactionRow[], hotMap: Record<string, string>, eps = 1e-9): ProxyScore[] {
  return REACTION_PROXIES.map((proxy) => {
    const expected = ARROW_SIGN[hotMap[proxy.inst] ?? '≈'] ?? 0;
    let agree = 0;
    let scored = 0;
    const hots: number[] = [];
    const colds: number[] = [];
    for (const r of rows) {
      const raw = r.rets[proxy.sym];
      if (raw == null || Math.abs(r.surprise) < eps) continue;
      const ret = proxy.invert ? -raw : raw; // score in the playbook instrument's terms
      if (r.surprise > 0) hots.push(raw);
      else colds.push(raw);
      if (expected === 0) continue;
      const want = r.surprise > 0 ? expected : -expected;
      scored++;
      if (Math.sign(ret) === want) agree++;
    }
    const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    return { sym: proxy.sym, label: proxy.label, hotAvg: avg(hots), coldAvg: avg(colds), agree, scored };
  });
}

/** One-paragraph verdict: which legs actually respect the playbook. */
export function reactionVerdict(scores: ProxyScore[], eventShort: string): string {
  const rated = scores.filter((s) => s.scored >= 3).sort((a, b) => b.agree / b.scored - a.agree / a.scored);
  if (!rated.length) return `Not enough scored releases yet to grade the ${eventShort} playbook — the lab fills in as release history accumulates.`;
  const best = rated[0];
  const worst = rated[rated.length - 1];
  const pct = (s: ProxyScore) => `${s.agree}/${s.scored}`;
  const parts = [
    `Over the scored releases, the most reliable ${eventShort} leg has been ${best.label} — the playbook direction held ${pct(best)} times.`,
  ];
  if (worst !== best && worst.agree / worst.scored < 0.5) {
    parts.push(`${worst.label} held only ${pct(worst)} — treat that leg as regime-dependent, not mechanical.`);
  }
  parts.push('Size where the mapping is consistent; fade your own conviction where it is a coin flip.');
  return parts.join(' ');
}

/* --------------------------------- fetching ------------------------------- */

const PX_CACHE = 'ei-rxn-px-v1:';
const PX_FRESH_MS = 6 * 3600 * 1000;

/** Daily closes for one proxy over a range (browser key or /api/fmp relay). */
export async function fetchDailyCloses(sym: string, fromISO: string, toISO: string): Promise<DailyClose[] | null> {
  try {
    const hit = JSON.parse(localStorage.getItem(PX_CACHE + sym) ?? 'null') as { at: number; from: string; closes: DailyClose[] } | null;
    if (hit && Date.now() - hit.at < PX_FRESH_MS && hit.from <= fromISO && hit.closes.length) return hit.closes;
  } catch {
    // cache miss is fine
  }
  for (const url of fmpDailyBarUrls(sym, { from: fromISO, to: toISO })) {
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
      continue;
    }
    const closes: DailyClose[] = parseFmpDaily(json).map((b) => ({ date: b.date, close: b.close }));
    if (closes.length < 5) continue;
    try {
      localStorage.setItem(PX_CACHE + sym, JSON.stringify({ at: Date.now(), from: fromISO, closes }));
    } catch {
      // best effort
    }
    return closes;
  }
  return null;
}

/** All six proxies in parallel; null only if EVERY fetch failed. */
export async function fetchAllProxyCloses(fromISO: string, toISO: string): Promise<Record<string, DailyClose[]> | null> {
  const entries = await Promise.all(REACTION_PROXIES.map(async (p) => [p.sym, await fetchDailyCloses(p.sym, fromISO, toISO)] as const));
  const ok = entries.filter(([, v]) => v != null);
  if (!ok.length) return null;
  return Object.fromEntries(ok.map(([k, v]) => [k, v!]));
}
