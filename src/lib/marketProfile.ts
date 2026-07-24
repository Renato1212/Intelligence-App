/*
 * marketProfile.ts — the auction engine.
 *
 * Axia's technical domain is Market Profile, order flow and volume analysis.
 * Everywhere else the platform lets a trader WRITE about the profile; this
 * module COMPUTES it: TPO and volume distributions from intraday bars, value
 * area and point of control, the initial balance and its extensions, the day
 * type, the open type, how today's value sits against yesterday's, the single
 * prints, tails and poor extremes — and the trading implication of each.
 *
 * The vocabulary follows Steidlmayer/Dalton as taught on the Axia programme,
 * because those are the words the trader is already thinking in. Everything is
 * pure and deterministic: feed it bars, get the auction read back.
 */

export interface IntradayBar {
  /** "YYYY-MM-DD HH:MM:SS" in exchange time (ET for US futures/ETF proxies) */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/* --------------------------- bucketing helpers ---------------------------- */

/**
 * Profile row height. A profile is only readable at ~30–60 rows, so instead of
 * one row per tick (ES would be 200+ rows) we pick the nearest "nice" bucket
 * (1, 2, 2.5, 5 × 10^n) that lands in that band. Same logic a chart package
 * uses for axis ticks, applied to the price axis of the profile.
 */
export function autoBucket(range: number, targetRows = 45): number {
  if (!(range > 0)) return 0.25;
  const raw = range / targetRows;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

export function bucketOf(price: number, bucket: number): number {
  return Math.round(Math.floor(price / bucket + 1e-9) * bucket * 1e6) / 1e6;
}

/** TPO period letters: A–Z then a–z, so a 26-bracket day never collides. */
export function periodLetter(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  if (index < 52) return String.fromCharCode(97 + (index - 26));
  return '#';
}

function minutesOfDay(time: string): number {
  const m = /(\d{2}):(\d{2})/.exec(time.slice(11));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Split a flat bar array into sessions keyed by their date (ascending). */
export function groupSessions(bars: IntradayBar[]): Map<string, IntradayBar[]> {
  const out = new Map<string, IntradayBar[]>();
  for (const b of bars) {
    const day = b.time.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const list = out.get(day);
    if (list) list.push(b);
    else out.set(day, [b]);
  }
  for (const list of out.values()) list.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}

/* ------------------------------ the profile ------------------------------- */

export interface TpoRow {
  price: number;
  /** the period letters that traded this row, in order */
  letters: string;
  tpoCount: number;
  volume: number;
  /** true when only one period printed here (a single print) */
  single: boolean;
}

export type DayType =
  | 'trend'
  | 'double-distribution'
  | 'normal'
  | 'normal-variation'
  | 'neutral-center'
  | 'neutral-extreme'
  | 'non-trend'
  | 'incomplete';

export type OpenType = 'open-drive' | 'open-test-drive' | 'open-rejection-reverse' | 'open-auction' | 'unknown';

export interface Extremes {
  /**
   * A tail (excess) = 2+ buckets of single prints at the extreme that the
   * market then moved AWAY from. Single prints left by the final bracket are
   * not excess — the auction was still running there when the bell went.
   */
  buyingTailTicks: number;
  sellingTailTicks: number;
  /** poor = the extreme printed by 2+ periods with no tail — unfinished business */
  poorHigh: boolean;
  poorLow: boolean;
  /** the session ended AT this extreme: unfinished, not rejected */
  highAtClose: boolean;
  lowAtClose: boolean;
}

export interface SessionProfile {
  date: string;
  bucket: number;
  rows: TpoRow[];
  /** number of 30-minute brackets that printed */
  periods: number;
  open: number;
  close: number;
  high: number;
  low: number;
  range: number;
  totalVolume: number;
  /** TPO point of control (fairest price by time) */
  poc: number;
  vah: number;
  val: number;
  /** volume point of control (fairest price by trade) */
  vpoc: number;
  /** initial balance — the first two 30-minute brackets */
  ibHigh: number;
  ibLow: number;
  ibRange: number;
  /** range extension beyond the IB, in price */
  extUp: number;
  extDown: number;
  /** day range ÷ IB range — the classic day-type discriminator */
  rangeVsIb: number;
  /** where the close sits in the day range, 0 (low) … 1 (high) */
  closePosition: number;
  dayType: DayType;
  openType: OpenType;
  /** single-print buckets inside the body (auction gaps that act as magnets) */
  singlePrints: number[];
  extremes: Extremes;
}

/** TPO value area: expand from the POC, always taking the heavier neighbour. */
export function tpoValueArea(rows: TpoRow[], coverage = 0.7): { poc: number; vah: number; val: number } {
  if (!rows.length) return { poc: 0, vah: 0, val: 0 };
  const total = rows.reduce((s, r) => s + r.tpoCount, 0);
  // POC = most-printed row; ties resolve toward the middle of the range
  const mid = (rows[0].price + rows[rows.length - 1].price) / 2;
  let pocIdx = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const best = rows[pocIdx];
    if (r.tpoCount > best.tpoCount || (r.tpoCount === best.tpoCount && Math.abs(r.price - mid) < Math.abs(best.price - mid))) {
      pocIdx = i;
    }
  }
  let lo = pocIdx;
  let hi = pocIdx;
  let acc = rows[pocIdx].tpoCount;
  const target = total * coverage;
  while (acc < target && (lo > 0 || hi < rows.length - 1)) {
    const below = lo > 0 ? rows[lo - 1].tpoCount : -1;
    const above = hi < rows.length - 1 ? rows[hi + 1].tpoCount : -1;
    if (above >= below && hi < rows.length - 1) {
      hi++;
      acc += rows[hi].tpoCount;
    } else if (lo > 0) {
      lo--;
      acc += rows[lo].tpoCount;
    } else break;
  }
  return { poc: rows[pocIdx].price, vah: rows[hi].price, val: rows[lo].price };
}

/**
 * Open type — how the session began, which is the single best early read on
 * whether the day's direction will hold (Dalton). Measured against the IB so
 * the thresholds travel across instruments.
 */
export function classifyOpenType(bars: IntradayBar[], ibRange: number): OpenType {
  if (bars.length < 2 || !(ibRange > 0)) return 'unknown';
  const open = bars[0].open;
  const drive = ibRange * 0.45; // "meaningful" displacement from the open
  const early = bars.slice(0, Math.min(4, bars.length)); // first ~2 hours of 30m bars
  const hi = Math.max(...early.map((b) => b.high));
  const lo = Math.min(...early.map((b) => b.low));
  const upMove = hi - open;
  const downMove = open - lo;

  // Open-Drive: goes one way immediately and never trades back through the open
  const firstTwo = bars.slice(0, 2);
  const twoHi = Math.max(...firstTwo.map((b) => b.high));
  const twoLo = Math.min(...firstTwo.map((b) => b.low));
  if (twoHi - open >= drive && open - twoLo <= ibRange * 0.1) return 'open-drive';
  if (open - twoLo >= drive && twoHi - open <= ibRange * 0.1) return 'open-drive';

  // Open-Rejection-Reverse: displaces one way, then trades back THROUGH the
  // open and takes out the other side by a similar amount
  if (upMove >= drive && downMove >= drive) {
    const hiFirst = early.findIndex((b) => b.high >= open + drive);
    const loFirst = early.findIndex((b) => b.low <= open - drive);
    if (hiFirst >= 0 && loFirst >= 0 && hiFirst !== loFirst) return 'open-rejection-reverse';
  }

  // Open-Test-Drive: probes against the eventual direction first (a small test),
  // rejects it, then drives the other way past the open
  const testUp = open - bars[0].low;
  const testDown = bars[0].high - open;
  const laterHi = Math.max(...bars.slice(1, 4).map((b) => b.high));
  const laterLo = Math.min(...bars.slice(1, 4).map((b) => b.low));
  if (testUp > 0 && testUp < drive && laterHi - open >= drive) return 'open-test-drive';
  if (testDown > 0 && testDown < drive && open - laterLo >= drive) return 'open-test-drive';

  return 'open-auction';
}

/** Build the complete auction picture for one session. */
export function buildProfile(bars: IntradayBar[], opts: { bucket?: number; date?: string } = {}): SessionProfile | null {
  const clean = bars.filter((b) => isFinite(b.high) && isFinite(b.low) && b.high >= b.low);
  if (clean.length < 2) return null;
  const date = opts.date ?? clean[0].time.slice(0, 10);
  const high = Math.max(...clean.map((b) => b.high));
  const low = Math.min(...clean.map((b) => b.low));
  const range = high - low;
  const bucket = opts.bucket ?? autoBucket(range);
  if (!(bucket > 0)) return null;

  // group bars into 30-minute TPO brackets from the session's first bar
  const startMin = minutesOfDay(clean[0].time);
  const byPeriod = new Map<number, IntradayBar[]>();
  for (const b of clean) {
    const p = Math.max(0, Math.floor((minutesOfDay(b.time) - startMin) / 30));
    const list = byPeriod.get(p);
    if (list) list.push(b);
    else byPeriod.set(p, [b]);
  }
  const periodKeys = [...byPeriod.keys()].sort((a, b) => a - b);

  // paint each bracket's price span onto the profile rows
  const rowMap = new Map<number, { letters: string[]; volume: number }>();
  periodKeys.forEach((p, i) => {
    const list = byPeriod.get(p)!;
    const pHigh = Math.max(...list.map((b) => b.high));
    const pLow = Math.min(...list.map((b) => b.low));
    const vol = list.reduce((s, b) => s + (b.volume ?? 0), 0);
    const first = bucketOf(pLow, bucket);
    const last = bucketOf(pHigh, bucket);
    const steps = Math.max(0, Math.round((last - first) / bucket));
    const perRow = steps + 1;
    for (let k = 0; k <= steps; k++) {
      const price = Math.round((first + k * bucket) * 1e6) / 1e6;
      const cur = rowMap.get(price) ?? { letters: [], volume: 0 };
      cur.letters.push(periodLetter(i));
      cur.volume += vol / perRow;
      rowMap.set(price, cur);
    }
  });

  const rows: TpoRow[] = [...rowMap.entries()]
    .map(([price, v]) => ({ price, letters: v.letters.join(''), tpoCount: v.letters.length, volume: Math.round(v.volume), single: v.letters.length === 1 }))
    .sort((a, b) => a.price - b.price);
  if (!rows.length) return null;

  const { poc, vah, val } = tpoValueArea(rows);
  const vpoc = rows.reduce((best, r) => (r.volume > best.volume ? r : best), rows[0]).price;

  // initial balance = first two 30-minute brackets
  const ibBars = periodKeys.slice(0, 2).flatMap((p) => byPeriod.get(p)!);
  const ibHigh = ibBars.length ? Math.max(...ibBars.map((b) => b.high)) : high;
  const ibLow = ibBars.length ? Math.min(...ibBars.map((b) => b.low)) : low;
  const ibRange = ibHigh - ibLow;
  const extUp = Math.max(0, high - ibHigh);
  const extDown = Math.max(0, ibLow - low);
  const rangeVsIb = ibRange > 0 ? range / ibRange : 0;
  const open = clean[0].open;
  const close = clean[clean.length - 1].close;
  const closePosition = range > 0 ? (close - low) / range : 0.5;

  // single prints inside the body (excluding the extremes, which are tails)
  const singlePrints = rows.filter((r, i) => r.single && i > 0 && i < rows.length - 1).map((r) => r.price);

  /*
   * Tails / excess at the extremes. Excess only counts as rejection when the
   * market moved away from it: single prints written by the LAST bracket mean
   * the auction was still working there at the bell, which is unfinished
   * business (a target next session), not a defended level.
   */
  const lastLetter = periodLetter(periodKeys.length - 1);
  // both conditions must hold: the closing bracket printed the extreme AND the
  // close finished there. A last bracket that tags the high and then sells off
  // DID move away — that is a genuine (poor) extreme, not unfinished business.
  const highAtClose = rows[rows.length - 1].letters.includes(lastLetter) && closePosition >= 0.75;
  const lowAtClose = rows[0].letters.includes(lastLetter) && closePosition <= 0.25;
  let sellingTail = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].single; i--) sellingTail++;
  let buyingTail = 0;
  for (let i = 0; i < rows.length && rows[i].single; i++) buyingTail++;
  const extremes: Extremes = {
    buyingTailTicks: lowAtClose ? 0 : buyingTail,
    sellingTailTicks: highAtClose ? 0 : sellingTail,
    poorHigh: !highAtClose && sellingTail === 0 && rows[rows.length - 1].tpoCount >= 2,
    poorLow: !lowAtClose && buyingTail === 0 && rows[0].tpoCount >= 2,
    highAtClose,
    lowAtClose,
  };

