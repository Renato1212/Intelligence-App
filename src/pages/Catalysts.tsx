import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PnL, StatTile } from '../components/ui';
import { domainOf } from '../domain/taxonomy';
import { db } from '../lib/db';
import { eventsForDate, localTime, upcomingEvents, type CalendarEvent } from '../lib/calendar';
import { eventDaySplit, perEventStats, proximitySplit } from '../lib/eventStats';
import { addDays, fmtMoney, todayISO, weekdayName } from '../lib/format';

/** Monday of the week containing `iso`. */
function weekStart(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(iso, -back);
}

function impactDot(impact: string) {
  return <span className="grade-dot" style={{ background: impact === 'high' ? 'var(--loss)' : 'var(--dom-news)' }} />;
}

function EventRow({ e, isNext }: { e: CalendarEvent; isNext: boolean }) {
  const [open, setOpen] = useState(false);
  const dom = domainOf(e.domain);
  return (
    <div
      className="card"
      style={{
        padding: '10px 12px',
        cursor: 'pointer',
        borderLeft: `3px solid ${dom?.color ?? 'var(--muted)'}`,
        background: isNext ? 'var(--gold-dim)' : undefined,
      }}
      onClick={() => setOpen((o) => !o)}
    >
      <div className="spread" style={{ gap: 10, alignItems: 'center' }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', minWidth: 0 }}>
          <span className="mono" style={{ fontWeight: 700, width: 46 }}>{localTime(e.instant)}</span>
          <span className="muted small" style={{ width: 58 }}>{e.timeET} ET</span>
          {impactDot(e.impact)}
          <span style={{ fontWeight: 600 }}>{e.short}</span>
          <span className="muted small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
          {isNext && <span className="chip" style={{ background: 'var(--gold)', color: '#141210' }}>next</span>}
        </div>
        <div className="row" style={{ gap: 4, flexShrink: 0 }}>
          {e.affects.slice(0, 6).map((a) => (
            <span key={a} className="chip mono" style={{ fontSize: 11, padding: '1px 6px' }}>{a}</span>
          ))}
        </div>
      </div>
      {open && (
        <div className="small" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--hairline)', display: 'grid', gap: 6 }}>
          <div><b style={{ color: dom?.color }}>{dom?.short ?? e.domain}</b> · {e.cadence}</div>
          <div><b>Why it matters:</b> <span className="muted">{e.why}</span></div>
          <div><b>How to play it:</b> <span className="muted">{e.playbook}</span></div>
        </div>
      )}
    </div>
  );
}

