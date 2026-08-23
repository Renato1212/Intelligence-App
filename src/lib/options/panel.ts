/*
 * The panel: chain in, explained levels out.
 *
 * Everything here is derived from levels.ts and stays pure. The output is what
 * the trader marks on the chart in the morning, plus what each mark mechanically
 * means and how the day is likely to behave session by session.
 *
 * It describes conditions and dealer mechanics. It never says buy or sell.
 */
import {
  applyConfluence, atmIv, DEFAULT_CONFIG, expectedMove, gammaFlip, inBucket, netGexAtSpot,
  roundToTick, strikeProfile, scoreStrength, toFutures, TICKS,
  type ChainContract, type EngineConfig, type ExpiryBucket, type OptionLevel,
} from './levels';

export type Regime = 'positive' | 'negative' | 'transition' | 'undetermined';

export interface PanelInput {
  contracts: ChainContract[];
  /** index spot (SPX/NDX/RUT) */
  spot: number;
  asOf: Date;
  /** futures − index, sampled at the same instant */
  basis: number;
  basisSource: 'quote' | 'manual' | 'carry';
  future: string;
  indexSymbol: string;
  bucket?: ExpiryBucket;
  cfg?: EngineConfig;
}

export interface Panel {
  future: string;
  indexSymbol: string;
  asOf: Date;
  spot: number;
  futuresRef: number;
  basis: number;
  basisSource: PanelInput['basisSource'];
  bucket: ExpiryBucket;
  atmIv: number | null;
  expectedMove: number | null;
  netGex: number;
  gammaFlip: number | null;
  gammaFlipFutures: number | null;
  /** distance from spot to flip, in EM units */
  flipDistEm: number | null;
  regime: Regime;
  regimeExplain: string;
  levels: OptionLevel[];
  watch: string[];
  sessions: { label: string; window: string; note: string }[];
  contractsUsed: number;
}

const fmt = (n: number, dp = 2) => n.toFixed(dp);

/** Regime, and what it means for how the day trades. */
function readRegime(netGex: number, flipDistEm: number | null): { regime: Regime; explain: string } {
  if (!isFinite(netGex) || netGex === 0) {
    return { regime: 'undetermined', explain: 'Not enough gamma in the chain to read a regime. Treat levels as weak references only.' };
  }
  const nearFlip = flipDistEm != null && Math.abs(flipDistEm) <= 0.35;
  if (nearFlip) {
    return {
      regime: 'transition',
      explain:
        'Price is sitting on the gamma flip, so dealer hedging has no consistent sign. This is the least stable state: ' +
        'moves start and stall unpredictably, and both mean-reversion and momentum fail intermittently. Expect whipsaw ' +
        'around the flip until price commits to one side of it — which side it settles on usually sets the character of the rest of the day.',
    };
  }
  if (netGex > 0) {
    return {
      regime: 'positive',
      explain:
        'Dealers are net long gamma, so they hedge AGAINST the move: they sell into rallies and buy into dips. That ' +
        'mechanically dampens volatility and pins price. Expect a compressed, rotational session that keeps returning ' +
        'toward the heaviest strikes; ranges tend to hold and breakouts tend to fail unless a catalyst forces repricing. ' +
        'Trend-following is fighting the flow here.',
    };
  }
  return {
    regime: 'negative',
    explain:
      'Dealers are net short gamma, so they hedge WITH the move: they sell as price falls and buy as it rises. That ' +
      'mechanically amplifies volatility. Expect wider ranges, faster and more persistent directional moves, and ' +
      'air-pockets where price accelerates between strikes. Fading extremes is dangerous here; levels are more likely ' +
      'to break than to hold.',
  };
}