  const dayType = classifyDayType({ rangeVsIb, extUp, extDown, ibRange, closePosition, rows, periods: periodKeys.length });
  const openType = classifyOpenType(clean, ibRange);

  return {
    date,
    bucket,
    rows,
    periods: periodKeys.length,
    open,
    close,
    high,
    low,
    range,
    totalVolume: clean.reduce((s, b) => s + (b.volume ?? 0), 0),
    poc,
    vah,
    val,
    vpoc,
    ibHigh,
    ibLow,
    ibRange,
    extUp,
    extDown,
    rangeVsIb,
    closePosition,
    dayType,
    openType,
    singlePrints,
    extremes,
  };
}

/**
 * Day type. The order matters: neutral (both-sided extension) is checked before
 * the range ratios, because a neutral day can have any ratio and means
 * something completely different — two-sided responsive trade, not initiative.
 */
export function classifyDayType(i: {
  rangeVsIb: number;
  extUp: number;
  extDown: number;
  ibRange: number;
  closePosition: number;
  rows: TpoRow[];
  periods: number;
}): DayType {
  if (i.periods < 4 || !(i.ibRange > 0)) return 'incomplete';
  const bothSides = i.extUp > 0 && i.extDown > 0;
  if (bothSides) return i.closePosition >= 0.8 || i.closePosition <= 0.2 ? 'neutral-extreme' : 'neutral-center';
  if (i.rangeVsIb >= 2 && (i.closePosition >= 0.75 || i.closePosition <= 0.25)) {
    return hasDoubleDistribution(i.rows) ? 'double-distribution' : 'trend';
  }
  if (i.rangeVsIb <= 1.15) return i.rangeVsIb <= 1.02 && i.periods >= 10 ? 'non-trend' : 'normal';
  return 'normal-variation';
}

