import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Principle, StatTile } from '../components/ui';
import { upcomingEvents, localTime, type CalendarEvent } from '../lib/calendar';
import {
  gammaProfile,
  gammaRead,
  keyLevels,
  loadCboeQuote,
  loadChain,
  OPTION_ROOTS,
  vixRegime,
  type ChainSnapshot,
  type GammaProfile,
  type KeyLevel,
  type VixRegime,
} from '../lib/options';
import { fmtDateShort, todayISO, weekdayName } from '../lib/format';

const AXIS = { stroke: 'transparent', tick: { fill: '#8a857a', fontSize: 11 }, tickLine: false } as const;

const STATE_COLOR: Record<VixRegime['state'], string> = {
  calm: 'var(--profit)',
  nervous: 'var(--gold)',
  event: 'var(--gold)',
  stress: 'var(--loss)',
};
const STATE_LABEL: Record<VixRegime['state'], string> = {
  calm: 'Calm carry',
  nervous: 'Nervous',
  event: 'Event premium',
  stress: 'Backwardation',
};

/* ------------------------------ VIX panel ------------------------------- */

function VixPanel() {
  const [regime, setRegime] = useState<VixRegime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const [v, v9, v3] = await Promise.all([loadCboeQuote('_VIX'), loadCboeQuote('_VIX9D'), loadCboeQuote('_VIX3M')]);
      if (!alive) return;
      if (v.quote) {
        setRegime(vixRegime(v.quote.price, v9.quote?.price ?? null, v3.quote?.price ?? null));
        setUpdatedAt(new Date().toLocaleTimeString().slice(0, 5));
        setError(v9.error || v3.error || null);
      } else {
        setError(v.error);
      }
    };
    void pull();
    const id = window.setInterval(pull, 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          The VIX complex <span className="hint">9-day / 30-day / 3-month term structure — CBOE delayed feed, keyless, refreshing every minute</span>
        </div>
        {updatedAt && <span className="muted small">updated {updatedAt}</span>}
      </div>

      {!regime ? (
        <div className="muted small">{error ? <><b>VIX feed unreachable:</b> {error}</> : 'Reading the vol surface…'}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
            <StatTile small label="VIX (30d)" value={regime.vix.toFixed(2)} />
            <StatTile small label="VIX9D" value={regime.vix9d != null ? regime.vix9d.toFixed(2) : '—'} delta={regime.ratio9d != null ? `9D/30D ${regime.ratio9d.toFixed(2)}` : undefined} />
            <StatTile small label="VIX3M" value={regime.vix3m != null ? regime.vix3m.toFixed(2) : '—'} delta={regime.ratio3m != null ? `30D/3M ${regime.ratio3m.toFixed(2)}` : undefined} />
            <StatTile
              small
              label="Vol regime"
              value={<span style={{ color: STATE_COLOR[regime.state] }}>{STATE_LABEL[regime.state]}</span>}
            />
          </div>
          <p className="small" style={{ margin: 0, color: 'var(--gold)' }}>{regime.read}</p>
          {error && <div className="muted small" style={{ marginTop: 6 }}>Partial data: {error}</div>}
        </>
      )}

      <Principle domain="Volatility & the term structure">
        The VIX level tells you less than its SHAPE. In contango (30-day below 3-month) vol sellers are paid to sell
        every spike — dips get bought and fading panic is the edge. When the 9-day trades ABOVE the 30-day, the market
        is pricing a specific event inside two weeks: expect compression into it and a vol crush after — the classic
        setup around CPI/FOMC. Backwardation (30-day above 3-month) is the crisis signature: hedging is being bought at
        any price, rallies are short-covering, and position size — not direction — is the first decision.
      </Principle>
    </div>
  );
}

/* ------------------------- gamma & walls panel --------------------------- */

