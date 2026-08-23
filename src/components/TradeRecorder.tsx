import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from './ui';
import type { TradeClip } from '../domain/types';
import { ClipRecorder, listenForPlatform, type RecorderState } from '../lib/clipRecorder';
import { db } from '../lib/db';
import { formatDuration } from '../lib/positionTracker';

/**
 * Trade recorder — records the workspace around every position automatically.
 *
 * Arm it once per session (one click, which is the browser's screen-capture
 * permission and cannot be bypassed). After that, a clip starts the moment a
 * position opens and stops when it is fully closed, named and stored on the
 * platform. Scale-ins keep one clip running for the whole position.
 */
const MB = 1024 * 1024;
function fmtSize(b: number): string {
  return b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

function ClipRow({ c, onPlay }: { c: TradeClip; onPlay: (c: TradeClip) => void }) {
  const toast = useToast();
  return (
    <tr>
      <td className="mono small">{c.startedAt.slice(11, 16)}</td>
      <td>
        <div style={{ fontWeight: 600 }}>{c.instrument} {c.side} {c.qty}</div>
        <div className="muted small">{c.description}</div>
      </td>
      <td className="num mono small">{formatDuration(c.durationMs)}</td>
      <td className="num mono small muted">{fmtSize(c.sizeBytes)}</td>
      <td>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => onPlay(c)}>Play</button>
          <button
            className="btn sm"
            onClick={() => {
              const url = URL.createObjectURL(c.blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${c.instrument}-${c.side}-${c.startedAt.slice(0, 16).replace(/[:T-]/g, '')}.webm`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 4000);
            }}
          >
            Save
          </button>
          <button
            className="btn sm danger"
            onClick={async () => {
              if (!confirm('Delete this recording? It cannot be recovered.')) return;
              await db.clips.delete(c.id!);
              toast('Recording deleted');
            }}
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

export function TradeRecorder() {
  const toast = useToast();
  const recRef = useRef<ClipRecorder | null>(null);
  if (!recRef.current) recRef.current = new ClipRecorder(() => toast('Recording saved to the platform'));
  const rec = recRef.current;

  const [state, setState] = useState<RecorderState>(rec.getState());
  const [playing, setPlaying] = useState<TradeClip | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [manualInst, setManualInst] = useState('ES');

  useEffect(() => rec.subscribe(setState), [rec]);
  useEffect(() => listenForPlatform(rec), [rec]);

  // live elapsed timer while recording
  useEffect(() => {
    if (state.status !== 'recording' || !state.current) return;
    const start = new Date(state.current.startedAt).getTime();
    const iv = setInterval(() => setElapsed(Date.now() - start), 1000);
    setElapsed(Date.now() - start);
    return () => clearInterval(iv);
  }, [state.status, state.current]);

  const clips = useLiveQuery(() => db.clips.orderBy('startedAt').reverse().limit(40).toArray(), []) ?? [];
  const totalBytes = useMemo(() => clips.reduce((s, c) => s + c.sizeBytes, 0), [clips]);

  const playUrl = useMemo(() => (playing ? URL.createObjectURL(playing.blob) : null), [playing]);
  useEffect(() => () => { if (playUrl) URL.revokeObjectURL(playUrl); }, [playUrl]);

  const dot = state.status === 'recording' ? 'var(--loss)' : state.status === 'armed' ? 'var(--profit)' : 'var(--muted)';

  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>
          Trade recorder <span className="hint">records your workspace around every position, automatically</span>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="grade-dot" style={{ background: dot }} />
          <span className="small" style={{ fontWeight: 600, textTransform: 'capitalize' }}>
            {state.status === 'recording' ? 'Recording' : state.status === 'armed' ? 'Armed — waiting for a position' : 'Off'}
          </span>
          {state.status === 'off' ? (
            <button className="btn primary sm" onClick={() => void rec.arm()}>Arm recorder</button>
          ) : (
            <button className="btn sm" onClick={() => rec.disarm()}>Disarm</button>
          )}
        </div>
      </div>

      {state.error && <div className="small" style={{ color: 'var(--loss)', marginBottom: 8 }}>⚠ {state.error}</div>}

      {state.status === 'off' && (
        <div className="muted small" style={{ lineHeight: 1.6 }}>
          Click <b>Arm recorder</b> once at the start of your session and pick the screen or window to capture.
          Browsers only allow screen capture to begin from a click — that is a security rule, not a setting — so this
          is the one manual step. After it, every position is recorded start to finish with no further interaction.
        </div>
      )}

      {state.status === 'recording' && state.current && (
        <div style={{ background: 'var(--surface)', borderLeft: '3px solid var(--loss)', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
          <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <b style={{ fontSize: 17 }}>● {state.current.instrument} {state.current.side} {state.current.qty}</b>
            <span className="mono">{formatDuration(elapsed)}</span>
            <span className="muted small">recording since {state.current.startedAt.slice(11, 16)} — stops automatically when the position is flat</span>
          </div>
        </div>
      )}

      {state.status === 'armed' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          <span className="muted small">
            Listening for positions from the trading platform.
            {state.lastEventAt && <> Last activity {new Date(state.lastEventAt).toLocaleTimeString()}.</>}
            {' '}No feed? Start one by hand:
          </span>
          <input value={manualInst} onChange={(e) => setManualInst(e.target.value.toUpperCase())} style={{ width: 70 }} />
          <button className="btn sm" onClick={() => rec.startManual(manualInst, 'LONG')}>● Long</button>
          <button className="btn sm" onClick={() => rec.startManual(manualInst, 'SHORT')}>● Short</button>
        </div>
      )}
      {state.status === 'recording' && (
        <div className="row" style={{ marginBottom: 6 }}>
          <button className="btn sm" onClick={() => rec.stopManual()}>■ Stop &amp; save now</button>
          <span className="muted small">only needed if the platform feed missed the close</span>
        </div>
      )}

      {clips.length > 0 && (
        <>
          <div className="spread" style={{ alignItems: 'baseline', marginTop: 12, marginBottom: 4 }}>
            <div className="tile-label">Recordings</div>
            <span className="muted small">{clips.length} clips · {fmtSize(totalBytes)} stored locally</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 330, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr><th>Time</th><th>Position</th><th className="num">Held</th><th className="num">Size</th><th></th></tr>
              </thead>
              <tbody>
                {clips.map((c) => <ClipRow key={c.id} c={c} onPlay={setPlaying} />)}
              </tbody>
            </table>
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>
            Recordings are stored on this device only — video is far too large for cloud sync. Save the ones worth
            keeping and delete the rest so the browser's storage quota stays healthy.
          </div>
        </>
      )}

      {playing && playUrl && (
        <div style={{ marginTop: 12 }}>
          <div className="spread" style={{ marginBottom: 6 }}>
            <b className="small">{playing.description}</b>
            <button className="btn sm" onClick={() => setPlaying(null)}>Close</button>
          </div>
          <video src={playUrl} controls autoPlay style={{ width: '100%', borderRadius: 8, background: '#000' }} />
        </div>
      )}
    </div>
  );
}