/**
 * A double-distribution day leaves two fat clusters joined by a thin band of
 * single prints — price ran from one area of acceptance to another. Detected as
 * a run of single prints in the middle third with real distributions each side.
 */
export function hasDoubleDistribution(rows: TpoRow[]): boolean {
  if (rows.length < 9) return false;
  const from = Math.floor(rows.length * 0.2);
  const to = Math.ceil(rows.length * 0.8);
  let run = 0;
  let best = 0;
  let bestEnd = -1;
  for (let i = from; i < to; i++) {
    if (rows[i].tpoCount <= 1) {
      run++;
      if (run > best) {
        best = run;
        bestEnd = i;
      }
    } else run = 0;
  }
  if (best < 2 || bestEnd < 0) return false;
  const gapStart = bestEnd - best + 1;
  const belowMax = Math.max(...rows.slice(0, gapStart).map((r) => r.tpoCount), 0);
  const aboveMax = Math.max(...rows.slice(bestEnd + 1).map((r) => r.tpoCount), 0);
  return belowMax >= 3 && aboveMax >= 3;
}

/* ------------------------ day-over-day relationships ---------------------- */

export type ValueRelation = 'higher' | 'lower' | 'overlapping-higher' | 'overlapping-lower' | 'inside' | 'outside' | 'unchanged';
export type OpenLocation = 'above-value' | 'below-value' | 'inside-value' | 'above-range' | 'below-range';

