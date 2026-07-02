import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DomainChip, PnL, SideBadge, useToast } from '../components/ui';
import { CRITERIA, DOMAINS, domainOf, GRADE_LEVELS } from '../domain/taxonomy';
import type { CriterionId, GradeLevel, Trade } from '../domain/types';
import { db } from '../lib/db';
import { fmtDate, fmtDuration, fmtMoney, fmtR, fmtTime } from '../lib/format';
import { rMultiple } from '../lib/stats';

export default function TradeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const trade = useLiveQuery(() => db.trades.get(Number(id)), [id]);
  const strategies = useLiveQuery(() => db.strategies.toArray(), []) ?? [];
  const [draft, setDraft] = useState<Trade | null>(null);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (trade) setDraft({ ...trade, tags: [...trade.tags], grades: { ...trade.grades } });
  }, [trade]);

  if (!trade || !draft) {
    return (
      <div className="empty card">
        <h3>Trade not found</h3>
        <Link to="/trades" className="btn">
          Back to trades
        </Link>
      </div>
    );
  }

  const d = domainOf(draft.domain);
  const r = rMultiple(draft);

  const set = <K extends keyof Trade>(key: K, value: Trade[K]) => setDraft({ ...draft, [key]: value });

  const toggleTag = (tag: string) => {
    set('tags', draft.tags.includes(tag) ? draft.tags.filter((t) => t !== tag) : [...draft.tags, tag]);
  };

  const setGrade = (c: CriterionId, g: GradeLevel) => {
    const grades = { ...draft.grades };
    if (grades[c] === g) delete grades[c];
    else grades[c] = g;
    set('grades', grades);
  };

  const save = async () => {
    await db.trades.put(draft);
    toast('Trade debrief saved');
  };

  const remove = async () => {
    if (!confirm('Delete this trade? This cannot be undone.')) return;
    await db.trades.delete(trade.id!);
    nav('/trades');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 12 }}>
            <h1 className="page-title mono">{draft.instrument}</h1>
            <SideBadge side={draft.side} />
            <DomainChip id={draft.domain} />
          </div>
          <p className="page-sub">
            {fmtDate(draft.date)} · {fmtTime(draft.entryTime)} → {fmtTime(draft.exitTime)} ·{' '}
            {fmtDuration(draft.entryTime, draft.exitTime)} · {draft.qty} lots
            {draft.account && ` · ${draft.account}`}
          </p>
        </div>
        <div className="row">
          <button className="btn danger sm" onClick={remove}>
            Delete
          </button>
          <Link to="/trades" className="btn sm">
            Back
          </Link>
          <button className="btn primary" onClick={save}>
            Save debrief
          </button>
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-tiles">
          <div className="card tile">
            <div className="tile-label">Net P&L</div>
            <div className="tile-value">
              <PnL value={draft.pnl} />
            </div>
          </div>
          <div className="card tile">
            <div className="tile-label">Entry → Exit</div>
            <div className="tile-value sm mono">
              {draft.entryPrice} → {draft.exitPrice}
            </div>
          </div>
          <div className="card tile">
            <div className="tile-label">R multiple</div>
            <div className={`tile-value sm ${r != null ? (r >= 0 ? 'pos' : 'neg') : ''}`}>{fmtR(r)}</div>
            <div className="tile-delta">risk {draft.plannedRisk ? fmtMoney(draft.plannedRisk) : 'not set'}</div>
          </div>
          <div className="card tile">
            <div className="tile-label">Fees</div>
            <div className="tile-value sm">{fmtMoney(draft.fees)}</div>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card stack">
            <div className="card-title">Classification — how a coach would tag it</div>

            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>
                Level 1 · Edge domain
              </div>
              <div className="row">
                {DOMAINS.map((dom) => (
                  <DomainChip
                    key={dom.id}
                    id={dom.id}
                    selected={draft.domain === dom.id}
                    onClick={() => {
                      set('domain', draft.domain === dom.id ? null : dom.id);
                      if (draft.domain !== dom.id) set('category', null);
                    }}
                  />
                ))}
              </div>
              {d && <div className="small muted" style={{ marginTop: 6 }}>{d.level1}</div>}
            </div>

            {d && (
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  Level 2 · Category
                </div>
                <div className="row">
                  {d.categories.map((c) => (
                    <span
                      key={c.id}
                      className={`chip clickable ${draft.category === c.id ? 'selected' : ''}`}
                      title={c.hint}
                      onClick={() => set('category', draft.category === c.id ? null : c.id)}
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>
                Level 3 · Refinements
              </div>
              {d && (
                <div className="row" style={{ marginBottom: 8 }}>
                  {d.level3Suggestions.map((s) => (
                    <span key={s} className={`chip clickable ${draft.tags.includes(s) ? 'selected' : ''}`} onClick={() => toggleTag(s)}>
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <div className="row">
                {draft.tags
                  .filter((t) => !d || !d.level3Suggestions.includes(t))
                  .map((t) => (
                    <span key={t} className="chip selected clickable" onClick={() => toggleTag(t)}>
                      {t} ✕
                    </span>
                  ))}
                <input
                  placeholder="Add custom tag ↵"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tagInput.trim()) {
                      toggleTag(tagInput.trim());
                      setTagInput('');
                    }
                  }}
                  style={{ width: 150 }}
                />
              </div>
            </div>

            <div className="grid grid-2">
              <label className="field">
                <span>Strategy</span>
                <select
                  value={draft.strategyId ?? ''}
                  onChange={(e) => set('strategyId', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— none —</option>
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Planned risk ($ at stop)</span>
                <input
                  type="number"
                  min={0}
                  value={draft.plannedRisk ?? ''}
                  onChange={(e) => set('plannedRisk', e.target.value ? Number(e.target.value) : null)}
                  placeholder="e.g. 250"
                />
              </label>
            </div>
          </div>

          <div className="card stack">
            <div className="card-title">Trade debrief</div>
            <label className="field">
              <span>Description — what you were expecting and what happened</span>
              <textarea value={draft.description} onChange={(e) => set('description', e.target.value)} rows={5} />
            </label>
            <label className="field">
              <span>What did you learn?</span>
              <textarea value={draft.learned} onChange={(e) => set('learned', e.target.value)} rows={3} />
            </label>
            <label className="field">
              <span>How to apply what you learned</span>
              <textarea value={draft.applyNext} onChange={(e) => set('applyNext', e.target.value)} rows={3} />
            </label>
            <label className="field">
              <span>Video (recording / replay link)</span>
              <input value={draft.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} placeholder="https://…" />
            </label>
            {draft.videoUrl && (
              <a href={draft.videoUrl} target="_blank" rel="noreferrer" className="small">
                Open video ↗
              </a>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            Coach grading{' '}
            <span className="hint">{d ? `${d.name} standard` : 'select a domain to see the rubric descriptions'}</span>
          </div>
          <div className="table-wrap">
            <table className="data rubric">
              <thead>
                <tr>
                  <th>Criterion</th>
                  {GRADE_LEVELS.map((g) => (
                    <th key={g.id}>{g.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CRITERIA.map((c) => {
                  const row = d?.rubric.find((x) => x.criterion === c.id);
                  return (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.label}</td>
                      {GRADE_LEVELS.map((g) => {
                        const selected = draft.grades?.[c.id] === g.id;
                        const text = row ? row[g.id === 'below' ? 'below' : g.id === 'at' ? 'at' : 'above'] : '';
                        return (
                          <td
                            key={g.id}
                            onClick={() => setGrade(c.id, g.id)}
                            style={{
                              cursor: 'pointer',
                              background: selected
                                ? g.id === 'below'
                                  ? 'var(--loss-soft)'
                                  : g.id === 'above'
                                    ? 'var(--gold-dim)'
                                    : 'rgba(255,255,255,0.06)'
                                : undefined,
                              borderLeft: selected
                                ? `2px solid ${g.id === 'below' ? 'var(--loss)' : g.id === 'above' ? 'var(--gold)' : 'var(--text-2)'}`
                                : '2px solid transparent',
                            }}
                          >
                            <span className={selected ? '' : 'muted'}>{text || g.label}</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            Click a cell to grade the trade the way an AXIA coach would. Click again to clear.
          </div>
        </div>
      </div>
    </>
  );
}
