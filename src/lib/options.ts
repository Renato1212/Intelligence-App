/*
 * Options positioning & volatility — the dealer-flow layer of the FLOW domain.
 *
 * CBOE publishes delayed quotes and FULL OPTION CHAINS (per-strike open
 * interest, volume, IV and greeks) through a public CDN that is keyless and
 * CORS-open — the same raw feed the paid gamma-exposure services are built
 * on. From it this module computes what an index futures trader actually
 * needs before the open:
 *
 *  - THE VIX COMPLEX: VIX9D / VIX / VIX3M term structure → the vol regime
 *    (calm carry vs event stress vs crisis backwardation), refreshed live.
 *  - PUT WALL / CALL WALL: the strikes with the heaviest put/call open
 *    interest — where dealer hedging makes price sticky (support/resistance
 *    that exists because of mechanics, not opinion).
 *  - NET GAMMA (GEX) BY STRIKE + THE ZERO-GAMMA FLIP: with the standard
 *    dealer-positioning convention (dealers long calls they sold to
 *    overwriters? No — dealers are SHORT what customers are long: convention
 *    here is calls contribute positive dealer gamma, puts negative), the
 *    cumulative profile crosses zero at the "flip" level: above it dealers
 *    dampen moves (mean reversion, pinning), below it they amplify them
 *    (trend days, air pockets).
 *  - OPEX CONCENTRATION: how much of the open interest dies at the nearest
 *    expiry — the fuel for pinning into expiration and for the un-pinned
 *    move the session after.
 *
 * All analytics are pure functions over parsed chains, so they are testable
 * without the network; fetches are cached and every panel degrades with an
 * inline note when the CDN is unreachable.
 */

export interface CboeQuote {
  symbol: string;
  price: number;
  prevClose: number | null;
  changePct: number | null;
}

/** The index chains CBOE serves keylessly, mapped to the futures they drive. */
export interface OptionRoot {
  root: string;
  label: string;
  future: string;
  /** how index levels translate to the future's chart */
  mapNote: string;
}

export const OPTION_ROOTS: OptionRoot[] = [
  {
    root: '_SPX', label: 'S&P 500', future: 'ES',
    mapNote: 'SPX cash level ≈ ES minus the basis (a few points, sign varies with rates/dividends). Treat each level as a ZONE a few ES points wide, not a tick.',
  },
  {
    root: '_NDX', label: 'Nasdaq 100', future: 'NQ',
    mapNote: 'NDX cash level ≈ NQ minus the basis. NDX strikes are 25–100 points apart — zones are proportionally wider than on ES.',
  },
  {
    root: '_RUT', label: 'Russell 2000', future: 'RTY',
    mapNote: 'RUT cash level ≈ RTY minus the basis. Russell OI is thinner — walls carry less force than SPX walls; confirm with price action.',
  },
];

export interface OptionEntry {
  /** YYYY-MM-DD */
  expiry: string;
  strike: number;
  type: 'C' | 'P';
  openInterest: number;
  volume: number;
  gamma: number | null;
  iv: number | null;
}

export interface ChainSnapshot {
  root: string;
  spot: number;
  entries: OptionEntry[];
  fetchedAt: string;
  stale?: boolean;
}

/* ------------------------------- parsing -------------------------------- */