/** A horizontal timeline of one day's cash-session window with events plotted. */
function SessionRadar({ date }: { date: string }) {
  const events = eventsForDate(date);
  // window: 07:00 → 17:00 local, mapped 0–100%
  const startMin = 7 * 60;
  const endMin = 17 * 60;
  const span = endMin - startMin;
  const pos = (instant: string) => {
    const d = new Date(instant);
    const min = d.getHours() * 60 + d.getMinutes();
    return Math.max(0, Math.min(100, ((min - startMin) / span) * 100));
  };
  const inWindow = events.filter((e) => {
    const d = new Date(e.instant);
    const min = d.getHours() * 60 + d.getMinutes();
    return min >= startMin && min <= endMin;
  });
  const hours = [7, 9, 11, 13, 15, 17];
  return (
    <div className="card">
      <div className="card-title">
        Session radar <span className="hint">where the scheduled volatility sits today (local time)</span>
      </div>
      {inWindow.length === 0 ? (
        <div className="muted small">No tier-1 releases inside the 07:00–17:00 window {events.length ? '(some fall outside it)' : 'today'}.</div>
      ) : (
        <div style={{ position: 'relative', height: 88, marginTop: 20 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 40, height: 3, background: 'var(--surface-2, #2a2622)', borderRadius: 2 }} />
          {hours.map((h) => {
            const left = ((h * 60 - startMin) / span) * 100;
            return (
              <div key={h} style={{ position: 'absolute', left: `${left}%`, top: 30, bottom: 0 }}>
                <div style={{ width: 1, height: 12, background: 'var(--axis)', margin: '0 auto' }} />
                <div className="mono" style={{ fontSize: 10, opacity: 0.6, transform: 'translateX(-50%)', marginTop: 2 }}>{String(h).padStart(2, '0')}:00</div>
              </div>
            );
          })}
          {inWindow.map((e, i) => {
            const left = pos(e.instant);
            const dom = domainOf(e.domain);
            const up = i % 2 === 0;
            return (
              <div key={e.id} style={{ position: 'absolute', left: `${left}%`, top: up ? 0 : 44, transform: 'translateX(-50%)' }}>
                {!up && <div style={{ width: 2, height: 8, background: dom?.color, margin: '0 auto' }} />}
                <div
                  title={`${localTime(e.instant)} — ${e.name}`}
                  style={{
                    background: e.impact === 'high' ? dom?.color : 'transparent',
                    border: `1.5px solid ${dom?.color}`,
                    color: e.impact === 'high' ? '#fff' : dom?.color,
                    borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                  }}
                >
                  {e.short}
                </div>
                {up && <div style={{ width: 2, height: 8, background: dom?.color, margin: '0 auto' }} />}
              </div>
            );
          })}
          <div style={{ position: 'absolute', left: 0, top: 40, width: 8, height: 8, borderRadius: 8, background: 'var(--profit)', transform: 'translate(-50%,-30%)' }} />
        </div>
      )}
    </div>
  );
}

function CompareBar({ label, value, max, money }: { label: string; value: number; max: number; money?: boolean }) {
  const w = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  const pos = value >= 0;
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <span className="small" style={{ width: 96, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 16, position: 'relative', background: 'var(--surface)', borderRadius: 4 }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--axis)' }} />
        <div style={{ position: 'absolute', left: pos ? '50%' : `${50 - w / 2}%`, width: `${w / 2}%`, top: 2, bottom: 2, borderRadius: 3, background: pos ? 'var(--profit)' : 'var(--loss)' }} />
      </div>
      <span className={`small mono ${pos ? 'pos' : 'neg'}`} style={{ width: 78, textAlign: 'right' }}>
        {money ? fmtMoney(value, { sign: true }) : value.toFixed(0)}
      </span>
    </div>
  );
}

