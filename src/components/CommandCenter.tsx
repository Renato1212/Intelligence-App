import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Trade } from '../domain/types';
import { db } from '../lib/db';
import { localTime } from '../lib/calendar';
import { reconciledEventsForDate } from '../lib/reconcile';
import { buildFocus } from '../lib/confluence';
import { cachedCot } from '../lib/cot';
import { fmtMoney, todayISO, weekdayName } from '../lib/format';
import { rollingExpectancy } from '../lib/stats';

/**
 * The morning command center — the one band that connects the day's plan to
 * the work that matters, so nothing important gets lost:
 *  - today's scheduled catalysts (from the free calendar)
 *  - the market focus: where positioning, catalysts and the trader's own
 *    edge line up this week (from Market Intel's confluence engine)
 *  - whether today is prepared
 *  - the review queue: trades still missing a tag / description / grade
 *    (the AXIA discipline is that every rep is tagged and articulated)
 *  - the edge trend: is rolling expectancy improving or decaying?
 */
function Cell({ title, children, onClick, accent }: { title: string; children: React.ReactNode; onClick?: () => void; accent?: string }) {
  return (
    <div
      className="card"
      style={{ padding: '12px 14px', cursor: onClick ? 'pointer' : undefined, borderTop: `2px solid ${accent ?? 'var(--hairline)'}` }}
      onClick={onClick}
    >
      <div className="tile-label" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

export function CommandCenter({ trades }: { trades: Trade[] }) {
  const nav = useNavigate();
  const today = todayISO();
  const prep = useLiveQuery(() => db.preps.where('date').equals(today).first(), [today]);

  const events = useMemo(() => reconciledEventsForDate(today).events, [today]);
  const highToday = events.filter((e) => e.impact === 'high');
  const nextEvent = useMemo(() => {
    const now = Date.now();
    return events.find((e) => new Date(e.instant).getTime() >= now) ?? null;
  }, [events]);

  const queue = useMemo(() => {
    const untagged = trades.filter((t) => !t.domain);
    const undescribed = trades.filter((t) => !t.description || !t.description.trim());
    const ungraded = trades.filter((t) => Object.keys(t.grades ?? {}).length === 0);
    return { untagged: untagged.length, undescribed: undescribed.length, ungraded: ungraded.length };
  }, [trades]);

  const focus = useMemo(() => {
    // cached COT only — the command center never blocks on the network
    const rows = buildFocus(trades, cachedCot(), today).filter((r) => r.confluence >= 1);
    return { top: rows.slice(0, 3), strong: rows.filter((r) => r.confluence >= 2).length };
  }, [trades, today]);

  const trend = useMemo(() => {
    const roll = rollingExpectancy(trades, Math.min(20, Math.max(5, Math.floor(trades.length / 3) || 5)));
    if (roll.length < 2) return null;
    const last = roll[roll.length - 1].value;
    const prev = roll[Math.max(0, roll.length - Math.ceil(roll.length / 3) - 1)].value;
    return { last, delta: last - prev };
  }, [trades]);

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>
          Command center <span className="hint">{weekdayName(today)} — plan, execute, review</span>
        </div>
        <span className="small" style={{ cursor: 'pointer', color: 'var(--gold)' }} onClick={() => nav('/day')}>Open Trading Day →</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <Cell title="Today's catalysts" accent={highToday.length ? 'var(--loss)' : 'var(--profit)'} onClick={() => nav('/catalysts')}>
          {events.length === 0 ? (
            <div><b style={{ fontSize: 20 }}>Quiet</b><div className="muted small">No tier-1 releases — technicals / flow day.</div></div>
          ) : (
            <div>
              <b style={{ fontSize: 20, color: highToday.length ? 'var(--loss)' : undefined }}>
                {highToday.length ? `${highToday.length} high-impact` : `${events.length} scheduled`}
              </b>
              <div className="muted small">
                {nextEvent ? <>next <b style={{ color: 'var(--text)' }}>{nextEvent.approx ? '~' : ''}{nextEvent.short}</b> at {localTime(nextEvent.instant)}{nextEvent.approx ? ' (est.)' : ''}</> : 'all released for today'}
              </div>
            </div>
          )}
        </Cell>

        <Cell title="Market focus" accent={focus.strong ? 'var(--gold)' : 'var(--hairline)'} onClick={() => nav('/intel')}>
          {focus.top.length === 0 ? (
            <div><b style={{ fontSize: 20 }}>—</b><div className="muted small">Open Market Intel to pull positioning.</div></div>
          ) : (
            <div>
              <b style={{ fontSize: 20 }} className="mono">{focus.top.map((r) => r.symbol).join(' · ')}</b>
              <div className="muted small">
                {focus.strong
                  ? `${focus.strong} market${focus.strong > 1 ? 's' : ''} with 2+ reads aligned this week`
                  : 'positioning × catalysts × your edge'}
              </div>
            </div>
          )}
        </Cell>

        <Cell title="Today's preparation" accent={prep ? 'var(--profit)' : 'var(--dom-news)'} onClick={() => nav('/day?tab=prep')}>
          <b style={{ fontSize: 20 }}>{prep ? 'Ready' : 'Not started'}</b>
          <div className="muted small">{prep ? 'Prep saved — review your hypotheses.' : 'Build your plan before the open.'}</div>
        </Cell>

        <Cell title="Review queue" accent={queue.untagged || queue.ungraded ? 'var(--gold)' : 'var(--profit)'} onClick={() => nav('/trades')}>
          {queue.untagged === 0 && queue.ungraded === 0 && queue.undescribed === 0 ? (
            <div><b style={{ fontSize: 20, color: 'var(--profit)' }}>Clear</b><div className="muted small">Every trade tagged, described &amp; graded.</div></div>
          ) : (
            <div>
              <b style={{ fontSize: 20, color: 'var(--gold)' }}>{queue.untagged + queue.ungraded}</b>
              <div className="muted small">
                {queue.untagged} untagged · {queue.undescribed} to describe · {queue.ungraded} to grade
              </div>
            </div>
          )}
        </Cell>

        <Cell title="Edge trend" accent={trend && trend.delta >= 0 ? 'var(--profit)' : 'var(--loss)'} onClick={() => nav('/analytics')}>
          {!trend ? (
            <div><b style={{ fontSize: 20 }}>—</b><div className="muted small">More trades needed to read the trend.</div></div>
          ) : (
            <div>
              <b style={{ fontSize: 20 }} className={trend.last >= 0 ? 'pos' : 'neg'}>{fmtMoney(trend.last, { sign: true })}<span className="muted small" style={{ fontWeight: 400 }}>/trade</span></b>
              <div className="muted small">
                rolling expectancy {trend.delta >= 0 ? '▲ improving' : '▼ decaying'} ({fmtMoney(trend.delta, { sign: true })})
              </div>
            </div>
          )}
        </Cell>
      </div>
    </div>
  );
}
