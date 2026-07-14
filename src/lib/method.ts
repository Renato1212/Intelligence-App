/*
 * The Method — how every section of the platform combines into ONE process.
 *
 * Each tool in the app answers a single question. Edge comes from stacking the
 * answers in the right ORDER at the right TIME of day. This module is the
 * content spine for that: the daily workflow step by step (what to open, what
 * to read off it, the principle behind it), and the cross-section
 * "combinations" — which reads multiply each other and why.
 *
 * Pure content + tiny helpers, so the Method page and the per-page Connects
 * footers stay consistent from one source of truth.
 */

export interface MethodStep {
  n: number;
  when: string;
  title: string;
  route: string;
  routeLabel: string;
  question: string;
  read: string[];
  principle: string;
}

export const METHOD_STEPS: MethodStep[] = [
  {
    n: 1,
    when: 'Before anything',
    title: 'Know where you are in the day',
    route: '/sessions',
    routeLabel: 'Session Clock',
    question: 'Who is in control right now — and what opens next?',
    read: [
      'Which sessions are open and how long until the next open (Europe 08:00, US cash 14:30 Lisbon).',
      'Whether you are inside the Europe×US prime-time overlap — the deepest liquidity of the day.',
      'How far into the current session you are: opens carry edge, handoffs and lunches trap.',
    ],
    principle:
      'The same setup means different things at different clock times. Time-of-day is a real edge domain — anchor every other read to the session window before you weigh it.',
  },
  {
    n: 2,
    when: 'Pre-market',
    title: 'Map the scheduled volatility',
    route: '/catalysts',
    routeLabel: 'Catalysts',
    question: 'What is scheduled that can move my markets today — and what has the data been printing?',
    read: [
      'Today on the session radar: exact Lisbon times of every release, with consensus → actual updating live.',
      'The print history behind the headline event: trend, σ-band, momentum, and the full subcomponent basket (CPI).',
      'The market-implications table: what a hot vs cold print does to ES, NQ, ZN, 6E, GC, CL — and when that mapping flips.',
      'Your own record on this event\'s days — is it your edge or your leak?',
    ],
    principle:
      'Data prints are the day\'s scheduled regime tests. Decide BEFORE the print which interpretation regime the market is in (inflation-fear vs growth-fear) — the bond leg (ZN) tells you which lens won.',
  },
  {
    n: 3,
    when: 'Pre-market',
    title: 'Read the context layer',
    route: '/macro',
    routeLabel: 'Macro Map',
    question: 'What regime am I trading in — and does the world agree with itself?',
    read: [
      'Narrative monitor: which stories are SURGING — they decide which data prints matter this week.',
      'Rates & the curve: the policy-cycle clock behind every index and FX move.',
      'Cross-asset agreement: same move everywhere (conviction) or one market alone (fade candidate)?',
      'Breadth & IMF outlook: is the average stock confirming the index; which way does the slow current lean?',
    ],
    principle:
      'Context does not give entries — it sets the DIRECTION OF LEAST RESISTANCE and the size of your conviction. Trade with the current when everything agrees; get small when the reads conflict.',
  },
  {
    n: 4,
    when: 'Pre-market',
    title: 'Locate the dealer levels',
    route: '/optvol',
    routeLabel: 'Options & Vol',
    question: 'Where will hedging flows stall or accelerate price — and how big is today priced to be?',
    read: [
      'Vol regime from the VIX term structure: calm carry (fade extremes) vs event premium vs backwardation (size down).',
      'The walls and the zero-gamma flip for ES/NQ/RTY — mechanical support, resistance, and the regime line.',
      'The expected move: today\'s options-priced 1σ range — your rails for targets and fade zones.',
      'OPEX proximity: pinning force now, unclenching after.',
    ],
    principle:
      'Dealer hedging is FORCED flow — the most honest participant in the market. In positive gamma the expected-move band tends to hold; in negative gamma it breaks. Levels + regime together tell you whether today is a fade day or a follow day.',
  },
  {
    n: 5,
    when: 'Pre-market',
    title: 'Check who is positioned where',
    route: '/intel',
    routeLabel: 'Market Intel',
    question: 'Is the crowd already leaning my way — and this week\'s confluence ideas?',
    read: [
      'Large-spec positioning percentile per market: extremes are fuel for squeezes THROUGH catalysts.',
      'The week\'s focus list: positioning extremes × this week\'s catalysts × your own per-instrument expectancy.',
    ],
    principle:
      'Positioning is the potential energy; the catalyst is the trigger. A crowded trade + a surprise print = the violent move. Never fade a release that hits a positioning extreme.',
  },
  {
    n: 6,
    when: 'Then',
    title: 'Write the plan, then trade it',
    route: '/day',
    routeLabel: 'Trading Day → Preparation',
    question: 'What exactly am I looking to do — before the open forces me to improvise?',
    read: [
      'The prep page pulls the catalysts, positioning reads and briefing inline — write hypotheses, levels and risk.',
      'Risk Guardrail: today\'s loss limit and safe size BEFORE the first trade.',
    ],
    principle:
      'The plan is the edge. Everything before this step is input; the preparation page is where inputs become IF-THEN statements you can execute without thinking mid-trade.',
  },
  {
    n: 7,
    when: 'After the close',
    title: 'Debrief and feed the loop',
    route: '/journal',
    routeLabel: 'Daily Debrief',
    question: 'What did the market teach — and what did my execution reveal?',
    read: [
      'Import the day\'s fills (extension → Import paste). Grade the trades against the 5 domains.',
      'Edge Analytics: your expectancy by session window, event day, setup — the stats that tell you which parts of this method pay YOU.',
    ],
    principle:
      'The review IS the development. The whole platform is a loop: today\'s debrief re-weights which reads you trust tomorrow.',
  },
];