export default function Catalysts() {
  const [anchor, setAnchor] = useState(todayISO());
  const nav = useNavigate();
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];

  const ws = weekStart(anchor);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(ws, i)), [ws]);
  const today = todayISO();

  const nextEventId = useMemo(() => {
    const up = upcomingEvents(today, 10);
    const now = Date.now();
    return up.find((e) => new Date(e.instant).getTime() >= now)?.id ?? null;
  }, [today]);

  const split = useMemo(() => eventDaySplit(trades, 'high'), [trades]);
  const perEvent = useMemo(() => perEventStats(trades), [trades]);
  const prox = useMemo(() => proximitySplit(trades, 30), [trades]);
  const hasTrades = trades.length > 0;
  const maxEventNet = Math.max(1, ...perEvent.map((e) => Math.abs(e.netPnl)));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Catalysts</h1>
          <p className="page-sub">
            The scheduled volatility that moves your markets — free, always on, and crossed with how you actually
            trade around it. Times shown in your local zone.
          </p>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setAnchor(addDays(ws, -7))}>← Prev</button>
          <button className="btn sm" onClick={() => setAnchor(today)}>This week</button>
          <button className="btn sm" onClick={() => setAnchor(addDays(ws, 7))}>Next →</button>
        </div>
      </div>

      <div className="stack">
        <SessionRadar date={today} />

        <div className="card">
          <div className="card-title">
            Week ahead <span className="hint">click an event for why it matters &amp; how to play it</span>
          </div>
          <div className="stack" style={{ gap: 14 }}>
            {weekDays.map((d) => {
              const evs = eventsForDate(d);
              const isToday = d === today;
              return (
                <div key={d}>
                  <div className="spread" style={{ marginBottom: 6 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                      <b style={{ color: isToday ? 'var(--gold)' : undefined }}>{weekdayName(d)}</b>
                      <span className="muted small">{d.slice(5)}</span>
                      {isToday && <span className="chip" style={{ background: 'var(--gold)', color: '#141210' }}>today</span>}
                    </div>
                    <span className="muted small">{evs.length ? `${evs.length} event${evs.length > 1 ? 's' : ''}` : 'quiet'}</span>
                  </div>
                  {evs.length === 0 ? (
                    <div className="muted small" style={{ paddingLeft: 4, opacity: 0.6 }}>No tier-1 catalysts — a technicals / flow day.</div>
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      {evs.map((e) => (
                        <EventRow key={e.id} e={e} isNext={e.id === nextEventId} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            Your edge around catalysts <span className="hint">from your own trade history</span>
          </div>
          {!hasTrades ? (
            <div className="muted small">Import or record trades and this fills in — you'll see whether event days are your edge or your leak.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
                <StatTile label="Event-day net" value={<PnL value={split.eventDays.netPnl} />} delta={`${split.eventDays.count} trades`} />
                <StatTile label="Event-day win rate" value={`${(split.eventDays.winRate * 100).toFixed(0)}%`} delta={`exp ${fmtMoney(split.eventDays.expectancy, { sign: true })}/tr`} />
                <StatTile label="Quiet-day net" value={<PnL value={split.quietDays.netPnl} />} delta={`${split.quietDays.count} trades`} />
                <StatTile label="Quiet-day win rate" value={`${(split.quietDays.winRate * 100).toFixed(0)}%`} delta={`exp ${fmtMoney(split.quietDays.expectancy, { sign: true })}/tr`} />
              </div>

              <div className="grid grid-2" style={{ gap: 20 }}>
                <div>
                  <div className="small muted" style={{ marginBottom: 8 }}>Net P&amp;L: into the print (±30m) vs the aftermath</div>
                  <div className="stack" style={{ gap: 8 }}>
                    <CompareBar label={`Into print (${prox.nearCount})`} value={prox.near.netPnl} max={Math.max(1, Math.abs(prox.near.netPnl), Math.abs(prox.clear.netPnl))} money />
                    <CompareBar label={`Aftermath (${prox.clearCount})`} value={prox.clear.netPnl} max={Math.max(1, Math.abs(prox.near.netPnl), Math.abs(prox.clear.netPnl))} money />
                  </div>
                  <div className="muted small" style={{ marginTop: 8, opacity: 0.75 }}>
                    {prox.near.expectancy < prox.clear.expectancy && prox.nearCount >= 3
                      ? 'You do better waiting for the dust to settle than trading into the release.'
                      : prox.nearCount >= 3
                        ? 'Trading into the release is working for you — keep sizing it deliberately.'
                        : 'Not enough into-the-print trades yet to read a pattern.'}
                  </div>
                </div>
                <div>
                  <div className="small muted" style={{ marginBottom: 8 }}>Net P&amp;L by catalyst you traded</div>
                  {perEvent.length === 0 ? (
                    <div className="muted small">No trades on tier-1 event days yet.</div>
                  ) : (
                    <div className="stack" style={{ gap: 8 }}>
                      {perEvent.slice(0, 7).map((e) => (
                        <CompareBar key={e.short} label={`${e.short} (${e.count})`} value={e.netPnl} max={maxEventNet} money />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          <div className="muted small" style={{ marginTop: 12 }}>
            Prepare a specific day in <span style={{ cursor: 'pointer', color: 'var(--gold)', textDecoration: 'underline' }} onClick={() => nav('/day')}>Trading Day → Preparation</span>, where these catalysts appear inline.
          </div>
        </div>
      </div>
    </>
  );
}
