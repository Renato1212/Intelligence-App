/*
 * instruments.ts — the contract spec sheet.
 *
 * A discretionary futures trader does arithmetic on every trade: how many ticks
 * is my stop, what is that worth per contract, how many contracts fit inside
 * today's risk, what is the notional I am actually carrying. Getting any of
 * that wrong is the expensive kind of mistake, and doing it in your head at the
 * ticket is how it goes wrong. This module holds the real specs for the futures
 * this platform covers and turns them into sizing answers.
 *
 * Hours are exchange time (ET). Point values agree with contracts.ts, which
 * stays the lightweight lookup used by the fill importers.
 */

export type InstrumentGroup = 'Equity index' | 'Rates' | 'FX' | 'Energy' | 'Metals' | 'Ags' | 'Crypto' | 'Vol';

export interface InstrumentSpec {
  root: string;
  name: string;
  exchange: string;
  group: InstrumentGroup;
  /** minimum price increment */
  tickSize: number;
  /** $ per tick, per contract */
  tickValue: number;
  /** $ per full point, per contract (= tickValue / tickSize) */
  pointValue: number;
  currency: string;
  /** regular trading hours in ET, "HH:MM" */
  rthOpen: string;
  rthClose: string;
  /** globex/electronic open in ET (the prior evening for most CME products) */
  globexOpen: string;
  /** the delivery months actually traded, as month codes */
  months: string;
  /** the smaller sibling for sizing down, when one exists */
  micro: string | null;
  /** liquid ETF/index proxy used for daily + intraday history */
  proxy: string | null;
  /** typical daily range in POINTS — a sanity anchor for stops and targets */
  typicalRange: number;
  /** what a trader needs to know about trading this specific contract */
  notes: string;
}

