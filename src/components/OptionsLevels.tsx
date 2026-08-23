import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from './ui';
import { loadChain, OPTION_ROOTS, type ChainSnapshot } from '../lib/options';
import {
  carryBasis, daysToQuarterlyExpiry, DEFAULT_CONFIG, TICKS,
  type ChainContract, type ExpiryBucket, type OptionLevel, type Strength,
} from '../lib/options/levels';
import { buildPanel, levelsAsCsv, levelsAsText, type Panel } from '../lib/options/panel';

/**
 * Options levels for the morning — the mechanical support and resistance that
 * dealer hedging creates, already converted to the futures price so they can be
 * marked straight onto the chart.
 *
 * Honest by construction: open interest only updates once a day, so the panel
 * shows two separate timestamps — when the levels were computed against the
 * current spot, and when the open interest was actually observed. It never
 * implies live OI, and it never says buy or sell.
 */

const BASIS_KEY = 'ei-opt-basis';
const STRENGTH_COLOR: Record<Strength, string> = {
  'HIGH*': 'var(--gold)',
  HIGH: 'var(--gold)',
  MEDIUM: 'var(--dom-news)',
  LOW: 'var(--muted)',
};
const KIND_STYLE: Record<OptionLevel['kind'], string> = {
  regime: 'solid, thick — regime boundary',
  wall: 'solid — hedging wall',
  magnet: 'dashed — pin candidate',
  envelope: 'dotted — expected move',
};