function GexChart({ prof }: { prof: GammaProfile }) {
  const window = prof.rows.filter((r) => Math.abs(r.strike - prof.spot) / prof.spot <= 0.05);
  const data = (window.length >= 8 ? window : prof.rows).map((r) => ({ strike: r.strike, gex: r.gex / 1e9, putOI: r.putOI, callOI: r.callOI }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }} barCategoryGap={1}>
        <CartesianGrid stroke="#262320" vertical={false} />
        <XAxis dataKey="strike" {...AXIS} minTickGap={40} />
        <YAxis {...AXIS} width={54} tickFormatter={(v: number) => `${v.toFixed(1)}B`} />
        <ReferenceLine y={0} stroke="#3a362f" />
        <ReferenceLine x={prof.spot} stroke="#d3a94f" strokeDasharray="4 3" label={{ value: 'spot', fill: '#d3a94f', fontSize: 11, position: 'top' }} />
        {prof.zeroGamma != null && (
          <ReferenceLine x={prof.zeroGamma} stroke="#3987e5" strokeDasharray="4 3" label={{ value: 'flip', fill: '#3987e5', fontSize: 11, position: 'top' }} />
        )}
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { strike: number; gex: number; putOI: number; callOI: number };
            return (
              <div className="viz-tooltip">
                <div className="tt-title">Strike {p.strike}</div>
                <div className="tt-row"><span>Net GEX</span><b>{p.gex.toFixed(2)}B / 1%</b></div>
                <div className="tt-row"><span>Call OI</span><b>{p.callOI.toLocaleString()}</b></div>
                <div className="tt-row"><span>Put OI</span><b>{p.putOI.toLocaleString()}</b></div>
              </div>
            );
          }}
        />
        <Bar dataKey="gex" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.strike} fill={d.gex >= 0 ? 'rgba(12,163,12,0.8)' : 'rgba(230,103,103,0.85)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const LEVEL_COLOR: Record<KeyLevel['kind'], string> = {
  'call-wall': 'var(--profit)',
  'gamma-peak': 'var(--gold)',
  flip: '#3987e5',
  'gamma-trough': 'var(--loss)',
  'put-wall': 'var(--loss)',
};

