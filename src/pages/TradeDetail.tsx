import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MediaEditor, VideoField } from '../components/media';
import { DomainChip, PnL, SideBadge, useToast } from '../components/ui';
import { CRITERIA, DOMAINS, domainOf, GRADE_LEVELS } from '../domain/taxonomy';
import type { CriterionId, Execution, GradeLevel, Trade } from '../domain/types';
import { db } from '../lib/db';
import { downloadFile, openPrintView, tradeDebriefHtml, tradeDebriefMarkdown } from '../lib/exporters';
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
    if (trade) setDraft({ links: [], ...trade, tags: [...trade.tags], grades: { ...trade.grades } });
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
    await db.photos.where('[parentType+parentId]').equals(['trade', trade.id!]).delete();
    await db.trades.delete(trade.id!);
    nav('/trades');
  };

  const exportDebrief = async (format: 'md' | 'json' | 'print') => {
    const photos = await db.photos.where('[parentType+parentId]').equals(['trade', trade.id!]).toArray();
    const stamp = `${draft.date}-${draft.instrument}`;
    if (format === 'md') downloadFile(`trade-debrief-${stamp}.md`, tradeDebriefMarkdown(draft, photos), 'text/markdown');
    else if (format === 'json')
      downloadFile(`trade-debrief-${stamp}.json`, JSON.stringify({ ...draft, photos: photos.map((p) => ({ ...p, dataUrl: `[image ${p.name}]` })) }, null, 2), 'application/json');
    else openPrintView(`Trade debrief ${draft.instrument} ${fmtDate(draft.date)}`, tradeDebriefHtml(draft, photos));
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
          <button className="btn sm" title="Export as Markdown" onClick={() => exportDebrief('md')}>
            ⬇ MD
          </button>
          <button className="btn sm" title="Print-ready view — save as PDF from the print dialog" onClick={() => exportDebrief('print')}>
            ⬇ PDF
          </button>
          <button className="btn sm" title="Structured data export" onClick={() => exportDebrief('json')}>
            ⬇ JSON
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
            <VideoField label="Video (recording / replay)" value={draft.videoUrl} onChange={(v) => set('videoUrl', v)} />
            <hr className="divider" />
            <MediaEditor
              parentType="trade"
              parentId={trade.id ?? null}
              links={draft.links ?? []}
              onLinksChange={(links) => set('links', links)}
            />
          </div>
        </div>

        {(draft.executions?.length ?? 0) > 0 && <ExecutionLadder trade={draft} />}

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

const ORDER_TYPE_LABEL: Record<string, string> = {
  market: 'Market',
  limit: 'Limit',
  stop: 'Stop',
  'stop-limit': 'Stop-limit',
  unknown: '—',
};

/**
 * Every fill of the trade with its role in the position (entry, scale-in,
 * scale-out, exit), the running position size and the evolving average
 * price of the open position — the raw material for studying in-trade
 * decisions when scaling dynamically.
 */
function ExecutionLadder({ trade }: { trade: Trade }) {
  const execs = [...(trade.executions ?? [])].sort((a, b) => a.time.localeCompare(b.time));
  const dir = trade.side === 'LONG' ? 1 : -1;

  let position = 0; // signed contracts (+ long / − short)
  let avgPrice = 0; // average price of the open position
  const rows = execs.map((e, i) => {
    const delta = (e.action === 'BUY' ? 1 : -1) * e.qty;
    const before = position;
    const increasing = Math.sign(delta) === dir || before === 0;
    if (increasing) {
      // adding in the trade direction — average price blends
      avgPrice = (Math.abs(before) * avgPrice + e.qty * e.price) / (Math.abs(before) + e.qty);
    }
    position += delta;
    const kind =
      increasing && before === 0
        ? 'Entry'
        : increasing
          ? 'Scale-in'
          : position === 0 && i === execs.length - 1
            ? 'Exit'
            : position === 0
              ? 'Exit'
              : 'Scale-out';
    return { e, kind, position, avgPrice };
  });

  const maxSize = Math.max(...rows.map((r) => Math.abs(r.position)), 0);
  const entries = execs.filter((e) => (e.action === 'BUY' ? 1 : -1) === dir);
  const exits = execs.filter((e) => (e.action === 'BUY' ? 1 : -1) !== dir);
  const wavg = (xs: Execution[]) => {
    const q = xs.reduce((s, x) => s + x.qty, 0);
    return q ? xs.reduce((s, x) => s + x.price * x.qty, 0) / q : 0;
  };
  const fmtPx = (v: number) => Number(v.toFixed(6)).toString();

  return (
    <div className="card">
      <div className="card-title">
        Executions — how the position was built{' '}
        <span className="hint">
          {execs.length} fills · max size {maxSize} · avg in {fmtPx(wavg(entries))} · avg out {fmtPx(wavg(exits))}
        </span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Time</th>
              <th>Role</th>
              <th>Action</th>
              <th>Order type</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th className="num">Position after</th>
              <th className="num">Avg price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="mono">{fmtTime(r.e.time)}</td>
                <td>
                  <span
                    className="chip"
                    style={
                      r.kind === 'Entry' || r.kind === 'Scale-in'
                        ? { color: 'var(--gold-strong)', borderColor: 'var(--gold)' }
                        : undefined
                    }
                  >
                    {r.kind}
                  </span>
                </td>
                <td>
                  <span className={`side-badge ${r.e.action === 'BUY' ? 'long' : 'short'}`}>{r.e.action}</span>
                </td>
                <td className="muted">{ORDER_TYPE_LABEL[r.e.orderType] ?? r.e.orderType}</td>
                <td className="num">{r.e.qty}</td>
                <td className="num mono">{fmtPx(r.e.price)}</td>
                <td className="num">{Math.abs(r.position)}</td>
                <td className="num mono">{Math.abs(r.position) > 0 ? fmtPx(r.avgPrice) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
