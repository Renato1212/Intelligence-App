import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { CRITERIA, DOMAINS } from '../domain/taxonomy';
import { db } from '../lib/db';
import { fmtMoney, fmtPct } from '../lib/format';
import { computeStats } from '../lib/stats';

export default function Playbook() {
  const [active, setActive] = useState(DOMAINS[0].id);
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];
  const d = DOMAINS.find((x) => x.id === active)!;

  const domainStats = useMemo(() => computeStats(trades.filter((t) => t.domain === d.id)), [trades, d]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">The 5 Edge Domain Playbook</h1>
          <p className="page-sub">
            Know what to look for, how to classify a trade and how it is graded — before you put size on.
          </p>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        {DOMAINS.map((dom) => (
          <span
            key={dom.id}
            className={`chip clickable ${active === dom.id ? 'selected' : ''}`}
            style={{ padding: '6px 14px', fontSize: 13 }}
            onClick={() => setActive(dom.id)}
          >
            <span className="dot" style={{ background: dom.color }} />
            {String(dom.index).padStart(2, '0')} · {dom.name}
          </span>
        ))}
      </div>

      <div className="stack">
        <div className="card" style={{ borderLeft: `3px solid ${d.color}` }}>
          <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div className="small muted" style={{ letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                Edge domain {d.index}
              </div>
              <h2 style={{ fontSize: 26, marginTop: 2 }}>{d.name}</h2>
              <div className="muted" style={{ fontStyle: 'italic' }}>{d.tagline}</div>
            </div>
            {domainStats.count > 0 && (
              <div className="row" style={{ gap: 22 }}>
                <MiniStat label="Your trades" value={String(domainStats.count)} />
                <MiniStat
                  label="Net P&L"
                  value={fmtMoney(domainStats.netPnl, { sign: true })}
                  cls={domainStats.netPnl >= 0 ? 'pos' : 'neg'}
                />
                <MiniStat label="Win rate" value={fmtPct(domainStats.winRate)} />
                <MiniStat
                  label="Expectancy"
                  value={fmtMoney(domainStats.expectancy, { sign: true })}
                  cls={domainStats.expectancy >= 0 ? 'pos' : 'neg'}
                />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">
              <span className="row" style={{ gap: 8 }}>
                <span className="pb-section-label">A</span> What to look for
              </span>
              <span className="hint">spot when this domain is in play</span>
            </div>
            <ul className="check">
              {d.lookFor.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
          <div className="card">
            <div className="card-title">
              <span className="row" style={{ gap: 8 }}>
                <span className="pb-section-label">C</span> Common mistakes
              </span>
              <span className="hint">self-check before you size up</span>
            </div>
            <ul className="check">
              {d.mistakes.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span className="row" style={{ gap: 8 }}>
              <span className="pb-section-label">B</span> How to classify a trade — tagging
            </span>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            <div>
              <div className="small" style={{ color: 'var(--gold)', fontWeight: 650, letterSpacing: '0.08em' }}>
                LEVEL 1 — PRIMARY TAG
              </div>
              <div className="muted">{d.level1}</div>
            </div>
            <div>
              <div className="small" style={{ color: 'var(--gold)', fontWeight: 650, letterSpacing: '0.08em' }}>
                LEVEL 2 — CATEGORIES
              </div>
              <div className="stack" style={{ gap: 4, marginTop: 4 }}>
                {d.categories.map((c) => (
                  <div key={c.id}>
                    <b>{c.label}:</b> <span className="muted">{c.hint}.</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="small" style={{ color: 'var(--gold)', fontWeight: 650, letterSpacing: '0.08em' }}>
                LEVEL 3 — SUGGESTIONS
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                {d.level3Suggestions.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span className="row" style={{ gap: 8 }}>
              <span className="pb-section-label">D</span> Grading criteria — coach view
            </span>
            <span className="hint">the bar AXIA coaches hold you to</span>
          </div>
          <div className="table-wrap">
            <table className="data rubric">
              <thead>
                <tr>
                  <th>Criterion</th>
                  <th>Below standard</th>
                  <th>At standard</th>
                  <th>Above standard</th>
                </tr>
              </thead>
              <tbody>
                {d.rubric.map((r) => (
                  <tr key={r.criterion}>
                    <td style={{ fontWeight: 600 }}>{CRITERIA.find((c) => c.id === r.criterion)?.label}</td>
                    <td className="muted">{r.below}</td>
                    <td>{r.at}</td>
                    <td className="above">{r.above}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function MiniStat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="tile-label">{label}</div>
      <div className={`tile-value sm ${cls ?? ''}`}>{value}</div>
    </div>
  );
}