/** Where today's value area sits relative to yesterday's. */
export function valueRelation(today: { vah: number; val: number }, prior: { vah: number; val: number }): ValueRelation {
  const overlap = Math.min(today.vah, prior.vah) - Math.max(today.val, prior.val);
  const todayHeight = today.vah - today.val;
  const priorHeight = prior.vah - prior.val;
  if (overlap <= 0) return today.val > prior.vah ? 'higher' : 'lower';
  if (today.val >= prior.val && today.vah <= prior.vah && todayHeight < priorHeight * 0.95) return 'inside';
  if (today.val <= prior.val && today.vah >= prior.vah && todayHeight > priorHeight * 1.05) return 'outside';
  const shift = (today.vah + today.val) / 2 - (prior.vah + prior.val) / 2;
  if (Math.abs(shift) < priorHeight * 0.1) return 'unchanged';
  return shift > 0 ? 'overlapping-higher' : 'overlapping-lower';
}

/** Where the open printed relative to yesterday's value and range. */
export function openLocation(open: number, prior: { vah: number; val: number; high: number; low: number }): OpenLocation {
  if (open > prior.high) return 'above-range';
  if (open < prior.low) return 'below-range';
  if (open > prior.vah) return 'above-value';
  if (open < prior.val) return 'below-value';
  return 'inside-value';
}

