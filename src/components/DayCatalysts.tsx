import { useState } from 'react';
import { domainOf } from '../domain/taxonomy';
import { eventsForDate, localTime, type CalendarEvent } from '../lib/calendar';

/**
 * Free, always-on catalysts for the preparation day — no API key. Computed
 * deterministically from the tier-1 US release schedule and shown with the
 * "why it matters / how to play it" context an AXIA discretionary trader needs
 * while preparing.
 */
function Row({ e }: { e: CalendarEvent }) {
  const [open, setOpen] = useState(false);
  const dom = domainOf(e.domain);
  return (
    <div style={{ borderLeft: `3px solid ${dom?.color ?? 'var(--muted)'}`, paddingLeft: 10 }}>
      <div className="spread" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <div className="row" style={{ gap: 8, alignItems: 'center', minWidth: 0 }}>
          <span className="mono" style={{ fontWeight: 700, width: 44 }}>{localTime(e.instant)}</span>
          <span className="grade-dot" style={{ background: e.impact === 'high' ? 'var(--loss)' : 'var(--dom-news)' }} />
          <b>{e.short}</b>
          <span className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
        </div>
        <div className="row" style={{ gap: 3, flexShrink: 0 }}>
          {e.affects.slice(0, 5).map((a) => (
            <span key={a} className="chip mono" style={{ fontSize: 10, padding: '1px 5px' }}>{a}</span>
          ))}
        </div>
      </div>
      {open && (
        <div className="small muted" style={{ margin: '4px 0 8px', display: 'grid', gap: 4 }}>
          <div><b style={{ color: dom?.color }}>Why:</b> {e.why}</div>
          <div><b style={{ color: dom?.color }}>Play:</b> {e.playbook}</div>
        </div>
      )}
    </div>
  );
}

export function DayCatalysts({ date }: { date: string }) {
  const events = eventsForDate(date);
  const highCount = events.filter((e) => e.impact === 'high').length;
  return (
    <div className="card">
      <div className="card-title">
        Scheduled catalysts <span className="hint">free · always on · times in your local zone</span>
      </div>
      {events.length === 0 ? (
        <div className="muted small">
          No tier-1 US releases scheduled — a technicals / flow day. Let structure and the overnight read lead.
        </div>
      ) : (
        <>
          <div className="muted small" style={{ marginBottom: 8 }}>
            {highCount > 0 ? (
              <><b style={{ color: 'var(--loss)' }}>{highCount} high-impact</b> release{highCount > 1 ? 's' : ''} today — plan around the scheduled volatility.</>
            ) : (
              'Only second-tier releases today — lighter scheduled risk.'
            )}
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {events.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
