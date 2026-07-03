import type { CriterionId, DomainId, GradeLevel } from './types';

/**
 * The 5 Edge Domain framework (AXIA playbook) encoded as data:
 * what to look for, how a trade is tagged (3 levels) and how a coach
 * grades it (5 criteria x below / at / above standard).
 */

export interface DomainCategory {
  id: string;
  label: string;
  hint: string;
}

export interface GradeRubricRow {
  criterion: CriterionId;
  below: string;
  at: string;
  above: string;
}

export interface EdgeDomain {
  id: DomainId;
  index: number;
  name: string;
  short: string;
  tagline: string;
  color: string;
  lookFor: string[];
  level1: string;
  categories: DomainCategory[];
  level3Suggestions: string[];
  mistakes: string[];
  rubric: GradeRubricRow[];
}

export const CRITERIA: { id: CriterionId; label: string }[] = [
  { id: 'trigger', label: 'Trigger recognition' },
  { id: 'sizing', label: 'Sizing' },
  { id: 'exit', label: 'Exit discipline' },
  { id: 'articulation', label: 'Articulation' },
  { id: 'review', label: 'Post-trade review' },
];

export const GRADE_LEVELS: { id: GradeLevel; label: string; score: number }[] = [
  { id: 'below', label: 'Below standard', score: 0 },
  { id: 'at', label: 'At standard', score: 1 },
  { id: 'above', label: 'Above standard', score: 2 },
];

