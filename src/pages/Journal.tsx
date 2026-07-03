import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DebriefEditor } from '../components/DebriefEditor';
import { DomainChip, PnL, SideBadge } from '../components/ui';
import { db } from '../lib/db';
import { fmtDate, fmtMoney, fmtTime, todayISO, weekdayName } from '../lib/format';
import { computeStats } from '../lib/stats';

export default function Journal() {
  const debriefs = useLiveQuery(() => db.debriefs.orderBy('date').reverse().toArray(), []);
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [dayTag, setDayTag] = useState('');
  const nav = useNavigate();

  const dayTrades = useMemo(
    () => trades.filter((t) => t.date === selectedDate).sort((a, b) => a.entryTime.localeCompare(b.entryTime)),
    [trades, selectedDate],
  );
  const dayStats = useMemo(() => computeStats(dayTrades), [dayTrades]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  }, [trades]);

  /** Days shown in the sidebar: debrief days, optionally narrowed to days containing a tag. */
  const pastDays = useMemo(() => {
    let list = debriefs ?? [];
    if (dayTag) {
      const daysWithTag = new Set(trades.filter((t) => t.tags.includes(dayTag)).map((t) => t.date));
      list = list.filter((d) => daysWithTag.has(d.date));
    }
    return list;
  }, [debriefs, trades, dayTag]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Daily Debrief</h1>
          <p className="page-sub">
            Describe what happened, compare it with your preparation, extract the lesson, decide how to apply it.
          </p>
        </div>
        <div className="row">
          <Link to={`/day?date=${selectedDate}`} className="btn sm">
            Open Trading Day view
          </Link>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
        <div className="stack">
          <div className="card">
            <div className="card-title">
              {weekdayName(selectedDate)} {fmtDate(selectedDate)}
              <span className="hint">
                {dayTrades.length ? (
                  <>
                    {dayTrades.length} trades · <PnL value={dayStats.netPnl} />
                  </>
                ) : (
                  'no trades recorded this day'
                )}
              </span>
            </div>
            <DebriefEditor date={selectedDate} />
          </div>

          {dayTrades.length > 0 && (
            <div className="card">
              <div className="card-title">Trades this day</div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Inst</th>
                      <th>Side</th>
                      <th>Domain</th>
                      <th>Tags</th>
                      <th className="num">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayTrades.map((t) => (
                      <tr key={t.id} className="clickable" onClick={() => nav(`/trades/${t.id}`)}>
                        <td>{fmtTime(t.entryTime)}</td>
                        <td className="mono">{t.instrument}</td>
                        <td>
                          <SideBadge side={t.side} />
                        </td>
                        <td>
                          <DomainChip id={t.domain} />
                        </td>
                        <td className="muted small">{t.tags.slice(0, 3).join(' · ')}</td>
                        <td className="num">
                          <PnL value={t.pnl} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Past debriefs</div>
          <select value={dayTag} onChange={(e) => setDayTag(e.target.value)} style={{ width: '100%', marginBottom: 10 }} title="Show only days containing trades with this tag">
            <option value="">All days — filter by tag…</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                Days with “{t}” trades
              </option>
            ))}
          </select>
          {!pastDays.length && <div className="muted small">{dayTag ? 'No debriefed days contain that tag.' : 'No debriefs yet — write your first one.'}</div>}
          <div className="stack" style={{ gap: 6 }}>
            {pastDays.slice(0, 40).map((d) => {
              const dayPnl = trades.filter((t) => t.date === d.date).reduce((s, t) => s + t.pnl, 0);
              return (
                <div
                  key={d.id}
                  className="spread"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: d.date === selectedDate ? 'var(--gold-dim)' : 'transparent',
                  }}
                  onClick={() => setSelectedDate(d.date)}
                >
                  <span>
                    {weekdayName(d.date)} {fmtDate(d.date)}
                  </span>
                  <span className={dayPnl > 0 ? 'pos' : dayPnl < 0 ? 'neg' : 'muted'}>{fmtMoney(dayPnl, { sign: true, compact: true })}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