/** Parse an OCC option symbol like "SPX   240719C05000000" or "SPY240719P00550000". */
export function parseOcc(occ: string): { root: string; expiry: string; type: 'C' | 'P'; strike: number } | null {
  const m = String(occ).replace(/\s+/g, '').match(/^([A-Z^_.]{1,6}?)(\d{6})([CP])(\d{7,8})$/);
  if (!m) return null;
  const [, root, ymd, cp, strikeRaw] = m;
  const yy = Number(ymd.slice(0, 2));
  const year = yy + (yy < 70 ? 2000 : 1900);
  const expiry = `${year}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;
  return { root, expiry, type: cp as 'C' | 'P', strike: Number(strikeRaw) / 1000 };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/** Parse a CBOE delayed-quotes options payload into a chain snapshot. */
export function parseChain(json: unknown, root: string): ChainSnapshot | null {
  const data = (json as { data?: Record<string, unknown> })?.data;
  if (!data) return null;
  const spot = num(data.current_price) ?? num(data.close) ?? num(data.last_trade_price);
  const rawOptions = data.options;
  if (spot == null || !Array.isArray(rawOptions)) return null;
  const entries: OptionEntry[] = [];
  for (const o of rawOptions as Record<string, unknown>[]) {
    const parsed = parseOcc(String(o.option ?? ''));
    if (!parsed) continue;
    const oi = num(o.open_interest) ?? 0;
    if (oi <= 0) continue;
    entries.push({
      expiry: parsed.expiry,
      strike: parsed.strike,
      type: parsed.type,
      openInterest: oi,
      volume: num(o.volume) ?? 0,
      gamma: num(o.gamma),
      iv: num(o.iv),
    });
  }
  if (!entries.length) return null;
  return { root, spot, entries, fetchedAt: new Date().toISOString() };
}

export function parseQuote(json: unknown, symbol: string): CboeQuote | null {
  const data = (json as { data?: Record<string, unknown> })?.data;
  if (!data) return null;
  const price = num(data.current_price) ?? num(data.close) ?? num(data.last_trade_price);
  if (price == null) return null;
  const prevClose = num(data.prev_day_close);
  const changePct = num(data.price_change_percent) ?? (prevClose ? ((price - prevClose) / prevClose) * 100 : null);
  return { symbol, price, prevClose, changePct };
}

/* ------------------------------ analytics ------------------------------- */

export interface StrikeRow {
  strike: number;
  callOI: number;
  putOI: number;
  /** net dealer gamma exposure at this strike (calls +, puts −), $ per 1% move */
  gex: number;
}

export interface GammaProfile {
  expiries: string[];
  /** the expiries included in this profile */
  included: string[];
  spot: number;
  rows: StrikeRow[];
  putWall: number | null;
  callWall: number | null;
  /** cumulative-GEX zero crossing nearest to spot, null when one-signed */
  zeroGamma: number | null;
  /** total net GEX ($ per 1% move); sign = the regime */
  totalGex: number;
  regime: 'positive' | 'negative';
  /** share of total OI expiring at the nearest included expiry */
  nearestExpiryShare: number;
}

/** Multiplier: index options are 100x; GEX per strike = Σ gamma·OI·100·spot²·1% */
function gexOf(e: OptionEntry, spot: number): number {
  const g = e.gamma ?? 0;
  const raw = g * e.openInterest * 100 * spot * spot * 0.01;
  return e.type === 'C' ? raw : -raw;
}

/**
 * Build the strike-level gamma/OI profile for the selected expiries.
 * Pure — feed it any parsed chain.
 */
export function gammaProfile(chain: ChainSnapshot, selectedExpiries: string[] | 'nearest' | 'all' = 'nearest'): GammaProfile | null {
  const expiries = [...new Set(chain.entries.map((e) => e.expiry))].sort();
  if (!expiries.length) return null;
  const included =
    selectedExpiries === 'all' ? expiries : selectedExpiries === 'nearest' ? [expiries[0]] : selectedExpiries.filter((e) => expiries.includes(e));
  if (!included.length) return null;
  const inc = new Set(included);
  const use = chain.entries.filter((e) => inc.has(e.expiry));

  const byStrike = new Map<number, StrikeRow>();
  for (const e of use) {
    let row = byStrike.get(e.strike);
    if (!row) {
      row = { strike: e.strike, callOI: 0, putOI: 0, gex: 0 };
      byStrike.set(e.strike, row);
    }
    if (e.type === 'C') row.callOI += e.openInterest;
    else row.putOI += e.openInterest;
    row.gex += gexOf(e, chain.spot);
  }
  const rows = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  if (!rows.length) return null;

  // walls: heaviest OI within ±12% of spot (far wings are noise for intraday)
  const near = rows.filter((r) => Math.abs(r.strike - chain.spot) / chain.spot <= 0.12);
  const pool = near.length >= 5 ? near : rows;
  const putWall = pool.reduce((best, r) => (r.putOI > (best?.putOI ?? 0) ? r : best), null as StrikeRow | null)?.strike ?? null;
  const callWall = pool.reduce((best, r) => (r.callOI > (best?.callOI ?? 0) ? r : best), null as StrikeRow | null)?.strike ?? null;

  // zero-gamma flip: walk cumulative GEX from the bottom; take the crossing
  // closest to spot
  let cum = 0;
  let zeroGamma: number | null = null;
  let prevCum = 0;
  let prevStrike = rows[0].strike;
  for (const r of rows) {
    prevCum = cum;
    cum += r.gex;
    if (prevCum !== 0 && Math.sign(prevCum) !== Math.sign(cum) && cum !== 0) {
      const cross = prevStrike + (r.strike - prevStrike) * (Math.abs(prevCum) / (Math.abs(prevCum) + Math.abs(cum)));
      if (zeroGamma == null || Math.abs(cross - chain.spot) < Math.abs(zeroGamma - chain.spot)) zeroGamma = Math.round(cross);
    }
    prevStrike = r.strike;
  }

  const totalGex = rows.reduce((s, r) => s + r.gex, 0);
  const totalOI = chain.entries.reduce((s, e) => s + e.openInterest, 0);
  const nearestOI = chain.entries.filter((e) => e.expiry === expiries[0]).reduce((s, e) => s + e.openInterest, 0);

  return {
    expiries,
    included,
    spot: chain.spot,
    rows,
    putWall,
    callWall,
    zeroGamma,
    totalGex,
    regime: totalGex >= 0 ? 'positive' : 'negative',
    nearestExpiryShare: totalOI > 0 ? nearestOI / totalOI : 0,
  };
}

/** The plain-language read of the dealer-gamma state. */
export function gammaRead(p: GammaProfile): string {
  const parts: string[] = [];
  if (p.regime === 'positive') {
    parts.push(
      'Dealers are NET LONG gamma: their hedging sells rallies and buys dips, which dampens moves — expect mean reversion, tighter ranges and strike pinning',
    );
  } else {
    parts.push(
      'Dealers are NET SHORT gamma: their hedging sells weakness and buys strength, which AMPLIFIES moves — trend days, air pockets and fast tape live here',
    );
  }
  if (p.zeroGamma != null) {
    const rel = p.spot >= p.zeroGamma ? 'above' : 'below';
    parts.push(`spot is ${rel} the zero-gamma flip (~${p.zeroGamma}) — a cross of that level often changes the day's character`);
  }
  if (p.putWall != null && p.callWall != null) {
    parts.push(`the heavy strikes bracket the session: put wall ${p.putWall} below, call wall ${p.callWall} above`);
  }
  return parts.join('. ') + '.';
}

