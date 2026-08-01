import { useMemo } from 'react';
import type { Close } from '../lib/flows';

/*
 * OverlayChart — several instruments on one axis, honestly.
 *
 * Price-space overlays lie: a $600 index and a $25 ETF cannot share a y-axis
 * without one of them looking flat. Everything here is plotted in a comparable
 * space (rebased %, ratio, or z-score) chosen by the caller, with a baseline
 * drawn so "above/below the start" is readable at a glance.
 */

export interface OverlaySeries {
  symbol: string;
  label: string;
  color: string;
  points: Close[];
}

export const OVERLAY_COLORS = ['#b5842c', '#4f8fca', '#43a45c', '#cc5f83', '#9085e9', '#c98500', '#199e70', '#8a857a'];

export function OverlayChart({
  series,
  height = 300,
  baseline,
  valueLabel,
  fmt = (v: number) => v.toFixed(1),
}: {
  series: OverlaySeries[];
  height?: number;
  /** horizontal reference line (100 for rebased, 0 for z-score) */
  baseline?: number;
  valueLabel?: string;
  fmt?: (v: number) => string;
}) {
  const W = 1000;
  const H = height;
  const PAD_L = 52;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 22;

  const model = useMemo(() => {
    const withData = series.filter((s) => s.points.length > 1);
    if (!withData.length) return null;
    const n = Math.max(...withData.map((s) => s.points.length));
    const all = withData.flatMap((s) => s.points.map((p) => p.close));
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (baseline != null) {
      lo = Math.min(lo, baseline);
      hi = Math.max(hi, baseline);
    }
    if (!(hi > lo)) {
      hi = lo + 1;
      lo -= 1;
    }
    const padY = (hi - lo) * 0.06;
    lo -= padY;
    hi += padY;
    const x = (i: number, len: number) => PAD_L + (len <= 1 ? 0 : (i / (len - 1)) * (W - PAD_L - PAD_R));
    const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
    const ticks = [lo + (hi - lo) * 0.05, (lo + hi) / 2, hi - (hi - lo) * 0.05];
    const dates = withData[0].points.map((p) => p.date);
    return { withData, n, lo, hi, x, y, ticks, dates };
  }, [series, baseline, H]);

  if (!model) return <div className="muted small">Not enough overlapping history to plot.</div>;
  const { withData, x, y, ticks, dates } = model;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }} preserveAspectRatio="none">
        {/* horizontal grid + value axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} stroke="var(--hairline)" strokeWidth="1" />
            <text x={PAD_L - 6} y={y(t) + 3.5} textAnchor="end" style={{ fill: 'var(--muted)', fontSize: 10 }}>
              {fmt(t)}
            </text>
          </g>
        ))}
        {/* the baseline everything is measured from */}
        {baseline != null && (
          <line x1={PAD_L} y1={y(baseline)} x2={W - PAD_R} y2={y(baseline)} stroke="var(--gold)" strokeWidth="1.2" strokeDasharray="5 4" opacity="0.75" />
        )}
        {/* the series */}
        {withData.map((s) => {
          const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i, s.points.length).toFixed(1)} ${y(p.close).toFixed(1)}`).join(' ');
          return <path key={s.symbol} d={d} fill="none" stroke={s.color} strokeWidth="1.7" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
        })}
        {/* date ends */}
        {dates.length > 1 && (
          <>
            <text x={PAD_L} y={H - 6} style={{ fill: 'var(--muted)', fontSize: 10 }}>{dates[0]}</text>
            <text x={W - PAD_R} y={H - 6} textAnchor="end" style={{ fill: 'var(--muted)', fontSize: 10 }}>{dates[dates.length - 1]}</text>
          </>
        )}
      </svg>
      {/* legend carries the number that matters: where each line ended */}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        {withData.map((s) => {
          const last = s.points[s.points.length - 1].close;
          const first = s.points[0].close;
          const chg = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
          return (
            <span key={s.symbol} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 3, background: s.color, borderRadius: 2 }} />
              <b>{s.label}</b>
              <span className="mono" style={{ color: chg > 0 ? 'var(--profit)' : chg < 0 ? 'var(--loss)' : 'var(--muted)' }}>
                {fmt(last)}
                {baseline != null && ` (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%)`}
              </span>
            </span>
          );
        })}
        {valueLabel && <span className="hint" style={{ marginLeft: 'auto' }}>{valueLabel}</span>}
      </div>
    </div>
  );
}

/** A single-line panel for rolling correlation / beta / dispersion. */
export function LinePanel({
  points,
  height = 130,
  color = 'var(--dom-tech)',
  bands,
  fmt = (v: number) => v.toFixed(2),
}: {
  points: { date: string; value: number }[];
  height?: number;
  color?: string;
  /** horizontal reference lines, e.g. [-0.5, 0, 0.5] */
  bands?: number[];
  fmt?: (v: number) => string;
}) {
  const W = 1000;
  const H = height;
  const PAD_L = 40;
  const PAD_B = 16;
  if (points.length < 2) return <div className="muted small">Not enough history for this window yet.</div>;

  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals, ...(bands ?? []));
  let hi = Math.max(...vals, ...(bands ?? []));
  if (!(hi > lo)) {
    hi = lo + 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const x = (i: number) => PAD_L + (i / (points.length - 1)) * (W - PAD_L - 6);
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 6 - PAD_B);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }} preserveAspectRatio="none">
      {(bands ?? []).map((b) => (
        <g key={b}>
          <line x1={PAD_L} y1={y(b)} x2={W - 6} y2={y(b)} stroke="var(--hairline)" strokeWidth="1" strokeDasharray={b === 0 ? undefined : '4 4'} />
          <text x={PAD_L - 5} y={y(b) + 3.5} textAnchor="end" style={{ fill: 'var(--muted)', fontSize: 9.5 }}>{fmt(b)}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <text x={PAD_L} y={H - 4} style={{ fill: 'var(--muted)', fontSize: 9.5 }}>{points[0].date}</text>
      <text x={W - 6} y={H - 4} textAnchor="end" style={{ fill: 'var(--muted)', fontSize: 9.5 }}>
        {points[points.length - 1].date} · {fmt(points[points.length - 1].value)}
      </text>
    </svg>
  );
}
