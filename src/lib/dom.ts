/*
 * Depth-of-Market engine — a professional order-flow ladder, pure and testable.
 *
 * The DOM is where futures traders read the auction in real time. This engine
 * ingests the three things Rithmic streams — the inside quote (best bid/offer),
 * executed prints (with aggressor side), and, when available, full book depth —
 * and maintains a price-keyed ladder plus the derived order-flow analytics a
 * serious desk wants:
 *
 *   • Volume profile per price (traded contracts), with POC and value area.
 *   • Cumulative delta (buy-aggressor volume − sell-aggressor volume), session
 *     and per-price, so absorption and initiative are visible.
 *   • Depth ratios: inside bid/ask imbalance and total book imbalance.
 *   • Bid/ask resting size per level (from BBO, and full depth when present).
 *   • A rolling tape of the last prints.
 *
 * The React layer only renders what this computes. Every function is pure or a
 * deterministic state update, unit-tested without a socket.
 */

export interface TickSpec {
  tick: number; // minimum price increment
  decimals: number;
}

/** Tick size per futures root — falls back to a sensible default. */
export function tickSpecFor(symbol: string): TickSpec {
  const root = symbol.replace(/[0-9]/g, '').toUpperCase().replace(/[FGHJKMNQUVXZ]$/, '');
  const table: Record<string, TickSpec> = {
    ES: { tick: 0.25, decimals: 2 }, MES: { tick: 0.25, decimals: 2 },
    NQ: { tick: 0.25, decimals: 2 }, MNQ: { tick: 0.25, decimals: 2 },
    RTY: { tick: 0.1, decimals: 1 }, M2K: { tick: 0.1, decimals: 1 },
    YM: { tick: 1, decimals: 0 }, MYM: { tick: 1, decimals: 0 },
    CL: { tick: 0.01, decimals: 2 }, MCL: { tick: 0.01, decimals: 2 },
    GC: { tick: 0.1, decimals: 1 }, MGC: { tick: 0.1, decimals: 1 },
    SI: { tick: 0.005, decimals: 3 },
    ZB: { tick: 1 / 32, decimals: 4 }, ZN: { tick: 1 / 64, decimals: 4 }, ZF: { tick: 1 / 128, decimals: 5 },
    '6E': { tick: 0.00005, decimals: 5 }, '6J': { tick: 0.0000005, decimals: 7 },
    '6B': { tick: 0.0001, decimals: 4 }, '6A': { tick: 0.0001, decimals: 4 }, '6C': { tick: 0.0001, decimals: 4 },
    NG: { tick: 0.001, decimals: 3 }, HG: { tick: 0.0005, decimals: 4 },
  };
  return table[root] ?? { tick: 0.25, decimals: 2 };
}

/** Round a price to the instrument's tick grid — avoids float drift as a key. */
export function snapToTick(price: number, tick: number): number {
  return Math.round(price / tick) * tick;
}

/** A stable integer key for a price on the tick grid (avoids float map keys). */
export function priceKey(price: number, tick: number): number {
  return Math.round(price / tick);
}

export interface LadderRow {
  price: number;
  bidSize: number; // resting bid depth at this price (inside from BBO, full from depth)
  askSize: number;
  buyVol: number; // traded volume that lifted the offer here
  sellVol: number; // traded volume that hit the bid here
  totalVol: number; // buyVol + sellVol (the volume-profile bar)
  delta: number; // buyVol − sellVol at this price
}

export interface DomTrade {
  price: number;
  size: number;
  aggressor: number | null;
  at: number;
}

export interface SessionStats {
  last: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  /** total traded contracts this session */
  volume: number;
  /** session cumulative delta */
  cumDelta: number;
  /** volume-weighted average price of the session */
  vwap: number | null;
  high: number | null;
  low: number | null;
  /** point of control — the price with the most traded volume */
  poc: number | null;
  /** value area (70% of volume) low/high prices */
  valLow: number | null;
  valHigh: number | null;
  /** inside imbalance: bidSize / (bidSize+askSize), 0..1 (>0.5 = bid-heavy) */
  insideImbalance: number | null;
  /** whole-book imbalance across all known depth, 0..1 */
  bookImbalance: number | null;
}

