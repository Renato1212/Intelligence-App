import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Principle } from '../components/ui';
import { COMBOS, METHOD_STEPS } from '../lib/method';

/**
 * The Method — the page that ties the whole platform together: the daily
 * workflow in order (with what to read off each section and why), and the
 * cross-section combinations that multiply each other.
 */
export default function Method() {
  const [openStep, setOpenStep] = useState<number | null>(1);
  const [openCombo, setOpenCombo] = useState<number | null>(0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">The Method</h1>
          <p className="page-sub">
            Every section answers ONE question. Edge comes from stacking the answers in the right order at the right
            time of day. This is the order — and the combinations that multiply each other.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-title">
            The daily loop <span className="hint">open these in order — each step feeds the next</span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {METHOD_STEPS.map((s) => {
              const open = openStep === s.n;
              return (
                <div
                  key={s.n}
                  className="card"
                  style={{ padding: '10px 12px', cursor: 'pointer', borderLeft: `3px solid ${open ? 'var(--gold)' : 'var(--hairline)'}` }}
                  onClick={() => setOpenStep(open ? null : s.n)}
                >
                  <div className="spread" style={{ alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <div className="row" style={{ gap: 10, alignItems: 'baseline', minWidth: 0 }}>
                      <span className="mono" style={{ color: 'var(--gold)', fontWeight: 700 }}>{s.n}</span>
                      <b>{s.title}</b>
                      <span className="muted small">{s.when}</span>
                    </div>
                    <Link
                      to={s.route}
                      onClick={(e) => e.stopPropagation()}
                      className="chip clickable"
                      style={{ textDecoration: 'none', color: 'var(--gold)' }}
                    >
                      {s.routeLabel} →
                    </Link>
                  </div>
                  <div className="small muted" style={{ marginTop: 4, fontStyle: 'italic' }}>“{s.question}”</div>
                  {open && (
                    <div className="small" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--hairline)', display: 'grid', gap: 6 }}>
                      <div>
                        <b style={{ color: 'var(--gold)' }}>Read off it:</b>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                          {s.read.map((r, i) => (
                            <li key={i} className="muted" style={{ marginBottom: 2 }}>{r}</li>
                          ))}
                        </ul>
                      </div>
                      <div><b style={{ color: 'var(--gold)' }}>Principle:</b> <span className="muted">{s.principle}</span></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            The combinations <span className="hint">where two or three reads together say more than each alone</span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {COMBOS.map((c, i) => {
              const open = openCombo === i;
              return (
                <div
                  key={c.title}
                  className="card"
                  style={{ padding: '10px 12px', cursor: 'pointer', borderLeft: `3px solid ${open ? 'var(--gold)' : 'var(--hairline)'}` }}
                  onClick={() => setOpenCombo(open ? null : i)}
                >
                  <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <b>{c.title}</b>
                    <span className="muted small">{c.parts.join(' × ')}</span>
                  </div>
                  {open && <div className="small muted" style={{ marginTop: 6 }}>{c.why}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <Principle domain="Why a method beats a toolbox">
          Information does not compound — DECISIONS do. Ten open tabs of data produce hesitation; a fixed reading order
          produces a bias, a location and a size before the open, which is all a discretionary trader can prepare. Run
          the same loop every day so that when the tape surprises you, you know exactly WHICH input was wrong — that is
          how the loop, and your edge, improves. Your own numbers close the circle: Edge Analytics tells you which steps
          of this method actually pay you, and the debrief re-weights tomorrow's reads.
        </Principle>
      </div>
    </>
  );
}
