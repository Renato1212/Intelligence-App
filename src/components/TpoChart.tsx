import { useMemo } from 'react';
import { compositeProfile, nakedPocs, type SessionProfile } from '../lib/marketProfile';

/*
 * TpoChart — a real Market Profile chart: several sessions side by side on one
 * shared price grid, the way a profile chart is actually read.
 *
 * TradingView's free embed cannot host this (Volume Profile is a paid TV
 * feature and embeds do not run custom studies), so it is drawn natively from
 * the same auction engine the Market Profile page uses. Two renderings:
 *
 *  TPO      — one letter per 30-minute bracket, the classic time distribution
 *  Volume   — a horizontal histogram per price, the volume distribution
 *
 * and two views: each session in its own column, or one merged composite for
 * "where has the market spent its time over the whole period".
 */

const GOLD = 'var(--gold)';
const TECH = 'var(--dom-tech)';
const VA_BG = 'rgba(211,169,79,0.10)';

export type TpoMode = 'tpo' | 'volume';
export type TpoView = 'split' | 'composite';

export function TpoChart({
  profiles,
  mode,
  view,
  fmtPx,
  rowHeight = 13,
}: {
  /** newest first, all sharing one bucket */
  profiles: SessionProfile[];
  mode: TpoMode;
  view: TpoView;
  fmtPx: (v: number) => string;
  rowHeight?: number;
}) {
  const composite = useMemo(() => compositeProfile(profiles), [profiles]);
  const naked = useMemo(() => nakedPocs(profiles), [profiles]);

  // oldest → newest reads left to right, like every other chart
  const columns = useMemo(() => {
    if (view === 'composite') return composite ? [composite] : [];
    return [...profiles].sort((a, b) => a.date.localeCompare(b.date));
  }, [profiles, view, composite]);

  // one shared price grid spanning every column
  const grid = useMemo(() => {
    if (!columns.length) return [];
    const bucket = columns[0].bucket;
    const hi = Math.max(...columns.map((c) => c.rows[c.rows.length - 1].price));
    const lo = Math.min(...columns.map((c) => c.rows[0].price));
    const out: number[] = [];
    for (let p = hi; p >= lo - 1e-9; p = Math.round((p - bucket) * 1e6) / 1e6) out.push(p);
    return out;
  }, [columns]);

  if (!columns.length || !grid.length) return <div className="muted small">No sessions to plot yet.</div>;

  const maxTpo = Math.max(1, ...columns.flatMap((c) => c.rows.map((r) => r.tpoCount)));
  const maxVol = Math.max(1, ...columns.flatMap((c) => c.rows.map((r) => r.volume)));
  const nakedSet = new Set(naked.map((n) => n.price));

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', minWidth: 320 }}>
        {/* shared price axis */}
        <div className="mono" style={{ flexShrink: 0, fontSize: 10.5 }}>
          <div style={{ height: 22 }} />
          {grid.map((p) => {
            const isNaked = nakedSet.has(p);
            return (
              <div
                key={p}
                style={{
                  height: rowHeight,
                  lineHeight: `${rowHeight}px`,
                  paddingRight: 6,
                  textAlign: 'right',
                  color: isNaked ? 'var(--loss)' : 'var(--muted)',
                  fontWeight: isNaked ? 700 : 400,
                  whiteSpace: 'nowrap',
                }}
                title={isNaked ? 'Naked POC — never traded back through since' : undefined}
              >
                {fmtPx(p)}
                {isNaked ? ' ◄' : ''}
              </div>
            );
          })}
        </div>

        {columns.map((col) => (
          <ProfileColumn key={col.date} col={col} grid={grid} mode={mode} maxTpo={maxTpo} maxVol={maxVol} rowHeight={rowHeight} />
        ))}
      </div>

      <div className="hint" style={{ marginTop: 8, lineHeight: 1.6 }}>
        {mode === 'tpo'
          ? 'Each letter is one 30-minute bracket (A = the session open). Width = time spent, so the widest part is where the market agreed on price.'
          : 'Each bar is the volume traded at that price. Where volume and time disagree, the heavier one is the real magnet.'}{' '}
        Shaded band = value area (70%). <span style={{ color: GOLD }}>◆</span> time POC ·{' '}
        <span style={{ color: GOLD }}>◇</span> volume POC · <span style={{ color: TECH }}>left rail</span> = initial balance ·{' '}
        <span style={{ color: 'var(--loss)' }}>red price ◄</span> = naked POC, never traded back through since.
        {view === 'composite' && ' Composite merges every session — letters are dropped because they only mean something inside one session.'}
      </div>
    </div>
  );
}

function ProfileColumn({
  col,
  grid,
  mode,
  maxTpo,
  maxVol,
  rowHeight,
}: {
  col: SessionProfile;
  grid: number[];
  mode: TpoMode;
  maxTpo: number;
  maxVol: number;
  rowHeight: number;
}) {
  const byPrice = useMemo(() => new Map(col.rows.map((r) => [r.price, r])), [col]);
  const half = col.bucket / 2;
  // composite columns carry no single-session IB
  const hasIb = col.rangeVsIb > 0;

  return (
    <div style={{ flexShrink: 0, marginRight: 10, minWidth: mode === 'tpo' ? 68 : 78 }}>
      <div
        className="small"
        style={{ height: 22, fontWeight: 700, color: TECH, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        title={`${col.date} · POC ${col.poc} · value ${col.val}–${col.vah}`}
      >
        {col.date.length > 12 ? 'Composite' : col.date.slice(5)}
      </div>
      {grid.map((p) => {
        const row = byPrice.get(p);
        const inVa = p >= col.val - 1e-9 && p <= col.vah + 1e-9;
        const isPoc = Math.abs(p - col.poc) < half;
        const isVpoc = Math.abs(p - col.vpoc) < half;
        const inIb = hasIb && p >= col.ibLow - 1e-9 && p <= col.ibHigh + 1e-9;
        return (
          <div key={p} style={{ display: 'flex', alignItems: 'center', height: rowHeight, background: inVa ? VA_BG : undefined }}>
            <span style={{ width: 3, alignSelf: 'stretch', background: inIb ? TECH : 'transparent', opacity: 0.6, flexShrink: 0 }} />
            <span style={{ width: 11, flexShrink: 0, color: GOLD, fontSize: 9 }}>{isPoc ? '◆' : isVpoc ? '◇' : ''}</span>
            {row ? (
              mode === 'tpo' ? (
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: 0.3,
                    whiteSpace: 'nowrap',
                    color: row.single ? 'var(--loss)' : isPoc ? GOLD : 'var(--text)',
                    opacity: row.single ? 0.9 : 0.55 + 0.45 * (row.tpoCount / maxTpo),
                  }}
                  title={`${row.tpoCount} bracket${row.tpoCount > 1 ? 's' : ''}${row.single ? ' — single print' : ''}`}
                >
                  {row.letters || '█'.repeat(Math.max(1, Math.round((row.tpoCount / maxTpo) * 9)))}
                </span>
              ) : (
                <span
                  style={{
                    height: Math.max(4, rowHeight - 4),
                    width: `${Math.max(2, (row.volume / maxVol) * 62)}px`,
                    background: isVpoc ? GOLD : TECH,
                    opacity: isVpoc ? 0.95 : 0.6,
                  }}
                  title={`volume ${Math.round(row.volume).toLocaleString()}`}
                />
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
