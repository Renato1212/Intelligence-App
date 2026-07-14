/*
 * Edge Terminal — the synthesis engine.
 *
 * Every section of the platform answers one question from one data source.
 * The Terminal answers the question a desk head asks at 07:00: "where ARE we,
 * and what does today want to do?" — by fusing the app's independent reads
 * (vol term structure, breadth, the curve, positioning extremes, narrative
 * heat, the options-priced move, volume participation, expiration proximity,
 * scheduled catalysts, earnings that move index futures) into ONE structured,
 * rules-based market read. Nothing here is a black box: every line of the
 * verdict names the input that produced it, so the read teaches while it
 * orients.
 *
 * All synthesis is pure and null-tolerant (any feed may be down); fetchers
 * are thin and cached. This is the layer terminals charge for — computed
 * from the same primary sources, with the reasoning shown.
 */
import { fmpDailyBarUrls, fmpUrls, parseFmpDaily } from './market';

/* ----------------------------- earnings radar ----------------------------- */

export interface IndexMover {
  sym: string;
  name: string;
  /** which futures the print moves hardest */
  drives: 'NQ + ES' | 'ES' | 'ES + YM';
  note: string;
}

/** The names whose earnings actually move index futures (mega-cap weight or
 * read-through). Kept short deliberately — a 500-row earnings list is noise. */
export const INDEX_MOVERS: IndexMover[] = [
  { sym: 'NVDA', name: 'Nvidia', drives: 'NQ + ES', note: 'The AI-capex bellwether — moves the whole tape after hours.' },
  { sym: 'MSFT', name: 'Microsoft', drives: 'NQ + ES', note: 'Azure growth = the AI-demand read.' },
  { sym: 'AAPL', name: 'Apple', drives: 'NQ + ES', note: 'Largest weight; consumer + China read.' },
  { sym: 'AMZN', name: 'Amazon', drives: 'NQ + ES', note: 'AWS margin + the consumer read.' },
  { sym: 'GOOGL', name: 'Alphabet', drives: 'NQ + ES', note: 'Ad spend = the macro-demand canary.' },
  { sym: 'META', name: 'Meta', drives: 'NQ + ES', note: 'Ad pricing + AI capex guidance.' },
  { sym: 'TSLA', name: 'Tesla', drives: 'NQ + ES', note: 'High-beta sentiment leader; options-heavy tape.' },
  { sym: 'AVGO', name: 'Broadcom', drives: 'NQ + ES', note: 'AI networking demand; NVDA read-through.' },
  { sym: 'AMD', name: 'AMD', drives: 'NQ + ES', note: 'The other AI-chip read.' },
  { sym: 'NFLX', name: 'Netflix', drives: 'NQ + ES', note: 'First mega-cap of every season — sets the tone.' },
  { sym: 'COST', name: 'Costco', drives: 'ES', note: 'The cleanest consumer-health read.' },
  { sym: 'LLY', name: 'Eli Lilly', drives: 'ES', note: 'Top S&P weight outside tech.' },
  { sym: 'JPM', name: 'JPMorgan', drives: 'ES + YM', note: 'Opens every season: credit + net-interest read.' },
  { sym: 'BAC', name: 'Bank of America', drives: 'ES + YM', note: 'Consumer credit trends.' },
  { sym: 'GS', name: 'Goldman Sachs', drives: 'ES + YM', note: 'Trading revenue = the vol-regime mirror.' },
  { sym: 'UNH', name: 'UnitedHealth', drives: 'ES + YM', note: 'Biggest Dow weight — moves YM alone.' },
  { sym: 'CAT', name: 'Caterpillar', drives: 'ES + YM', note: 'The global-industrial cycle read.' },
  { sym: 'XOM', name: 'Exxon', drives: 'ES', note: 'Energy earnings follow CL with a lag.' },
  { sym: 'WMT', name: 'Walmart', drives: 'ES', note: 'The low-income-consumer read.' },
  { sym: 'HD', name: 'Home Depot', drives: 'ES', note: 'Housing-adjacent consumer read.' },
];

