/*
 * ideas.ts — the Conviction Board engine.
 *
 * Turns the platform's five edge-domain reads (central banks, economic data,
 * news/narrative, technicals, flow) into EXECUTABLE trade ideas: each one a
 * complete plan — thesis, trigger, entry zone, invalidation, targets, kill
 * switch — plus which domains confirm it and which fight it. Conviction is
 * scored 1–5 from that cross-domain agreement, never from a single signal.
 *
 * Everything here is pure and null-tolerant: feed it whatever loaded and it
 * builds ideas from what it has. The page (Ideas.tsx) gathers the inputs.
 */

import type { CalendarEvent, EdgeDomain } from './calendar';
import type { CotAnalysis } from './cot';
import { PRINT_PLAYBOOK } from './econData';
import type { GammaProfile, ExpectedMove, VixRegime } from './options';
import type { ThemeSeries } from './narrative';
import type { PairCorr } from './crossAsset';
import type { OhlcBar } from './market';

export type IdeaBias = 'long' | 'short' | 'two-way';

export interface TradeIdea {
  id: string;
  domain: EdgeDomain;
  title: string;
  /** the instrument to express it in (futures root) */
  instrument: string;
  bias: IdeaBias;
  /** when the idea is live, in trader terms (Lisbon times where clock-bound) */
  timeWindow: string;
  /** WHY this setup exists — the context paragraph */
  thesis: string;
  /** what must happen before any order goes in */
  trigger: string;
  /** where/how to enter once triggered */
  entry: string;
  /** the price/condition that proves the idea wrong — exit, no argument */
  invalidation: string;
  targets: string[];
  /** the non-price event that kills the idea even if price hasn't */
  killSwitch: string;
  /** cross-domain evidence in favor / against */
  confirms: string[];
  conflicts: string[];
  /** 1 (take only with extra confluence) … 5 (A+ setup) */
  conviction: number;
  horizon: 'intraday' | 'multi-day';
}

/* ------------------------------ helpers ---------------------------------- */

/** conviction = base ± cross-domain agreement, clamped to 1..5 */
export function convictionOf(base: number, confirms: string[], conflicts: string[]): number {
  return Math.max(1, Math.min(5, Math.round(base + Math.min(2, confirms.length) - conflicts.length)));
}

/** Average true range over the last n completed bars. */
export function atr(bars: OhlcBar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = bars[i - 1].close;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose)));
  }
  return trs.reduce((s, x) => s + x, 0) / trs.length;
}

export interface GapStats {
  /** today's open vs yesterday's close, % */
  gapPct: number;
  /** the same gap in ATR14 multiples */
  gapAtr: number | null;
  direction: 'up' | 'down';
  /** of historical same-direction gaps ≥ half today's size: how often the gap
   * FILLED the same day (traded back to the prior close) */
  fillRate: number | null;
  sampleSize: number;
}

/**
 * Empirical gap study on daily OHLC. The LAST bar is treated as today (its
 * open is the live gap); history is everything before it. A gap-up counts as
 * filled when that day's LOW trades back to the prior close; gap-down when the
 * HIGH does.
 */
export function gapStats(bars: OhlcBar[]): GapStats | null {
  if (bars.length < 40) return null;
  const today = bars[bars.length - 1];
  const prior = bars[bars.length - 2];
  if (!(prior.close > 0)) return null;
  const gapPct = (today.open / prior.close - 1) * 100;
  if (!isFinite(gapPct)) return null;
  const dir: 'up' | 'down' = gapPct >= 0 ? 'up' : 'down';
  const a = atr(bars.slice(0, -1), 14);
  const gapAtr = a != null && a > 0 ? Math.abs(today.open - prior.close) / a : null;

  const threshold = Math.abs(gapPct) / 2;
  let filled = 0;
  let n = 0;
  for (let i = 1; i < bars.length - 1; i++) {
    const pc = bars[i - 1].close;
    if (!(pc > 0)) continue;
    const g = (bars[i].open / pc - 1) * 100;
    if (!isFinite(g)) continue;
    const sameDir = (g >= 0 ? 'up' : 'down') === dir;
    if (!sameDir || Math.abs(g) < Math.max(0.1, threshold)) continue;
    n++;
    const fill = dir === 'up' ? bars[i].low <= pc : bars[i].high >= pc;
    if (fill) filled++;
  }
  return { gapPct, gapAtr, direction: dir, fillRate: n >= 8 ? filled / n : null, sampleSize: n };
}