/* ------------------------------- the read --------------------------------- */

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  trend: 'Trend day',
  'double-distribution': 'Double-distribution trend day',
  normal: 'Normal day',
  'normal-variation': 'Normal variation day',
  'neutral-center': 'Neutral day (closed centre)',
  'neutral-extreme': 'Neutral extreme day',
  'non-trend': 'Non-trend day',
  incomplete: 'Session incomplete',
};

export const DAY_TYPE_MEANING: Record<DayType, string> = {
  trend: 'One-timeframe control from the open: the initiating side never let price back. Range ran 2×+ the initial balance and the close held the extreme. Trend days are for holding, not scalping — the mistake is taking profit at the first target and spending the rest of the day watching it go.',
  'double-distribution': 'Price left one area of acceptance, ran through a thin band of single prints, and built a second distribution. Those single prints are the day\'s spine: while they hold, the new distribution is valid — a return through them says the move was rejected.',
  normal: 'The first hour set the day. A wide initial balance with almost no extension means the auction found both parties early: responsive trade between the extremes, fade the edges, and distrust breakouts that come late in the session.',
  'normal-variation': 'The initial balance was probed and extended roughly one IB-width — the most common day. Direction was chosen after the first hour, so the IB extreme that broke is the reference: it should now hold on a retest.',
  'neutral-center': 'Both sides of the initial balance were extended and price closed in the middle — the two-sided fight ended unresolved. Neutral-centre days are the market saying "no decision"; the following session frequently resolves the imbalance, so mark both extremes.',
  'neutral-extreme': 'Both extremes were probed but one side won late and the close held that extreme — the losing side got trapped. Neutral-extreme closes are the strongest single-day continuation signal in the profile toolkit: the trapped side has to cover.',
  'non-trend': 'A tiny, coiled range with no extension — no one had conviction. These days store energy: expect the expansion out of this balance to be larger and faster than the range suggests, and trade the break rather than the middle.',
  incomplete: 'Not enough brackets have printed yet to classify the day. Reads based on a partial profile are provisional — the initial balance is only complete one hour in.',
};

export const OPEN_TYPE_LABEL: Record<OpenType, string> = {
  'open-drive': 'Open-Drive',
  'open-test-drive': 'Open-Test-Drive',
  'open-rejection-reverse': 'Open-Rejection-Reverse',
  'open-auction': 'Open-Auction',
  unknown: 'Open unclassified',
};