export const DOMAINS: EdgeDomain[] = [
  {
    id: 'central-banks',
    index: 1,
    name: 'Central Banks',
    short: 'CB',
    tagline: 'The edge that pays when policy moves the market',
    color: '#3987e5',
    lookFor: [
      'Scheduled rate and policy decisions, including projections (SEPs and Dots) across the Fed, BoE, ECB, BoJ, SNB and others.',
      'Press conference after the policy decision: how the language changes — an interpretation trade.',
      'Inter-meeting speeches from voting members: track who is speaking and what is said.',
      'Shifts in rate pricing between decisions, shown by STIR markets.',
    ],
    level1: 'A trade taken on a central bank input.',
    categories: [
      { id: 'statement', label: 'Statement', hint: 'Trade triggered by the headline release itself' },
      { id: 'presser', label: 'Presser', hint: 'Spoken language in the post-decision press conference' },
      { id: 'speaker', label: 'Speaker', hint: 'A central bank member commented outside a meeting' },
      { id: 'sources', label: 'Sources', hint: 'Unnamed sources suggesting a potential policy change' },
      { id: 'opinion', label: 'Opinion', hint: 'A journalist article or comment setting the tone for policy' },
    ],
    level3Suggestions: ['Hawkish', 'Dovish', 'Speaker name', 'Journalist name'],
    mistakes: [
      'Entering before the statement drops without an exit plan for either direction.',
      'Trading the headline and ignoring the press conference 30 to 60 minutes later.',
      'Ignoring pricing going in. The market had a view; your trade is relative to it.',
      'Trading every meeting. Not every decision is a trading opportunity.',
    ],
    rubric: [
      {
        criterion: 'trigger',
        below: 'Cannot identify which decision is in play.',
        at: 'Names the meeting, knows the consensus, knows the prior reaction.',
        above: 'Anticipates which language change would surprise the market and trades that asymmetry.',
      },
      {
        criterion: 'sizing',
        below: 'Risks the same on every meeting regardless of conviction.',
        at: 'Sizes up for high-conviction setups, smaller around low-edge meetings.',
        above: 'Scales in around the press conference based on language signals.',
      },
      {
        criterion: 'exit',
        below: 'Holds through opposing signals because they want it to work.',
        at: 'Exits on the first clear language reversal.',
        above: 'Pre-defined exit, executed without hesitation, even on a winning trade.',
      },
      {
        criterion: 'articulation',
        below: 'Cannot explain the trade beyond a feel.',
        at: 'Names the policy lever and the expected market reaction.',
        above: 'Maps the trade to the curve, the cross-asset reaction and the prior reference meeting.',
      },
      {
        criterion: 'review',
        below: 'No tag, no notes.',
        at: 'Tagged; notes name what worked or did not.',
        above: 'Tagged; notes link the trade to a future template the trader will reuse.',
      },
    ],
  },
  {
    id: 'economic-data',
    index: 2,
    name: 'Economic Data',
    short: 'Data',
    tagline: 'Where blowout numbers and central bank policy collide',
    color: '#199e70',
    lookFor: [
      'Tier 1 releases on the calendar today (e.g. NFP, CPI, ISM, GDP).',
      'Consensus vs the range of expectations. Know what is a tradeable outlier and what is not worth trading.',
      'Revisions to the prior period print, often as market-moving as the headline.',
      'The sub-component reads inside the headline (e.g. wages within NFP).',
      'Central bank context. What would this print do for the next meeting?',
      'Track which data points are currently creating reactions.',
    ],
    level1: 'Data is the reason behind the trade — the initial reaction, second wave or post-trade pattern.',
    categories: [
      { id: 'unemployment', label: 'Unemployment', hint: 'NFP, ADP, Initial Jobless' },
      { id: 'inflation', label: 'Inflation', hint: 'CPI, PCE, PPI' },
      { id: 'growth', label: 'Growth', hint: 'GDP, ISM, Retail Sales' },
      { id: 'sentiment', label: 'Sentiment', hint: 'Consumer Confidence, Michigan' },
      { id: 'inventory', label: 'Inventory', hint: 'Oil and Gas inventories, WASDE, Business Inventories' },
    ],
    level3Suggestions: [
      'Phase 1',
      'Phase 2',
      'Phase 3',
      'Fade',
      'Continuation',
      'Smash and grab',
      'NFP',
      'CPI',
      'PCE',
      'ISM',
      'GDP',
      'Retail Sales',
      'Jobless Claims',
      'EIA',
    ],
    mistakes: [
      'Chasing the first algorithmic spike without a target or stop.',
      'Trading data with no view on what consensus was.',
      'Fading too early. The algo move can extend before the discretionary leg starts.',
      'Not knowing how far a market typically moves on a specific data point, and trying for too much.',
      'Going into a data point with a position. This is essentially gambling.',
      'Guessing the number beforehand. It clouds your ability to react to the actual data.',
      'Not having a clear plan beforehand: what is out of line, what is worth trading, with markets and clip size pre-selected.',
    ],
    rubric: [
      {
        criterion: 'trigger',
        below: 'Did not check the calendar. Got caught by a release.',
        at: 'Knows the release, the consensus and the typical first reaction.',
        above: 'Pre-mapped the trade for both directions before the print.',
      },
      {
        criterion: 'sizing',
        below: 'Same size every release.',
        at: 'Sized to the surprise potential, not the headline.',
        above: 'Size and market selection deliberately varied by the data result.',
      },
      {
        criterion: 'exit',
        below: 'Holds losers hoping for the second leg.',
        at: 'Cuts on first invalidation of the thesis.',
        above: 'Scales out as the second leg matures; holds with trailing logic.',
      },
      {
        criterion: 'articulation',
        below: 'Says "NFP was strong" with no detail.',
        at: 'Names the print, the surprise, the cross-asset implication.',
        above: 'Connects this print to the next central bank meeting and the prior prints.',
      },
      {
        criterion: 'review',
        below: 'Tag missing.',
        at: 'Tagged with sub-tag; notes capture what surprised them.',
        above: 'Notes feed a template for the next release in the same series.',
      },
    ],
  },
  {
    id: 'news',
    index: 3,
    name: 'News — Geo-Macro',
    short: 'News',
    tagline: 'Unscheduled headlines and cross-asset moves',
    color: '#c98500',
    lookFor: [
      'Unscheduled headlines outside the data and central bank calendar.',
      'Escalation patterns: news, market reaction, counter-response or denial, new situation.',
      'The first 5 to 10 minute window before consensus interpretation forms.',
      'Theme and narrative classification: know where you are in the story.',
      'How you expect a market to react vs how it reacts.',
      'Correlation: which markets react best to different narratives, e.g. tariffs vs conflicts.',
    ],
    level1: 'The news creates the trade.',
    categories: [
      { id: 'terminal', label: 'Terminal', hint: 'News from Delta 1, you read it yourself' },
      { id: 'tv', label: 'TV', hint: 'News channels' },
      { id: 'social', label: 'Social', hint: 'X, Telegram, Truth, etc.' },
      { id: 'squawk', label: 'Squawk', hint: 'You reacted to the squawk rather than reading it yourself' },
    ],
    level3Suggestions: [
      'Risk-off',
      'Risk-on',
      'Smash & Grab',
      'Hit & Hold',
      'Fade',
      'Denial',
      'Old news',
      'Tariffs',
      'War',
      'Political',
    ],
    mistakes: [
      'Trading the headline without knowing how a market should react.',
      'Hesitating, missing the initial move, then chasing late.',
      'Oversizing without a good entry, e.g. entering once the move has already gone a typical distance.',
      'Sizing too small because the move feels uncertain, then dramatically increasing later in the move.',
      'Trading every headline. Most are noise. Edge lives in the few that change the regime.',
      'Not paying attention to correlation. If other markets are not moving, that is a warning sign for your position.',
    ],
    rubric: [
      {
        criterion: 'trigger',
        below: 'Sees the headline late or not at all.',
        at: 'Identifies the headline, knows how markets should react, picks appropriate assets.',
        above: 'Pre-mapped the scenario before it broke and acts with a clear expectation and management plan.',
      },
      {
        criterion: 'sizing',
        below: 'Same (max) size for every headline.',
        at: 'Sized to the regime-shift potential.',
        above: 'Scaled across multiple correlated assets in one move.',
      },
      {
        criterion: 'exit',
        below: 'Holds for hope as the story fades.',
        at: 'Exits at a pre-defined point, e.g. after a set time or on a break.',
        above: 'Pyramids on continuation; manages the position across multiple markets.',
      },
      {
        criterion: 'articulation',
        below: 'Cannot explain why this asset and not another.',
        at: 'Names the cross-asset logic clearly.',
        above: 'Can tell a re-pricing event from a variation in theme.',
      },
      {
        criterion: 'review',
        below: 'No tag.',
        at: 'Tagged with sub-tag and headline reference.',
        above: 'Notes feed a template for the next similar headline.',
      },
    ],
  },
  {
    id: 'technicals',
    index: 4,
    name: 'Technicals',
    short: 'Tech',
    tagline: 'The edge that supports every other domain',
    color: '#9085e9',
    lookFor: [
      'Market profile shape and expectations (P-shape, b-shape, normal distribution, double distribution).',
      'Specific order flow patterns: a chance for an opportunistic trade.',
      'Footprint reads showing aggressive buying or selling at a level.',
      'Patterns you have observed, documented, tested and could explain.',
      'Every trade has a clear entry, target and stop defined.',
      'Most explosive when volatility expands — VIX above 20, sweet spot above 25.',
    ],
    level1: 'Any trade based purely on technical tools.',
    categories: [
      { id: 'candlesticks', label: 'Candlesticks', hint: 'Patterns (flags, H+S), level breaks and bounces, trend breaks' },
      { id: 'profile', label: 'Profile', hint: 'IB breaks, elastic bands, cave fills' },
      { id: 'dom', label: 'DOM', hint: 'Momentum, icebergs, flippers, stops — pure order flow' },
      { id: 'footprint', label: 'Footprint', hint: 'Imbalances, absorption, delta flips and reversals' },
    ],
    level3Suggestions: [
      'Continuation',
      'Breakout',
      'Reversal',
      'VWAP',
      'EMA',
      'Fib',
      'Trend day',
      'Double distribution',
      'P-shape',
      'Neutral',
    ],
    mistakes: [
      'Entering a trade without a defined stop and target.',
      'Relying on one timeframe or one single setup in isolation.',
      'Using standardised size and/or fixed-size stops and targets.',
      'Not adapting to volatility. As volatility increases, opportunity frequency rises and so do target and stop sizes.',
      'Not considering a setup relative to broader context, e.g. playing a continuation or breakout on a clearly balanced day.',
    ],
    rubric: [
      {
        criterion: 'trigger',
        below: 'Names a setup but cannot define the trigger price.',
        at: 'Trigger, stop and target are defined before entry.',
        above: 'Multiple confluent reads (profile, DOM, footprint) align on the same trigger.',
      },
      {
        criterion: 'sizing',
        below: 'Same size every setup.',
        at: 'Sized to the distance to invalidation.',
        above: 'Size varies with tick risk and the probability of the trade working.',
      },
      {
        criterion: 'exit',
        below: 'Moves the stop wider when wrong, or to scratch when onside. Leaves runners with no objective.',
        at: 'Stop honoured. Targets defined and trades carried to them.',
        above: 'Actively manages the position, taking new information into account.',
      },
      {
        criterion: 'articulation',
        below: 'Says "it looked good."',
        at: 'Clear structure and reasoning to the trade.',
        above: 'Articulates why this setup works in this context and where it would not.',
      },
      {
        criterion: 'review',
        below: 'No tag.',
        at: 'Tagged with named play; screenshot saved.',
        above: 'Notes feed a template that compounds across similar setups.',
      },
    ],
  },
  {
    id: 'flow',
    index: 5,
    name: 'Flow Events',
    short: 'Flow',
    tagline: 'The survival edge when no other edge is in play',
    color: '#d55181',
    lookFor: [
      'Specific time-based windows where order flow changes, driven by larger participants needing to hedge, enter and exit positions.',
      'Bond auction windows: banks in the auction need to hedge their expected allocation.',
      'Option expiry (monthly and quarterly): writers hedge exposure while owners exit positions.',
      'Market opens: gaps and mis-pricing forcing new positioning, open range breaks (Globex and cash session opens).',
      'Market close imbalance window: flow as positions are exited and Market on Close (MOC) orders are entered.',
    ],
    level1: 'A flow-based trade that occurs at repeated times on a daily, weekly or monthly basis.',
    categories: [
      { id: 'auctions', label: 'Auctions', hint: 'Bond auction — the move into the auction and post-results' },
      { id: 'opex', label: 'OPEX', hint: 'Patterns and timings pre and post expiry (~15 min either side)' },
      { id: 'opens', label: 'Opens', hint: 'Rebalancing flow, typically the first 5 minutes' },
      { id: 'moc', label: 'MOC', hint: 'Close auction and rebalancing flow; MOC orders hit 2 min from cash close' },
    ],
    level3Suggestions: ['Long', 'Short', 'Chop', 'Pre-event', 'Post-event', 'Start time'],
    mistakes: [
      'Missing the auction window entirely.',
      'Forcing a trade. Not every flow window produces a tradeable opportunity; be sure the required flow is present.',
      'Not knowing previous patterns of movement.',
      'Relying on technicals. They can provide targets, but flow takes precedence in these periods.',
      'Being stubborn. If the flow changes, do not stay in the trade.',
    ],
    rubric: [
      {
        criterion: 'trigger',
        below: 'Did not know the auction was happening.',
        at: 'Knows the calendar and the typical patterns of flow events.',
        above: 'Pre-mapped flow windows; knows what the flow has to look like to participate.',
      },
      {
        criterion: 'sizing',
        below: 'Static sizing.',
        at: 'Adds to the position as flow indicates.',
        above: 'Dynamically sized; positions increased and reduced as the move progresses.',
      },
      {
        criterion: 'exit',
        below: 'Holds past the end of the flow event, or exits too soon after getting onside.',
        at: 'Exits at pre-defined, time-based stages.',
        above: 'Clear exit strategy, adapted to the flow with clear triggers for any change.',
      },
      {
        criterion: 'articulation',
        below: 'Cannot explain why the flow happens.',
        at: 'Names the flow event and what is expected.',
        above: 'Can define the nature of the flow needed to participate.',
      },
      {
        criterion: 'review',
        below: 'No tag.',
        at: 'Tagged with the flow-event sub-tag.',
        above: 'Notes track which flow events repeated edge and which did not.',
      },
    ],
  },
];

