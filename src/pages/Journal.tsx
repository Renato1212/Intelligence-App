import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DomainChip, PnL, SideBadge, useToast } from '../components/ui';
import type { DailyDebrief } from '../domain/types';
import { db } from '../lib/db';
import { fmtDate, fmtMoney, fmtTime, todayISO, weekdayName } from '../lib/format';
import { computeStats } from '../lib/stats';

const EMPTY: Omit<DailyDebrief, 'id'> = {
  date: todayISO(),
  narrative: '',
  comparison: '',
  learned: '',
  applyNext: '',
  prepScore: null,
  executionScore: null,
};

export default function Journal() {
  const debriefs = useLiveQuery(() => db.debriefs.orderBy('date').reverse().toArray(), []);
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [draft, setDraft] = useState<Omit<DailyDebrief, 'id'> & { id?: number }>({ ...EMPTY });
  const toast = useToast();
  const nav = useNavigate();

  const existing = useMemo(() => (debriefs ?? []).find((d) => d.date === selectedDate), [debriefs, selectedDate]);

  // load selection into draft when the date or stored entry changes
  useMemo(() => {
    setDraft(existing ? { ...existing } : { ...EMPTY, date: selectedDate });
  }, [existing, selectedDate]);

  const dayTrades = useMemo(
    () => trades.filter((t) => t.date === selectedDate).sort((a, b) => a.entryTime.localeCompare(b.entryTime)),
    [trades, selectedDate],
  );
  const dayStats = useMemo(() => computeStats(dayTrades), [dayTrades]);

  const save = async () => {
    const record = { ...draft, date: selectedDate };
    if (existing?.id) await db.debriefs.put({ ...record, id: existing.id });
    else await db.debriefs.add(record);
    toast('Daily debrief saved');
  };

  const set = <K extends keyof DailyDebrief>(k: K, v: DailyDebrief[K]) => setDraft({ ...draft, [k]: v });

  const scorePicker = (label: string, key: 'prepScore' | 'executionScore') => (
    <div>
      <div className="small muted" style={{ marginBottom: 5 }}>
        {label}
      </div>
      <div className="row">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={`chip clickable ${draft[key] === n ? 'selected' : ''}`}
            onClick={() => set(key, draft[key] === n ? null : n)}
          >
            {n}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Daily Debrief</h1>
          <p className="page-sub">
            Describe what happened, compare it with your preparation, extract the lesson, decide how to apply it.
          </p>
        </div>
        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
        <div className="stack">
          <div className="card stack">
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
            <label className="field">
              <span>What happened, what you did and how you were feeling during this trading day</span>
              <textarea rows={5} value={draft.narrative} onChange={(e) => set('narrative', e.target.value)} />
            </label>
            <label className="field">
              <span>Compare what happened with your preparation and hypothesis for this day</span>
              <textarea rows={4} value={draft.comparison} onChange={(e) => set('comparison', e.target.value)} />
            </label>
            <label className="field">
              <span>Did you learn something?</span>
              <textarea rows={3} value={draft.learned} onChange={(e) => set('learned', e.target.value)} />
            </label>
            <label className="field">
              <span>Is there something you can do to apply what you learned?</span>
              <textarea rows={3} value={draft.applyNext} onChange={(e) => set('applyNext', e.target.value)} />
            </label>
            <div className="row" style={{ gap: 26 }}>
              {scorePicker('Preparation quality (1–5)', 'prepScore')}
              {scorePicker('Execution quality (1–5)', 'executionScore')}
              <span style={{ flex: 1 }} />
              <button className="btn primary" onClick={save}>
                {existing ? 'Update debrief' : 'Save debrief'}
              </button>
            </div>
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
          {!debriefs?.length && <div className="muted small">No debriefs yet — write your first one.</div>}
          <div className="stack" style={{ gap: 6 }}>
            {(debriefs ?? []).slice(0, 30).map((d) => {
              const dayPnl = trades.filter((t) => t.date === d.date).reduce((s, t) => s + t.pnl, 0);
              return (
                <div
                  key={d.id}
                  className="spread clickable"
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
                  <span className={dayPnl > 0 ? 'pos' : dayPnl < 0 ? 'neg' : 'muted'}>
                    {fmtMoney(dayPnl, { sign: true, compact: true })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
