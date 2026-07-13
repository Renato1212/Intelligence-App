import { useEffect, useMemo, useState } from 'react';
import { Principle } from '../components/ui';
import {
  allSessionStates,
  fmtCountdown,
  primeTime,
  type SessionState,
} from '../lib/sessions';
import { fmtLisbon, fmtLisbonDate, lisbonAbbr, lisbonParts, zoneParts } from '../lib/tz';

/** Re-render every `ms` for the live clock. */
function useTick(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/* -------------------------------- clock --------------------------------- */

function LiveClock({ now }: { now: Date }) {
  const et = zoneParts(now, 'America/New_York');
  const lon = zoneParts(now, 'Europe/London');
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
      <div>
        <div className="tile-label">Lisbon · {lisbonAbbr(now)}</div>
        <div className="mono" style={{ fontSize: 42, fontWeight: 700, lineHeight: 1.05, letterSpacing: 1 }}>
          {fmtLisbon(now, { seconds: true })}
        </div>
        <div className="muted small">{fmtLisbonDate(now)}</div>
      </div>
      <div className="row" style={{ gap: 22, marginLeft: 'auto', flexWrap: 'wrap' }}>
        <div>
          <div className="tile-label">New York (ET)</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{pad(et.h)}:{pad(et.min)}</div>
        </div>
        <div>
          <div className="tile-label">London</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{pad(lon.h)}:{pad(lon.min)}</div>
        </div>
        <div>
          <div className="tile-label">UTC</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{pad(now.getUTCHours())}:{pad(now.getUTCMinutes())}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- timeline -------------------------------- */

/** A 24-hour Lisbon timeline with each session as a bar and a live "now" marker. */
function Timeline({ now, states }: { now: Date; states: SessionState[] }) {
  const nowPct = (lisbonParts(now).minutesOfDay / 1440) * 100;

  // Position each session at its DAILY Lisbon clock window (minute-of-day of the
  // open/close instant), so every session shows regardless of open/closed today.
  // None of these sessions cross Lisbon midnight, so open-min < close-min holds.
  const seg = (s: SessionState) => {
    const startMin = lisbonParts(s.openInstant).minutesOfDay;
    const endMin = lisbonParts(s.closeInstant).minutesOfDay;
    return { left: (startMin / 1440) * 100, width: (Math.max(0, endMin - startMin) / 1440) * 100 };
  };

  const hours = [0, 4, 8, 12, 16, 20, 24];
  return (
    <div className="card">
      <div className="card-title">
        The day at a glance <span className="hint">24h Lisbon timeline — where the sessions sit and overlap, live</span>
      </div>
      <div style={{ position: 'relative', paddingTop: 6 }}>
        {/* hour grid */}
        <div style={{ position: 'relative', height: 16 }}>
          {hours.map((h) => (
            <div key={h} className="mono" style={{ position: 'absolute', left: `${(h / 24) * 100}%`, transform: 'translateX(-50%)' }}>
              <span className="muted" style={{ fontSize: 10 }}>{String(h).padStart(2, '0')}</span>
            </div>
          ))}
        </div>
        {/* session bars */}
        <div className="stack" style={{ gap: 4, position: 'relative' }}>
          {states.map((s) => {
            const { left, width } = seg(s);
            if (width <= 0) return null;
            return (
              <div key={s.def.id} style={{ position: 'relative', height: 20 }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: 8, height: 3, background: 'var(--surface-2,#221f1b)', borderRadius: 2 }} />
                <div
                  title={`${s.def.short} · ${fmtLisbon(s.openInstant)}–${fmtLisbon(s.closeInstant)} Lisbon`}
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 2,
                    height: 15,
                    background: s.phase === 'open' ? s.def.color : `${s.def.color}44`,
                    border: `1px solid ${s.def.color}`,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: 6,
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, color: s.phase === 'open' ? '#12100c' : s.def.color, whiteSpace: 'nowrap' }}>{s.def.short}</span>
                </div>
              </div>
            );
          })}
          {/* now marker spanning all rows */}
          <div style={{ position: 'absolute', left: `${nowPct}%`, top: -2, bottom: -2, width: 2, background: 'var(--gold)', boxShadow: '0 0 6px var(--gold)' }}>
            <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: 'var(--gold)', fontWeight: 700, whiteSpace: 'nowrap' }}>now</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- session cards ----------------------------- */