/* ------------------------ cross-section combinations ---------------------- */

export interface Combo {
  title: string;
  parts: string[];
  why: string;
}

export const COMBOS: Combo[] = [
  {
    title: 'The pre-print stack',
    parts: ['Catalysts: consensus + implications map', 'Market Intel: positioning percentile', 'Options & Vol: expected move + vol regime'],
    why: 'A print only moves the market when it surprises a CROWDED market beyond what options PRICED. Consensus tells you the bar, positioning tells you the fuel, the expected move tells you how far the repricing can run before dealers lean on it.',
  },
  {
    title: 'Fade day vs follow day',
    parts: ['Options & Vol: gamma regime + walls', 'Session Clock: which window you are in', 'Macro Map: cross-asset agreement'],
    why: 'Positive gamma + lunch window + cross-asset disagreement = mean-reversion conditions: fade the edges of the expected move toward the gamma magnet. Negative gamma + prime-time + everything moving together = trend conditions: buy strength, sell weakness, respect the acceleration strike.',
  },
  {
    title: 'The narrative filter',
    parts: ['Macro Map: surging narratives', 'Catalysts: which release owns the tape', 'Playbook: domain classification'],
    why: 'The market only trades one or two stories at a time. A surging inflation narrative makes CPI a regime event and NFP an afterthought — and vice versa in a growth scare. Classify the day\'s domain BEFORE picking a setup from the Playbook.',
  },
  {
    title: 'The OPEX week overlay',
    parts: ['Options & Vol: expiration calendar + OI share', 'Catalysts: flow filter', 'Edge Analytics: your OPEX-day stats'],
    why: 'Expiration mechanics override normal reads: pinning suppresses catalysts landing on OPEX Friday morning, and the Monday after frees the tape. Your own OPEX-day expectancy tells you whether to trade it or stand down.',
  },
  {
    title: 'The honest-leg check',
    parts: ['Macro Map: rates panel (ZN/curve)', 'Catalysts: post-print reaction', 'Options & Vol: VIX term structure'],
    why: 'When equities and bonds disagree after a print, the bond move is usually the honest one. Confirm with the vol curve: if VIX9D stays bid after a "good" print, the market does not believe it — fade the equity pop.',
  },
];

/** Compact cross-links shown at the bottom of each section ("use this with…"). */
export interface Connection {
  route: string;
  label: string;
  why: string;
}

export const CONNECTS: Record<string, Connection[]> = {
  catalysts: [
    { route: '/optvol', label: 'Options & Vol', why: 'the expected move + gamma regime tell you how far the print can run and whether to fade or follow it' },
    { route: '/intel', label: 'Market Intel', why: 'a print that hits a positioning extreme is the squeeze setup — check the percentile before fading anything' },
    { route: '/sessions', label: 'Session Clock', why: 'the same release trades differently at the open vs lunch — know your window' },
  ],
  optvol: [
    { route: '/catalysts', label: 'Catalysts', why: 'event premium in the VIX curve points at a specific date — find it on the calendar' },
    { route: '/macro', label: 'Macro Map', why: 'gamma says HOW price moves; the narrative and cross-asset reads say WHICH WAY to lean' },
    { route: '/sessions', label: 'Session Clock', why: 'walls matter most into the close and OPEX hours — time-stamp your levels' },
    { route: '/charts', label: 'Charts', why: 'draw these levels on the TradingView chart and watch how price treats them live' },
  ],
  macro: [
    { route: '/intel', label: 'Market Intel', why: 'a narrative surge + a positioning extreme in the same market is the crowded-story setup' },
    { route: '/catalysts', label: 'Catalysts', why: 'the surging story decides which of this week\'s prints actually matters' },
    { route: '/optvol', label: 'Options & Vol', why: 'regime context + dealer levels = direction AND location' },
  ],
  intel: [
    { route: '/catalysts', label: 'Catalysts', why: 'positioning is fuel; the scheduled print is the spark — line them up' },
    { route: '/day', label: 'Preparation', why: 'focus-list markets carry their positioning read into your prep automatically' },
  ],
  sessions: [
    { route: '/optvol', label: 'Options & Vol', why: 'the session flow map and the dealer levels are the same mechanics seen from time vs price' },
    { route: '/analytics', label: 'Edge Analytics', why: 'your timing heatmap shows which of these windows actually pays you' },
  ],
  charts: [
    { route: '/optvol', label: 'Options & Vol', why: 'draw the put wall, call wall, flip and expected-move band on the chart — dealer levels are the ones that hold' },
    { route: '/catalysts', label: 'Catalysts', why: 'time-stamp the chart with today\'s release times; the candle AT the print is the regime tell' },
    { route: '/sessions', label: 'Session Clock', why: 'the chart renders in Lisbon time — line up the session opens and the prime-time overlap' },
  ],
};