export const OPEN_TYPE_MEANING: Record<OpenType, string> = {
  'open-drive': 'The strongest open there is: one side committed at the bell and never allowed trade back through the open. Conviction is highest here — the open itself becomes the day\'s line in the sand, and a trade back through it is the signal you were wrong, not a better entry.',
  'open-test-drive': 'The market tested a level first, rejected it, and then drove the other way. Nearly as strong as an open-drive and often a better entry: the test gives you a defined, tight invalidation at the rejected extreme.',
  'open-rejection-reverse': 'Price drove one way, found no acceptance and reversed back through the open. The initiating side is trapped; the reversal typically runs further than expected because those positions have to come off. Trade with the reversal, not the first drive.',
  'open-auction': 'Rotation around the open with no commitment. Inside yesterday\'s value this is the lowest-conviction open — expect balance and fade the extremes. Outside yesterday\'s value it matters more: an unconvinced open away from value often gets pulled back toward it.',
  unknown: 'Not enough early data to classify the open.',
};

export const VALUE_RELATION_MEANING: Record<ValueRelation, string> = {
  higher: 'Value migrated entirely higher with no overlap — an unambiguous upward repricing. Buyers were willing to pay above yesterday\'s whole value area. Pullbacks into the top of yesterday\'s value are the trade; acceptance back inside it kills the thesis.',
  lower: 'Value migrated entirely lower with no overlap — an unambiguous downward repricing. Sellers were accepted below all of yesterday\'s value. Rallies into the bottom of yesterday\'s value are the trade.',
  'overlapping-higher': 'Value shifted up while still overlapping yesterday\'s — the normal, healthy way an uptrend advances. Slower and more sustainable than a full migration; the overlap area is support while the shift continues.',
  'overlapping-lower': 'Value shifted down while overlapping yesterday\'s — the normal way a downtrend advances. The overlap is resistance while the shift continues.',
  inside: 'Today\'s value sits entirely inside yesterday\'s — a balancing, energy-storing session. Inside value is a coiled spring: trade the break of the containing range rather than the middle, and expect the expansion to be larger than this range implies.',
  outside: 'Today\'s value engulfed yesterday\'s on both sides — a wide, two-sided auction that resolved nothing but widened the accepted range. Both extremes now matter as references.',
  unchanged: 'Value is effectively unchanged — the market re-auctioned the same prices and agreed with yesterday. Balance: responsive trade at the edges, and a real catalyst is required to break it.',
};

export const OPEN_LOCATION_MEANING: Record<OpenLocation, string> = {
  'above-value': 'Opened above yesterday\'s value but inside its range — the market is testing higher prices. Acceptance (time spent) above value confirms the move; rejection back into value sets up a rotation to the other side.',
  'below-value': 'Opened below yesterday\'s value but inside its range — testing lower prices. Acceptance below value confirms; rejection back inside sets up a rotation up through value.',
  'inside-value': 'Opened inside yesterday\'s value — the lowest-energy start. The market agrees with yesterday, so expect rotation until something forces a decision; the value extremes are the reference points.',
  'above-range': 'Gapped above yesterday\'s entire range. Two outcomes only: acceptance (the gap holds and becomes support — trade with it) or rejection (the gap fills — trade the fill). The first hour decides which, and the gap edge is the arbiter.',
  'below-range': 'Gapped below yesterday\'s entire range. Same binary: acceptance makes the gap edge resistance, rejection means a fill. Let the open\'s first hour tell you which before committing.',
};

export interface ProfileLevel {
  label: string;
  price: number;
  kind: 'value' | 'balance' | 'extreme' | 'gap';
  why: string;
}

