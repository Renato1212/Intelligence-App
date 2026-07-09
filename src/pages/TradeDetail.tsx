import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MediaEditor, VideoField } from '../components/media';
import { DomainChip, PnL, SideBadge, useToast } from '../components/ui';
import { CRITERIA, DOMAINS, domainOf, GRADE_LEVELS } from '../domain/taxonomy';
import type { CriterionId, Execution, GradeLevel, Trade } from '../domain/types';
import { db } from '../lib/db';
import { downloadFile, openPrintView, tradeDebriefHtml, tradeDebriefMarkdown } from '../lib/exporters';
import { applyFillsToTrade, computeLadder, ORDER_TYPES, sortFills } from '../lib/fills';
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

        <ExecutionLogger
          trade={draft}
          onApply={async (execs) => {
            const next = applyFillsToTrade(draft, execs);
            setDraft(next);
            await db.trades.put(next);
            toast(execs.length ? `Saved ${execs.length} fills — trade recomputed` : 'Fills cleared');
          }}
        />

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

/** Local-time value for a datetime-local input from an ISO instant. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string {
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * The Execution Logger — track every decision in a trade by hand or from
 * capture. Add each fill (scale-in, add, partial, exit) with its own order
 * type, price, size and time; the role, running position, evolving average
 * price and realized P&L are computed live, and applying the fills recomputes
 * the trade's entry/exit/size/P&L so a hand-logged trade is a first-class one.
 */
function ExecutionLogger({ trade, onApply }: { trade: Trade; onApply: (execs: Execution[]) => void }) {
  const [fills, setFills] = useState<Execution[]>(() => sortFills(trade.executions ?? []));
  const [dirty, setDirty] = useState(false);

  // reload when the trade identity changes (navigating between trades)
  useEffect(() => {
    setFills(sortFills(trade.executions ?? []));
    setDirty(false);
  }, [trade.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirLabel = trade.side === 'LONG' ? 'BUY' : 'SELL';
  const rows = computeLadder(fills, trade.side);
  const fmtPx = (v: number) => Number(v.toFixed(6)).toString();

  const patch = (i: number, p: Partial<Execution>) => {
    setFills((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)));
    setDirty(true);
  };
  const removeRow = (i: number) => {
    setFills((fs) => fs.filter((_, j) => j !== i));
    setDirty(true);
  };
  const addRow = () => {
    // default: continue in the trade direction, market order, at the last
    // known price, timed just after the previous fill
    const last = fills[fills.length - 1];
    const nextTime = last ? new Date(new Date(last.time).getTime() + 60000).toISOString() : trade.entryTime || new Date().toISOString();
    const seed: Execution = {
      time: nextTime,
      action: (trade.side === 'LONG' ? 'BUY' : 'SELL') as Execution['action'],
      qty: last?.qty ?? trade.qty ?? 1,
      price: last?.price ?? trade.entryPrice ?? 0,
      orderType: 'market',
    };
    setFills((fs) => [...fs, seed]);
    setDirty(true);
  };
  const seedFromSummary = () => {
    // bootstrap two fills from the averaged trade so the trader can refine
    const entry: Execution = { time: trade.entryTime, action: dirLabel as Execution['action'], qty: trade.qty || 1, price: trade.entryPrice, orderType: 'market' };
    const exit: Execution = { time: trade.exitTime, action: (dirLabel === 'BUY' ? 'SELL' : 'BUY') as Execution['action'], qty: trade.qty || 1, price: trade.exitPrice, orderType: 'market' };
    setFills([entry, exit]);
    setDirty(true);
  };

  const maxSize = Math.max(...rows.map((r) => r.position), 0);

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Execution logger{' '}
          <span className="hint">
            {fills.length ? `${fills.length} fills · max size ${maxSize}` : 'log every add, partial & exit — with its order type'}
          </span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={addRow}>+ Add fill</button>
          {fills.length === 0 && (trade.entryPrice || trade.exitPrice) ? (
            <button className="btn sm" title="Start from the averaged entry/exit, then refine each fill" onClick={seedFromSummary}>
              Seed from trade
            </button>
          ) : null}
          {dirty && (
            <button className="btn primary sm" onClick={() => { onApply(fills); setDirty(false); }}>
              Save fills to trade
            </button>
          )}
        </div>
      </div>

      {fills.length === 0 ? (
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          No per-fill detail yet. Click <b>+ Add fill</b> to log each decision — entry, every scale-in and add, each
          partial and the exit — with its order type (market / limit / stop), price, size and time. The role, running
          position, average price and realized P&L are computed as you go, and saving recomputes the trade from your
          fills. Fills captured from Trader One land here too and can be corrected by hand.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Role</th>
                <th>Action</th>
                <th>Order type</th>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th className="num">Size after</th>
                <th className="num">Avg price</th>
                <th className="num">Realized</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                // the index into `fills` for this sorted row
                const idx = fills.indexOf(r.e);
                return (
                  <tr key={i}>
                    <td>
                      <input
                        type="datetime-local"
                        value={toLocalInput(r.e.time)}
                        onChange={(e) => patch(idx, { time: fromLocalInput(e.target.value) })}
                        style={{ width: 172, fontSize: 12 }}
                      />
                    </td>
                    <td>
                      <span className="chip" style={r.role === 'Entry' || r.role === 'Scale-in' ? { color: 'var(--gold-strong)', borderColor: 'var(--gold)' } : undefined}>
                        {r.role}
                      </span>
                    </td>
                    <td>
                      <select value={r.e.action} onChange={(e) => patch(idx, { action: e.target.value as Execution['action'] })} style={{ fontSize: 12 }}>
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                      </select>
                    </td>
                    <td>
                      <select value={r.e.orderType} onChange={(e) => patch(idx, { orderType: e.target.value as Execution['orderType'] })} style={{ fontSize: 12 }}>
                        {ORDER_TYPES.map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <input type="number" min="0" step="any" value={r.e.qty} onChange={(e) => patch(idx, { qty: Number(e.target.value) })} style={{ width: 62, textAlign: 'right' }} />
                    </td>
                    <td className="num">
                      <input type="number" step="any" value={r.e.price} onChange={(e) => patch(idx, { price: Number(e.target.value) })} style={{ width: 92, textAlign: 'right' }} className="mono" />
                    </td>
                    <td className="num">{r.position}</td>
                    <td className="num mono">{r.position > 0 ? fmtPx(r.avgPrice) : '—'}</td>
                    <td className={`num mono ${r.realizedPts > 0 ? 'pos' : r.realizedPts < 0 ? 'neg' : 'muted'}`}>
                      {r.realizedPts ? `${r.realizedPts > 0 ? '+' : ''}${fmtPx(r.realizedPts)}` : '—'}
                    </td>
                    <td>
                      <span style={{ cursor: 'pointer', color: 'var(--muted)' }} title="Remove fill" onClick={() => removeRow(idx)}>✕</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dirty && (
        <div className="small" style={{ marginTop: 8, color: 'var(--gold)' }}>
          Unsaved fill edits — <b>Save fills to trade</b> to recompute entry, exit, size and P&amp;L from these fills.
        </div>
      )}
    </div>
  );
}
