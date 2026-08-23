/*
 * Auto-recording controller.
 *
 * Wires three things together:
 *   position events (from the trading platform)  →  the screen recorder  →  storage
 *
 * The one browser constraint that shapes this whole design: `getDisplayMedia`
 * can only be called from a user gesture. A page cannot silently start
 * capturing your screen — that is a security rule, not an oversight. So the
 * trader ARMS the recorder once per session with a single click, which grants
 * the capture and keeps the stream alive; from that point every position is
 * recorded and saved with no further interaction.
 */
import type { TradeClip } from '../domain/types';
import { db } from './db';
import { describeClip, PositionTracker, type PositionEvent } from './positionTracker';
import { browserRecorder, type TradeRecorder } from './screenRecord';

export type RecorderStatus = 'off' | 'armed' | 'recording';

export interface RecorderState {
  status: RecorderStatus;
  /** the position currently being recorded, when recording */
  current: { instrument: string; side: 'LONG' | 'SHORT'; qty: number; startedAt: string } | null;
  error: string | null;
  /** last event received from the platform, for the UI's "listening" indicator */
  lastEventAt: string | null;
}

type Listener = (s: RecorderState) => void;

/** Persist a finished clip to the local database. */
export async function saveClip(
  blob: Blob,
  meta: { instrument: string; side: 'LONG' | 'SHORT'; qty: number; startedAt: Date; endedAt: Date; source: 'auto' | 'manual' },
): Promise<number> {
  const clip: TradeClip = {
    date: meta.startedAt.toISOString().slice(0, 10),
    instrument: meta.instrument,
    side: meta.side,
    qty: meta.qty,
    description: describeClip(meta),
    startedAt: meta.startedAt.toISOString(),
    endedAt: meta.endedAt.toISOString(),
    durationMs: Math.max(0, meta.endedAt.getTime() - meta.startedAt.getTime()),
    mime: blob.type || 'video/webm',
    sizeBytes: blob.size,
    blob,
    tradeId: null,
    source: meta.source,
  };
  return db.clips.add(clip);
}

/**
 * Owns the recorder, the position tracker and the subscription to platform
 * events. A single instance is shared by the app.
 */
export class ClipRecorder {
  private rec: TradeRecorder;
  private tracker = new PositionTracker();
  private listeners = new Set<Listener>();
  private pending: { instrument: string; side: 'LONG' | 'SHORT'; qty: number; startedAt: Date } | null = null;
  private state: RecorderState = { status: 'off', current: null, error: null, lastEventAt: null };

  constructor(onSaved?: (id: number) => void) {
    this.rec = browserRecorder((blob) => {
      const p = this.pending;
      this.pending = null;
      if (!p) return;
      void saveClip(blob, { ...p, endedAt: new Date(), source: 'auto' })
        .then((id) => onSaved?.(id))
        .catch((e) => this.patch({ error: e instanceof Error ? e.message : String(e) }));
    });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): RecorderState {
    return this.state;
  }

  private patch(p: Partial<RecorderState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l(this.state);
  }

  /** One click, once per session. Grants screen capture and keeps the stream. */
  async arm(): Promise<void> {
    const err = await this.rec.arm();
    this.patch({ status: err ? 'off' : 'armed', error: err });
  }

  disarm(): void {
    this.rec.disarm();
    this.tracker.closeAll();
    this.pending = null;
    this.patch({ status: 'off', current: null });
  }

  isArmed(): boolean {
    return this.rec.isArmed();
  }

  /**
   * Feed a position event in. Opening starts a clip; closing stops it and the
   * finished blob is saved automatically.
   */
  handle(ev: PositionEvent): void {
    this.patch({ lastEventAt: new Date().toISOString() });
    if (!this.rec.isArmed()) return;

    if (ev.type === 'opened') {
      const startedAt = new Date(ev.at);
      if (this.rec.startClip(ev.instrument, ev.side === 'LONG' ? 'BUY' : 'SELL')) {
        this.pending = { instrument: ev.instrument, side: ev.side, qty: ev.qty, startedAt };
        this.patch({ status: 'recording', current: { ...this.pending, startedAt: startedAt.toISOString() } });
      }
      return;
    }
    if (ev.type === 'scaled') {
      // keep the clip running; remember the largest size held
      if (this.pending && ev.instrument === this.pending.instrument) {
        this.pending.qty = Math.max(this.pending.qty, ev.qty);
        this.patch({ current: { ...this.pending, startedAt: this.pending.startedAt.toISOString() } });
      }
      return;
    }
    // closed
    if (this.pending && ev.instrument === this.pending.instrument) {
      this.pending.qty = Math.max(this.pending.qty, ev.maxQty);
      this.pending.startedAt = new Date(ev.openedAt);
    }
    this.rec.stopClip();
    this.patch({ status: this.rec.isArmed() ? 'armed' : 'off', current: null });
  }

  /** Apply raw platform activity and forward whatever position events it causes. */
  applyFill(f: { instrument: string; action: 'BUY' | 'SELL'; qty: number; at?: string }): void {
    for (const ev of this.tracker.applyFill(f)) this.handle(ev);
  }
  applySnapshot(s: { instrument: string; netQty: number; at?: string }): void {
    for (const ev of this.tracker.applySnapshot(s)) this.handle(ev);
  }

  /** Manual control, for when the feed is unavailable. */
  startManual(instrument: string, side: 'LONG' | 'SHORT', qty = 1): void {
    this.handle({ type: 'opened', instrument, side, qty, at: new Date().toISOString() });
  }
  stopManual(): void {
    const cur = this.state.current;
    if (!cur) return;
    this.handle({
      type: 'closed', instrument: cur.instrument, side: cur.side,
      maxQty: cur.qty, at: new Date().toISOString(), openedAt: cur.startedAt,
    });
  }
}

/* -------------------- bridge from the capture extension -------------------- */

export interface BridgeMessage {
  __eiPosition?: true;
  kind: 'fill' | 'position' | 'hello';
  instrument?: string;
  action?: 'BUY' | 'SELL';
  qty?: number;
  netQty?: number;
  at?: string;
}

/**
 * Listen for position activity relayed by the Edge Capture extension.
 *
 * The extension watches the trading platform in its own tab and forwards fills
 * and position snapshots to this app via window.postMessage. Returns an
 * unsubscribe function.
 */
export function listenForPlatform(rec: ClipRecorder): () => void {
  const onMsg = (e: MessageEvent) => {
    const d = e.data as BridgeMessage | undefined;
    if (!d || d.__eiPosition !== true) return;
    if (d.kind === 'fill' && d.instrument && d.action && d.qty) {
      rec.applyFill({ instrument: d.instrument, action: d.action, qty: d.qty, at: d.at });
    } else if (d.kind === 'position' && d.instrument && typeof d.netQty === 'number') {
      rec.applySnapshot({ instrument: d.instrument, netQty: d.netQty, at: d.at });
    }
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}
