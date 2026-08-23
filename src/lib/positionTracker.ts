/*
 * Position state machine — the trigger for auto-recording.
 *
 * Watches the fills (and any explicit position snapshots) coming off the
 * trading platform and answers one question: am I flat, or in a position?
 *
 * Recording starts when net position leaves zero and stops when it returns to
 * zero, so a scaled entry records as ONE clip covering the whole position
 * rather than one clip per fill.
 *
 * Pure and synchronous so it can be unit-tested without a browser or a feed.
 */

export interface FillEvent {
  instrument: string;
  action: 'BUY' | 'SELL';
  qty: number;
  /** ISO instant; defaults to now at apply time */
  at?: string;
}

/** Some platforms publish the net position directly — trust it over derivation. */
export interface PositionSnapshot {
  instrument: string;
  /** signed net quantity: positive long, negative short, 0 flat */
  netQty: number;
  at?: string;
}

export type PositionEvent =
  | { type: 'opened'; instrument: string; side: 'LONG' | 'SHORT'; qty: number; at: string }
  | { type: 'scaled'; instrument: string; side: 'LONG' | 'SHORT'; qty: number; at: string }
  | { type: 'closed'; instrument: string; side: 'LONG' | 'SHORT'; maxQty: number; at: string; openedAt: string };

interface OpenPos {
  net: number;
  maxAbs: number;
  side: 'LONG' | 'SHORT';
  openedAt: string;
}

/**
 * Tracks net position per instrument and emits open / scale / close events.
 *
 * A position that flips through zero (long 2 → sell 5 → short 3) is treated as
 * a close followed by an open, which is what a reviewer wants: two separate
 * clips for two separate decisions.
 */
export class PositionTracker {
  private open = new Map<string, OpenPos>();

  /** Current signed net for an instrument (0 when flat). */
  netOf(instrument: string): number {
    return this.open.get(instrument)?.net ?? 0;
  }

  /** Instruments currently holding a non-zero position. */
  openInstruments(): string[] {
    return [...this.open.keys()];
  }

  isFlat(): boolean {
    return this.open.size === 0;
  }

  /** Apply one fill; returns the events it caused, in order. */
  applyFill(f: FillEvent): PositionEvent[] {
    const at = f.at ?? new Date().toISOString();
    const signed = (f.action === 'BUY' ? 1 : -1) * Math.abs(f.qty || 0);
    if (!f.instrument || signed === 0) return [];
    return this.moveTo(f.instrument, this.netOf(f.instrument) + signed, at);
  }

  /** Apply an authoritative net-position snapshot. */
  applySnapshot(s: PositionSnapshot): PositionEvent[] {
    const at = s.at ?? new Date().toISOString();
    if (!s.instrument) return [];
    return this.moveTo(s.instrument, s.netQty, at);
  }

  /** Force-close everything (session end, disconnect) so no clip runs forever. */
  closeAll(at = new Date().toISOString()): PositionEvent[] {
    const out: PositionEvent[] = [];
    for (const inst of [...this.open.keys()]) out.push(...this.moveTo(inst, 0, at));
    return out;
  }

  private moveTo(instrument: string, next: number, at: string): PositionEvent[] {
    const cur = this.open.get(instrument);
    const prev = cur?.net ?? 0;
    if (prev === next) return [];
    const events: PositionEvent[] = [];

    // crossing through zero = close the old position, then open the new one
    if (cur && next !== 0 && Math.sign(next) !== Math.sign(prev)) {
      events.push({ type: 'closed', instrument, side: cur.side, maxQty: cur.maxAbs, at, openedAt: cur.openedAt });
      this.open.delete(instrument);
      return [...events, ...this.moveTo(instrument, next, at)];
    }

    if (next === 0) {
      if (cur) {
        events.push({ type: 'closed', instrument, side: cur.side, maxQty: cur.maxAbs, at, openedAt: cur.openedAt });
        this.open.delete(instrument);
      }
      return events;
    }

    if (!cur) {
      const side = next > 0 ? 'LONG' : 'SHORT';
      this.open.set(instrument, { net: next, maxAbs: Math.abs(next), side, openedAt: at });
      events.push({ type: 'opened', instrument, side, qty: Math.abs(next), at });
      return events;
    }

    cur.net = next;
    cur.maxAbs = Math.max(cur.maxAbs, Math.abs(next));
    events.push({ type: 'scaled', instrument, side: cur.side, qty: Math.abs(next), at });
    return events;
  }
}

/* ------------------------- describing a recording ------------------------- */

const SESSION_OF_HOUR: [number, number, string][] = [
  [0, 7, 'Asia session'],
  [7, 13, 'London session'],
  [13, 14.5, 'US pre-open'],
  [14.5, 17, 'US morning'],
  [17, 21, 'US afternoon'],
  [21, 24, 'after the close'],
];

/** Which trading session an instant falls in, in the trader's local time. */
export function sessionLabel(at: Date): string {
  const h = at.getHours() + at.getMinutes() / 60;
  return SESSION_OF_HOUR.find(([a, b]) => h >= a && h < b)?.[2] ?? 'session';
}

/**
 * A human description for the clip: instrument, side and size, the date, the
 * time of day, and which session that hour belongs to.
 *
 * e.g. "ES LONG 3 — Mon 24 Aug 2026, 14:37 (US morning)"
 */
export function describeClip(opts: {
  instrument: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  startedAt: Date;
  endedAt?: Date;
}): string {
  const { instrument, side, qty, startedAt, endedAt } = opts;
  const date = startedAt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = `${String(startedAt.getHours()).padStart(2, '0')}:${String(startedAt.getMinutes()).padStart(2, '0')}`;
  const held = endedAt ? ` · held ${formatDuration(endedAt.getTime() - startedAt.getTime())}` : '';
  return `${instrument} ${side} ${qty} — ${date}, ${time} (${sessionLabel(startedAt)})${held}`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