function readBasis(future: string): number | null {
  try {
    const all = JSON.parse(localStorage.getItem(BASIS_KEY) ?? '{}') as Record<string, number>;
    const v = all[future];
    return typeof v === 'number' && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
function writeBasis(future: string, v: number) {
  let all: Record<string, number> = {};
  try {
    all = JSON.parse(localStorage.getItem(BASIS_KEY) ?? '{}') as Record<string, number>;
  } catch {
    all = {};
  }
  all[future] = v;
  localStorage.setItem(BASIS_KEY, JSON.stringify(all));
}

function LevelRow({ l, tick }: { l: OptionLevel; tick: number }) {
  const [open, setOpen] = useState(false);
  const dp = tick < 1 ? 2 : 0;
  return (
    <>
      <tr className="clickable" onClick={() => setOpen((o) => !o)} title="Click for the mechanical meaning">
        <td className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{l.futuresPrice.toFixed(dp)}</td>
        <td>{l.name}{l.confluence.length > 0 && <span className="chip" style={{ marginLeft: 6, fontSize: 10 }}>stacked</span>}</td>
        <td><span style={{ color: STRENGTH_COLOR[l.strength], fontWeight: 700 }}>{l.strength}</span></td>
        <td className="num mono">{l.distEm > 90 ? '—' : `${l.distEm.toFixed(2)} EM`}</td>
        <td className="num mono muted">{l.indexPrice.toFixed(0)}</td>
        <td className="muted small">{open ? '▾' : '▸'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--surface)', padding: '10px 14px' }}>
            <div className="small" style={{ lineHeight: 1.55 }}>{l.note}</div>
            <div className="muted small" style={{ marginTop: 6 }}>
              Suggested line: <b>{KIND_STYLE[l.kind]}</b>
              {l.share > 0 && <> · carries {(l.share * 100).toFixed(1)}% of total gamma</>}
              {l.confluence.length > 0 && <> · stacks with <b>{l.confluence.join(', ')}</b> (upgraded one notch)</>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function OptionsLevels() {
  const toast = useToast();
  const [rootIdx, setRootIdx] = useState(0);
  const root = OPTION_ROOTS[rootIdx];
  const [chain, setChain] = useState<ChainSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState<ExpiryBucket>('month');
  const [basisInput, setBasisInput] = useState<string>('');
  const [computedAt, setComputedAt] = useState<Date>(new Date());

  const load = useCallback(async (force = false) => {
    setLoading(true);
    const { chain: c, error } = await loadChain(root.root, force);
    setChain(c);
    setErr(error);
    setComputedAt(new Date());
    setLoading(false);
  }, [root.root]);

  useEffect(() => {
    setBasisInput(readBasis(root.future)?.toString() ?? '');
    void load();
  }, [root.future, load]);

  // recompute against the current spot every minute — that is what genuinely
  // changes intraday; the chain itself is only refetched every 15 minutes
  useEffect(() => {
    const iv = setInterval(() => setComputedAt(new Date()), 60000);
    return () => clearInterval(iv);
  }, []);

  const manualBasis = basisInput.trim() === '' ? null : Number(basisInput);
  const panel: Panel | null = useMemo(() => {
    if (!chain) return null;
    const contracts: ChainContract[] = chain.entries.map((e) => ({
      expiry: e.expiry, strike: e.strike, right: e.type,
      openInterest: e.openInterest, iv: e.iv, gamma: e.gamma, volume: e.volume,
    }));
    const auto = carryBasis(chain.spot, daysToQuarterlyExpiry(computedAt), DEFAULT_CONFIG.rate, DEFAULT_CONFIG.dividendYield);
    const useManual = manualBasis != null && isFinite(manualBasis);
    return buildPanel({
      contracts, spot: chain.spot, asOf: computedAt,
      basis: useManual ? manualBasis : auto,
      basisSource: useManual ? 'manual' : 'carry',
      future: root.future, indexSymbol: root.label, bucket,
    });
  }, [chain, computedAt, manualBasis, root.future, root.label, bucket]);

  const tick = TICKS[root.future] ?? 0.25;
  const dp = tick < 1 ? 2 : 0;

  const copy = async (what: 'text' | 'csv') => {
    if (!panel) return;
    await navigator.clipboard.writeText(what === 'csv' ? levelsAsCsv(panel) : levelsAsText(panel));
    toast(what === 'csv' ? 'Levels copied as CSV' : 'Levels copied — paste onto your chart');
  };

  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>
          Options levels <span className="hint">dealer hedging levels, converted to {root.future} — mark these on your chart</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {OPTION_ROOTS.map((r, i) => (
            <span key={r.root} className={`chip clickable ${i === rootIdx ? 'selected' : ''}`} onClick={() => setRootIdx(i)}>
              {r.future}
            </span>
          ))}
          <span style={{ width: 8 }} />
          {(['zero', 'week', 'month'] as ExpiryBucket[]).map((b) => (
            <span key={b} className={`chip clickable ${bucket === b ? 'selected' : ''}`} onClick={() => setBucket(b)}
              title={b === 'zero' ? 'Expiring today' : b === 'week' ? 'Within 7 days' : 'Within 35 days — the structural set'}>
              {b === 'zero' ? '0DTE' : b === 'week' ? '≤7d' : '≤35d'}
            </span>
          ))}
          <button className="btn sm" disabled={loading} onClick={() => void load(true)}>{loading ? '…' : 'Refresh'}</button>
        </div>
      </div>

      {err && (
        <div className="small" style={{ color: 'var(--dom-news)', marginBottom: 8 }}>
          ⚠ {err} {chain?.stale && 'Showing the last good snapshot.'}
        </div>
      )}
      {!chain && !err && <div className="muted small">Loading the {root.label} chain…</div>}

      {panel && (
        <>
          {/* regime header — the most prominent thing on the panel */}
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '14px 16px', marginBottom: 12, borderLeft: `3px solid ${panel.regime === 'negative' ? 'var(--loss)' : panel.regime === 'positive' ? 'var(--profit)' : 'var(--gold)'}` }}>
            <div className="spread" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'baseline' }}>
              <div>
                <span className="tile-label">Gamma regime</span>
                <div style={{ fontSize: 26, fontWeight: 800, textTransform: 'capitalize', lineHeight: 1.15 }}>{panel.regime}</div>
              </div>
              <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
                <div>
                  <span className="tile-label">Gamma flip ({root.future})</span>
                  <div className="mono" style={{ fontSize: 19, fontWeight: 700 }}>{panel.gammaFlipFutures?.toFixed(dp) ?? '—'}</div>
                  <div className="muted small">index {panel.gammaFlip?.toFixed(0) ?? '—'}{panel.flipDistEm != null && <> · {Math.abs(panel.flipDistEm).toFixed(2)} EM away</>}</div>
                </div>
                <div>
                  <span className="tile-label">Net GEX</span>
                  <div className="mono" style={{ fontSize: 19, fontWeight: 700 }}>{(panel.netGex / 1e9).toFixed(2)}B</div>
                  <div className="muted small">per 1% move</div>
                </div>
                <div>
                  <span className="tile-label">Expected move</span>
                  <div className="mono" style={{ fontSize: 19, fontWeight: 700 }}>±{panel.expectedMove?.toFixed(1) ?? '—'}</div>
                  <div className="muted small">ATM IV {panel.atmIv != null ? `${(panel.atmIv * 100).toFixed(1)}%` : '—'}</div>
                </div>
              </div>
            </div>
            <div className="small" style={{ marginTop: 10, lineHeight: 1.6 }}>{panel.regimeExplain}</div>
          </div>

          {/* levels */}
          <div className="spread" style={{ marginBottom: 6, alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <div className="tile-label">Levels to mark — {root.future} price</div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => void copy('text')}>Copy for chart</button>
              <button className="btn sm" onClick={() => void copy('csv')}>Copy CSV</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{root.future}</th><th>Level</th><th>Strength</th><th className="num">Distance</th><th className="num">Index</th><th></th>
                </tr>
              </thead>
              <tbody>
                {panel.levels.map((l) => <LevelRow key={l.name} l={l} tick={tick} />)}
              </tbody>
            </table>
          </div>

          {/* basis control — the fallback that never breaks */}
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted small">Basis ({root.future} − index):</span>
            <input
              type="number" step="0.25" value={basisInput} placeholder={panel.basis.toFixed(2)}
              style={{ width: 100 }}
              onChange={(e) => {
                setBasisInput(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value.trim() !== '' && isFinite(n)) writeBasis(root.future, n);
              }}
            />
            <span className="muted small">
              {panel.basisSource === 'manual'
                ? `manual — every level reconverts instantly. ${root.future} ref ${panel.futuresRef.toFixed(dp)}`
                : `estimated from cost of carry (${panel.basis.toFixed(2)}) — read ${root.future} off your platform and type it here for exact levels`}
            </span>
          </div>

          {/* what to watch */}
          <div style={{ marginTop: 14 }}>
            <div className="tile-label" style={{ marginBottom: 6 }}>What to watch today</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.65 }}>
              {panel.watch.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>

          {/* session by session */}
          <div style={{ marginTop: 14 }}>
            <div className="tile-label" style={{ marginBottom: 6 }}>How the day should trade, session by session <span className="hint">Lisbon time</span></div>
            <div style={{ display: 'grid', gap: 6 }}>
              {panel.sessions.map((s) => (
                <div key={s.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <span className="mono small" style={{ width: 74, flexShrink: 0, color: 'var(--gold)' }}>{s.label}</span>
                  <span className="mono small muted" style={{ width: 92, flexShrink: 0 }}>{s.window}</span>
                  <span className="small" style={{ lineHeight: 1.5, flex: 1, minWidth: 0 }}>{s.note}</span>
                </div>
              ))}
            </div>
          </div>

          {/* honesty footer — the two timestamps must never be confused */}
          <div className="muted small" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--hairline)', lineHeight: 1.6 }}>
            Levels computed <b>{computedAt.toLocaleTimeString()}</b> against spot {panel.spot.toFixed(2)} ·
            open interest observed <b>{chain ? new Date(chain.fetchedAt).toLocaleTimeString() : '—'}</b>
            {chain?.stale && <span style={{ color: 'var(--dom-news)' }}> (stale — source unreachable)</span>}
            {' · '}{panel.contractsUsed} contracts, {bucket === 'zero' ? 'expiring today' : bucket === 'week' ? '≤7 days' : '≤35 days'}.
            <br />
            Open interest updates <b>once per day</b> — these levels move intraday only because spot moves, never because
            positioning changed. Dealer direction assumes long calls / short puts, the market-standard convention: an
            assumption, not a measurement. Chain data is ~15 minutes delayed.
          </div>
        </>
      )}
    </div>
  );
}