export interface EarningsRow {
  date: string; // YYYY-MM-DD
  sym: string;
  name: string;
  session: 'pre-market' | 'after-close' | 'during';
  drives: string;
  note: string;
  epsEstimate: number | null;
}

/** Pure: keep only index movers, map session, sort by date. */
export function rankEarnings(raw: unknown, fromISO: string, toISO: string): EarningsRow[] {
  const bySym = new Map(INDEX_MOVERS.map((m) => [m.sym, m]));
  const rows = Array.isArray(raw) ? raw : [];
  const out: EarningsRow[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const sym = String(r.symbol ?? '').toUpperCase();
    const m = bySym.get(sym);
    const date = String(r.date ?? '').slice(0, 10);
    if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < fromISO || date > toISO) continue;
    const time = String(r.time ?? '').toLowerCase();
    const session: EarningsRow['session'] = time === 'bmo' ? 'pre-market' : time === 'amc' ? 'after-close' : 'during';
    const eps = Number(r.epsEstimated ?? r.epsEstimate);
    out.push({ date, sym, name: m.name, session, drives: m.drives, note: m.note, epsEstimate: isFinite(eps) ? eps : null });
  }
  // one row per symbol (providers occasionally duplicate), earliest date wins
  const seen = new Map<string, EarningsRow>();
  for (const r of out.sort((a, b) => a.date.localeCompare(b.date))) {
    if (!seen.has(r.sym)) seen.set(r.sym, r);
  }
  return [...seen.values()];
}

const EARN_CACHE = 'ei-terminal-earnings-v1';

export async function fetchEarnings(fromISO: string, toISO: string): Promise<EarningsRow[] | null> {
  try {
    const hit = JSON.parse(localStorage.getItem(EARN_CACHE) ?? 'null') as { at: number; from: string; rows: EarningsRow[] } | null;
    if (hit && Date.now() - hit.at < 6 * 3600 * 1000 && hit.from === fromISO) return hit.rows;
  } catch {
    // cache miss
  }
  // stable route first (new keys 403 on legacy v3), legacy fallback
  const urls = [...fmpUrls(`stable/earnings-calendar?from=${fromISO}&to=${toISO}`), ...fmpUrls(`api/v3/earning_calendar?from=${fromISO}&to=${toISO}`)];
  for (const url of urls) {
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
    if (!Array.isArray(json)) continue;
    const rows = rankEarnings(json, fromISO, toISO);
    try {
      localStorage.setItem(EARN_CACHE, JSON.stringify({ at: Date.now(), from: fromISO, rows }));
    } catch {
      // best effort
    }
    return rows;
  }
  return null;
}

/* ----------------------------- volume pulse ------------------------------- */

export interface VolumePulse {
  ratio: number; // last session volume / 20-day average
  read: string;
}