export const DOMAIN_MAP: Record<DomainId, EdgeDomain> = Object.fromEntries(
  DOMAINS.map((d) => [d.id, d]),
) as Record<DomainId, EdgeDomain>;

export function domainOf(id: string | null | undefined): EdgeDomain | null {
  if (!id) return null;
  return DOMAIN_MAP[id as DomainId] ?? null;
}

/** Match a free-text domain label ("Tech", "News", "Central Banks", "data"...) to a domain id. */
export function domainFromLabel(label: string | null | undefined): DomainId | null {
  if (!label) return null;
  const s = label.trim().toLowerCase();
  if (!s) return null;
  for (const d of DOMAINS) {
    if (s === d.id || s === d.short.toLowerCase() || s === d.name.toLowerCase()) return d.id;
  }
  if (s.includes('central') || s === 'cb') return 'central-banks';
  if (s.includes('data') || s.includes('econ')) return 'economic-data';
  if (s.includes('news') || s.includes('macro')) return 'news';
  if (s.includes('tech')) return 'technicals';
  if (s.includes('flow')) return 'flow';
  return null;
}

/** Match a free-text category label ("Candlesticks", "MOC", "presser"…) to a category id of a domain. */
export function categoryFromLabel(domainId: DomainId, label: string | null | undefined): string | null {
  if (!label) return null;
  const s = label.trim().toLowerCase();
  if (!s) return null;
  const d = DOMAIN_MAP[domainId];
  for (const c of d.categories) {
    if (s === c.id || s === c.label.toLowerCase()) return c.id;
  }
  return null;
}

export function categoryLabel(domainId: string | null | undefined, catId: string | null | undefined): string {
  const d = domainOf(domainId);
  if (!d || !catId) return catId ?? '';
  return d.categories.find((c) => c.id === catId)?.label ?? catId;
}
