import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DebriefEditor } from '../components/DebriefEditor';
import { Hub } from '../components/Hub';
import { DomainChip, PnL, SideBadge } from '../components/ui';
import { db } from '../lib/db';
import { addDays, fmtDate, fmtDuration, fmtPct, fmtTime, todayISO, weekdayName } from '../lib/format';
import { computeStats } from '../lib/stats';
import AICoach from './AICoach';

/**
 * Debrief — the "After trade" block: each trade, then the day.
 *
 * This screen owns the review half of the loop only. Preparation belongs to
 * the brief; showing it here again is what made the two blocks feel identical.
 */
function DayReview({ date }: { date: string }) {
  const nav = useNavigate();
  const trades =
    useLiveQuery(() => db.trades.where('date').equals(date).toArray(), [date])?.sort((a, b) =>
      a.entryTime.localeCompare(b.entryTime),
    ) ?? [];
  const stats = useMemo(() => computeStats(trades), [trades]);
  const ungraded = trades.filter((t) => Object.keys(t.grades ?? {}).length === 0).length;

  return (
    <div className="stack">
      <div className="card">
        <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 17, margin: 0 }}>{weekdayName(date)} {fmtDate(date)}</h2>
            <div className="muted small" style={{ marginTop: 3 }}>
              {trades.length ? (
                <>
                  {trades.length} trade{trades.length > 1 ? 's' : ''} · net <PnL value={stats.netPnl} /> · win rate{' '}
                  {fmtPct(stats.winRate, 0)}
                  {ungraded > 0 && <> · <b style={{ color: 'var(--gold)' }}>{ungraded} still to grade</b></>}
                </>
              ) : (
                'No trades recorded on this day.'
              )}
            </div>
          </div>
        </div>
      </div>

      {trades.length > 0 && (
        <div className="card">
          <div className="card-title">
            Each trade <span className="hint">click a trade to grade it and write its lesson</span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Inst</th>
                  <th>Side</th>
                  <th className="num">Qty</th>
                  <th>Held</th>
                  <th>Domain</th>
                  <th className="num">P&amp;L</th>
                  <th>Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const graded = Object.keys(t.grades ?? {}).length > 0;
                  const described = !!t.description?.trim();
                  return (
                    <tr key={t.id} className="clickable" onClick={() => nav(`/trades/${t.id}`)}>
                      <td>{fmtTime(t.entryTime)}</td>
                      <td className="mono">{t.instrument}</td>
                      <td><SideBadge side={t.side} /></td>
                      <td className="num">{t.qty}</td>
                      <td className="muted">{fmtDuration(t.entryTime, t.exitTime)}</td>
                      <td><DomainChip id={t.domain} /></td>
                      <td className="num"><PnL value={t.pnl} /></td>
                      <td className="small">
                        {graded && described ? (
                          <span style={{ color: 'var(--profit)' }}>✓ done</span>
                        ) : (
                          <span style={{ color: 'var(--gold)' }}>
                            {!described && 'describe'}{!described && !graded && ' · '}{!graded && 'grade'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">
          The day <span className="hint">what happened, what you learned, what you will apply</span>
        </div>
        <DebriefEditor date={date} />
      </div>
    </div>
  );
}

export default function Debrief() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayISO();
  const setDate = (d: string) => setParams({ date: d });

  return (
    <Hub
      title="Debrief"
      block="After trade"
      sub="Each trade and the overall day — the lessons and actions that make the next session better."
      param="step"
      right={
        <div className="row">
          <button className="btn sm" onClick={() => setDate(addDays(date, -1))}>← Prev</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn sm" onClick={() => setDate(addDays(date, 1))}>Next →</button>
          <button className="btn sm" onClick={() => setDate(todayISO())}>Today</button>
        </div>
      }
      steps={[
        {
          id: 'day',
          label: 'Trades & day',
          purpose: 'Grade each trade, then write the day: what happened, and what you will do differently.',
          body: <DayReview date={date} />,
        },
        {
          id: 'coach',
          label: 'Coach',
          purpose: 'What your own record says to work on next — computed from your results, not generic advice.',
          body: <AICoach />,
        },
      ]}
    />
  );
}