/** Pure: participation vs the 20-day norm from daily bars (any order). */
export function volumePulse(bars: { date: string; volume: number }[]): VolumePulse | null {
  const clean = bars
    .filter((b) => isFinite(b.volume) && b.volume > 0 && /^\d{4}-\d{2}-\d{2}/.test(b.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length < 8) return null;
  const last = clean[clean.length - 1];
  const prior = clean.slice(-21, -1);
  const avg = prior.reduce((s, b) => s + b.volume, 0) / prior.length;
  if (!avg) return null;
  const ratio = last.volume / avg;
  const read =
    ratio >= 1.4
      ? 'Heavy participation — real money is engaged; moves carry more information.'
      : ratio >= 0.85
        ? 'Normal participation.'
        : 'Thin tape — moves stretch further on less; distrust breakouts, respect the fade.';
  return { ratio, read };
}

export async function fetchVolumePulse(sym = 'SPY'): Promise<VolumePulse | null> {
  for (const url of fmpDailyBarUrls(sym, { timeseries: 30 })) {
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
    const bars = parseFmpDaily(json).filter((b) => b.volume != null);
    if (!bars.length) continue;
    return volumePulse(bars.map((b) => ({ date: b.date, volume: b.volume! })));
  }
  return null;
}

/* ------------------------------ OPEX proximity ---------------------------- */

/** Days until the next monthly OPEX (3rd Friday), 0 on the day itself. Pure. */
export function daysToOpex(now = new Date()): number {
  const third = (y: number, m: number) => {
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    return 1 + ((5 - first + 7) % 7) + 14; // day-of-month of 3rd Friday
  };
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let d = third(y, m);
  let target = Date.UTC(y, m, d);
  const today = Date.UTC(y, m, now.getUTCDate());
  if (today > target) {
    const ny = m === 11 ? y + 1 : y;
    const nm = (m + 1) % 12;
    d = third(ny, nm);
    target = Date.UTC(ny, nm, d);
  }
  return Math.round((target - today) / 86400000);
}

/* ------------------------------- synthesis -------------------------------- */

export interface TerminalInputs {
  /** from vixRegime */
  volState: 'calm' | 'nervous' | 'event' | 'stress' | null;
  vix: number | null;
  /** sectors above 50DMA out of 11 */
  breadthAbove50: number | null;
  /** equal-weight vs cap-weight 20d relative return, % */
  rspSpy20: number | null;
  /** 2s10s bp + whether inverted */
  curveBps: number | null;
  curveInverted: boolean | null;
  /** markets flagged at positioning extremes, e.g. ["ES longs 96th", …] */
  cotExtremes: string[];
  /** top surging narrative, if any */
  narrativeTop: string | null;
  /** options-priced 1σ daily move, % of spot */
  expectedMovePct: number | null;
  volumeRatio: number | null;
  daysToOpex: number | null;
  /** number of tier-1 catalysts scheduled today */
  catalystsToday: number;
  /** index-mover earnings in the next 5 sessions */
  earningsCount: number;
}

export interface TerminalRead {
  /** the banner, e.g. "RISK-ON — orderly trend" */
  regime: string;
  banner: string;
  leans: string[];
  risks: string[];
  focus: string[];
}

/** Pure, null-tolerant: the desk-head read from whatever inputs loaded. */
export function synthesize(i: TerminalInputs): TerminalRead {
  const leans: string[] = [];
  const risks: string[] = [];
  const focus: string[] = [];

  // --- regime: vol first, breadth second ---
  let regime = 'MIXED — partial data';
  let banner = 'Feeds are still loading or offline; the read sharpens as inputs arrive.';
  const broad = i.breadthAbove50 != null ? i.breadthAbove50 >= 7 : null;
  if (i.volState) {
    if (i.volState === 'stress') {
      regime = 'RISK-OFF — vol backwardation';
      banner = 'The term structure is inverted: demand for protection NOW exceeds later. De-risking conditions — size down, trade the short side of failed bounces, respect gaps.';
    } else if (i.volState === 'event') {
      regime = 'EVENT-RISK — premium in the front';
      banner = 'Short-dated vol is bid over spot vol: the market is paying up for an imminent catalyst. Expect compression INTO the event and expansion out of it — the move is being saved up.';
    } else if (i.volState === 'calm' && broad !== false) {
      regime = 'RISK-ON — orderly trend';
      banner = 'Calm carry in the vol curve with participation intact: dips are for buying until the vol regime says otherwise. Trade WITH the tape; fade only at the expected-move rails.';
    } else if (i.volState === 'calm' && broad === false) {
      regime = 'NARROW TAPE — index up, soldiers missing';
      banner = 'Vol is calm but breadth is thin: a handful of mega-caps carry the index. These tapes trend longer than feels right and break suddenly — ride it with tight invalidation, never add on strength.';
    } else {
      regime = 'TRANSITION — vol waking up';
      banner = 'Vol is off the lows without stress: two-sided tape. Take profits faster, let the next regime declare itself before pressing.';
    }
  }

  // --- leans ---
  if (broad === true) leans.push(`Breadth confirms: ${i.breadthAbove50}/11 sectors above their 50DMA — the average stock participates, pullbacks are supported.`);
  if (broad === false) leans.push(`Breadth diverges: only ${i.breadthAbove50}/11 sectors above their 50DMA — index strength is narrow; the equal-weight tape is the honest one.`);
  if (i.rspSpy20 != null && Math.abs(i.rspSpy20) >= 1) {
    leans.push(
      i.rspSpy20 > 0
        ? `Equal-weight is beating cap-weight by ${i.rspSpy20.toFixed(1)}% over 20d — rotation INTO the average stock (healthy).`
        : `Cap-weight is beating equal-weight by ${Math.abs(i.rspSpy20).toFixed(1)}% over 20d — mega-cap crowding; watch those earnings dates like macro events.`,
    );
  }
  if (i.curveBps != null) {
    leans.push(
      i.curveInverted
        ? `The curve is inverted (2s10s ${i.curveBps.toFixed(0)}bp) — the bond market still prices restriction; rate-sensitive longs need the front end to crack first.`
        : `The curve is positive (2s10s +${i.curveBps.toFixed(0)}bp) — normalization; steepening days favor banks/YM over NQ.`,
    );
  }
  if (i.volumeRatio != null && i.volumeRatio < 0.85) leans.push('Volume is running thin vs the 20-day norm — stretch moves, distrust breakouts.');
  if (i.volumeRatio != null && i.volumeRatio >= 1.4) leans.push('Volume is heavy vs the 20-day norm — institutional participation; today\'s direction carries weight.');

  // --- risks ---
  if (i.cotExtremes.length) {
    risks.push(`Positioning extremes: ${i.cotExtremes.slice(0, 3).join(' · ')} — crowded trades are squeeze fuel through any surprise.`);
  }
  if (i.daysToOpex != null && i.daysToOpex <= 4) {
    risks.push(`OPEX in ${i.daysToOpex === 0 ? 'TODAY' : `${i.daysToOpex}d`} — pinning force rises into expiry and the tape unclenches after; expect magnet behavior around big strikes.`);
  }
  if (i.catalystsToday > 0) {
    risks.push(`${i.catalystsToday} tier-1 release${i.catalystsToday > 1 ? 's' : ''} scheduled today — the expected move is priced around ${i.expectedMovePct != null ? `±${i.expectedMovePct.toFixed(1)}%` : 'the data'}; don't carry full size into the print.`);
  }
  if (i.earningsCount > 0) {
    risks.push(`${i.earningsCount} index-moving earnings within 5 sessions — single-stock gaps become index gaps at this concentration.`);
  }
  if (i.narrativeTop) {
    risks.push(`Narrative heat: "${i.narrativeTop}" is surging in global media — the story decides which data prints matter this week.`);
  }

  // --- focus ---
  if (i.expectedMovePct != null) focus.push(`Rails: the options market prices a ±${i.expectedMovePct.toFixed(1)}% 1σ day — fade the edges in positive gamma, follow the break in negative.`);
  focus.push('Confirm any index read against ZN (the honest leg) and the session clock before sizing.');
  if (regime.startsWith('RISK-ON')) focus.push('In this regime the failed BREAKDOWN is the highest-quality long entry — the crowd sells the low, the trend takes it back.');
  if (regime.startsWith('RISK-OFF')) focus.push('In this regime the failed BOUNCE is the trade — rallies into resistance with vol still bid are supply.');
  if (regime.startsWith('EVENT')) focus.push('Pre-event: trade small or stand down; the paid trade is the post-print repricing, not the guess.');

  return { regime, banner, leans, risks, focus };
}
