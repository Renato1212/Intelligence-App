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
import { bestMimeType, browserRecorder, type TradeRecorder } from './screenRecord';

export type RecorderStatus = 'off' | 'armed' | 'recording';

export interface RecorderState {
  status: RecorderStatus;
  /** the position currently being recorded, when recording */
  current: { instrument: string; side: 'LONG' | 'SHORT'; qty: number; startedAt: string } | null;
  error: string | null;
  /** last event received from the platform, for the UI's "listening" indicator */
  lastEventAt: string | null;
  /** the extension bridge has said hello on this page */
  bridgeSeen: boolean;
  /** how many platform events have arrived this session */
  eventCount: number;
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
  private state: RecorderState = { status: 'off', current: null, error: null, lastEventAt: null, bridgeSeen: false, eventCount: 0 };

  constructor(onSaved?: (id: number) => void) {
    this.rec = browserRecorder(
      (blob) => {
      const p = this.pending;
      this.pending = null;
      if (!p) return;
        void saveClip(blob, { ...p, endedAt: new Date(), source: 'auto' })
          .then((id) => onSaved?.(id))
          .catch((e) => this.patch({ error: e instanceof Error ? e.message : String(e) }));
      },
      () => {
        // the browser's own "Stop sharing" ended the capture
        this.pending = null;
        this.patch({
          status: 'off',
          current: null,
          error: 'Screen sharing was stopped in the browser, so recording is off. Arm it again to resume.',
        });
      },
    );
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

  hasLiveTrack(): boolean {
    return this.rec.hasLiveTrack();
  }

  /**
   * Feed a position event in. Opening starts a clip; closing stops it and the
   * finished blob is saved automatically.
   */
  /** The extension bridge announced itself on this page. */
  noteBridge(): void {
    this.patch({ bridgeSeen: true });
  }

  handle(ev: PositionEvent): void {
    this.patch({ lastEventAt: new Date().toISOString(), eventCount: this.state.eventCount + 1 });
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

/** One line per link in the chain, so a failure names itself. */
export interface CheckResult { label: string; ok: boolean; detail: string }

/**
 * Diagnose the whole path: browser capability → capture permission → live
 * track → extension bridge → platform events → storage. Every previous
 * "it didn't work" cost a round trip; this answers it in one click.
 */
export async function selfTest(rec: ClipRecorder): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const s = rec.getState();

  out.push({
    label: 'Secure context',
    ok: typeof window !== 'undefined' && window.isSecureContext,
    detail: window.isSecureContext ? 'https or localhost — screen capture is allowed' : 'Screen capture needs https. Open the app over https.',
  });

  const hasGdm = typeof navigator !== 'undefined' && !!navigator.mediaDevices &&
    typeof (navigator.mediaDevices as { getDisplayMedia?: unknown }).getDisplayMedia === 'function';
  out.push({
    label: 'Screen capture supported',
    ok: hasGdm,
    detail: hasGdm ? 'getDisplayMedia is available' : 'This browser cannot capture the screen. Use desktop Chrome, Edge or Firefox — iOS Safari cannot.',
  });

  const mime = typeof MediaRecorder !== 'undefined' ? bestMimeType() : '';
  out.push({
    label: 'Video encoder',
    ok: typeof MediaRecorder !== 'undefined',
    detail: typeof MediaRecorder === 'undefined' ? 'MediaRecorder is missing in this browser.' : `recording as ${mime || 'the browser default'}`,
  });

  const live = rec.hasLiveTrack();
  out.push({
    label: 'Capture armed',
    ok: live,
    detail: live ? 'a live screen track is held — recordings can start' : 'Not armed. Press "Arm recorder" and choose a screen or window.',
  });

  out.push({
    label: 'Extension bridge',
    ok: s.bridgeSeen,
    detail: s.bridgeSeen
      ? 'the Edge Capture extension is talking to this page'
      : 'No bridge detected. Load/reload the extension, and make sure this page\'s address is covered by it (localhost or *.vercel.app).',
  });

  out.push({
    label: 'Platform activity',
    ok: s.eventCount > 0,
    detail: s.eventCount > 0
      ? `${s.eventCount} position events received, last ${s.lastEventAt ? new Date(s.lastEventAt).toLocaleTimeString() : '—'}`
      : 'No fills or positions seen yet. Open Trading Technologies in another tab; if it still shows nothing while you are in a position, detection needs tuning for your TT build — use the manual buttons meanwhile.',
  });

  let storageOk = false;
  let storageDetail = '';
  try {
    const probe = new Blob([new Uint8Array(1024)], { type: 'video/webm' });
    const id = await db.clips.add({
      date: '1970-01-01', instrument: '__probe', side: 'LONG', qty: 0,
      description: 'storage self-test', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
      durationMs: 0, mime: 'video/webm', sizeBytes: probe.size, blob: probe, tradeId: null, source: 'manual',
    });
    await db.clips.delete(id);
    storageOk = true;
    storageDetail = 'video can be written to and read from this device';
  } catch (e) {
    storageDetail = `Cannot store recordings: ${e instanceof Error ? e.message : String(e)}. The browser's storage quota may be full.`;
  }
  out.push({ label: 'Local storage', ok: storageOk, detail: storageDetail });

  return out;
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
    if (d.kind === 'hello') {
      rec.noteBridge();
    } else if (d.kind === 'fill' && d.instrument && d.action && d.qty) {
      rec.applyFill({ instrument: d.instrument, action: d.action, qty: d.qty, at: d.at });
    } else if (d.kind === 'position' && d.instrument && typeof d.netQty === 'number') {
      rec.applySnapshot({ instrument: d.instrument, netQty: d.netQty, at: d.at });
    }
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}


/**
 * One recorder for the whole app.
 *
 * It must NOT live inside a React component: arming holds a screen-capture
 * stream, and if the component unmounts (navigating away from Today) a
 * per-instance recorder would be discarded, silently orphaning the capture and
 * coming back reporting "off". A module-level singleton keeps the armed stream
 * alive across navigation for the whole session.
 */
let singleton: ClipRecorder | null = null;
export function getClipRecorder(onSaved?: (id: number) => void): ClipRecorder {
  if (!singleton) singleton = new ClipRecorder(onSaved);
  return singleton;
}