/** What to watch, conditioned on the regime. Observation prompts, never signals. */
function whatToWatch(regime: Regime, p: { flipFut: number | null; callWall?: OptionLevel; putWall?: OptionLevel; em: number | null; future: string }): string[] {
  const out: string[] = [];
  if (p.flipFut != null) {
    out.push(`Gamma flip sits at ${fmt(p.flipFut)} on ${p.future}. Which side of it price spends the session on is the single most informative thing on this panel — mark it first.`);
  }
  if (regime === 'positive') {
    out.push('Watch for rejection at the walls rather than clean breaks: in positive gamma, dealer selling into strength and buying into weakness makes the extremes sticky.');
    if (p.callWall) out.push(`${fmt(p.callWall.futuresPrice)} is the call wall — the level dealers must sell into. Watch whether approaches stall there or push through; a sustained break through a heavy call wall usually means the hedging assumption is breaking down.`);
    if (p.putWall) out.push(`${fmt(p.putWall.futuresPrice)} is the put wall — dealer buying should appear on approaches. Note whether the first touch produces a reaction and how large it is.`);
    out.push('Late in the session, 0DTE gamma decays and the pin weakens. Watch for range expansion into the close that was not possible mid-session.');
  } else if (regime === 'negative') {
    out.push('Watch for acceleration rather than reaction: in negative gamma the hedging flow pushes price further in the direction it is already going.');
    if (p.putWall) out.push(`${fmt(p.putWall.futuresPrice)} is the largest put gamma below — in negative gamma this acts less like support and more like a shelf that, once lost, opens an air-pocket. Watch how price behaves on the approach.`);
    if (p.callWall) out.push(`${fmt(p.callWall.futuresPrice)} is the largest call gamma above; a reclaim can start a squeeze rather than stall the move.`);
    out.push('Expect the realised range to run at or beyond the expected move. Sizing that assumes a normal day is the classic error in this regime.');
  } else if (regime === 'transition') {
    out.push('Until price picks a side of the flip, treat every level as provisional. The cleanest observation today is which side it commits to and what happens immediately after.');
  } else {
    out.push('Regime undetermined — rely on structure and the catalyst calendar rather than these levels.');
  }
  if (p.em != null) out.push(`One expected-move session is ±${fmt(p.em)} points. Any level further than about one EM away is unlikely to be reached without a catalyst — that is what the EM column is for.`);
  out.push('Open interest updates once per day. These levels move intraday only because SPOT moves, not because positioning changed.');
  return out;
}

/**
 * Session-by-session read for a Lisbon-based trader. The US cash session is the
 * afternoon, and dealer gamma matters most while US options are trading.
 */
function sessionPlaybook(regime: Regime): Panel['sessions'] {
  const base = [
    { label: 'Asia', window: '00:00–07:00', note: 'US option desks are flat; gamma has almost no grip. Overnight moves are driven by flow and news, not hedging. Levels are reference only.' },
    { label: 'London', window: '07:00–13:00', note: 'European hours. Hedging picks up but the US chain is not yet active. Use the levels to frame the range, not to expect reactions.' },
    { label: 'NY pre', window: '13:00–14:30', note: 'The chain wakes up. Overnight positioning is adjusted and the first real tests of the walls tend to happen here.' },
    { label: 'US cash', window: '14:30–21:00', note: 'The session these levels are actually built for. Dealer hedging is live and the levels have their maximum force.' },
    { label: 'Close', window: '20:00–21:00', note: '0DTE gamma decays and then releases at the cash close. Pins loosen and price often makes its cleanest move of the day.' },
  ];
  if (regime === 'positive') {
    base[3].note = 'Dealer hedging is live and dampening. Expect rotation between the walls, failed breakouts, and price gravitating back toward the heaviest strike. This is the regime where the levels hold best.';
    base[4].note = 'The pin is strongest into the afternoon and then releases at the cash close as 0DTE expires. A late break that was impossible all session is common.';
  } else if (regime === 'negative') {
    base[3].note = 'Dealer hedging is live and amplifying. Expect trend persistence, wider swings and levels that break rather than hold. This is the regime where being early to fade costs the most.';
    base[4].note = 'Short-gamma hedging into the close can extend the day\'s move rather than mean-revert it. The last hour is often the fastest.';
  } else if (regime === 'transition') {
    base[3].note = 'Price is near the flip: hedging has no consistent sign, so the session can switch character mid-way. Whichever side of the flip price settles on tends to set the tone for the remainder.';
  }
  return base;
}

