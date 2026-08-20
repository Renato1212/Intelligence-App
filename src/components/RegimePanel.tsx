import { useEffect, useMemo, useState } from 'react';
import { fmpOhlcBarUrls, getMarketApiKey, parseFmpOhlc } from '../lib/market';
import { classifyDay, classifyRegime, priorSessionRead, type Bar } from '../lib/regime';

/** Daily OHLC for the regime window, using the same source as the other panels. */
async function fetchOhlc(symbol: string, days: number): Promise<Bar[]> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  for (const url of fmpOhlcBarUrls(symbol, { from, to })) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bars = parseFmpOhlc(await res.json());
      if (bars.length >= 5) return bars.map((b) => ({ ...b, volume: b.volume ?? undefined }));
    } catch {
      continue;
    }
  }
  return [];
}

/**
 * "Current volume and volatility" + "Previous day and previous session type"
 * — the two environment questions the routine asks, answered with evidence.
 *
 * Law 3: the tag is never shown alone. Each axis carries the metric, the
 * percentile it sits at, and what it implies, so it can always be interrogated.
 */
function Axis({ label, value, pct, evidence }: { label: string; value: string; pct: number; evidence: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="card clickable"
      style={{ background: 'var(--surface)', padding: '10px 12px', cursor: 'pointer' }}
      onClick={() => setOpen((o) => !o)}
      title="Click for the evidence"
    >
      <div className="tile-label">{label}</div>
      <b style={{ fontSize: 16, textTransform: 'capitalize' }}>{value}</b>
      <div style={{ height: 5, background: 'var(--surface-2, #2a2622)', borderRadius: 3, margin: '7px 0 3px', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(pct * 100)}%`, background: 'var(--gold)', borderRadius: 3 }} />
      </div>
      <div className="muted small">{Math.round(pct * 100)}th percentile {open ? '▾' : '▸'}</div>
      {open && <div className="small" style={{ marginTop: 6, lineHeight: 1.5 }}>{evidence}</div>}
    </div>
  );
}

export function RegimePanel({ symbol = 'ES' }: { symbol?: string }) {
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBars(null);
    setErr(null);
    if (!getMarketApiKey()) {
      setErr('no market-data key');
      return;
    }
    fetchOhlc(symbol, 400)
      .then((b) => {
        if (!alive) return;
        if (b.length) setBars(b);
        else setErr('the source returned no daily bars');
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const regime = useMemo(() => (bars ? classifyRegime(bars) : null), [bars]);
  const prior = useMemo(() => (bars ? classifyDay(bars) : null), [bars]);

  return (
    <div className="card">
      <div className="card-title">
        Regime &amp; previous session <span className="hint">{symbol} · click any axis for the evidence behind it</span>
      </div>

      {err && <div className="small" style={{ color: 'var(--dom-news)' }}>⚠ Regime needs daily bars — {err}. Connect a free market-data key in Data → Settings.</div>}
      {!bars && !err && <div className="muted small">Loading daily bars…</div>}
      {bars && !regime && !err && (
        <div className="muted small">Not enough daily history yet to classify the regime (needs ~25 sessions).</div>
      )}

      {regime && (
        <>
          <div className="mono" style={{ fontSize: 15, marginBottom: 10 }}>{regime.label}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            <Axis label="Direction" value={regime.trend.value} pct={regime.trend.pct} evidence={regime.trend.evidence} />
            <Axis label="Energy" value={regime.energy.value} pct={regime.energy.pct} evidence={regime.energy.evidence} />
            <Axis label="Structure" value={regime.structure.value} pct={regime.structure.pct} evidence={regime.structure.evidence} />
          </div>
        </>
      )}

      {prior && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
          <div className="spread" style={{ alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <span className="tile-label">Previous session</span>{' '}
              <b style={{ fontSize: 15 }}>{prior.label}</b>{' '}
              <span className="muted small">confidence {Math.round(prior.confidence * 100)}%</span>
            </div>
            <span className="muted small mono">{prior.date}</span>
          </div>
          <div className="small" style={{ marginTop: 6 }}>{priorSessionRead(prior)}</div>
          <ul className="muted small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {prior.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <div className="muted small" style={{ marginTop: 6, opacity: 0.7 }}>
            Classified from the daily bar; a full profile read needs intraday TPO, which is why the confidence is stated.
          </div>
        </div>
      )}
    </div>
  );
}