/** The reference prices to carry into the session, in trade-ready language. */
export function profileLevels(p: SessionProfile, prior?: SessionProfile | null): ProfileLevel[] {
  const out: ProfileLevel[] = [
    { label: 'POC (time)', price: p.poc, kind: 'value', why: 'Fairest price by time — the magnet. Auctions return here when direction fails.' },
    { label: 'Value high', price: p.vah, kind: 'value', why: 'Top of accepted value. Rejection here turns the session back down; acceptance above opens the range.' },
    { label: 'Value low', price: p.val, kind: 'value', why: 'Bottom of accepted value. The mirror of the value high.' },
    { label: 'IB high', price: p.ibHigh, kind: 'balance', why: 'Initial balance high. Extension above it is initiative buying; on a retest it should hold.' },
    { label: 'IB low', price: p.ibLow, kind: 'balance', why: 'Initial balance low. Extension below is initiative selling.' },
    {
      label: 'Session high',
      price: p.high,
      kind: 'extreme',
      why: p.extremes.highAtClose
        ? 'UNFINISHED — the session closed at this high, so the prints there are the auction still running, not rejection. A target next session, not a level to fade.'
        : p.extremes.poorHigh
          ? 'POOR HIGH — printed by multiple periods with no excess. Unfinished business; expect it revisited.'
          : 'Session high with excess above it — the auction finished there.',
    },
    {
      label: 'Session low',
      price: p.low,
      kind: 'extreme',
      why: p.extremes.lowAtClose
        ? 'UNFINISHED — the session closed at this low. The prints there are the closing bracket, not excess; expect it probed again.'
        : p.extremes.poorLow
          ? 'POOR LOW — no tail beneath it. Unfinished business; expect it revisited.'
          : 'Session low with excess beneath it — the auction finished there.',
    },
  ];
  if (p.vpoc !== p.poc) {
    out.push({ label: 'Volume POC', price: p.vpoc, kind: 'value', why: 'Fairest price by traded volume. When it sits away from the time POC, the heavier one is the real magnet.' });
  }
  for (const sp of p.singlePrints.slice(0, 3)) {
    out.push({ label: 'Single prints', price: sp, kind: 'gap', why: 'An area price ran through without auctioning. Acts as a magnet on the way back and as a shelf while it holds.' });
  }
  if (prior) {
    out.push({ label: 'Prior POC', price: prior.poc, kind: 'value', why: 'Yesterday\'s fairest price — the first target when today\'s direction fails.' });
    out.push({ label: 'Prior value high', price: prior.vah, kind: 'value', why: 'Yesterday\'s value high: the reference that decides whether today is a higher-value day.' });
    out.push({ label: 'Prior value low', price: prior.val, kind: 'value', why: 'Yesterday\'s value low: the mirror reference.' });
  }
  return out;
}

export interface AuctionRead {
  headline: string;
  /** the ordered narrative: open → structure → value → what it implies */
  lines: string[];
  /** concrete "if X then Y" statements for the next session */
  plan: string[];
}