/** Month-to-date % return: last close vs the final close of the prior month. */
export function monthToDate(bars: { date: string; close: number }[]): number | null {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const month = last.date.slice(0, 7);
  let base: number | null = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date.slice(0, 7) !== month) {
      base = bars[i].close;
      break;
    }
  }
  return base != null && base > 0 ? (last.close / base - 1) * 100 : null;
}

/** Weekdays remaining in the month AFTER the given date (a proxy for trading days). */
export function tradingDaysLeftInMonth(dateISO: string): number {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day-count of month m (1-based)
  let count = 0;
  for (let day = d + 1; day <= last; day++) {
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function daysUntil(dateISO: string, nowISO: string): number {
  const a = Date.UTC(+nowISO.slice(0, 4), +nowISO.slice(5, 7) - 1, +nowISO.slice(8, 10));
  const b = Date.UTC(+dateISO.slice(0, 4), +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

const fmtLvl = (v: number): string => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2));

/* --------------------------- inputs bundle -------------------------------- */

export interface IdeaInputs {
  /** ISO date-time "now" — generators only use the date part + coarse timing */
  nowISO: string;
  /** upcoming calendar (~7 days), from upcomingEvents() */
  events: CalendarEvent[];
  /** analyzed COT markets (analyzeSeries over the snapshot) */
  cot: CotAnalysis[];
  /** narrative theme series (loadNarrative) */
  themes: ThemeSeries[];
  /** correlation-regime breaks (loadCrossAsset read.breaks) */
  corrBreaks: PairCorr[];
  /** SPX dealer gamma profile + expected move (loadChain → gammaProfile/expectedMove) */
  gamma: GammaProfile | null;
  em: ExpectedMove | null;
  vol: VixRegime | null;
  /** daily OHLC for the index proxy (SPY) — powers the gap study */
  indexBars: OhlcBar[];
  /** month-to-date % for the rebalancing detector (SPY / TLT proxies) */
  spyMtd: number | null;
  tltMtd: number | null;
  daysToOpex: number | null;
  /** index-mover earnings inside the next 5 sessions */
  earningsCount: number;
}

export function emptyInputs(nowISO: string): IdeaInputs {
  return {
    nowISO,
    events: [],
    cot: [],
    themes: [],
    corrBreaks: [],
    gamma: null,
    em: null,
    vol: null,
    indexBars: [],
    spyMtd: null,
    tltMtd: null,
    daysToOpex: null,
    earningsCount: 0,
  };
}

/* ----------------------- domain 1: central banks -------------------------- */

/**
 * FOMC ideas. Two classic, well-documented structures:
 *  – the pre-FOMC drift (equities' tendency to grind up in the ~24h before
 *    the statement, strongest in calm vol regimes), and
 *  – the statement-day second move (fade the first spike, trade the reversal
 *    that starts during/after the press conference).
 */
export function centralBankIdeas(i: IdeaInputs): TradeIdea[] {
  const out: TradeIdea[] = [];
  const fomc = i.events.find((e) => e.domain === 'central-banks' && /fomc/i.test(e.name) && !/minutes/i.test(e.name));
  if (!fomc) return out;
  const d = daysUntil(fomc.date, i.nowISO);
  if (d < 0 || d > 5) return out;

  if (d >= 1) {
    const confirms: string[] = [];
    const conflicts: string[] = [];
    if (i.vol?.state === 'calm') confirms.push('Vol curve in contango — the drift historically concentrates in calm regimes');
    if (i.vol?.state === 'stress') conflicts.push('Vol backwardation — stress regimes break the drift pattern');
    if (i.gamma?.regime === 'positive') confirms.push('Positive dealer gamma dampens downside on the approach');
    if (i.gamma?.regime === 'negative') conflicts.push('Negative gamma: hedging amplifies any pre-meeting shock');
    out.push({
      id: `cb-drift-${fomc.date}`,
      domain: 'central-banks',
      title: 'Pre-FOMC drift',
      instrument: 'ES',
      bias: 'long',
      timeWindow: `From the ${fomc.date} T-1 US open until ~19:00 Lisbon on decision day (statement 19:00)`,
      thesis:
        `FOMC lands ${fomc.date} at ${fomc.timeET} ET. Equities have a documented tendency to drift higher in the ~24 hours before the statement — the market de-risks early, then the absence of sellers lets the index grind up into the event.`,
      trigger: 'No tier-1 data shock between now and the window; ES holding above the prior day\'s low at the T-1 US open.',
      entry: 'Long ES on the first pullback to VWAP after the T-1 US open; add only if the London close (17:00 Lisbon) holds the entry.',
      invalidation: 'A close below the prior day\'s low, or any 1%+ down move during the window — the drift is a fair-weather edge.',
      targets: ['Prior swing high', i.em ? `Upper expected-move rail ~${fmtLvl(i.em.dailyUpper)}` : 'The upper expected-move rail'],
      killSwitch: 'FLAT BEFORE 19:00 Lisbon on decision day. The drift edge ends AT the statement — holding through it is a different (worse) trade.',
      confirms,
      conflicts,
      conviction: convictionOf(3, confirms, conflicts),
      horizon: 'multi-day',
    });
  }

  {
    const confirms: string[] = [];
    const conflicts: string[] = [];
    if (i.gamma?.regime === 'negative') confirms.push('Negative gamma: dealer hedging extends the second move once it starts');
    if (i.gamma?.regime === 'positive') conflicts.push('Positive gamma mutes follow-through — take targets faster');
    if (i.em) confirms.push(`Options price ±${i.em.dailyPct.toFixed(1)}% for the day — the rails for both directions are known`);
    out.push({
      id: `cb-secondmove-${fomc.date}`,
      domain: 'central-banks',
      title: 'FOMC second move',
      instrument: 'ES',
      bias: 'two-way',
      timeWindow: `${fomc.date}: statement 19:00 Lisbon, press conference 19:30–20:15`,
      thesis:
        'The first spike after an FOMC statement is algorithmic keyword-reading and is reversed by the press conference roughly half the time. The tradeable move is the SECOND one — the direction that survives Powell\'s Q&A.',
      trigger: 'Wait for the statement spike to stall, then for price to reclaim or reject the pre-statement level DURING the press conference.',
      entry: 'Enter in the direction of the reclaim/reject once the 19:30–19:45 range breaks; never trade the 19:00 candle itself.',
      invalidation: 'Back inside the pre-statement range for more than 10 minutes — no second move today, stand down.',
      targets: [
        i.em ? `The expected-move rail in the move's direction (${fmtLvl(i.em.dailyLower)} / ${fmtLvl(i.em.dailyUpper)})` : 'The daily expected-move rail',
        'Hold a runner into the 21:00 close only if the last 30 minutes extend',
      ],
      killSwitch: 'ZN disagreeing with the equity move — when bonds and stocks split after a Fed event, the bond read wins; exit the equity leg.',
      confirms,
      conflicts,
      conviction: convictionOf(3, confirms, conflicts),
      horizon: 'intraday',
    });
  }
  return out;
}

/* ----------------------- domain 2: economic data -------------------------- */

/**
 * Print-squeeze ideas: a tier-1 release inside 2 days whose playbook touches a
 * market where large specs sit at a 3-year positioning extreme. Crowded trades
 * have asymmetric reactions — the surprise that hits the crowd travels much
 * farther than the one that comforts it. The idea trades WITH the squeeze.
 */
export function dataIdeas(i: IdeaInputs): TradeIdea[] {
  const out: TradeIdea[] = [];
  const soon = i.events.filter((e) => e.domain === 'economic-data' && e.impact === 'high' && PRINT_PLAYBOOK[e.short] && daysUntil(e.date, i.nowISO) >= 0 && daysUntil(e.date, i.nowISO) <= 2);
  for (const ev of soon.slice(0, 3)) {
    const pb = PRINT_PLAYBOOK[ev.short];
    for (const a of i.cot) {
      const root = a.market.symbol;
      if (!root || !(root in pb.hot)) continue;
      const p = a.pctile3y;
      if (p == null || (p < 90 && p > 10)) continue;
      const crowdedLong = p >= 90;
      // the squeeze direction is AGAINST the crowd; find which surprise causes it
      const hotArrow = pb.hot[root] ?? '';
      const hotIsDown = hotArrow.includes('↓');
      const squeezeSurprise = crowdedLong ? (hotIsDown ? 'hot' : 'cold') : hotIsDown ? 'cold' : 'hot';
      const bias: IdeaBias = crowdedLong ? 'short' : 'long';
      const confirms = [
        `COT: large specs at the ${p}th percentile of their 3-year ${crowdedLong ? 'long' : 'short'} range (report ${a.reportDate})`,
      ];
      if (a.flags.includes('big-shift')) confirms.push('Positioning just moved at a 90th-percentile weekly pace — the crowd is active, not stale');
      const conflicts: string[] = [];
      if (a.flags.includes('flip')) conflicts.push('Net position just flipped sign — the extreme read is younger and less reliable');
      out.push({
        id: `data-squeeze-${ev.short}-${root}-${ev.date}`.replace(/\s+/g, ''),
        domain: 'economic-data',
        title: `${ev.short} squeeze risk in ${root}`,
        instrument: root,
        bias,
        timeWindow: `${ev.date} at ${ev.timeET} ET — the print and the 60–90 minutes after it`,
        thesis:
          `${ev.name} prints ${ev.date} while large specs are ${crowdedLong ? 'max long' : 'max short'} ${root} (${p}th pctile, 3y). A ${squeezeSurprise.toUpperCase()} surprise forces that crowd out, and crowded exits overshoot: the reaction in the squeeze direction should travel farther and stick better than the consensus-friendly one. Driver to watch: ${pb.driver}`,
        trigger: `A clearly ${squeezeSurprise.toUpperCase()} print vs consensus. If the print lands on-consensus, there is NO trade — the crowd stays put.`,
        entry: `${bias === 'short' ? 'Short' : 'Long'} ${root} on the first pullback after the initial ${squeezeSurprise}-print impulse (30–50% retrace of the first swing), not on the spike itself.`,
        invalidation: 'Full retrace of the print move — the market rejected the surprise; the squeeze thesis is dead.',
        targets: ['1× the first impulse measured from the retrace entry', 'Trail the rest — squeezes end abruptly, not gently'],
        killSwitch: pb.regimeFlip ? `Regime check: ${pb.regimeFlip}` : 'A same-day counter-headline that re-anchors the narrative — exit, don\'t argue.',
        confirms,
        conflicts,
        conviction: convictionOf(3, confirms, conflicts),
        horizon: 'intraday',
      });
    }
  }
  return out;
}

/* ------------------- domain 3: news & narrative --------------------------- */

/**
 * Narrative ideas: a media-volume surge (z ≥ 2 vs the theme's own baseline)
 * says the market's attention is on ONE story — that story will decide how
 * ambiguous tape and second-tier data get read this week.
 */
export function narrativeIdeas(i: IdeaInputs): TradeIdea[] {
  const out: TradeIdea[] = [];
  const surging = i.themes.filter((t) => t.surging && t.z != null).sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
  for (const t of surging.slice(0, 2)) {
    const inst = t.theme.affects[0] ?? 'ES';
    const confirms: string[] = [`GDELT media volume ${t.z!.toFixed(1)}σ above the theme's trailing baseline`];
    const conflicts: string[] = [];
    const related = i.corrBreaks[0];
    if (related) confirms.push(`Correlation regime moving: ${related.a}/${related.b} 20d corr ${related.c20.toFixed(2)} vs 60d ${related.c60.toFixed(2)} — cross-asset flows are repricing`);
    if (i.vol?.state === 'calm') conflicts.push('Vol curve is still in calm carry — the options market is not paying up for this story yet');
    if (i.vol?.state === 'event' || i.vol?.state === 'stress') confirms.push(`Vol regime "${i.vol.state}" — the options market confirms the market cares`);
    out.push({
      id: `news-${t.theme.id}`,
      domain: 'news',
      title: `Narrative heat: ${t.theme.label}`,
      instrument: inst,
      bias: 'two-way',
      timeWindow: 'This week, headline-driven — strongest outside US hours when books are thin',
      thesis:
        `"${t.theme.label}" is surging in global media (${t.z!.toFixed(1)}σ above its own baseline). ${t.theme.why} While the surge lasts, headlines on this theme will move ${t.theme.affects.join('/')} faster and farther than scheduled data.`,
      trigger: `A fresh headline on this theme hitting during a quiet tape — the move starts in ${inst} within minutes and the first impulse is tradeable.`,
      entry: `Trade the impulse direction on the FIRST shallow pullback; alternatively pre-position only at technical levels that already stood on their own.`,
      invalidation: 'The impulse fully retraces within 30 minutes — the market judged the headline stale or priced.',
      targets: ['Prior session high/low in the headline direction', 'Scale out fast — narrative moves front-load'],
      killSwitch: `Media volume dropping back under ${t.baseline.toFixed(2)} baseline for 2 days — the story died; stop trading it.`,
      confirms,
      conflicts,
      conviction: convictionOf(2, confirms, conflicts),
      horizon: 'multi-day',
    });
  }
  return out;
}

/* ------------------------ domain 4: technicals ---------------------------- */

/**
 * Technical ideas from hard numbers: the empirical gap study on the index
 * proxy, and the expected-move rails read through the dealer-gamma regime
 * (fade the rails in positive gamma, follow the break in negative gamma).
 */
export function technicalIdeas(i: IdeaInputs): TradeIdea[] {
  const out: TradeIdea[] = [];
  const g = gapStats(i.indexBars);

  if (g && g.gapAtr != null && g.gapAtr >= 0.25 && g.fillRate != null) {
    const fade = g.fillRate >= 0.6;
    const dirWord = g.direction === 'up' ? 'gap-UP' : 'gap-DOWN';
    const bias: IdeaBias = fade ? (g.direction === 'up' ? 'short' : 'long') : g.direction === 'up' ? 'long' : 'short';
    const confirms = [
      `History: ${Math.round(g.fillRate * 100)}% of comparable same-direction gaps filled the same day (n=${g.sampleSize})`,
    ];
    const conflicts: string[] = [];
    if (fade && i.gamma?.regime === 'negative') conflicts.push('Negative dealer gamma favors continuation over fill — the fade is fighting the hedging flow');
    if (fade && i.gamma?.regime === 'positive') confirms.push('Positive dealer gamma: hedging leans against the gap direction, helping the fill');
    if (!fade && i.gamma?.regime === 'negative') confirms.push('Negative dealer gamma: hedging amplifies the gap direction');
    out.push({
      id: `tech-gap-${g.direction}`,
      domain: 'technicals',
      title: fade ? `Fade the ${dirWord}` : `${dirWord} and go`,
      instrument: 'ES',
      bias,
      timeWindow: 'US cash open (14:30 Lisbon) through the first 90 minutes',
      thesis:
        `The index opens ${g.gapPct >= 0 ? '+' : ''}${g.gapPct.toFixed(2)}% (${g.gapAtr.toFixed(1)}× ATR14) from yesterday's close. In this market's own history, comparable ${dirWord} opens filled the same day ${Math.round(g.fillRate * 100)}% of the time — ${fade ? 'the odds favor a rotation back to the prior close.' : 'this size of gap tends to HOLD; the fill trade is the losing side.'}`,
      trigger: fade
        ? 'The opening drive stalls without extending beyond the first 15-minute range, then breaks back through the open price.'
        : 'The first pullback after the open holds ABOVE the opening range midpoint (below, for gap-downs).',
      entry: fade
        ? 'Enter toward the fill on the break back through the opening price; half size before 15:00 Lisbon.'
        : 'Enter with the gap direction on that first held pullback.',
      invalidation: fade
        ? 'A new extreme beyond the first-hour range in the gap direction — the gap is going, not filling.'
        : 'Full gap fill (price back at yesterday\'s close) — continuation failed.',
      targets: fade
        ? [`Yesterday's close (the full fill)`, 'Half off at half-gap']
        : ['Measured move: one gap-size beyond the open', i.em ? `Expected-move rail ~${fmtLvl(g.direction === 'up' ? i.em.dailyUpper : i.em.dailyLower)}` : 'The daily expected-move rail'],
      killSwitch: 'A tier-1 print or Fed speaker inside the window re-pricing the open — the gap logic resets; stand down and re-plan.',
      confirms,
      conflicts,
      conviction: convictionOf(3, confirms, conflicts),
      horizon: 'intraday',
    });
  }

  if (i.gamma && i.em) {
    const pos = i.gamma.regime === 'positive';
    const confirms: string[] = [];
    const conflicts: string[] = [];
    if (pos && i.vol?.state === 'calm') confirms.push('Calm vol regime — range days dominate under positive gamma + contango');
    if (!pos && (i.vol?.state === 'stress' || i.vol?.state === 'event')) confirms.push(`Vol regime "${i.vol!.state}" agrees: expansion conditions`);
    if (pos && i.vol?.state === 'stress') conflicts.push('Vol stress against positive gamma — mixed regime, take the fade smaller');
    const lvls: string[] = [];
    if (i.gamma.putWall != null) lvls.push(`put wall ${i.gamma.putWall}`);
    if (i.gamma.zeroGamma != null) lvls.push(`zero-gamma flip ${i.gamma.zeroGamma}`);
    if (i.gamma.callWall != null) lvls.push(`call wall ${i.gamma.callWall}`);
    out.push({
      id: `tech-rails-${i.gamma.regime}`,
      domain: 'technicals',
      title: pos ? 'Fade the expected-move rails' : 'Follow the rail break',
      instrument: 'ES',
      bias: 'two-way',
      timeWindow: 'Today\'s US session; strongest 15:30–20:00 Lisbon',
      thesis: pos
        ? `Dealers are net LONG gamma (${(i.gamma.totalGex / 1e9).toFixed(1)}bn/1%): their hedging sells rallies and buys dips, compressing the day inside the options-priced ±${i.em.dailyPct.toFixed(1)}% band (${fmtLvl(i.em.dailyLower)}–${fmtLvl(i.em.dailyUpper)}). Touches of the rails are statistically stretched — the edge is fading them back toward the middle. Key levels: ${lvls.join(', ')}.`
        : `Dealers are net SHORT gamma (${(i.gamma.totalGex / 1e9).toFixed(1)}bn/1%): hedging AMPLIFIES moves. A break of the ±${i.em.dailyPct.toFixed(1)}% rail (${fmtLvl(i.em.dailyLower)} / ${fmtLvl(i.em.dailyUpper)}) can extend rather than revert — trend-day conditions. Key levels: ${lvls.join(', ')}.`,
      trigger: pos
        ? 'Price tags a rail and prints a rejection (failed breakout / delta flip on the DOM) within 2–3 candles.'
        : 'A rail breaks and the first retest from outside HOLDS.',
      entry: pos ? 'Fade at the rail with the rejection candle; never fade a FIRST touch that came on expanding volume.' : 'Enter with the break on the held retest.',
      invalidation: pos
        ? 'Two consecutive closes beyond the rail — the band lost; positive-gamma logic is off for the day.'
        : 'Back inside the band and through VWAP — the break failed.',
      targets: pos ? ['VWAP', 'The opposite rail if momentum flips'] : ['1.5× the daily expected move', i.gamma.zeroGamma != null ? `The zero-gamma flip at ${i.gamma.zeroGamma}` : 'The next dealer level'],
      killSwitch: i.gamma.zeroGamma != null ? `A cross of the zero-gamma flip (${i.gamma.zeroGamma}) changes the regime mid-day — re-read before pressing.` : 'A vol-regime shift intraday (VIX9D through VIX) — re-read before pressing.',
      confirms,
      conflicts,
      conviction: convictionOf(3, confirms, conflicts),
      horizon: 'intraday',
    });
  }
  return out;
}

/* --------------------------- domain 5: flow ------------------------------- */

export function flowIdeas(i: IdeaInputs): TradeIdea[] {
  const out: TradeIdea[] = [];

  // OPEX pin
  if (i.daysToOpex != null && i.daysToOpex <= 2 && i.gamma && i.gamma.regime === 'positive' && (i.gamma.putWall != null || i.gamma.callWall != null)) {
    const walls = [i.gamma.putWall, i.gamma.callWall].filter((x): x is number => x != null);
    const near = walls.reduce((b, w) => (Math.abs(w - i.gamma!.spot) < Math.abs(b - i.gamma!.spot) ? w : b), walls[0]);
    const confirms = [`${Math.round(i.gamma.nearestExpiryShare * 100)}% of chain OI expires at the nearest expiry`];
    const conflicts: string[] = [];
    if (i.events.some((e) => e.impact === 'high' && daysUntil(e.date, i.nowISO) === 0)) conflicts.push('A tier-1 print today can rip price off the pin — the catalyst outranks the flow');
    out.push({
      id: `flow-opex-${i.daysToOpex}`,
      domain: 'flow',
      title: `OPEX pin ${i.daysToOpex === 0 ? 'today' : `in ${i.daysToOpex}d`}`,
      instrument: 'ES',
      bias: 'two-way',
      timeWindow: 'OPEX week, strongest the final session — index AM settlement prices off the 9:30 ET (14:30 Lisbon) cash open',
      thesis:
        `Expiration ${i.daysToOpex === 0 ? 'is TODAY' : `lands in ${i.daysToOpex} sessions`} with dealers long gamma: hedging flows pull price toward the heavy strikes. Nearest big strike to spot: ${near} (put wall ${i.gamma.putWall ?? '—'}, call wall ${i.gamma.callWall ?? '—'}). Ranges compress and moves away from the magnets get faded mechanically.`,
      trigger: `Price stretching ≥0.5× the daily expected move AWAY from ${near} without a catalyst behind it.`,
      entry: `Fade back toward ${near}; enter on the stall, not the stretch itself.`,
      invalidation: 'A catalyst-backed break that HOLDS beyond the stretch — pins lose to real news.',
      targets: [`The magnet strike ${near}`, 'Exit by the OPEX settlement — the force disappears with the open interest'],
      killSwitch: 'Monday after OPEX the pin is GONE — do not carry pin logic past expiration; the tape unclenches.',
      confirms,
      conflicts,
      conviction: convictionOf(3, confirms, conflicts),
      horizon: 'multi-day',
    });
  }

  // Month-end rebalancing
  const daysLeft = tradingDaysLeftInMonth(i.nowISO);
  if (daysLeft <= 3 && i.spyMtd != null && i.tltMtd != null) {
    const spread = i.spyMtd - i.tltMtd;
    if (Math.abs(spread) >= 2) {
      const equitiesWon = spread > 0;
      const confirms = [
        `Month-to-date: equities ${i.spyMtd >= 0 ? '+' : ''}${i.spyMtd.toFixed(1)}% vs bonds ${i.tltMtd >= 0 ? '+' : ''}${i.tltMtd.toFixed(1)}% — a ${Math.abs(spread).toFixed(1)}pp spread forces fixed-weight portfolios to trade`,
      ];
      const conflicts: string[] = [];
      if (i.vol?.state === 'stress') conflicts.push('Stress regime: discretionary de-risking can swamp the mechanical rebalance');
      out.push({
        id: 'flow-monthend',
        domain: 'flow',
        title: `Month-end rebalance: ${equitiesWon ? 'equity supply, bond demand' : 'equity demand, bond supply'}`,
        instrument: equitiesWon ? 'ES' : 'ZN',
        bias: 'short',
        timeWindow: `Last ${daysLeft === 0 ? 'session' : `${daysLeft} sessions`} of the month, concentrated in the final hour into the 21:00 Lisbon MOC`,
        thesis:
          `Balanced mandates rebalance to fixed weights at month-end. With ${equitiesWon ? 'equities' : 'bonds'} outperforming by ${Math.abs(spread).toFixed(1)}pp this month, the mechanical flow is SELL ${equitiesWon ? 'equities' : 'bonds'} / BUY ${equitiesWon ? 'bonds' : 'equities'} — biggest at the closing auctions of the final sessions.`,
        trigger: `${equitiesWon ? 'ES' : 'ZN'} failing to make new session highs after 19:30 Lisbon on a month-end session, with MOC imbalance headlines leaning sell.`,
        entry: `Short ${equitiesWon ? 'ES' : 'ZN'} into the final 60–90 minutes; the companion long (${equitiesWon ? 'ZN' : 'ES'}) is the hedged expression.`,
        invalidation: 'Price making new session highs after 20:00 Lisbon — the flow was absorbed or you mis-sized it.',
        targets: ['The final-hour flush into the 21:00 auction; exit AT the close', 'Do not hold overnight — the flow ends with the bell'],
        killSwitch: 'First session of the new month: the pressure often unwinds — if anything, look for the reversal long, not a continuation.',
        confirms,
        conflicts,
        conviction: convictionOf(3, confirms, conflicts),
        horizon: 'multi-day',
      });
    }
  }

  // Earnings concentration
  if (i.earningsCount >= 3) {
    out.push({
      id: 'flow-earnings',
      domain: 'flow',
      title: `Earnings cluster: ${i.earningsCount} index movers in 5 sessions`,
      instrument: 'NQ',
      bias: 'two-way',
      timeWindow: 'After-hours prints (21:00+ Lisbon) and the following opens',
      thesis:
        `${i.earningsCount} index-moving reports land within 5 sessions. At this concentration, single-stock gaps become index gaps — NQ carries the risk overnight, and implied vol stays bid until the reports clear.`,
      trigger: 'A mega-cap surprise moving its stock ≥5% after hours while index futures lag the implied move.',
      entry: 'Trade NQ toward the weighted implied index move when futures haven\'t caught up within 15 minutes of the print.',
      invalidation: 'The single-stock move halves before the cash open — the market faded the report itself.',
      targets: ['The arithmetic index-weight move', 'Flat by the first 30 minutes of cash — the edge is the lag, not the day'],
      killSwitch: 'Guidance ambiguity (stock whipsawing both sides) — no read, no trade.',
      confirms: ['Earnings calendar (FMP) shows the cluster', i.vol?.state === 'event' ? 'Front-end vol premium confirms the market is braced' : ''].filter(Boolean),
      conflicts: [],
      conviction: 2,
      horizon: 'multi-day',
    });
  }
  return out;
}

/* ------------------------------ composer ---------------------------------- */

export interface IdeaBoard {
  ideas: TradeIdea[];
  /** which domains produced at least one idea */
  activeDomains: EdgeDomain[];
  /** one-line stand-down note when nothing qualifies */
  standDown: string | null;
}

export function generateIdeas(i: IdeaInputs): IdeaBoard {
  const ideas = [...centralBankIdeas(i), ...dataIdeas(i), ...narrativeIdeas(i), ...technicalIdeas(i), ...flowIdeas(i)].sort(
    (a, b) => b.conviction - a.conviction,
  );
  const activeDomains = [...new Set(ideas.map((x) => x.domain))];
  return {
    ideas,
    activeDomains,
    standDown:
      ideas.length === 0
        ? 'No qualified setups right now. That IS the read: the edge domains are quiet, and forcing a trade without one is how edge leaks. Re-run after the next data load, or stand down.'
        : null,
  };
}
