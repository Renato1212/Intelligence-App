import { useMemo } from 'react';
import type { Trade } from '../domain/types';
import { fmtMoney } from '../lib/format';

/**
 * Edge timing heatmap: expectancy ($/trade) across weekday × hour-of-day.
 * A discretionary trader's edge is not uniform through the session — this
 * surfaces the windows where the edge actually shows up (trade those) and the
 * ones that quietly bleed (sit those out). Cells are coloured by expectancy;
 * the best and worst meaningful windows are called out.
 */
const DOWS = [1, 2, 3, 4, 5]; // Mon..Fri
const DOW_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

interface Cell {
  dow: number;
  hour: number;
  count: number;
  net: number;
  expectancy: number;
}

function color(exp: number, scale: number): string {
  if (scale <= 0) return 'var(--surface)';
  const t = Math.max(-1, Math.min(1, exp / scale));
  if (t >= 0) return `rgba(46, 160, 105, ${0.12 + t * 0.78})`;
  return `rgba(214, 81, 81, ${0.12 + -t * 0.78})`;
}

export function EdgeHeatmap({ trades }: { trades: Trade[] }) {
  const { cells, hours, scale, best, worst } = useMemo(() => {
    const map = new Map<string, Cell>();
    let minH = 23;
    let maxH = 0;
    for (const t of trades) {
      const d = new Date(t.entryTime);
      const day = d.getDay();
      if (day < 1 || day > 5) continue;
      const hour = d.getHours();
      if (!isFinite(hour)) continue;
      minH = Math.min(minH, hour);
      maxH = Math.max(maxH, hour);
      const key = `${day}-${hour}`;
      let c = map.get(key);
      if (!c) {
        c = { dow: day, hour, count: 0, net: 0, expectancy: 0 };
        map.set(key, c);
      }
      c.count++;
      c.net += t.pnl;
    }
    for (const c of map.values()) c.expectancy = c.count ? c.net / c.count : 0;
    const hours: number[] = [];
    if (map.size) for (let h = minH; h <= maxH; h++) hours.push(h);
    const meaningful = [...map.values()].filter((c) => c.count >= 3);
    const scale = Math.max(1, ...meaningful.map((c) => Math.abs(c.expectancy)));
    const best = meaningful.slice().sort((a, b) => b.expectancy - a.expectancy)[0] ?? null;
    const worst = meaningful.slice().sort((a, b) => a.expectancy - b.expectancy)[0] ?? null;
    return { cells: map, hours, scale, best, worst };
  }, [trades]);

  if (!hours.length) return <div className="muted small">Not enough timed trades to build the timing map.</div>;

  const label = (c: Cell | null) => (c ? `${DOW_LABEL[c.dow]} ${String(c.hour).padStart(2, '0')}:00 · ${fmtMoney(c.expectancy, { sign: true })}/tr (${c.count})` : '—');

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 3, minWidth: 360 }}>
          <thead>
            <tr>
              <th></th>
              {DOWS.map((d) => (
                <th key={d} className="small muted" style={{ fontWeight: 600, padding: '0 2px' }}>{DOW_LABEL[d]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h}>
                <td className="small muted mono" style={{ paddingRight: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>{String(h).padStart(2, '0')}:00</td>
                {DOWS.map((d) => {
                  const c = cells.get(`${d}-${h}`);
                  const isBest = best && c && c.dow === best.dow && c.hour === best.hour;
                  const isWorst = worst && c && c.dow === worst.dow && c.hour === worst.hour;
                  return (
                    <td
                      key={d}
                      title={c ? label(c) : 'no trades'}
                      style={{
                        width: 52, height: 34, borderRadius: 5, textAlign: 'center', verticalAlign: 'middle',
                        background: c ? color(c.expectancy, scale) : 'var(--surface)',
                        outline: isBest ? '2px solid var(--gold)' : isWorst ? '2px solid var(--loss)' : 'none',
                        fontSize: 11, fontWeight: 700,
                        color: c && Math.abs(c.expectancy) / scale > 0.45 ? '#fff' : 'var(--muted)',
                      }}
                    >
                      {c ? fmtMoney(c.expectancy, { compact: true }) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        <span className="small"><span className="grade-dot" style={{ background: 'var(--gold)' }} /> Best window: <b>{label(best)}</b></span>
        <span className="small"><span className="grade-dot" style={{ background: 'var(--loss)' }} /> Avoid: <b>{label(worst)}</b></span>
        <span className="small muted">green = positive expectancy · red = bleed · cells with ≥3 trades ranked</span>
      </div>
    </div>
  );
}