/** The full teaching read of one session, in the trader's own vocabulary. */
export function auctionRead(p: SessionProfile, prior?: SessionProfile | null): AuctionRead {
  const lines: string[] = [];
  const plan: string[] = [];
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2));

  lines.push(`${OPEN_TYPE_LABEL[p.openType]} — ${OPEN_TYPE_MEANING[p.openType]}`);
  lines.push(`${DAY_TYPE_LABEL[p.dayType]} — ${DAY_TYPE_MEANING[p.dayType]}`);
  lines.push(
    `Structure: initial balance ${fmt(p.ibLow)}–${fmt(p.ibHigh)} (${fmt(p.ibRange)} wide), day range ${fmt(p.range)} = ${p.rangeVsIb.toFixed(2)}× IB, ` +
      `${p.extUp > 0 ? `extended ${fmt(p.extUp)} above` : 'no extension above'} and ${p.extDown > 0 ? `${fmt(p.extDown)} below` : 'none below'}. ` +
      `Value ${fmt(p.val)}–${fmt(p.vah)} around a POC of ${fmt(p.poc)}; the close finished at ${Math.round(p.closePosition * 100)}% of the range.`,
  );

  if (prior) {
    const rel = valueRelation(p, prior);
    const loc = openLocation(p.open, prior);
    lines.push(`Value vs yesterday — ${rel.replace('-', ' ')}: ${VALUE_RELATION_MEANING[rel]}`);
    lines.push(`The open — ${loc.replace('-', ' ')}: ${OPEN_LOCATION_MEANING[loc]}`);
  }

  const tail = p.extremes;
  if (tail.buyingTailTicks >= 2) lines.push(`Buying tail of ${tail.buyingTailTicks} rows at the low — responsive buyers rejected those prices outright. That low is defended; it is the reference for longs until it breaks.`);
  if (tail.sellingTailTicks >= 2) lines.push(`Selling tail of ${tail.sellingTailTicks} rows at the high — responsive sellers rejected those prices. That high is defended.`);
  if (tail.highAtClose) {
    lines.push(`The session ended AT the high (${fmt(p.high)}) — the prints up there belong to the closing bracket, so they are the auction still running, not rejection. Treat that high as unfinished: it is a target on the next session, not a level to fade.`);
    plan.push(`Close at the high: the auction never finished above ${fmt(p.high)}. Expect an early probe higher next session; the failure of that probe is the short, and its acceptance is the continuation.`);
  }
  if (tail.lowAtClose) {
    lines.push(`The session ended AT the low (${fmt(p.low)}) — those prints are the closing bracket, not excess. The low is unfinished business rather than a defended level.`);
    plan.push(`Close at the low: expect an early probe beneath ${fmt(p.low)} next session — its failure is the long, its acceptance the continuation.`);
  }
  if (tail.poorHigh) plan.push(`The high (${fmt(p.high)}) is POOR — no excess above it. Expect the market to return and finish that auction; a clean sweep of it is the trade, not a breakout to chase.`);
  if (tail.poorLow) plan.push(`The low (${fmt(p.low)}) is POOR — no excess beneath it. Expect it revisited and taken out cleanly.`);
  if (p.singlePrints.length) plan.push(`Single prints at ${p.singlePrints.slice(0, 3).map(fmt).join(', ')} — while they hold they are a shelf; once price trades back into them it usually travels the whole band quickly.`);

  // day-type specific plans
  if (p.dayType === 'trend' || p.dayType === 'double-distribution') {
    plan.push(`Trend-day follow-on: the open (${fmt(p.open)}) and POC (${fmt(p.poc)}) are the two references. Continuation opens above value and stays there; failure trades straight back to the POC.`);
  } else if (p.dayType === 'normal' || p.dayType === 'non-trend') {
    plan.push(`Balance rules apply: fade ${fmt(p.vah)} and ${fmt(p.val)} back toward ${fmt(p.poc)} while the range holds. The trade is the BREAK of this balance with acceptance outside — take it on the retest, not the first print.`);
  } else if (p.dayType === 'neutral-center') {
    plan.push(`Unresolved: both ${fmt(p.high)} and ${fmt(p.low)} were probed and rejected. Mark both — the next session usually resolves one of them, and that resolution is the day's move.`);
  } else if (p.dayType === 'neutral-extreme') {
    plan.push(`Trapped side: the close at ${Math.round(p.closePosition * 100)}% of the range means one side is offside overnight. Continuation in the close's direction is the highest-probability follow-on in the profile toolkit.`);
  } else if (p.dayType === 'normal-variation') {
    plan.push(`The IB extreme that broke (${p.extUp > p.extDown ? fmt(p.ibHigh) : fmt(p.ibLow)}) is the reference: it should hold on a retest. Losing it turns the day's direction into a failed auction.`);
  }

  plan.push(`Overnight inventory check: if the market opens the next session far from ${fmt(p.close)} in the opposite direction to the close, the overnight inventory is imbalanced and the first move is usually a correction of it, not a new trend.`);

  const headline = `${DAY_TYPE_LABEL[p.dayType]} · ${OPEN_TYPE_LABEL[p.openType]}${prior ? ` · ${valueRelation(p, prior).replace('-', ' ')} value` : ''}`;
  return { headline, lines, plan };
}
