import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui';
import { todayISO } from '../lib/format';
import Terminal from './Terminal';

/**
 * Pre-US reassessment — the "Before US session" block.
 *
 * Deliberately short: a five-minute reset. What changed since the EU brief,
 * and a single decision. Standing down is a first-class outcome and is tracked
 * as a positive, not a failure.
 */
type Verdict = 'hold' | 'adjust' | 'standdown';

interface Reassessment {
  date: string;
  changed: string;
  verdict: Verdict;
  note: string;
  at: string;
}

const KEY = 'ei-reassess';

export function getReassessment(date: string): Reassessment | null {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Reassessment>;
    return all[date] ?? null;
  } catch {
    return null;
  }
}
function save(r: Reassessment) {
  const all = (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Reassessment>;
    } catch {
      return {};
    }
  })();
  all[r.date] = r;
  localStorage.setItem(KEY, JSON.stringify(all));
}

const VERDICTS: { id: Verdict; label: string; hint: string; color: string }[] = [
  { id: 'hold', label: 'Plan holds', hint: 'Nothing material changed — trade the plan as written.', color: 'var(--profit)' },
  { id: 'adjust', label: 'Adjust', hint: 'Something changed — note what, and amend the plan before the open.', color: 'var(--dom-news)' },
  { id: 'standdown', label: 'Stand down', hint: 'Conditions are not mine. Not trading is a win, and it is recorded as one.', color: 'var(--gold)' },
];

export default function Reassess() {
  const date = todayISO();
  const nav = useNavigate();
  const toast = useToast();
  const existing = getReassessment(date);
  const [changed, setChanged] = useState(existing?.changed ?? '');
  const [verdict, setVerdict] = useState<Verdict | null>(existing?.verdict ?? null);
  const [note, setNote] = useState(existing?.note ?? '');

  const commit = () => {
    if (!verdict) {
      toast('Pick a verdict — that is the whole point of the reset');
      return;
    }
    save({ date, changed, verdict, note, at: new Date().toISOString() });
    toast(verdict === 'standdown' ? 'Stood down — recorded as a good decision' : 'Reassessment saved');
    nav(verdict === 'standdown' ? '/' : '/live');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="tile-label" style={{ marginBottom: 2 }}>Before US session</div>
          <h1 className="page-title">Reassess</h1>
          <p className="page-sub">Five minutes. What changed since the brief, and does the plan still hold?</p>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-title">
            1 · What changed <span className="hint">since the EU brief</span>
          </div>
          <textarea
            rows={3}
            placeholder="New headlines, level breaks, a regime or correlation shift…"
            value={changed}
            onChange={(e) => setChanged(e.target.value)}
          />
        </div>

        <div className="card">
          <div className="card-title">
            2 · The decision <span className="hint">one choice, then act on it</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {VERDICTS.map((v) => (
              <div
                key={v.id}
                className="card clickable"
                style={{
                  background: verdict === v.id ? 'var(--gold-dim)' : 'var(--surface)',
                  borderLeft: `3px solid ${v.color}`,
                  cursor: 'pointer',
                  padding: '12px 14px',
                }}
                onClick={() => setVerdict(v.id)}
              >
                <b>{v.label}</b>
                <div className="muted small" style={{ marginTop: 3 }}>{v.hint}</div>
              </div>
            ))}
          </div>
          <textarea
            rows={2}
            style={{ marginTop: 10 }}
            placeholder="Optional: the reason, in one line"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={commit}>Save reassessment</button>
            {existing && <span className="muted small">last saved {new Date(existing.at).toLocaleTimeString()}</span>}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            Morning tape <span className="hint">what has printed since the brief</span>
          </div>
          <div className="embedded"><Terminal /></div>
        </div>
      </div>
    </>
  );
}