/** The dealer-level ladder: each level with its distance and expected behavior. */
function KeyLevelsLadder({ prof, future, mapNote }: { prof: GammaProfile; future: string; mapNote: string }) {
  const levels = keyLevels(prof);
  if (!levels.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>
        Key dealer levels — index points, read them on <b>{future}</b> as zones
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {levels.map((l) => (
          <div key={`${l.kind}-${l.level}`} className="card" style={{ padding: '8px 12px', borderLeft: `3px solid ${LEVEL_COLOR[l.kind]}` }}>
            <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontWeight: 700, fontSize: 15, width: 76 }}>{l.level.toLocaleString()}</span>
              <b style={{ color: LEVEL_COLOR[l.kind], width: 140 }}>{l.label}</b>
              <span className={`mono small ${l.distPct >= 0 ? 'pos' : 'neg'}`}>{l.distPct >= 0 ? '+' : ''}{l.distPct.toFixed(1)}% from spot</span>
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>{l.behavior}</div>
          </div>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>{mapNote}</div>
    </div>
  );
}

function GammaPanel() {
  const [rootSym, setRootSym] = useState(OPTION_ROOTS[0].root);
  const [chains, setChains] = useState<Record<string, ChainSnapshot | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<'nearest' | 'monthly' | 'all'>('nearest');

  const rootInfo = OPTION_ROOTS.find((r) => r.root === rootSym) ?? OPTION_ROOTS[0];
  const chain = chains[rootSym] ?? null;

  const refresh = async (force: boolean, sym = rootSym) => {
    setLoading(true);
    const res = await loadChain(sym, force);
    setChains((m) => ({ ...m, [sym]: res.chain }));
    setError(res.error);
    setLoading(false);
  };
  useEffect(() => {
    if (!chains[rootSym]) void refresh(false, rootSym);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootSym]);

  const prof = useMemo(() => {
    if (!chain) return null;
    if (sel === 'all') return gammaProfile(chain, 'all');
    if (sel === 'nearest') return gammaProfile(chain, 'nearest');
    // monthly = the next standard 3rd-Friday expiry
    const expiries = [...new Set(chain.entries.map((e) => e.expiry))].sort();
    const monthly = expiries.find((e) => {
      const d = new Date(e + 'T12:00:00Z');
      return d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21;
    });
    return gammaProfile(chain, monthly ? [monthly] : 'nearest');
  }, [chain, sel]);

  const nextOpex = useMemo(() => upcomingEvents(todayISO(), 35).find((e) => e.short === 'OPEX' || e.short === 'Quad Witching') ?? null, []);

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Dealer gamma &amp; the walls <span className="hint">per-strike open interest and net gamma exposure — the mechanics behind pinning and air pockets</span>
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {OPTION_ROOTS.map((r) => (
            <span key={r.root} className={`chip clickable ${rootSym === r.root ? 'selected' : ''}`} onClick={() => setRootSym(r.root)}>
              {r.label} ({r.future})
            </span>
          ))}
          <span style={{ width: 10 }} />
          {(['nearest', 'monthly', 'all'] as const).map((s) => (
            <span key={s} className={`chip clickable ${sel === s ? 'selected' : ''}`} onClick={() => setSel(s)}>
              {s === 'nearest' ? 'Nearest expiry' : s === 'monthly' ? 'Monthly OPEX' : 'All expiries'}
            </span>
          ))}
          <button className="btn sm" disabled={loading} onClick={() => void refresh(true)}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {!prof ? (
        <div className="muted small">
          {error ? (
            <><b>Chain unavailable:</b> {error} The first load pulls the full {rootInfo.label} chain from CBOE's free CDN (heavy — a few MB); it is cached for 15 minutes after that.</>
          ) : (
            `Pulling the ${rootInfo.label} option chain (first load is a few MB — then cached)…`
          )}
        </div>
      ) : (
        <>
          {chain?.stale && <div className="muted small" style={{ marginBottom: 8 }}>Showing the cached chain — the latest refresh failed ({error}).</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
            <StatTile
              small
              label="Gamma regime"
              value={<span className={prof.regime === 'positive' ? 'pos' : 'neg'}>{prof.regime === 'positive' ? 'Positive' : 'Negative'}</span>}
              delta={`net ${(prof.totalGex / 1e9).toFixed(1)}B$/1%`}
            />
            <StatTile small label="Zero-gamma flip" value={prof.zeroGamma != null ? prof.zeroGamma.toLocaleString() : '—'} delta={`spot ${Math.round(prof.spot).toLocaleString()}`} />
            <StatTile small label="Put wall" value={prof.putWall != null ? prof.putWall.toLocaleString() : '—'} valueClass="neg" delta="heaviest put OI" />
            <StatTile small label="Call wall" value={prof.callWall != null ? prof.callWall.toLocaleString() : '—'} valueClass="pos" delta="heaviest call OI" />
            <StatTile
              small
              label="OI at nearest expiry"
              value={`${Math.round(prof.nearestExpiryShare * 100)}%`}
              delta={nextOpex ? `OPEX ${weekdayName(nextOpex.date).slice(0, 3)} ${nextOpex.date.slice(5)}` : undefined}
            />
          </div>
          <GexChart prof={prof} />
          <div className="row" style={{ gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
            <span className="small"><span className="grade-dot" style={{ background: 'rgba(12,163,12,0.8)' }} /> net GEX + (dampening)</span>
            <span className="small"><span className="grade-dot" style={{ background: 'rgba(230,103,103,0.85)' }} /> net GEX − (amplifying)</span>
            <span className="muted small" style={{ marginLeft: 'auto' }}>
              {prof.included.length === 1 ? `expiry ${fmtDateShort(prof.included[0])}` : `${prof.included.length} expiries`} · as of {chain ? new Date(chain.fetchedAt).toLocaleTimeString().slice(0, 5) : ''} (delayed)
            </span>
          </div>
          <p className="small" style={{ margin: '12px 0 0', color: 'var(--gold)' }}>{gammaRead(prof)}</p>
          <KeyLevelsLadder prof={prof} future={rootInfo.future} mapNote={rootInfo.mapNote} />
        </>
      )}

      <Principle domain="Flow — dealer gamma, walls & OPEX">
        Market makers hedge the options they've sold, and that hedging is FORCED flow. In POSITIVE gamma they trade
        against the market (sell rallies, buy dips) — moves stall, big OI strikes act like magnets, and expiration
        Fridays pin. In NEGATIVE gamma their hedging chases the market — small pushes become trend days and stops get
        run through air pockets. The PUT WALL is where crash protection is thickest (mechanical support), the CALL WALL
        caps grind-ups (mechanical resistance), and the FLIP level is where the whole regime changes. Into OPEX these
        forces peak — then the hedges expire, the pin releases, and the session after expiration often makes the clean
        directional move. Trade the mechanics: respect walls as first targets, expect chop above the flip and speed
        below it, and never expect a trend day inside a heavy positive-gamma pin.
      </Principle>
    </div>
  );
}

/* ----------------------- expiration & flow calendar ---------------------- */

/** Settlement mechanics per flow-event type — the exact hours and what settles. */
const EXPIRY_MECHANICS: Record<string, string> = {
  OPEX:
    'Two settlements, two hours: SPX traditional (AM-settled) stops trading Thursday 16:00 ET and settles on Friday\'s 09:30 SOQ (opening prints of every SPX component); SPXW weeklies, equity and ETF options trade to Friday 16:00 ET (PM-settled). The pin is strongest into each settlement hour, and the hedges backing it die WITH the settlement — Friday afternoon trades on a lighter book than Friday morning.',
  'Quad Witching':
    'Index futures and AM index options settle on the Friday 09:30 ET SOQ — the opening auction is the volume event of the quarter. Equity/ETF options follow at 16:00 ET, and the 15:50 MOC carries the index-rebalance flow. Between the two windows, huge printed volume is mostly plumbing.',
  'VIX Expiry':
    'Wednesday morning, 30 days before the next monthly OPEX. Settlement (VRO) comes from the 09:30 ET opening auction of SPX options — a window that can be pushed by big SOQ orders. Vol positions reset here mid-week: the tape\'s character often changes from Wednesday 09:30 onward.',
  'Futures Roll':
    'Liquidity migrates to the next quarterly contract over roughly a week (calendar-spread volume peaks around 10:00–14:00 ET). Confirm you are quoting the new front month; DOM depth and footprint reads are distorted by spread legs all week.',
  'Month-End':
    'The rebalance window is 15:00–16:00 ET: equity MOC imbalances publish 15:50, bond index extensions buy duration into the 15:00 futures settle and the 16:00 bell.',
  'Quarter-End':
    'Same 15:00–16:00 ET window as month-end but with quarterly mandates stacked on top. Estimates circulate all week — the flow is often front-run days early, so the "obvious" close-day trade frequently disappoints.',
  'UST Auction':
    'Bids due 13:00 ET, results ~13:02. The tail (vs when-issued) and bid-to-cover hit ZN/ZB instantly; a weak 30-year is the one that spills into equities within minutes.',
  'New-Month Flow':
    'Fresh 401(k)/target-date inflows get put to work from the 09:30 open — the buy-side tilt is strongest in the first 60–90 minutes.',
};

/** Day-by-day mechanics of an OPEX week — what each session tends to do. */
const OPEX_WEEK: { day: string; read: string }[] = [
  { day: 'Mon–Tue', read: 'Charm & vanna decay: as expiry nears, dealer hedges on in-the-money-ish options bleed off, producing a slow supportive drift in quiet tape. Trend-following into strength works better than fading it.' },
  { day: 'Wednesday', read: 'VIX expiry (when it lands this week) resets vol hedges at the 09:30 SOQ — watch for the tape to change character from mid-morning. A post-expiry vol crush often fuels an index grind.' },
  { day: 'Thursday', read: 'Last trading day for AM-settled SPX monthlies (16:00 ET). Pinning to the big strikes tightens; range compression into the close is the norm, not a setup.' },
  { day: 'Friday (OPEX)', read: '09:30 SOQ prints the AM settlement — the volume burst is mechanical. Expect magnetism to round-number strikes most of the day, gamma rolling off into 16:00, and late-session drift as the pin releases.' },
  { day: 'Monday after', read: 'The unclenching: the expired hedges are gone, dealer gamma is at its lightest, and the market is freest to MOVE. The cleanest trend days of the month cluster here — size the breakout playbook up, the fade playbook down.' },
];

function ExpiryCalendarPanel() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showWeek, setShowWeek] = useState(false);
  const events = useMemo(
    () => upcomingEvents(todayISO(), 45).filter((e: CalendarEvent) => e.domain === 'flow'),
    [],
  );
  return (
    <div className="card">
      <div className="card-title">
        Expiration &amp; flow calendar <span className="hint">every mechanical date in the next 6 weeks — with the exact settlement hours</span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {events.map((e) => {
          const mech = EXPIRY_MECHANICS[e.short];
          const open = openId === e.id;
          return (
            <div
              key={e.id}
              className="card"
              style={{ padding: '10px 12px', cursor: 'pointer', borderLeft: `3px solid ${open ? 'var(--gold)' : 'var(--hairline)'}` }}
              onClick={() => setOpenId(open ? null : e.id)}
            >
              <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontWeight: 700, width: 86 }}>{weekdayName(e.date).slice(0, 3)} {e.date.slice(5)}</span>
                <span className="mono muted small" style={{ width: 110 }}>{e.timeET} ET · {localTime(e.instant)} local</span>
                <b>{e.short}</b>
                <span className="muted small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                {e.approx && <span className="chip" style={{ fontSize: 10, padding: '0 5px', color: 'var(--muted)' }}>est.</span>}
              </div>
              {open && (
                <div className="small" style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                  {mech && <div><b style={{ color: 'var(--gold)' }}>Mechanics &amp; hours:</b> <span className="muted">{mech}</span></div>}
                  <div><b style={{ color: 'var(--gold)' }}>Why it matters:</b> <span className="muted">{e.why}</span></div>
                  <div><b style={{ color: 'var(--gold)' }}>Play:</b> <span className="muted">{e.playbook}</span></div>
                </div>
              )}
            </div>
          );
        })}
        {!events.length && <div className="muted small">No flow events computed for the next 6 weeks — unexpected; check the calendar module.</div>}
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
        <div className="spread" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowWeek((s) => !s)}>
          <b className="small" style={{ color: 'var(--gold)' }}>{showWeek ? '▾' : '▸'} How to trade OPEX week — day by day</b>
        </div>
        {showWeek && (
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {OPEX_WEEK.map((d) => (
              <div key={d.day} className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                <span className="mono small" style={{ fontWeight: 700, width: 104, flexShrink: 0 }}>{d.day}</span>
                <span className="muted small">{d.read}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Principle domain="Flow — trading expiration dates">
        Expiration edges are TIME-STAMPED: the pin exists only while the hedges behind it are alive, and each settlement
        hour (Thu 16:00, Fri 09:30, Fri 16:00, VIX Wednesday 09:30) kills a layer of them. That is why the same chart
        pattern fails on OPEX Friday morning and works on the Monday after. Before an expiration day, note three things
        from this page: WHERE the pin is (gamma magnet / walls), HOW MUCH dies at this expiry (OI share tile above),
        and WHICH settlement hours apply — then expect compression before each hour and freedom after the last one.
      </Principle>
    </div>
  );
}

/* --------------------------- session flow map ---------------------------- */

const SESSION_FLOWS: { time: string; name: string; why: string; play: string }[] = [
  {
    time: '09:30 ET',
    name: 'Cash open & opening drive',
    why: 'The overnight inventory meets the day-timeframe players; the opening auction resolves who is trapped.',
    play: 'Classify the open (drive / test-drive / rejection / auction). An open-drive away from value rarely looks back — join early or leave it; fading it is the lowest-odds trade of the day.',
  },
  {
    time: '10:00 ET',
    name: 'Data window & first reversal slot',
    why: 'The 10:00 releases (ISM, sentiment) and the exhaustion of opening orders make this the first common inflection.',
    play: 'If the opening move was inventory-driven, this is where it corrects. Watch for the first meaningful delta divergence on the push.',
  },
  {
    time: '11:30–13:30 ET',
    name: 'Lunch / European close',
    why: 'Europe hands off its book around 11:30 ET; liquidity and range participation thin out.',
    play: 'Ranges compress and false breaks multiply. Scale expectations down — or stand down. The Euro-close unwind can retrace the morning trend.',
  },
  {
    time: '14:00 ET',
    name: 'Afternoon re-engagement',
    why: 'Bond futures settle 15:00; announcements (refunding, minutes) land 14:00; the afternoon auction picks a direction.',
    play: 'Breaks of the lunch balance carry real participation again. The 14:00–15:00 direction often runs to the close.',
  },
  {
    time: '15:50 ET',
    name: 'MOC imbalance window',
    why: 'Market-on-close orders publish ~15:50; index rebalancing and fund flow must execute by the bell.',
    play: 'A large published imbalance drags price its way into 16:00. Do not fade a strong MOC push — front-run it or leave it.',
  },
];

function SessionFlowPanel() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="card">
      <div className="card-title">
        The session's flow map <span className="hint">the recurring mechanical windows of every US day — click each for the play</span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {SESSION_FLOWS.map((f, i) => (
          <div
            key={f.time}
            className="card"
            style={{ padding: '10px 12px', cursor: 'pointer', borderLeft: `3px solid ${open === i ? 'var(--gold)' : 'var(--hairline)'}` }}
            onClick={() => setOpen(open === i ? null : i)}
          >
            <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
              <span className="mono" style={{ fontWeight: 700, width: 100 }}>{f.time}</span>
              <b>{f.name}</b>
            </div>
            {open === i && (
              <div className="small" style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                <div><b style={{ color: 'var(--gold)' }}>Why:</b> <span className="muted">{f.why}</span></div>
                <div><b style={{ color: 'var(--gold)' }}>Play:</b> <span className="muted">{f.play}</span></div>
              </div>
            )}
          </div>
        ))}
      </div>
      <Principle domain="Flow — opens, MOC & the clock">
        Flow trades repeat because the CLOCK forces them: funds must open, Europe must close, MOC must print. That
        makes time-of-day a genuine edge domain — the same setup means different things at 09:35, 12:30 and 15:55.
        Anchor every intraday read to the window it happens in, and let your own time-of-day stats (Edge Analytics →
        timing heatmap) tell you which windows pay YOU.
      </Principle>
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

export default function OptionsVol() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Options &amp; Vol</h1>
          <p className="page-sub">
            The dealer-flow layer: live VIX term structure, per-strike gamma and open-interest walls, OPEX
            concentration and the session's mechanical windows — free CBOE data, no key required.
          </p>
        </div>
      </div>
      <div className="stack">
        <VixPanel />
        <GammaPanel />
        <ExpiryCalendarPanel />
        <SessionFlowPanel />
      </div>
    </>
  );
}