/** Build the whole panel. */
export function buildPanel(input: PanelInput): Panel | null {
  const cfg = input.cfg ?? DEFAULT_CONFIG;
  const bucket: ExpiryBucket = input.bucket ?? 'month';
  const { spot, asOf, basis, future, indexSymbol } = input;
  const tick = TICKS[future] ?? 0.25;

  const contracts = input.contracts.filter((c) => inBucket(c.expiry, asOf, bucket) && c.openInterest > 0);
  if (!contracts.length || !(spot > 0)) return null;

  const iv = atmIv(contracts, spot);
  const em = iv != null ? expectedMove(spot, iv) : null;
  const netGex = netGexAtSpot(contracts, spot, asOf, cfg);
  const flip = gammaFlip(contracts, spot, asOf, cfg);
  const flipFut = flip != null ? toFutures(flip, basis, tick) : null;
  const flipDistEm = flip != null && em ? (spot - flip) / em : null;

  const prof = strikeProfile(contracts, spot, asOf, cfg);
  const totalAbs = prof.reduce((s, r) => s + Math.abs(r.callGex) + Math.abs(r.putGex), 0) || 1;
  const dead = em ? em * cfg.wallDeadZoneEm : 0;
  const zeroDte = contracts.some((c) => inBucket(c.expiry, asOf, 'zero'));

  const mkLevel = (name: string, kind: OptionLevel['kind'], indexPrice: number, gex: number, note: string): OptionLevel => {
    const share = Math.abs(gex) / totalAbs;
    const distEm = em ? Math.abs(indexPrice - spot) / em : 99;
    return {
      name, kind, indexPrice,
      futuresPrice: toFutures(indexPrice, basis, tick),
      strength: scoreStrength(share, distEm, bucket === 'zero' || (zeroDte && kind === 'wall' && false), cfg),
      share, distEm, expiryTag: bucket, note, confluence: [],
    };
  };

  const levels: OptionLevel[] = [];

  // Regime level — the flip
  if (flip != null) {
    levels.push({
      name: 'Gamma flip', kind: 'regime', indexPrice: flip, futuresPrice: flipFut!,
      strength: 'HIGH',
      share: 0, distEm: em ? Math.abs(spot - flip) / em : 99, expiryTag: bucket,
      note:
        'The spot price at which net dealer gamma crosses zero. Above it dealers dampen moves; below it they amplify them. ' +
        'It is a regime boundary, not support or resistance — crossing it changes how the whole session behaves.',
      confluence: [],
    });
  }

  // Walls — largest gamma exposure either side, excluding the ATM dead zone
  const above = prof.filter((r) => r.strike > spot + dead).sort((a, b) => b.callGex - a.callGex);
  const below = prof.filter((r) => r.strike < spot - dead).sort((a, b) => b.putGex - a.putGex);
  const wallNote = (side: 'call' | 'put') =>
    side === 'call'
      ? 'The strike with the most call gamma above spot. Dealers long these calls must SELL futures as price rises into it, which mechanically slows advances — resistance that comes from hedging, not from opinion.'
      : 'The strike with the most put gamma below spot. Dealers short these puts must BUY futures as price falls into it, which mechanically cushions declines — support that comes from hedging. In negative gamma this inverts and it becomes a shelf that accelerates once lost.';

  above.slice(0, 3).forEach((r, i) => {
    levels.push(mkLevel(i === 0 ? 'Call wall' : `Call wall ${i + 1}`, 'wall', r.strike, r.callGex, wallNote('call')));
  });
  below.slice(0, 3).forEach((r, i) => {
    levels.push(mkLevel(i === 0 ? 'Put wall' : `Put wall ${i + 1}`, 'wall', r.strike, r.putGex, wallNote('put')));
  });

  // Magnet — the single heaviest absolute gamma strike (the pin candidate)
  const magnet = prof.slice().sort((a, b) => Math.abs(b.callGex) + Math.abs(b.putGex) - (Math.abs(a.callGex) + Math.abs(a.putGex)))[0];
  if (magnet) {
    levels.push(
      mkLevel('Gamma magnet', 'magnet', magnet.strike, magnet.callGex + magnet.putGex,
        'The strike carrying the most total gamma. In positive gamma this is where hedging pulls price toward — the classic pin, strongest into the afternoon and released at the cash close.'),
    );
  }

  // Envelope — one expected move either side
  if (em != null) {
    levels.push({
      name: 'Expected move high', kind: 'envelope', indexPrice: spot + em, futuresPrice: toFutures(spot + em, basis, tick),
      strength: 'MEDIUM', share: 0, distEm: 1, expiryTag: bucket,
      note: 'One session of implied volatility above spot. Roughly a 1-standard-deviation day; the options market is pricing ~68% odds of closing inside this envelope.',
      confluence: [],
    });
    levels.push({
      name: 'Expected move low', kind: 'envelope', indexPrice: spot - em, futuresPrice: toFutures(spot - em, basis, tick),
      strength: 'MEDIUM', share: 0, distEm: 1, expiryTag: bucket,
      note: 'One session of implied volatility below spot. Price closing outside this envelope marks the day as an outlier worth logging.',
      confluence: [],
    });
  }

  const withConfluence = em ? applyConfluence(levels, em, cfg) : levels;
  withConfluence.sort((a, b) => b.futuresPrice - a.futuresPrice);

  const { regime, explain } = readRegime(netGex, flipDistEm);
  const callWall = withConfluence.find((l) => l.name === 'Call wall');
  const putWall = withConfluence.find((l) => l.name === 'Put wall');

  return {
    future, indexSymbol, asOf, spot,
    futuresRef: roundToTick(spot + basis, tick),
    basis, basisSource: input.basisSource, bucket,
    atmIv: iv, expectedMove: em, netGex,
    gammaFlip: flip, gammaFlipFutures: flipFut, flipDistEm,
    regime, regimeExplain: explain,
    levels: withConfluence,
    watch: whatToWatch(regime, { flipFut, callWall, putWall, em, future }),
    sessions: sessionPlaybook(regime),
    contractsUsed: contracts.length,
  };
}

