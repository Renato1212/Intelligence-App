import { useEffect, useMemo, useState } from 'react';
import { Connects } from '../components/Connects';
import { LinePanel, OverlayChart, OVERLAY_COLORS, type OverlaySeries } from '../components/OverlayChart';
import { Principle, StatTile } from '../components/ui';
import {
  alignSeries, dispersionRead, dispersionSeries, leadLag, rateOfChangeLabel, ratioSeries, readFlowPairs,
  rebase, rollingBeta, rollingCorrelation, rotationTable, synthesiseFlows, zScoreSeries,
  type NamedSeries,
} from '../lib/flows';
import { correlation } from '../lib/crossAsset';
import { FLOW_UNIVERSE, loadBasket } from '../lib/flowsData';
import { returns } from '../lib/flows';

/*
 * Flows — cross-asset money flow, the way a macro desk reads it.
 *
 * Correlation tables are everywhere; what is rare is putting instruments on ONE
 * comparable axis and asking what the relationship is doing. This section
 * overlays them in percentage space, turns the canonical pairs into ratio
 * lines (which ARE the flow), tracks whether relationships are holding, finds
 * which market moves first, and measures how correlated the whole basket has
 * become — the dial that decides whether diversification is working at all.
 */

const LOOKBACKS = [
  { days: 21, label: '1M' },
  { days: 63, label: '3M' },
  { days: 126, label: '6M' },
  { days: 252, label: '1Y' },
];

type Mode = 'rebased' | 'ratio' | 'zscore';

const DEFAULT_BASKET = ['SPY', 'QQQ', 'IWM', 'TLT', 'HYG', 'GLD', 'CPER', 'UUP'];