/** Pure: point of control + value-area bounds from a volume-by-price map. */
export function valueArea(volByPrice: Map<number, number>, tick: number, coverage = 0.7): { poc: number | null; valLow: number | null; valHigh: number | null } {
  if (!volByPrice.size) return { poc: null, valLow: null, valHigh: null };
  const entries = [...volByPrice.entries()].sort((a, b) => a[0] - b[0]); // by price key asc
  let total = 0;
  let pocKey = entries[0][0];
  let pocVol = -1;
  for (const [k, v] of entries) {
    total += v;
    if (v > pocVol) { pocVol = v; pocKey = k; }
  }
  // expand out from POC, always taking the larger neighbour, until coverage met
  const idxByKey = new Map(entries.map(([k], i) => [k, i]));
  let lo = idxByKey.get(pocKey)!;
  let hi = lo;
  let acc = entries[lo][1];
  const target = total * coverage;
  while (acc < target && (lo > 0 || hi < entries.length - 1)) {
    const below = lo > 0 ? entries[lo - 1][1] : -1;
    const above = hi < entries.length - 1 ? entries[hi + 1][1] : -1;
    if (above >= below) { hi++; acc += entries[hi][1]; }
    else { lo--; acc += entries[lo][1]; }
  }
  return {
    poc: pocKey * tick,
    valLow: entries[lo][0] * tick,
    valHigh: entries[hi][0] * tick,
  };
}

export class DomEngine {
  readonly tick: number;
  readonly decimals: number;
  private bidPrice: number | null = null;
  private askPrice: number | null = null;
  private bidSizeInside = 0;
  private askSizeInside = 0;
  private lastPrice: number | null = null;
  private high: number | null = null;
  private low: number | null = null;
  private volume = 0;
  private cumDelta = 0;
  private pxVolSum = 0; // Σ price·size for vwap
  // per-price-key aggregates
  private buyVol = new Map<number, number>();
  private sellVol = new Map<number, number>();
  private depthBid = new Map<number, number>(); // full book resting sizes (optional)
  private depthAsk = new Map<number, number>();
  private tape: DomTrade[] = [];

  constructor(symbol: string) {
    const spec = tickSpecFor(symbol);
    this.tick = spec.tick;
    this.decimals = spec.decimals;
  }

  /** Update the inside quote from a BBO. */
  onQuote(bid: number | null, ask: number | null, bidSize?: number | null, askSize?: number | null): void {
    if (bid != null) this.bidPrice = snapToTick(bid, this.tick);
    if (ask != null) this.askPrice = snapToTick(ask, this.tick);
    if (bidSize != null) this.bidSizeInside = bidSize;
    if (askSize != null) this.askSizeInside = askSize;
  }

  /**
   * Ingest an executed print. aggressor 1=buy (lifts offer), 2=sell (hits bid).
   * When aggressor is unknown, classify by the inside quote (>= ask = buy).
   */
  onTrade(price: number, size: number, aggressor: number | null, at = Date.now()): void {
    if (!(size > 0) || !isFinite(price)) return;
    const p = snapToTick(price, this.tick);
    const k = priceKey(price, this.tick);
    let side = aggressor;
    if (side !== 1 && side !== 2) {
      if (this.askPrice != null && p >= this.askPrice) side = 1;
      else if (this.bidPrice != null && p <= this.bidPrice) side = 2;
      else side = this.lastPrice != null && p >= this.lastPrice ? 1 : 2; // uptick=buy
    }
    if (side === 1) this.buyVol.set(k, (this.buyVol.get(k) ?? 0) + size);
    else this.sellVol.set(k, (this.sellVol.get(k) ?? 0) + size);
    this.volume += size;
    this.cumDelta += side === 1 ? size : -size;
    this.pxVolSum += p * size;
    this.lastPrice = p;
    this.high = this.high == null ? p : Math.max(this.high, p);
    this.low = this.low == null ? p : Math.min(this.low, p);
    this.tape.unshift({ price: p, size, aggressor: side, at });
    if (this.tape.length > 100) this.tape.length = 100;
  }