/** Plain text for pasting the marked levels onto a chart. */
export function levelsAsText(p: Panel): string {
  const lines = [
    `${p.future} options levels — ${p.asOf.toISOString().slice(0, 10)}`,
    `regime ${p.regime} · net GEX ${p.netGex.toExponential(2)} · basis ${fmt(p.basis)} (${p.basisSource})`,
    '',
  ];
  for (const l of p.levels) {
    lines.push(`${fmt(l.futuresPrice)}\t${l.name}\t${l.strength}\t${fmt(l.distEm, 2)} EM`);
  }
  return lines.join('\n');
}

/** CSV for importing the marked levels into a charting package. */
export function levelsAsCsv(p: Panel): string {
  const style = (k: OptionLevel['kind']) =>
    k === 'regime' ? 'solid-thick' : k === 'wall' ? 'solid' : k === 'magnet' ? 'dashed' : 'dotted';
  const rows = [['price', 'name', 'kind', 'strength', 'dist_em', 'index_price', 'suggested_style'].join(',')];
  for (const l of p.levels) {
    rows.push([fmt(l.futuresPrice), `"${l.name}"`, l.kind, l.strength, fmt(l.distEm, 2), fmt(l.indexPrice), style(l.kind)].join(','));
  }
  return rows.join('\n');
}
