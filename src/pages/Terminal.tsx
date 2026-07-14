import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Connects } from '../components/Connects';
import { Principle, StatTile } from '../components/ui';
import { reconciledEventsForDate } from '../lib/reconcile';
import { fmtCountdown, openNow, primeTime } from '../lib/sessions';
import { todayISO } from '../lib/format';
import { analyzeSeries, loadCot, type CotAnalysis } from '../lib/cot';
import { analyzeRates, loadRates, type RatesRead } from '../lib/rates';
import { loadNarrative, type ThemeSeries } from '../lib/narrative';
import { loadBreadth, loadCrossAsset, type BreadthRead, type CrossAssetRead } from '../lib/crossAsset';
import { expectedMove, loadCboeQuote, loadChain, vixRegime, type ExpectedMove, type VixRegime } from '../lib/options';
import {
  daysToOpex,
  fetchEarnings,
  fetchVolumePulse,
  synthesize,
  type EarningsRow,
  type TerminalInputs,
  type VolumePulse,
} from '../lib/terminal';

/*
 * Edge Terminal — one screen, one read.
 *
 * Every card elsewhere in the platform answers a single question from a single
 * source. This page fuses them: the vol curve, breadth, the yield curve,
 * positioning extremes, narrative heat, the options-priced move, volume
 * participation, expiration proximity, today's catalysts and the earnings
 * that move index futures — into a computed, explainable desk-head read.
 * Each block loads independently and degrades gracefully; the synthesis
 * sharpens as feeds arrive.
 */

const REGIME_COLOR = (regime: string): string =>
  regime.startsWith('RISK-ON') ? 'var(--profit)'
  : regime.startsWith('RISK-OFF') ? 'var(--loss)'
  : regime.startsWith('EVENT') ? 'var(--gold)'
  : regime.startsWith('NARROW') ? '#cc5f83'
  : 'var(--muted)';