/* ------------------------------ key levels ------------------------------- */

export interface KeyLevel {
  level: number;
  kind: 'call-wall' | 'gamma-peak' | 'flip' | 'put-wall' | 'gamma-trough';
  label: string;
  /** distance from spot, % (positive = above) */
  distPct: number;
  behavior: string;
}

/**
 * The dealer-level ladder for one gamma profile, sorted top-down like a
 * price ladder. Pure — testable with fixture profiles.
 */
export function keyLevels(p: GammaProfile): KeyLevel[] {
  const out: KeyLevel[] = [];
  const dist = (lvl: number) => ((lvl - p.spot) / p.spot) * 100;
  const push = (level: number | null, kind: KeyLevel['kind'], label: string, behavior: string) => {
    if (level == null) return;
    if (out.some((l) => l.level === level)) return; // walls and peaks often coincide
    out.push({ level, kind, label, distPct: dist(level), behavior });
  };

  push(
    p.callWall, 'call-wall', 'Call wall',
    'Heaviest call OI. Dealer hedging supplies stock into rallies here — grind-ups stall, breakouts need real flow behind them. First upside target in positive gamma; take-profit zone, not a chase zone.',
  );
  push(
    p.putWall, 'put-wall', 'Put wall',
    'Heaviest put OI — where crash protection is thickest. Dealer hedging buys into weakness approaching it: mechanical support and the classic downside target. A clean break of the put wall means hedges roll DOWN — air below.',
  );
  push(
    p.zeroGamma, 'flip', 'Zero-gamma flip',
    'The regime line. Above it dealer hedging dampens moves (fade extremes, expect pinning); below it hedging amplifies them (trend days, air pockets, respect momentum). A cross often changes the day\'s character mid-session.',
  );

  // biggest positive / negative net-GEX strikes near spot that aren't already listed
  const near = p.rows.filter((r) => Math.abs(r.strike - p.spot) / p.spot <= 0.06);
  const peak = near.reduce((b, r) => (r.gex > (b?.gex ?? 0) ? r : b), null as StrikeRow | null);
  const trough = near.reduce((b, r) => (r.gex < (b?.gex ?? 0) ? r : b), null as StrikeRow | null);
  if (peak && peak.gex > 0) {
    push(
      peak.strike, 'gamma-peak', 'Gamma magnet',
      'Largest positive net gamma near spot — the strongest pin candidate. Late on quiet and expiry days, price gets pulled here; ranges compress around it.',
    );
  }
  if (trough && trough.gex < 0) {
    push(
      trough.strike, 'gamma-trough', 'Acceleration strike',
      'Largest negative net gamma near spot — hedging flips to chasing through here. Moves SPEED UP across this strike; stops resting just beyond it get run.',
    );
  }

  return out.sort((a, b) => b.level - a.level);
}

export interface VixRegime {
  vix: number;
  vix9d: number | null;
  vix3m: number | null;
  /** VIX ÷ VIX3M — < 0.9 calm carry, ~1 alert, > 1 backwardation/stress */
  ratio3m: number | null;
  /** VIX9D ÷ VIX — > 1 = imminent-event premium */
  ratio9d: number | null;
  state: 'calm' | 'nervous' | 'event' | 'stress';
  read: string;
}

