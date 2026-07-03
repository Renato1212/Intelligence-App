import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DomainChip, Modal, useToast } from '../components/ui';
import { DOMAINS, domainOf } from '../domain/taxonomy';
import type { Strategy, StrategyStatus } from '../domain/types';
import { db } from '../lib/db';
import { fmtMoney, fmtPct, fmtR } from '../lib/format';
import { computeStats } from '../lib/stats';

const STATUS: { id: StrategyStatus; label: string; hint: string }[] = [
  { id: 'incubating', label: 'Incubating', hint: 'An observed pattern being written up — no live risk yet' },
  { id: 'testing', label: 'Testing', hint: 'Trading small, collecting a sample' },
  { id: 'active', label: 'Active', hint: 'Proven edge, full playbook size' },
  { id: 'retired', label: 'Retired', hint: 'Edge decayed or invalidated — kept for the record' },
];

const EMPTY: Omit<Strategy, 'id'> = {
  name: '',
  domain: null,
  category: null,
  status: 'incubating',
  hypothesis: '',
  rules: '',
  createdAt: '',
};

export default function Strategies() {
  const strategies = useLiveQuery(() => db.strategies.toArray(), []);
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];
  const [editing, setEditing] = useState<(Omit<Strategy, 'id'> & { id?: number }) | null>(null);
  const toast = useToast();
  const nav = useNavigate();

  const statsFor = useMemo(() => {
    const map = new Map<number, ReturnType<typeof computeStats>>();
    for (const s of strategies ?? []) {
      map.set(s.id!, computeStats(trades.filter((t) => t.strategyId === s.id)));
    }
    return map;
  }, [strategies, trades]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast('Give the strategy a name');
      return;
    }
    if (editing.id) await db.strategies.put(editing as Strategy);
    else await db.strategies.add({ ...editing, createdAt: new Date().toISOString() });
    setEditing(null);
    toast('Strategy saved');
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this strategy? Linked trades keep their data.')) return;
    await db.trades.where('strategyId').equals(id).modify({ strategyId: null });
    await db.strategies.delete(id);
  };

  const grouped = STATUS.map((st) => ({
    ...st,
    items: (strategies ?? []).filter((s) => s.status === st.id),
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Strategy Lab</h1>
          <p className="page-sub">
            Turn observations into templates, templates into tested strategies, tested strategies into your playbook.
            Notes that feed a template are what "above standard" review looks like.
          </p>
        </div>
        <button className="btn primary" onClick={() => setEditing({ ...EMPTY })}>
          + New strategy
        </button>
      </div>

      <div className="stack">
        {grouped.map((g) => (
          <div key={g.id}>
            <div className="row" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 14 }}>{g.label}</h3>
              <span className="muted small">{g.hint}</span>
            </div>
            {g.items.length === 0 ? (
              <div className="muted small" style={{ padding: '4px 2px 10px' }}>
                Nothing here yet.
              </div>
            ) : (
              <div className="grid grid-2">
                {g.items.map((s) => {
                  const st = statsFor.get(s.id!);
                  const d = domainOf(s.domain);
                  return (
                    <div key={s.id} className="card" style={{ borderLeft: `3px solid ${d?.color ?? 'var(--hairline)'}` }}>
                      <div className="spread">
                        <h3 style={{ fontSize: 15 }}>{s.name}</h3>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn sm" onClick={() => setEditing({ ...s })}>
                            Edit
                          </button>
                          <button className="btn sm danger" onClick={() => remove(s.id!)}>
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="row" style={{ margin: '6px 0' }}>
                        <DomainChip id={s.domain} />
                        {s.category && <span className="chip">{s.category}</span>}
                      </div>
                      {s.hypothesis && <p className="muted small" style={{ margin: '6px 0' }}>{s.hypothesis}</p>}
                      {st && st.count > 0 ? (
                        <div className="row" style={{ gap: 18, marginTop: 10 }}>
                          <Mini label="Sample" value={`${st.count} trades`} />
                          <Mini label="Net P&L" value={fmtMoney(st.netPnl, { sign: true })} cls={st.netPnl >= 0 ? 'pos' : 'neg'} />
                          <Mini label="Win rate" value={fmtPct(st.winRate, 0)} />
                          <Mini label="Expectancy" value={fmtMoney(st.expectancy, { sign: true })} cls={st.expectancy >= 0 ? 'pos' : 'neg'} />
                          <Mini label="Avg R" value={fmtR(st.avgR)} />
                        </div>
                      ) : (
                        <div className="muted small" style={{ marginTop: 10 }}>
                          No trades linked yet — link trades from the trade debrief page to build the sample.
                        </div>
                      )}
                      {st && st.count > 0 && (
                        <button
                          className="btn sm"
                          style={{ marginTop: 10 }}
                          onClick={() => nav(`/trades?strategy=${s.id}`)}
                        >
                          View trades
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit strategy' : 'New strategy'} onClose={() => setEditing(null)}>
          <div className="stack">
            <label className="field">
              <span>Name</span>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. IB Break / LVN Continuation" />
            </label>
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>
                Edge domain
              </div>
              <div className="row">
                {DOMAINS.map((d) => (
                  <DomainChip
                    key={d.id}
                    id={d.id}
                    selected={editing.domain === d.id}
                    onClick={() => setEditing({ ...editing, domain: editing.domain === d.id ? null : d.id, category: null })}
                  />
                ))}
              </div>
            </div>
            {editing.domain && (
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  Category
                </div>
                <div className="row">
                  {domainOf(editing.domain)!.categories.map((c) => (
                    <span
                      key={c.id}
                      className={`chip clickable ${editing.category === c.id ? 'selected' : ''}`}
                      onClick={() => setEditing({ ...editing, category: editing.category === c.id ? null : c.id })}
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <label className="field">
              <span>Status</span>
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as StrategyStatus })}>
                {STATUS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} — {s.hint}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Hypothesis — why does this edge exist?</span>
              <textarea rows={3} value={editing.hypothesis} onChange={(e) => setEditing({ ...editing, hypothesis: e.target.value })} />
            </label>
            <label className="field">
              <span>Rules — entry, stop, target, sizing, management</span>
              <textarea rows={4} value={editing.rules} onChange={(e) => setEditing({ ...editing, rules: e.target.value })} />
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={save}>
                Save strategy
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Mini({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="tile-label" style={{ fontSize: 10.5 }}>
        {label}
      </div>
      <div className={`small ${cls ?? ''}`} style={{ fontWeight: 650 }}>
        {value}
      </div>
    </div>
  );
}