function SessionCard({ s, open }: { s: SessionState; open: boolean }) {
  const [show, setShow] = useState(false);
  const total = s.def.close[0] * 60 + s.def.close[1] - (s.def.open[0] * 60 + s.def.open[1]);
  return (
    <div className="card" style={{ borderLeft: `3px solid ${s.def.color}`, opacity: open ? 1 : 0.92 }}>
      <div className="spread" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setShow((v) => !v)}>
        <div className="row" style={{ gap: 10, alignItems: 'baseline', minWidth: 0 }}>
          <span className="grade-dot" style={{ background: s.def.color, boxShadow: open ? `0 0 6px ${s.def.color}` : 'none' }} />
          <b>{s.def.name}</b>
          <span className="mono muted small">{fmtLisbon(s.openInstant)}–{fmtLisbon(s.closeInstant)} Lisbon</span>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {open ? (
            <>
              <span className="chip" style={{ background: s.def.color, color: '#12100c', fontWeight: 700 }}>OPEN</span>
              <span className="mono small">closes in {fmtCountdown(s.msToClose ?? 0)}</span>
            </>
          ) : (
            <>
              <span className="chip" style={{ color: 'var(--muted)' }}>closed</span>
              <span className="mono small" style={{ color: 'var(--gold)' }}>opens in {fmtCountdown(s.msToOpen ?? 0)}</span>
            </>
          )}
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ position: 'relative', height: 6, background: 'var(--surface-2,#221f1b)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${s.progress * 100}%`, background: s.def.color }} />
          </div>
          <div className="spread muted small" style={{ marginTop: 3 }}>
            <span>{fmtCountdown(s.elapsedMs ?? 0)} in ({Math.round(s.progress * 100)}%)</span>
            <span>{Math.round(total / 60 * 10) / 10}h session</span>
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        {s.def.markets.map((m) => (
          <span key={m} className="chip mono" style={{ fontSize: 11 }}>{m}</span>
        ))}
        <span className="muted small" style={{ marginLeft: 'auto', cursor: 'pointer' }} onClick={() => setShow((v) => !v)}>{show ? '▾ why & how' : '▸ why & how'}</span>
      </div>
      {show && (
        <div className="small" style={{ marginTop: 8, display: 'grid', gap: 4, paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
          <div><b style={{ color: 'var(--gold)' }}>Why it matters:</b> <span className="muted">{s.def.why}</span></div>
          <div><b style={{ color: 'var(--gold)' }}>How to trade it:</b> <span className="muted">{s.def.play}</span></div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- page ---------------------------------- */

export default function Sessions() {
  const now = useTick(1000);
  const states = useMemo(() => allSessionStates(now), [now]);
  const openStates = states.filter((s) => s.phase === 'open');
  const pt = useMemo(() => primeTime(now), [now]);

  // order: open sessions first (by close time), then upcoming (by open time)
  const ordered = [...states].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase === 'open' ? -1 : 1;
    return a.phase === 'open'
      ? (a.msToClose ?? 0) - (b.msToClose ?? 0)
      : (a.msToOpen ?? 0) - (b.msToOpen ?? 0);
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Session Clock</h1>
          <p className="page-sub">
            The day's structure in Lisbon time — who is in control right now, what opens next, and the overlaps where the
            volume (and the edge) lives. Live, to the second.
          </p>
        </div>
      </div>

      <div className="stack">
        <LiveClock now={now} />

        {/* right-now summary */}
        <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="tile-label">Open now</div>
            {openStates.length ? (
              <div className="row" style={{ gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                {openStates.map((s) => (
                  <span key={s.def.id} className="chip" style={{ background: s.def.color, color: '#12100c', fontWeight: 700 }}>{s.def.short}</span>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 2 }}>Markets closed — next open in {fmtCountdown(Math.min(...states.map((s) => s.msToOpen ?? Infinity)))}</div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div className="tile-label">Prime time — Europe × US overlap</div>
            {pt ? (
              pt.active ? (
                <div style={{ color: 'var(--profit)', fontWeight: 700 }}>● LIVE — ends in {fmtCountdown(pt.msToEnd ?? 0)}</div>
              ) : (
                <div className="mono">{fmtLisbon(pt.start)}–{fmtLisbon(pt.end)} Lisbon{pt.msToStart != null ? ` · in ${fmtCountdown(pt.msToStart)}` : ''}</div>
              )
            ) : (
              <div className="muted">—</div>
            )}
          </div>
        </div>

        <Timeline now={now} states={states} />

        <div className="stack" style={{ gap: 8 }}>
          {ordered.map((s) => (
            <SessionCard key={s.def.id} s={s} open={s.phase === 'open'} />
          ))}
        </div>

        <Principle domain="The session map — timing the day">
          Liquidity and volatility rotate around the clock, and the same setup means different things at 09:00, 14:30 and
          17:00 Lisbon. The two windows that pay are the OPENS (fresh inventory, real volume — the European 08:00 and the
          US-cash 14:30 Lisbon) and the Europe×US OVERLAP (both continents live, the deepest liquidity of the day). The
          windows that trap are the handoffs and lunches, when one region has left and the next hasn't arrived — ranges go
          thin and false breaks multiply. Anchor every intraday decision to the window it happens in, and let your own
          time-of-day stats (Edge Analytics → timing heatmap) tell you which of these sessions actually pays YOU.
        </Principle>

        <div className="muted small">
          Hours shown are each market's liquid/active window (cash or pit hours), computed in the market's own timezone and
          rendered in Lisbon — so DST on both sides is always correct. Electronic (Globex) trading runs nearly 24h around
          these; the windows above are where the volume that moves price actually concentrates.
        </div>
      </div>
    </>
  );
}