export const INSTRUMENTS: InstrumentSpec[] = [
  {
    root: 'ES', name: 'E-mini S&P 500', exchange: 'CME', group: 'Equity index',
    tickSize: 0.25, tickValue: 12.5, pointValue: 50, currency: 'USD',
    rthOpen: '09:30', rthClose: '16:00', globexOpen: '18:00', months: 'HMUZ',
    micro: 'MES', proxy: 'SPY', typicalRange: 60,
    notes: 'The reference contract for US risk. Deepest book of any equity index future — the tick is small relative to the range, so stops are about structure, not cost. RTH profile is the one that matters; the overnight session mostly stores inventory that gets corrected after 09:30.',
  },
  {
    root: 'NQ', name: 'E-mini Nasdaq 100', exchange: 'CME', group: 'Equity index',
    tickSize: 0.25, tickValue: 5, pointValue: 20, currency: 'USD',
    rthOpen: '09:30', rthClose: '16:00', globexOpen: '18:00', months: 'HMUZ',
    micro: 'MNQ', proxy: 'QQQ', typicalRange: 280,
    notes: 'Higher beta than ES and far more sensitive to real yields and mega-cap earnings. Range is ~4× ES in points but the point value is smaller — always size in DOLLARS, not contracts, when switching between them.',
  },
  {
    root: 'RTY', name: 'E-mini Russell 2000', exchange: 'CME', group: 'Equity index',
    tickSize: 0.1, tickValue: 5, pointValue: 50, currency: 'USD',
    rthOpen: '09:30', rthClose: '16:00', globexOpen: '18:00', months: 'HMUZ',
    micro: 'M2K', proxy: 'IWM', typicalRange: 30,
    notes: 'The domestic, rate-sensitive, credit-sensitive index. Thinner book than ES/NQ — respect the spread and avoid market orders into events. Leads on risk-appetite turns and on banking stress.',
  },
  {
    root: 'YM', name: 'E-mini Dow', exchange: 'CBOT', group: 'Equity index',
    tickSize: 1, tickValue: 5, pointValue: 5, currency: 'USD',
    rthOpen: '09:30', rthClose: '16:00', globexOpen: '18:00', months: 'HMUZ',
    micro: 'MYM', proxy: 'DIA', typicalRange: 450,
    notes: 'Price-weighted and only 30 names, so a single high-priced constituent can drive it. Useful as the value/defensive leg against NQ on rotation days.',
  },
  {
    root: 'ZN', name: '10-Year T-Note', exchange: 'CBOT', group: 'Rates',
    tickSize: 0.015625, tickValue: 15.625, pointValue: 1000, currency: 'USD',
    rthOpen: '08:20', rthClose: '15:00', globexOpen: '18:00', months: 'HMUZ',
    micro: null, proxy: 'IEF', typicalRange: 0.5,
    notes: 'Quoted in 32nds (half-32nds for ZN). THE honest leg on macro days: when equities and bonds disagree after a print, the bond move is the one to believe. Auction days (see Catalysts) create a concession into 13:00 ET.',
  },
  {
    root: 'ZB', name: '30-Year T-Bond', exchange: 'CBOT', group: 'Rates',
    tickSize: 0.03125, tickValue: 31.25, pointValue: 1000, currency: 'USD',
    rthOpen: '08:20', rthClose: '15:00', globexOpen: '18:00', months: 'HMUZ',
    micro: null, proxy: 'TLT', typicalRange: 1.2,
    notes: 'The long end — pure duration, so it reacts to term premium and fiscal news more than to the front-end policy path. Faster and thinner than ZN; size accordingly.',
  },
  {
    root: 'ZF', name: '5-Year T-Note', exchange: 'CBOT', group: 'Rates',
    tickSize: 0.0078125, tickValue: 7.8125, pointValue: 1000, currency: 'USD',
    rthOpen: '08:20', rthClose: '15:00', globexOpen: '18:00', months: 'HMUZ',
    micro: null, proxy: 'IEI', typicalRange: 0.3,
    notes: 'The belly — the cleanest expression of the market\'s view on the policy path over the cycle. Quiet until data days, then it moves first.',
  },
  {
    root: '6E', name: 'Euro FX', exchange: 'CME', group: 'FX',
    tickSize: 0.00005, tickValue: 6.25, pointValue: 125000, currency: 'USD',
    rthOpen: '08:20', rthClose: '15:00', globexOpen: '18:00', months: 'HMUZ',
    micro: 'M6E', proxy: 'FXE', typicalRange: 0.008,
    notes: 'The dollar\'s other side. Trades the RATE DIFFERENTIAL, so it responds to the gap between ECB and Fed repricing, not to either alone. The European morning is its real session — the US open is often a fade.',
  },
  {
    root: 'GC', name: 'Gold', exchange: 'COMEX', group: 'Metals',
    tickSize: 0.1, tickValue: 10, pointValue: 100, currency: 'USD',
    rthOpen: '08:20', rthClose: '13:30', globexOpen: '18:00', months: 'GJMQVZ',
    micro: 'MGC', proxy: 'GLD', typicalRange: 35,
    notes: 'Real yields and the dollar drive it day to day; geopolitics drives it in bursts that decay. The 08:20 ET open and the London fixes are the liquidity events — profiles built without them mislead.',
  },
  {
    root: 'CL', name: 'WTI Crude Oil', exchange: 'NYMEX', group: 'Energy',
    tickSize: 0.01, tickValue: 10, pointValue: 1000, currency: 'USD',
    rthOpen: '09:00', rthClose: '14:30', globexOpen: '18:00', months: 'all',
    micro: 'MCL', proxy: 'USO', typicalRange: 2.2,
    notes: 'The most headline-driven contract on this list, with its own weekly catalyst: EIA inventories, Wednesdays 10:30 ET. Rolls monthly — check the front month before every session. Trends hard and reverses harder.',
  },
  {
    root: 'NG', name: 'Natural Gas', exchange: 'NYMEX', group: 'Energy',
    tickSize: 0.001, tickValue: 10, pointValue: 10000, currency: 'USD',
    rthOpen: '09:00', rthClose: '14:30', globexOpen: '18:00', months: 'all',
    micro: 'QG', proxy: 'UNG', typicalRange: 0.18,
    notes: 'Weather-driven and violently volatile — the widow-maker. Weekly storage Thursdays 10:30 ET. Size at a fraction of what the tick value suggests; the range routinely triples.',
  },
  {
    root: 'SI', name: 'Silver', exchange: 'COMEX', group: 'Metals',
    tickSize: 0.005, tickValue: 25, pointValue: 5000, currency: 'USD',
    rthOpen: '08:25', rthClose: '13:25', globexOpen: '18:00', months: 'HKNUZ',
    micro: 'SIL', proxy: 'SLV', typicalRange: 0.9,
    notes: 'Gold\'s high-beta cousin with an industrial leg. Thinner and gappier than GC — the same dollar risk needs a wider stop and a smaller position.',
  },
  {
    root: 'HG', name: 'Copper', exchange: 'COMEX', group: 'Metals',
    tickSize: 0.0005, tickValue: 12.5, pointValue: 25000, currency: 'USD',
    rthOpen: '08:10', rthClose: '13:00', globexOpen: '18:00', months: 'HKNUZ',
    micro: 'MHG', proxy: 'CPER', typicalRange: 0.09,
    notes: 'The growth read — China property and grid demand set the tone, so the Asian session often does the work before the US open.',
  },
];

const BY_ROOT = new Map(INSTRUMENTS.map((i) => [i.root, i]));

export function instrumentFor(root: string): InstrumentSpec | null {
  return BY_ROOT.get(String(root || '').toUpperCase()) ?? null;
}

/**
 * Format a price the way the contract actually quotes it. The note complex
 * trades in 32nds: CME shows 110'165 for 110 + 16.5/32, where the trailing
 * digit is the first decimal of the sub-32nd (0.25→2, 0.5→5, 0.75→7).
 */