export default function Terminal() {
  const [vix, setVix] = useState<VixRegime | null>(null);
  const [em, setEm] = useState<ExpectedMove | null>(null);
  const [breadth, setBreadth] = useState<BreadthRead | null>(null);
  const [rates, setRates] = useState<RatesRead | null>(null);
  const [cotX, setCotX] = useState<string[]>([]);
  const [narr, setNarr] = useState<ThemeSeries | null>(null);
  const [pulse, setPulse] = useState<VolumePulse | null>(null);
  const [earnings, setEarnings] = useState<EarningsRow[] | null>(null);
  const [xa, setXa] = useState<CrossAssetRead | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const ok = <T,>(set: (v: T) => void) => (v: T) => { if (alive) set(v); };

    void (async () => {
      const [v, v9, v3] = await Promise.all([loadCboeQuote('_VIX'), loadCboeQuote('_VIX9D'), loadCboeQuote('_VIX3M')]);
      if (v.quote) ok(setVix)(vixRegime(v.quote.price, v9.quote?.price ?? null, v3.quote?.price ?? null));
    })();
    void loadChain('_SPX').then(({ chain }) => { if (chain) ok(setEm)(expectedMove(chain)); });
    void loadBreadth().then(({ read }) => { if (read) ok(setBreadth)(read); });
    void loadRates().then((r) => { if (r.snapshot) ok(setRates)(analyzeRates(r.snapshot)); });
    void loadCot().then((r) => {
      if (!r.snapshot) return;
      const extremes: string[] = [];
      for (const s of r.snapshot.series) {
        const a: CotAnalysis | null = analyzeSeries(s);
        if (!a || a.pctile1y == null) continue;
        if (a.flags.includes('extreme-high')) extremes.push(`${a.market.symbol} specs ${Math.round(a.pctile1y)}th pctile long`);
        if (a.flags.includes('extreme-low')) extremes.push(`${a.market.symbol} specs ${Math.round(a.pctile1y)}th pctile short`);
      }
      ok(setCotX)(extremes);
    });
    void loadNarrative().then((r) => {
      const top = r.series.filter((s) => s.surging).sort((a, b) => (b.z ?? 0) - (a.z ?? 0))[0] ?? null;
      if (top) ok(setNarr)(top);
    });
    void fetchVolumePulse('SPY').then((p) => { if (p) ok(setPulse)(p); });
    const from = todayISO();
    const to = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    void fetchEarnings(from, to).then((rows) => { if (rows) ok(setEarnings)(rows); });
    void loadCrossAsset().then((r) => { if (r.read) ok(setXa)(r.read); });

    return () => { alive = false; };
  }, []);

  const today = todayISO();
  const todaysEvents = useMemo(() => reconciledEventsForDate(today).events, [today]);
  const opexIn = daysToOpex(now);
  const open = openNow(now);
  const prime = primeTime(now);

  const inputs: TerminalInputs = {
    volState: vix?.state ?? null,
    vix: vix?.vix ?? null,
    breadthAbove50: breadth?.above50Count ?? null,
    rspSpy20: breadth?.rspSpy20 ?? null,
    curveBps: rates?.spreadNow ?? null,
    curveInverted: rates ? rates.inverted : null,
    cotExtremes: cotX,
    narrativeTop: narr?.theme.label ?? null,
    expectedMovePct: em?.dailyPct ?? null,
    volumeRatio: pulse?.ratio ?? null,
    daysToOpex: opexIn,
    catalystsToday: todaysEvents.length,
    earningsCount: earnings?.length ?? 0,
  };
  const read = synthesize(inputs);
  const regimeColor = REGIME_COLOR(read.regime);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h1 className="page-title">Edge Terminal</h1>
        <div className="page-sub">
          Everything the platform knows, fused into one desk-head read: where we are, what today wants to do, and
          exactly which input says so. Each line names its source — the read teaches while it orients.
        </div>
      </div>

      {/* regime banner */}
      <div className="card" style={{ borderLeft: `4px solid ${regimeColor}` }}>
        <div className="row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.5, color: regimeColor }}>{read.regime}</span>
          <span className="muted small">
            {open.length ? `open: ${open.map((s) => s.def.short).join(' · ')}` : 'all primary sessions closed'}
            {prime?.msToEnd != null && ` · PRIME TIME (${fmtCountdown(prime.msToEnd)} left)`}
          </span>
        </div>
        <p className="small" style={{ margin: '8px 0 0', maxWidth: 900 }}>{read.banner}</p>
      </div>

      {/* the instrument panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <StatTile small label="Vol regime" value={vix ? vix.state.toUpperCase() : '—'} delta={vix ? `VIX ${vix.vix.toFixed(1)}${vix.ratio3m != null ? ` · /3M ${vix.ratio3m.toFixed(2)}` : ''}` : 'loading vol curve'} valueClass={vix?.state === 'stress' ? 'neg' : undefined} />
        <StatTile small label="Options-priced day (SPX 1σ)" value={em ? `±${em.dailyPct.toFixed(2)}%` : '—'} delta={em ? `±${em.daily.toFixed(0)} pts · IV ${(em.atmIV * 100).toFixed(1)}%` : 'needs /api/cboe'} />
        <StatTile small label="Breadth (sectors > 50DMA)" value={breadth ? `${breadth.above50Count}/11` : '—'} delta={breadth?.rspSpy20 != null ? `RSP−SPY 20d ${breadth.rspSpy20 > 0 ? '+' : ''}${breadth.rspSpy20.toFixed(1)}%` : undefined} valueClass={breadth && breadth.above50Count <= 3 ? 'neg' : undefined} />
        <StatTile small label="Curve (2s10s)" value={rates ? `${rates.spreadNow > 0 ? '+' : ''}${rates.spreadNow.toFixed(0)}bp` : '—'} delta={rates ? (rates.inverted ? `inverted ${rates.invertedDays}d` : '10y ' + rates.y10Now.toFixed(2) + '%') : undefined} />
        <StatTile small label="Positioning extremes" value={cotX.length ? String(cotX.length) : '0'} delta={cotX[0] ?? 'no crowded books flagged'} valueClass={cotX.length >= 3 ? 'neg' : undefined} />
        <StatTile small label="Narrative heat" value={narr ? narr.theme.label : 'quiet'} delta={narr?.z != null ? `+${narr.z.toFixed(1)}σ media volume` : 'no surging story'} />
        <StatTile small label="Volume pulse (SPY)" value={pulse ? `${pulse.ratio.toFixed(2)}×` : '—'} delta={pulse ? 'vs 20-day average' : 'needs market-data key'} valueClass={pulse && pulse.ratio < 0.85 ? 'neg' : undefined} />
        <StatTile small label="Monthly OPEX" value={opexIn === 0 ? 'TODAY' : `${opexIn}d`} delta={opexIn <= 4 ? 'pin risk rising' : 'no pin force yet'} valueClass={opexIn <= 1 ? 'neg' : undefined} />
      </div>

      {/* the read */}
      <div className="card">
        <div className="card-title">
          The read <span className="hint">rules-based synthesis — every line names the input that produced it</span>
        </div>
        <div className="grid grid-2" style={{ gap: 14 }}>
          <div>
            <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 4 }}>Leans — the direction of least resistance</div>
            <div className="stack" style={{ gap: 5 }}>
              {read.leans.length ? read.leans.map((l) => <div key={l.slice(0, 24)} className="small muted">• {l}</div>) : <div className="small muted">Waiting on breadth / curve / volume feeds…</div>}
            </div>
            <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', margin: '10px 0 4px' }}>Focus — how to trade this regime</div>
            <div className="stack" style={{ gap: 5 }}>
              {read.focus.map((l) => <div key={l.slice(0, 24)} className="small muted">• {l}</div>)}
            </div>
          </div>
          <div>
            <div className="small" style={{ fontWeight: 700, color: 'var(--loss)', marginBottom: 4 }}>Risks — what can break the read</div>
            <div className="stack" style={{ gap: 5 }}>
              {read.risks.length ? read.risks.map((l) => <div key={l.slice(0, 24)} className="small muted">• {l}</div>) : <div className="small muted">No concentrated risks flagged by the inputs that have loaded.</div>}
            </div>
            {todaysEvents.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 4 }}>Today&apos;s scheduled volatility</div>
                {todaysEvents.slice(0, 4).map((e) => (
                  <div key={e.short + e.date} className="small muted">• {e.short} — {e.name} <Link to="/catalysts" style={{ color: 'var(--gold)' }}>study →</Link></div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* cross-asset state */}
      <div className="card">
        <div className="card-title">
          Cross-asset state <span className="hint">20-day trend & realized-vol percentile per market · correlation breaks flag regime change</span>
        </div>
        {!xa ? (
          <div className="muted small">Needs the market-data connection — 20d trend/vol per asset and correlation-break detection load with your key.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="data" style={{ minWidth: 520 }}>
                <thead>
                  <tr><th>Market</th><th style={{ textAlign: 'right' }}>20d trend</th><th style={{ textAlign: 'right' }}>Realized vol</th><th style={{ textAlign: 'right' }}>Vol pctile</th></tr>
                </thead>
                <tbody>
                  {xa.states.map((s) => (
                    <tr key={s.symbol}>
                      <td>{s.label}</td>
                      <td className={`mono ${s.ret20 > 0 ? 'pos' : s.ret20 < 0 ? 'neg' : ''}`} style={{ textAlign: 'right' }}>{s.ret20 > 0 ? '+' : ''}{s.ret20.toFixed(1)}%</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{s.vol20.toFixed(0)}%</td>
                      <td className={`mono ${s.volPctile != null && s.volPctile >= 80 ? 'neg' : ''}`} style={{ textAlign: 'right' }}>{s.volPctile != null ? `${Math.round(s.volPctile)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {xa.breaks.length > 0 && (
              <div className="small muted" style={{ marginTop: 8 }}>
                <b style={{ color: 'var(--gold)' }}>Correlation breaks:</b>{' '}
                {xa.breaks.slice(0, 3).map((b) => `${b.a}×${b.b} (20d ${b.c20.toFixed(2)} vs norm ${b.c60.toFixed(2)})`).join(' · ')} — when stable
                relationships snap, a regime is changing before the headlines say so.
              </div>
            )}
          </>
        )}
      </div>

      {/* earnings radar */}
      <div className="card">
        <div className="card-title">
          Earnings radar <span className="hint">only the prints big enough to move index futures — next 7 days</span>
        </div>
        {earnings == null ? (
          <div className="muted small">Needs the market-data connection — the index-mover earnings calendar loads with your key.</div>
        ) : earnings.length === 0 ? (
          <div className="muted small">No index-moving earnings in the next 7 days — single-stock risk is off the board; macro owns the tape.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data" style={{ minWidth: 560 }}>
              <thead>
                <tr><th>Date</th><th>Name</th><th>Session</th><th>Moves</th><th>Why it matters</th></tr>
              </thead>
              <tbody>
                {earnings.map((r) => (
                  <tr key={r.sym}>
                    <td className="mono">{r.date.slice(5)}</td>
                    <td><b>{r.sym}</b> <span className="muted small">{r.name}</span></td>
                    <td className="small">{r.session}</td>
                    <td className="mono small">{r.drives}</td>
                    <td className="muted small">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <Principle domain="Synthesis — why one read beats ten dashboards">
          Edge does not come from having the data — everyone has the data. It comes from the ORDER of interpretation:
          vol regime first (it sets how price moves), then breadth and the curve (whether the move is trusted), then
          positioning and narrative (who is offside and which story is loaded), then the options rails (where the move
          stalls). The Terminal runs that order for you every time you open it, and shows its work — so on the days
          the inputs disagree, you know exactly which disagreement to respect. When this screen and your prep agree,
          size up; when they conflict, the conflict IS the information.
        </Principle>
      </div>

      <Connects id="terminal" />
    </div>
  );
}
