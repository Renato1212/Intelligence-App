import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandCenter } from '../components/CommandCenter';
import { OptionsLevels } from '../components/OptionsLevels';
import { useToast } from '../components/ui';
import { loadDemoData } from '../lib/demo';
import { db } from '../lib/db';
import { localTime } from '../lib/calendar';
import { fmtMoney, todayISO, weekdayName } from '../lib/format';
import { ensureLiveCoverage, reconciledEventsForDate } from '../lib/reconcile';
import { computeRisk, getRiskConfig } from '../lib/risk';
import { currentPhase, PHASES, SESSION_BLOCKS } from '../lib/routine';

/**
 * Home — "Today".
 *
 * Above the fold, nothing else: the session ribbon, one line of state, and a
 * single primary action that changes with the clock. The app should never make
 * the trader decide what to open.
 */
function Ribbon({ events }: { events: { instant: string; short: string; impact: string }[] }) {
  const now = new Date();
  const pct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
  return (
    <div className="ribbon" title="24h session ribbon — local time">
      {SESSION_BLOCKS.map((b) => (
        <div
          key={b.label}
          className="ribbon-block"
          style={{ left: `${(b.from / 24) * 100}%`, width: `${((b.to - b.from) / 24) * 100}%` }}
        >
          {b.label}
        </div>
      ))}
      {events.map((e, i) => {
        const d = new Date(e.instant);
        const left = ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100;
        return (
          <div
            key={i}
            className="ribbon-ev"
            style={{ left: `${left}%`, opacity: e.impact === 'high' ? 1 : 0.45 }}
            title={`${e.short} — ${localTime(e.instant)}`}
          />
        );
      })}
      <div className="ribbon-now" style={{ left: `${pct}%` }} title={`now ${localTime(now.toISOString())}`} />
    </div>
  );
}

export default function Today() {
  const nav = useNavigate();
  const today = todayISO();
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];
  const prep = useLiveQuery(() => db.preps.where('date').equals(today).first(), [today]);
  const debrief = useLiveQuery(() => db.debriefs.where('date').equals(today).first(), [today]);

  const toast = useToast();
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void ensureLiveCoverage(today).then((ok) => alive && ok && setTick((t) => t + 1));
    const iv = setInterval(() => setTick((t) => t + 1), 60000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [today]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => reconciledEventsForDate(today).events, [today, tick]);
  const high = events.filter((e) => e.impact === 'high');
  const risk = useMemo(() => computeRisk(trades, getRiskConfig()), [trades]);

  // The clock decides the next action; completed steps advance it.
  const phase = useMemo(() => {
    const p = currentPhase();
    if (p.id === 'brief' && prep) return PHASES.find((x) => x.id === 'plan')!;
    if (p.id === 'debrief' && debrief) return p;
    return p;
  }, [prep, debrief, tick]);

  const todayTrades = trades.filter((t) => t.date === today);
  const empty = trades.length === 0;
  const state = [
    high.length ? `${high.length} red event${high.length > 1 ? 's' : ''}` : 'no red events',
    prep ? 'prepared' : 'not prepared',
    `${todayTrades.length} trade${todayTrades.length === 1 ? '' : 's'} today`,
    `${fmtMoney(risk.headroom)} headroom`,
  ].join(' · ');

  return (
    <>
      <div className="page-head">
        <div>
          <div className="tile-label" style={{ marginBottom: 2 }}>{weekdayName(today)} {today}</div>
          <h1 className="page-title">Today</h1>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <Ribbon events={events} />
          <div className="spread" style={{ marginTop: 12, gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div className="mono small" style={{ letterSpacing: '.02em' }}>{state}</div>
              <div className="muted small" style={{ marginTop: 4 }}>{phase.block} — {phase.purpose}</div>
            </div>
            <button className="btn primary" onClick={() => nav(phase.route)} style={{ fontSize: 15, padding: '10px 20px' }}>
              {phase.action} →
            </button>
          </div>
        </div>

        {empty ? (
          <div className="card empty">
            <h3>Start the loop</h3>
            <p>
              The app follows your routine: brief before Europe, plan, reassess before the US open, trade, debrief.
              Bring your trades in and every screen fills with your own record — or load a demo day to see the shape
              of it first.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => nav('/data')}>Import trades</button>
              <button
                className="btn"
                disabled={loadingDemo}
                onClick={async () => {
                  setLoadingDemo(true);
                  const n = await loadDemoData();
                  setLoadingDemo(false);
                  toast(`Loaded ${n} demo trades — clear them any time in Data → Settings`);
                }}
              >
                {loadingDemo ? 'Loading…' : 'Load demo data'}
              </button>
            </div>
          </div>
        ) : (
          <CommandCenter trades={trades} />
        )}

        <OptionsLevels />

        <div className="card">
          <div className="card-title">
            The loop <span className="hint">your routine, in order — jump to any block</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {PHASES.map((p) => {
              const done = (p.id === 'brief' && !!prep) || (p.id === 'debrief' && !!debrief);
              const isNow = p.id === phase.id;
              return (
                <div
                  key={p.id}
                  className="card clickable"
                  style={{
                    background: 'var(--surface)',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderLeft: `3px solid ${isNow ? 'var(--gold)' : done ? 'var(--profit)' : 'var(--hairline)'}`,
                  }}
                  onClick={() => nav(p.route)}
                >
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    {done && <span style={{ color: 'var(--profit)' }}>✓</span>}
                    <b style={{ fontSize: 14 }}>{p.label}</b>
                    {isNow && <span className="chip" style={{ background: 'var(--gold)', color: '#141210', fontSize: 10 }}>now</span>}
                  </div>
                  <div className="muted small" style={{ marginTop: 2 }}>{p.block}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