export function formatPrice(spec: InstrumentSpec, price: number): string {
  if (spec.group === 'Rates' && spec.tickSize < 0.05) {
    const whole = Math.floor(price);
    const thirtySeconds = (price - whole) * 32;
    const full = Math.floor(thirtySeconds + 1e-9);
    const digit = Math.floor((thirtySeconds - full + 1e-9) * 10);
    return `${whole}'${String(full).padStart(2, '0')}${digit > 0 ? digit : ''}`;
  }
  // decimals come from the tick's own precision (0.25 → 2, not 1)
  const s = String(spec.tickSize);
  const dot = s.indexOf('.');
  return price.toFixed(dot < 0 ? 0 : s.length - dot - 1);
}

export function ticksBetween(spec: InstrumentSpec, a: number, b: number): number {
  return Math.round(Math.abs(a - b) / spec.tickSize);
}

/* ------------------------------- sizing ---------------------------------- */

export interface SizeRequest {
  spec: InstrumentSpec;
  /** the $ you are willing to lose on this trade */
  riskBudget: number;
  /** entry and stop as prices — the honest way to size (structure first) */
  entry: number;
  stop: number;
  /** optional target, for the R-multiple read */
  target?: number | null;
  /** cap so a wide-stop idea can't quietly become a huge position */
  maxContracts?: number;
}

export interface SizeResult {
  contracts: number;
  stopTicks: number;
  stopPoints: number;
  riskPerContract: number;
  totalRisk: number;
  /** what one tick of adverse movement costs at this size */
  tickCost: number;
  notional: number;
  rMultiple: number | null;
  /** the sibling suggestion when the full-size contract doesn't fit */
  microSuggestion: string | null;
  warnings: string[];
}

/**
 * Structure-first sizing: you choose where the trade is wrong, the engine
 * chooses how many contracts that allows. It never rounds up, and it says out
 * loud when the answer is "this trade doesn't fit — trade the micro or skip it".
 */
export function sizePosition(req: SizeRequest): SizeResult {
  const { spec, riskBudget, entry, stop } = req;
  const warnings: string[] = [];
  const stopPoints = Math.abs(entry - stop);
  const stopTicks = Math.round(stopPoints / spec.tickSize);
  const riskPerContract = stopTicks * spec.tickValue;

  let contracts = 0;
  if (riskPerContract > 0 && riskBudget > 0) contracts = Math.floor(riskBudget / riskPerContract);
  if (req.maxContracts != null) contracts = Math.min(contracts, Math.max(0, Math.floor(req.maxContracts)));

  if (stopTicks === 0) warnings.push('Entry and stop are the same price — there is no trade to size.');
  else if (stopTicks <= 2) warnings.push(`A ${stopTicks}-tick stop is inside the noise on ${spec.root}. It will be taken out by the spread, not by being wrong.`);
  if (stopPoints > spec.typicalRange * 0.75 && spec.typicalRange > 0) {
    warnings.push(`That stop is ${Math.round((stopPoints / spec.typicalRange) * 100)}% of a typical ${spec.root} day range — either the idea needs a closer invalidation or it is a swing, not an intraday trade.`);
  }
  if (contracts === 0 && riskPerContract > 0) {
    warnings.push(`One ${spec.root} contract risks $${riskPerContract.toFixed(0)}, which is more than the $${riskBudget.toFixed(0)} budget. Do not "just take one" — that is how a risk limit becomes a suggestion.`);
  }
  const microSuggestion =
    contracts === 0 && spec.micro && riskPerContract > 0
      ? `${Math.floor(riskBudget / (riskPerContract / 10))} × ${spec.micro} carries the same idea at 1/10 the size.`
      : null;

  const rMultiple = req.target != null && stopPoints > 0 ? Math.abs(req.target - entry) / stopPoints : null;
  if (rMultiple != null && rMultiple < 1) warnings.push(`Target is only ${rMultiple.toFixed(2)}R from entry — you need a very high hit rate to make sub-1R trades pay.`);

  return {
    contracts,
    stopTicks,
    stopPoints,
    riskPerContract,
    totalRisk: contracts * riskPerContract,
    tickCost: contracts * spec.tickValue,
    notional: contracts * entry * spec.pointValue,
    rMultiple,
    microSuggestion,
    warnings,
  };
}

/** Front-month code for a contract on a given date (e.g. ES → "ESZ6"). */
export function frontMonth(spec: InstrumentSpec, now = new Date()): string {
  const CODES = 'FGHJKMNQUVXZ';
  const months = spec.months === 'all' ? CODES : spec.months;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let ahead = 0; ahead < 14; ahead++) {
    const idx = (m + ahead) % 12;
    const year = y + Math.floor((m + ahead) / 12);
    const code = CODES[idx];
    if (months.includes(code)) return `${spec.root}${code}${String(year).slice(3)}`;
  }
  return spec.root;
}
