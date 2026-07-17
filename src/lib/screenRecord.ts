/*
 * Trade screen recorder — auto-capture a screen video around each position.
 *
 * Traders review their execution by re-watching the tape. This wraps the
 * browser's Screen Capture + MediaRecorder APIs so the platform can start a
 * recording the moment a position is initiated and stop it when the position
 * is flat (or on demand), then hand back a downloadable WebM clip named for
 * the trade.
 *
 * Everything media-related is behind a tiny surface so the pure parts
 * (filename, state machine, arming logic) are unit-tested without a browser.
 * The one-time permission prompt (getDisplayMedia) is a browser security
 * requirement — we keep the stream alive across trades so it is asked once.
 */

export type RecState = 'off' | 'armed' | 'recording';

/** Pure: a filesystem-safe clip name for a trade. */
export function clipName(symbol: string, side: string, at = new Date()): string {
  const stamp = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}-${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}${String(at.getSeconds()).padStart(2, '0')}`;
  const safe = String(symbol || 'trade').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'trade';
  const s = side === 'BUY' || side === 'SELL' ? side : 'POS';
  return `edge-${safe}-${s}-${stamp}.webm`;
}

/** Pick the best-supported recording mime type, or '' to let the browser pick. */
export function bestMimeType(supported: (t: string) => boolean = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)): string {
  for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
    try {
      if (supported(t)) return t;
    } catch {
      // isTypeSupported can throw on some engines
    }
  }
  return '';
}

interface RecorderLike {
  start(timeslice?: number): void;
  stop(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  state: string;
}
interface StreamLike {
  getTracks(): { stop(): void }[];
}

export interface RecorderDeps {
  getDisplayMedia: (constraints: unknown) => Promise<StreamLike>;
  makeRecorder: (stream: StreamLike, mime: string) => RecorderLike;
  /** deliver a finished clip (download / save) */
  onClip: (blob: Blob, name: string) => void;
}

/**
 * Holds the shared display stream and drives per-trade recordings. Inject deps
 * in tests; in the app the defaults use the real browser APIs.
 */
export class TradeRecorder {
  private stream: StreamLike | null = null;
  private recorder: RecorderLike | null = null;
  private chunks: Blob[] = [];
  private pendingName = '';
  state: RecState = 'off';

  constructor(private readonly deps: RecorderDeps) {}

  /** Ask for the screen ONCE and keep the stream so later clips need no prompt. */
  async arm(): Promise<string | null> {
    if (this.stream) {
      this.state = 'armed';
      return null;
    }
    try {
      this.stream = await this.deps.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      this.state = 'armed';
      return null;
    } catch (e) {
      this.state = 'off';
      return e instanceof Error && e.name === 'NotAllowedError' ? 'Screen capture was denied. Allow it to auto-record trades.' : 'Could not start screen capture.';
    }
  }

  /** Release the shared stream and stop everything. */
  disarm(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* already stopped */ }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.state = 'off';
  }

  isArmed(): boolean {
    return this.state === 'armed' || this.state === 'recording';
  }

  /** Begin a clip for a trade. No-op (returns false) if not armed or already recording. */
  startClip(symbol: string, side: string): boolean {
    if (!this.stream || this.state === 'recording') return false;
    const mime = bestMimeType();
    this.chunks = [];
    this.pendingName = clipName(symbol, side);
    const rec = this.deps.makeRecorder(this.stream, mime);
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    rec.onstop = () => {
      const type = mime || 'video/webm';
      const blob = new Blob(this.chunks, { type });
      if (blob.size > 0) this.deps.onClip(blob, this.pendingName);
      this.chunks = [];
      this.state = this.stream ? 'armed' : 'off';
    };
    rec.start(1000); // gather data every second so a crash still yields a clip
    this.recorder = rec;
    this.state = 'recording';
    return true;
  }

  /** Stop the current clip; the finished blob is delivered via onClip. */
  stopClip(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* already stopped */ }
    }
  }
}

/* ------------------------- default browser bindings ----------------------- */

/** Trigger a browser download of a blob (the default clip sink). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Construct a recorder wired to the real browser APIs. */
export function browserRecorder(onClip: (blob: Blob, name: string) => void = downloadBlob): TradeRecorder {
  return new TradeRecorder({
    getDisplayMedia: (c) => (navigator.mediaDevices as unknown as { getDisplayMedia: (x: unknown) => Promise<StreamLike> }).getDisplayMedia(c),
    makeRecorder: (stream, mime) => new MediaRecorder(stream as unknown as MediaStream, mime ? { mimeType: mime } : undefined) as unknown as RecorderLike,
    onClip,
  });
}