/** Classify the vol regime from the term structure. Pure. */
export function vixRegime(vix: number, vix9d: number | null, vix3m: number | null): VixRegime {
  const ratio3m = vix3m && vix3m > 0 ? vix / vix3m : null;
  const ratio9d = vix9d && vix > 0 ? vix9d / vix : null;
  let state: VixRegime['state'] = 'calm';
  if (ratio3m != null && ratio3m >= 1) state = 'stress';
  else if (ratio9d != null && ratio9d >= 1) state = 'event';
  else if (ratio3m != null && ratio3m >= 0.9) state = 'nervous';

  const read =
    state === 'stress'
      ? `Backwardation: 30-day vol (${vix.toFixed(1)}) is above 3-month (${vix3m?.toFixed(1)}). The market is paying up for protection NOW — crisis regime. Rallies are short-covering until this inverts back; trade smaller and faster.`
      : state === 'event'
        ? `Event premium: 9-day vol (${vix9d?.toFixed(1)}) trades above 30-day (${vix.toFixed(1)}) — the market is bracing for something inside two weeks (check the Catalysts week). Expect compression into the event and a vol crush after it.`
        : state === 'nervous'
          ? `Flattening curve: VIX/VIX3M at ${(ratio3m ?? 0).toFixed(2)} — carry is thinning. Not stressed yet, but the cushion for bad news is smaller; respect failed bounces.`
          : `Contango: VIX ${vix.toFixed(1)} well under VIX3M ${vix3m?.toFixed(1) ?? '—'} — the calm-carry regime. Dips get bought, vol sellers are in control; the edge is fading panic, not chasing it.`;

  return { vix, vix9d, vix3m, ratio3m, ratio9d, state, read };
}

/* ------------------------------- fetching ------------------------------- */

const CDN = 'https://cdn.cboe.com/api/global/delayed_quotes';
const QUOTE_TTL = 60 * 1000; // delayed feed; refresh read every minute
const CHAIN_TTL = 15 * 60 * 1000; // chains are heavy — 15-minute cache
const QUOTE_KEY = 'ei-cboe-quotes-v1';
const CHAIN_KEY = 'ei-cboe-chain-v2'; // v2: per-root entries

interface QuoteCache {
  [symbol: string]: { at: number; quote: CboeQuote };
}

export async function loadCboeQuote(symbol: string): Promise<{ quote: CboeQuote | null; error: string | null }> {
  let cache: QuoteCache = {};
  try {
    cache = JSON.parse(localStorage.getItem(QUOTE_KEY) ?? '{}') as QuoteCache;
  } catch {
    cache = {};
  }
  const hit = cache[symbol];
  if (hit && Date.now() - hit.at < QUOTE_TTL) return { quote: hit.quote, error: null };
  try {
    const res = await fetch(`${CDN}/quotes/${encodeURIComponent(symbol)}.json`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { quote: hit?.quote ?? null, error: `CBOE returned ${res.status} for ${symbol}.` };
    const quote = parseQuote(await res.json(), symbol);
    if (!quote) return { quote: hit?.quote ?? null, error: `Unexpected CBOE payload for ${symbol}.` };
    cache[symbol] = { at: Date.now(), quote };
    try {
      localStorage.setItem(QUOTE_KEY, JSON.stringify(cache));
    } catch {
      // best effort
    }
    return { quote, error: null };
  } catch {
    return { quote: hit?.quote ?? null, error: 'Could not reach the CBOE data CDN (network).' };
  }
}

/**
 * Load the full option chain for an index root (default SPX). The payload is
 * heavy (all expiries), so it is cached for 15 minutes and only refetched on
 * demand.
 */
export async function loadChain(root = '_SPX', force = false): Promise<{ chain: ChainSnapshot | null; error: string | null }> {
  const key = `${CHAIN_KEY}:${root}`;
  let cached: ChainSnapshot | null = null;
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as ChainSnapshot | null;
    if (raw && raw.root === root && Array.isArray(raw.entries)) cached = raw;
  } catch {
    cached = null;
  }
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < CHAIN_TTL) {
    return { chain: cached, error: null };
  }
  try {
    const res = await fetch(`${CDN}/options/${encodeURIComponent(root)}.json`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { chain: cached ? { ...cached, stale: true } : null, error: `CBOE returned ${res.status} for the ${root} chain.` };
    const chain = parseChain(await res.json(), root);
    if (!chain) return { chain: cached ? { ...cached, stale: true } : null, error: 'Unexpected CBOE chain payload.' };
    // keep the cache small: only strikes within ±25% of spot, OI > 0
    const slim: ChainSnapshot = {
      ...chain,
      entries: chain.entries.filter((e) => Math.abs(e.strike - chain.spot) / chain.spot <= 0.25),
    };
    try {
      localStorage.setItem(key, JSON.stringify(slim));
    } catch {
      // chain may exceed quota — serve it uncached
    }
    return { chain: slim, error: null };
  } catch {
    return { chain: cached ? { ...cached, stale: true } : null, error: 'Could not reach the CBOE data CDN (network).' };
  }
}