  /** Optional: full-book depth ladder (arrays of {price, size}). */
  onDepth(bids: { price: number; size: number }[], asks: { price: number; size: number }[]): void {
    this.depthBid = new Map(bids.map((b) => [priceKey(b.price, this.tick), b.size]));
    this.depthAsk = new Map(asks.map((a) => [priceKey(a.price, this.tick), a.size]));
  }

  /** Build the visible ladder: `depth` rows each side of the inside. */
  ladder(depth = 12): LadderRow[] {
    const center =
      this.lastPrice != null ? priceKey(this.lastPrice, this.tick)
      : this.bidPrice != null ? priceKey(this.bidPrice, this.tick)
      : 0;
    const bidK = this.bidPrice != null ? priceKey(this.bidPrice, this.tick) : center;
    const askK = this.askPrice != null ? priceKey(this.askPrice, this.tick) : center;
    const top = Math.max(askK, center) + depth;
    const bottom = Math.min(bidK, center) - depth;
    const rows: LadderRow[] = [];
    for (let k = top; k >= bottom; k--) {
      const buy = this.buyVol.get(k) ?? 0;
      const sell = this.sellVol.get(k) ?? 0;
      const restingBid = this.depthBid.get(k) ?? (k === bidK ? this.bidSizeInside : 0);
      const restingAsk = this.depthAsk.get(k) ?? (k === askK ? this.askSizeInside : 0);
      rows.push({
        price: k * this.tick,
        bidSize: restingBid,
        askSize: restingAsk,
        buyVol: buy,
        sellVol: sell,
        totalVol: buy + sell,
        delta: buy - sell,
      });
    }
    return rows;
  }

  stats(): SessionStats {
    const volByPrice = new Map<number, number>();
    for (const [k, v] of this.buyVol) volByPrice.set(k, (volByPrice.get(k) ?? 0) + v);
    for (const [k, v] of this.sellVol) volByPrice.set(k, (volByPrice.get(k) ?? 0) + v);
    const { poc, valLow, valHigh } = valueArea(volByPrice, this.tick);
    const insideTotal = this.bidSizeInside + this.askSizeInside;
    let bookBid = 0;
    let bookAsk = 0;
    for (const v of this.depthBid.values()) bookBid += v;
    for (const v of this.depthAsk.values()) bookAsk += v;
    const bookTotal = bookBid + bookAsk;
    return {
      last: this.lastPrice,
      bid: this.bidPrice,
      ask: this.askPrice,
      bidSize: this.bidSizeInside || null,
      askSize: this.askSizeInside || null,
      volume: this.volume,
      cumDelta: this.cumDelta,
      vwap: this.volume > 0 ? this.pxVolSum / this.volume : null,
      high: this.high,
      low: this.low,
      poc,
      valLow,
      valHigh,
      insideImbalance: insideTotal > 0 ? this.bidSizeInside / insideTotal : null,
      bookImbalance: bookTotal > 0 ? bookBid / bookTotal : null,
    };
  }

  getTape(): DomTrade[] {
    return this.tape;
  }

  /** Largest total volume at a single price — for scaling the profile bars. */
  maxLadderVol(): number {
    let m = 0;
    for (const [k, v] of this.buyVol) m = Math.max(m, v + (this.sellVol.get(k) ?? 0));
    for (const [k, v] of this.sellVol) if (!this.buyVol.has(k)) m = Math.max(m, v);
    return m;
  }

  reset(): void {
    this.bidPrice = this.askPrice = this.lastPrice = this.high = this.low = null;
    this.bidSizeInside = this.askSizeInside = this.volume = this.cumDelta = this.pxVolSum = 0;
    this.buyVol.clear();
    this.sellVol.clear();
    this.depthBid.clear();
    this.depthAsk.clear();
    this.tape = [];
  }

  fmt(price: number): string {
    return price.toFixed(this.decimals);
  }
}