export default function Flows() {
  const [selected, setSelected] = useState<string[]>(DEFAULT_BASKET);
  const [lookback, setLookback] = useState(63);
  const [mode, setMode] = useState<Mode>('rebased');
  const [pairA, setPairA] = useState('SPY');
  const [pairB, setPairB] = useState('TLT');
  const [corrWindow, setCorrWindow] = useState(20);
  const [series, setSeries] = useState<NamedSeries[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // the ratio map needs its own symbols regardless of what the user selected
  const needed = useMemo(() => {
    const flowSymbols = ['SPY', 'TLT', 'QQQ', 'IWM', 'XLY', 'XLP', 'CPER', 'GLD', 'HYG', 'IEF', 'SMH', 'EEM'];
    return [...new Set([...selected, ...flowSymbols, pairA, pairB])];
  }, [selected, pairA, pairB]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadBasket(needed).then((r) => {
      if (!alive) return;
      setSeries(r.series);
      setMissing(r.missing);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [needed]);

  const bySymbol = useMemo(() => new Map(series.map((s) => [s.symbol, s])), [series]);

  /** the selected basket, aligned and cut to the lookback window */
  const windowed = useMemo(() => {
    const picked = selected.map((s) => bySymbol.get(s)).filter((s): s is NamedSeries => !!s);
    const { aligned } = alignSeries(picked);
    return aligned.map((s) => ({ ...s, closes: s.closes.slice(-lookback) }));
  }, [selected, bySymbol, lookback]);

  const overlay: OverlaySeries[] = useMemo(() => {
    if (mode === 'ratio') {
      const a = bySymbol.get(pairA);
      const b = bySymbol.get(pairB);
      if (!a || !b) return [];
      const ratio = ratioSeries(a.closes, b.closes).slice(-lookback);
      return [{ symbol: `${pairA}/${pairB}`, label: `${pairA} / ${pairB}`, color: OVERLAY_COLORS[0], points: rebase(ratio) }];
    }
    return windowed.map((s, i) => ({
      symbol: s.symbol,
      label: s.label,
      color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
      points: mode === 'zscore' ? zScoreSeries(s.closes) : rebase(s.closes),
    }));
  }, [mode, windowed, bySymbol, pairA, pairB, lookback]);

  const pairSeriesA = bySymbol.get(pairA);
  const pairSeriesB = bySymbol.get(pairB);
  const rollCorr = useMemo(
    () => (pairSeriesA && pairSeriesB ? rollingCorrelation(pairSeriesA.closes, pairSeriesB.closes, corrWindow).slice(-lookback) : []),
    [pairSeriesA, pairSeriesB, corrWindow, lookback],
  );
  const rollBeta = useMemo(
    () => (pairSeriesA && pairSeriesB ? rollingBeta(pairSeriesA.closes, pairSeriesB.closes, 60).slice(-lookback) : []),
    [pairSeriesA, pairSeriesB, lookback],
  );
  const ll = useMemo(() => (pairSeriesA && pairSeriesB ? leadLag(pairSeriesA, pairSeriesB, 10) : null), [pairSeriesA, pairSeriesB]);

  const disp = useMemo(() => dispersionSeries(windowed.length >= 2 ? windowed : [], corrWindow), [windowed, corrWindow]);
  const dispLatest = disp.length ? disp[disp.length - 1].value : null;
  const dispPrior = disp.length > 21 ? disp[disp.length - 22].value : null;

  const flowReadings = useMemo(() => readFlowPairs(bySymbol, Math.min(lookback, 21)), [bySymbol, lookback]);
  const read = useMemo(() => synthesiseFlows(flowReadings, dispLatest), [flowReadings, dispLatest]);
  const rotation = useMemo(() => rotationTable(windowed.length ? windowed : series, 'SPY'), [windowed, series]);

  const matrix = useMemo(() => {
    const rets = windowed.map((s) => ({ symbol: s.symbol, r: returns(s.closes).slice(-corrWindow).map((x) => x.r) }));
    return rets.map((a) => ({
      symbol: a.symbol,
      cells: rets.map((b) => ({ symbol: b.symbol, c: a.symbol === b.symbol ? 1 : correlation(a.r, b.r) })),
    }));
  }, [windowed, corrWindow]);

  const toggle = (sym: string) =>
    setSelected((cur) => (cur.includes(sym) ? (cur.length > 2 ? cur.filter((s) => s !== sym) : cur) : [...cur, sym]));

  const headlineColor = read.headline.startsWith('RISK-ON')
    ? 'var(--profit)'
    : read.headline.startsWith('RISK-OFF')
      ? 'var(--loss)'
      : 'var(--gold)';

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h1 className="page-title">Flows</h1>
        <div className="page-sub">
          Where the money is going, and what it implies. Instruments overlaid on one comparable axis, the canonical
          ratios that ARE the flow, whether relationships are holding, which market moves first, and how correlated
          the whole basket has become.
        </div>
      </div>

      {/* the desk read */}
      <div className="card" style={{ borderLeft: `4px solid ${headlineColor}` }}>
        <div className="row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 17, color: headlineColor }}>{read.headline}</span>
          <span className="muted small">over the last {Math.min(lookback, 21)} sessions</span>
        </div>
        <div className="stack" style={{ gap: 5, marginTop: 9 }}>
          {read.lines.map((l) => (
            <div key={l.slice(0, 28)} className="small muted" style={{ lineHeight: 1.55 }}>• {l}</div>
          ))}
        </div>
        {read.implications.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
            <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 4 }}>What it implies</div>
            {read.implications.map((l) => (
              <div key={l.slice(0, 28)} className="small muted" style={{ lineHeight: 1.55 }}>→ {l}</div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <StatTile
          small
          label="Average pairwise correlation"
          value={dispLatest != null ? dispLatest.toFixed(2) : '—'}
          delta={dispLatest != null ? (dispLatest >= 0.7 ? 'one trade — diversification off' : dispLatest < 0.3 ? 'stock-pickers regime' : 'mixed regime') : `${corrWindow}-day window`}
          valueClass={dispLatest != null && dispLatest >= 0.7 ? 'neg' : dispLatest != null && dispLatest < 0.3 ? 'pos' : undefined}
        />
        <StatTile small label="Leader (20d vs SPY)" value={rotation[0]?.label ?? '—'} delta={rotation[0]?.rs20 != null ? `${rotation[0].rs20! >= 0 ? '+' : ''}${rotation[0].rs20!.toFixed(1)}pp relative` : undefined} valueClass="pos" />
        <StatTile small label="Laggard (20d vs SPY)" value={rotation[rotation.length - 1]?.label ?? '—'} delta={rotation[rotation.length - 1]?.rs20 != null ? `${rotation[rotation.length - 1].rs20!.toFixed(1)}pp relative` : undefined} valueClass="neg" />
        <StatTile
          small
          label={`${pairA} vs ${pairB} correlation`}
          value={rollCorr.length ? rollCorr[rollCorr.length - 1].value.toFixed(2) : '—'}
          delta={ll ? (ll.bestLag === 0 ? 'no reliable lead' : ll.bestLag > 0 ? `${pairA} leads by ${ll.bestLag}d` : `${pairB} leads by ${Math.abs(ll.bestLag)}d`) : `${corrWindow}-day window`}
        />
      </div>

      {/* overlay */}
      <div className="card">
        <div className="card-title">
          Overlay
          <span className="hint">
            price-space overlays lie — everything here is plotted in a comparable space so the shapes can be compared honestly
          </span>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <div className="row" style={{ gap: 4, alignItems: 'center' }}>
            <span className="tile-label" style={{ marginRight: 2 }}>Mode</span>
            <span className={`chip clickable ${mode === 'rebased' ? 'selected' : ''}`} onClick={() => setMode('rebased')} title="All series rebased to 100 at the window start — percent since then">Rebased</span>
            <span className={`chip clickable ${mode === 'ratio' ? 'selected' : ''}`} onClick={() => setMode('ratio')} title="One line: the pair ratio, which is the flow itself">Ratio</span>
            <span className={`chip clickable ${mode === 'zscore' ? 'selected' : ''}`} onClick={() => setMode('zscore')} title="Each series in σ from its own window mean — comparable extremes">Z-score</span>
          </div>
          <div className="row" style={{ gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
            <span className="tile-label" style={{ marginRight: 2 }}>Window</span>
            {LOOKBACKS.map((l) => (
              <span key={l.days} className={`chip clickable ${lookback === l.days ? 'selected' : ''}`} onClick={() => setLookback(l.days)}>{l.label}</span>
            ))}
          </div>
        </div>

        {mode !== 'ratio' && (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {FLOW_UNIVERSE.map((u) => (
              <span key={u.symbol} className={`chip clickable ${selected.includes(u.symbol) ? 'selected' : ''}`} onClick={() => toggle(u.symbol)} title={`${u.label} — ${u.why}`}>
                {u.symbol}
              </span>
            ))}
          </div>
        )}
        {mode === 'ratio' && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
            <span className="tile-label">Ratio</span>
            <select value={pairA} onChange={(e) => setPairA(e.target.value)}>
              {FLOW_UNIVERSE.map((u) => <option key={u.symbol} value={u.symbol}>{u.symbol}</option>)}
            </select>
            <span className="muted">/</span>
            <select value={pairB} onChange={(e) => setPairB(e.target.value)}>
              {FLOW_UNIVERSE.map((u) => <option key={u.symbol} value={u.symbol}>{u.symbol}</option>)}
            </select>
            <span className="hint">a rising line = money moving INTO {pairA} and out of {pairB}</span>
          </div>
        )}

        {loading && <div className="muted small">Loading the basket…</div>}
        {!loading && (
          <OverlayChart
            series={overlay}
            baseline={mode === 'zscore' ? 0 : 100}
            fmt={(v) => (mode === 'zscore' ? `${v.toFixed(1)}σ` : v.toFixed(0))}
            valueLabel={mode === 'zscore' ? 'σ from the window mean' : 'rebased to 100 at the window start'}
          />
        )}
        {missing.length > 0 && (
          <div className="hint" style={{ marginTop: 6 }}>No history returned for {missing.join(', ')} — those are dropped rather than plotted as gaps.</div>
        )}
      </div>

      {/* pair lab */}
      <div className="card">
        <div className="card-title">
          Pair lab — {pairA} vs {pairB}
          <span className="hint">a relationship changing is the earliest regime signal there is</span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <select value={pairA} onChange={(e) => setPairA(e.target.value)}>
            {FLOW_UNIVERSE.map((u) => <option key={u.symbol} value={u.symbol}>{u.symbol} — {u.label}</option>)}
          </select>
          <span className="muted">vs</span>
          <select value={pairB} onChange={(e) => setPairB(e.target.value)}>
            {FLOW_UNIVERSE.map((u) => <option key={u.symbol} value={u.symbol}>{u.symbol} — {u.label}</option>)}
          </select>
          <div className="row" style={{ gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
            <span className="tile-label" style={{ marginRight: 2 }}>Corr window</span>
            {[10, 20, 60].map((w) => (
              <span key={w} className={`chip clickable ${corrWindow === w ? 'selected' : ''}`} onClick={() => setCorrWindow(w)}>{w}d</span>
            ))}
          </div>
        </div>

        <div className="small" style={{ fontWeight: 700, color: 'var(--gold)' }}>Rolling correlation ({corrWindow}-day)</div>
        <LinePanel points={rollCorr} bands={[-1, -0.5, 0, 0.5, 1]} />
        <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', marginTop: 10 }}>Rolling beta of {pairA} to {pairB} (60-day)</div>
        <LinePanel points={rollBeta} bands={[0, 1]} color="var(--dom-flow)" />

        {ll && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
            <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 4 }}>Lead–lag</div>
            <p className="small muted" style={{ margin: '0 0 8px', lineHeight: 1.55 }}>{ll.read}</p>
            <div className="row" style={{ gap: 2, alignItems: 'flex-end', height: 64 }}>
              {ll.curve.map((p) => {
                const h = Math.max(2, Math.abs(p.corr) * 58);
                const isBest = p.lag === ll.bestLag;
                return (
                  <div key={p.lag} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }} title={`lag ${p.lag}: corr ${p.corr.toFixed(3)}`}>
                    <div
                      style={{
                        width: 13,
                        height: h,
                        background: isBest ? 'var(--gold)' : p.corr >= 0 ? 'var(--dom-tech)' : 'var(--loss)',
                        opacity: isBest ? 1 : 0.55,
                      }}
                    />
                    <span className="mono" style={{ fontSize: 8.5, color: p.lag === 0 ? 'var(--text)' : 'var(--muted)' }}>{p.lag}</span>
                  </div>
                );
              })}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              Correlation at each lag in sessions. Negative lags = {pairB} first, positive = {pairA} first, 0 = same day.
              A lead only counts when it beats the same-day bar by a clear margin — otherwise it is a pattern fitted after the fact.
            </div>
          </div>
        )}
      </div>

      {/* dispersion */}
      <div className="card">
        <div className="card-title">
          Correlation regime <span className="hint">how much of the basket is really one trade</span>
        </div>
        <LinePanel points={disp} bands={[0, 0.3, 0.5, 0.7, 1]} color="var(--dom-cb)" />
        {dispLatest != null && <p className="small muted" style={{ marginTop: 8, lineHeight: 1.6 }}>{dispersionRead(dispLatest, dispPrior)}</p>}
      </div>

      {/* correlation matrix */}
      <div className="card">
        <div className="card-title">
          Correlation matrix <span className="hint">{corrWindow}-day, daily returns — deep colour is a strong relationship</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data mono" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th />
                {matrix.map((r) => <th key={r.symbol} style={{ textAlign: 'center' }}>{r.symbol}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.symbol}>
                  <td style={{ fontWeight: 700 }}>{row.symbol}</td>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.symbol}
                      style={{
                        textAlign: 'center',
                        background: cell.c >= 0 ? `rgba(67,164,92,${Math.min(0.6, Math.abs(cell.c) * 0.6)})` : `rgba(204,95,131,${Math.min(0.6, Math.abs(cell.c) * 0.6)})`,
                        color: Math.abs(cell.c) > 0.6 ? 'var(--text)' : 'var(--muted)',
                      }}
                      title={`${row.symbol} vs ${cell.symbol}: ${cell.c.toFixed(3)}`}
                    >
                      {cell.c.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* rotation */}
      <div className="card">
        <div className="card-title">
          Rotation — relative strength <span className="hint">ranked by 20-day performance against SPY; risk-adjusted column is the honest leadership measure</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Market</th>
                <th style={{ textAlign: 'right' }}>5d</th>
                <th style={{ textAlign: 'right' }}>20d</th>
                <th style={{ textAlign: 'right' }}>60d</th>
                <th style={{ textAlign: 'right' }}>vs SPY (20d)</th>
                <th style={{ textAlign: 'right' }}>Vol</th>
                <th style={{ textAlign: 'right' }}>Ret/Vol</th>
                <th>Gear</th>
              </tr>
            </thead>
            <tbody>
              {rotation.map((r) => (
                <tr key={r.symbol}>
                  <td><b>{r.symbol}</b> <span className="muted small">{r.label}</span></td>
                  <td className={`mono ${(r.ret5 ?? 0) > 0 ? 'pos' : (r.ret5 ?? 0) < 0 ? 'neg' : ''}`} style={{ textAlign: 'right' }}>{r.ret5 != null ? `${r.ret5 >= 0 ? '+' : ''}${r.ret5.toFixed(1)}%` : '—'}</td>
                  <td className={`mono ${(r.ret20 ?? 0) > 0 ? 'pos' : (r.ret20 ?? 0) < 0 ? 'neg' : ''}`} style={{ textAlign: 'right' }}>{r.ret20 != null ? `${r.ret20 >= 0 ? '+' : ''}${r.ret20.toFixed(1)}%` : '—'}</td>
                  <td className={`mono ${(r.ret60 ?? 0) > 0 ? 'pos' : (r.ret60 ?? 0) < 0 ? 'neg' : ''}`} style={{ textAlign: 'right' }}>{r.ret60 != null ? `${r.ret60 >= 0 ? '+' : ''}${r.ret60.toFixed(1)}%` : '—'}</td>
                  <td className={`mono ${(r.rs20 ?? 0) > 0 ? 'pos' : (r.rs20 ?? 0) < 0 ? 'neg' : ''}`} style={{ textAlign: 'right', fontWeight: 700 }}>{r.rs20 != null ? `${r.rs20 >= 0 ? '+' : ''}${r.rs20.toFixed(1)}` : '—'}</td>
                  <td className="mono muted" style={{ textAlign: 'right' }}>{r.vol != null ? `${r.vol.toFixed(0)}%` : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{r.riskAdjusted != null ? r.riskAdjusted.toFixed(2) : '—'}</td>
                  <td className="small" style={{ color: r.accelerating ? 'var(--profit)' : 'var(--muted)' }}>{rateOfChangeLabel(r.accelerating)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* the money-flow map */}
      <div className="card">
        <div className="card-title">
          The money-flow map <span className="hint">each row is a flow, not a price — the numerator is what money moves INTO when the line rises</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data" style={{ minWidth: 680 }}>
            <thead>
              <tr><th>Ratio</th><th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>Range</th><th>What it means</th></tr>
            </thead>
            <tbody>
              {flowReadings.map((r) => (
                <tr key={r.pair.id} style={r.stale ? { opacity: 0.55 } : undefined}>
                  <td>
                    <b>{r.pair.label}</b>
                    <div className="muted small mono">{r.pair.numerator}/{r.pair.denominator}</div>
                  </td>
                  <td className={`mono ${r.stale ? 'muted' : r.change > 0 ? 'pos' : r.change < 0 ? 'neg' : ''}`} style={{ textAlign: 'right', fontWeight: 700 }}>
                    {r.stale ? 'stale' : `${r.change >= 0 ? '+' : ''}${r.change.toFixed(1)}%`}
                  </td>
                  <td className="mono muted" style={{ textAlign: 'right' }}>{r.percentile != null ? `${r.percentile}%` : '—'}</td>
                  <td className="muted small">{r.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {flowReadings.length === 0 && <div className="muted small">The ratio map needs the underlying ETFs — check Settings → Data connections.</div>}
      </div>

      <div className="card">
        <Principle domain="Flow — price tells you what happened, ratios tell you what is happening">
          A single market&apos;s chart cannot distinguish &quot;everything is up&quot; from &quot;this is being bought
          specifically&quot; — and those are different trades with different risks. Ratios can: they strip out the
          common factor and leave the decision someone actually made. Read them in this order — <b>credit</b> (is
          financing open?), <b>breadth</b> (is it the average asset or a handful?), <b>cyclical vs defensive</b> (what
          is being bet on?), then <b>the index</b>. When they agree, the move is real and you can size it. When they
          disagree, the disagreement is the trade: credit and breadth are right far more often than the index is, and
          the gap between them is where the next repricing comes from. And always check the correlation regime before
          sizing — in a high-correlation tape you do not have five positions, you have one position five times.
        </Principle>
      </div>

      <Connects id="flows" />
    </div>
  );
}
