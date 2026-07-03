import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DebriefEditor } from '../components/DebriefEditor';
import { PrepEditor } from '../components/PrepEditor';
import { DomainChip, Modal, PnL, SideBadge } from '../components/ui';
import type { Photo } from '../domain/types';
import { db } from '../lib/db';
import { addDays, fmtDate, fmtDuration, fmtPct, fmtTime, todayISO, weekdayName } from '../lib/format';
import { computeStats } from '../lib/stats';

type Tab = 'prep' | 'trades' | 'debrief';

export default function TradingDay() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayISO();
  const tab = (params.get('tab') as Tab) ?? 'prep';
  const nav = useNavigate();
  const [preview, setPreview] = useState<Photo | null>(null);

  const setDate = (d: string) => setParams({ date: d, tab });
  const setTab = (t: Tab) => setParams({ date, tab: t });

  const prep = useLiveQuery(() => db.preps.where('date').equals(date).first(), [date]);
  const debrief = useLiveQuery(() => db.debriefs.where('date').equals(date).first(), [date]);
  const trades =
    useLiveQuery(() => db.trades.where('date').equals(date).toArray(), [date])?.sort((a, b) => a.entryTime.localeCompare(b.entryTime)) ?? [];

  const photos =
    useLiveQuery(async () => {
      const parents: [Photo['parentType'], number][] = [];
      const [p, d, ts] = await Promise.all([
        db.preps.where('date').equals(date).first(),
        db.debriefs.where('date').equals(date).first(),
        db.trades.where('date').equals(date).toArray(),
      ]);
      if (p?.id) parents.push(['prep', p.id]);
      if (d?.id) parents.push(['debrief', d.id]);
      for (const t of ts) if (t.id) parents.push(['trade', t.id]);
      const all = await Promise.all(parents.map(([pt, pid]) => db.photos.where('[parentType+parentId]').equals([pt, pid]).toArray()));
      return all.flat();
    }, [date]) ?? [];

  const stats = useMemo(() => computeStats(trades), [trades]);

  const videos: { label: string; url: string }[] = [
    ...(prep?.videoUrl ? [{ label: 'Preparation video', url: prep.videoUrl }] : []),
    ...(debrief?.videoUrl ? [{ label: 'Day recording', url: debrief.videoUrl }] : []),
    ...trades.filter((t) => t.videoUrl).map((t) => ({ label: `${t.instrument} ${fmtTime(t.entryTime)} trade video`, url: t.videoUrl })),
  ];
  const links = [...(prep?.links ?? []), ...(debrief?.links ?? []), ...trades.flatMap((t) => t.links ?? [])];

  const TABS: { id: Tab; label: string; done: boolean }[] = [
    { id: 'prep', label: 'Preparation', done: !!prep },
    { id: 'trades', label: `Trades (${trades.length})`, done: trades.length > 0 },
    { id: 'debrief', label: 'Debrief', done: !!debrief },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Trading Day</h1>
          <p className="page-sub">Preparation, execution and debrief — the full cycle for one day in one place.</p>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setDate(addDays(date, -1))}>
            ← Prev
          </button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn sm" onClick={() => setDate(addDays(date, 1))}>
            Next →
          </button>
          <button className="btn sm" onClick={() => setDate(todayISO())}>
            Today
          </button>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 18 }}>
                {weekdayName(date)} {fmtDate(date)}
              </h2>
              <div className="muted small">
                {trades.length ? (
                  <>
                    {trades.length} trades · net <PnL value={stats.netPnl} /> · win rate {fmtPct(stats.winRate, 0)}
                  </>
                ) : (
                  'No trades recorded'
                )}
                {' · '}prep {prep ? '✓' : '—'} · debrief {debrief ? '✓' : '—'}
              </div>
            </div>
            <div className="row">
              {TABS.map((t) => (
                <span key={t.id} className={`chip clickable ${tab === t.id ? 'selected' : ''}`} style={{ padding: '6px 14px', fontSize: 13 }} onClick={() => setTab(t.id)}>
                  {t.done && <span style={{ color: 'var(--gold)' }}>●</span>} {t.label}
                </span>
              ))}
            </div>
          </div>

          {(videos.length > 0 || links.length > 0 || photos.length > 0) && (
            <>
              <hr className="divider" />
              <div className="row" style={{ gap: 8 }}>
                {videos.map((v, i) => (
                  <a key={`v${i}`} className="chip clickable" href={v.url} target="_blank" rel="noreferrer">
                    ▶ {v.label}
                  </a>
                ))}
                {links.map((l, i) => (
                  <a key={`l${i}`} className="chip clickable" href={l.url} target="_blank" rel="noreferrer">
                    {l.label} ↗
                  </a>
                ))}
                {photos.map((p) => (
                  <img
                    key={p.id}
                    src={p.dataUrl}
                    alt={p.name}
                    title={p.name}
                    style={{ height: 34, width: 50, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--hairline)', cursor: 'zoom-in' }}
                    onClick={() => setPreview(p)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {tab === 'prep' && <PrepEditor date={date} />}

        {tab === 'trades' && (
          <div className="card">
            <div className="card-title">
              Trades on {fmtDate(date)} <span className="hint">click a trade to open its debrief</span>
            </div>
            {trades.length === 0 ? (
              <div className="muted small">No trades this day — import executions or check another date.</div>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Inst</th>
                      <th>Side</th>
                      <th className="num">Qty</th>
                      <th>Duration</th>
                      <th>Domain</th>
                      <th>Tags</th>
                      <th className="num">P&L</th>
                      <th>Media</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.id} className="clickable" onClick={() => nav(`/trades/${t.id}`)}>
                        <td>{fmtTime(t.entryTime)}</td>
                        <td className="mono">{t.instrument}</td>
                        <td>
                          <SideBadge side={t.side} />
                        </td>
                        <td className="num">{t.qty}</td>
                        <td className="muted">{fmtDuration(t.entryTime, t.exitTime)}</td>
                        <td>
                          <DomainChip id={t.domain} />
                        </td>
                        <td className="muted small">{t.tags.slice(0, 3).join(' · ')}</td>
                        <td className="num">
                          <PnL value={t.pnl} />
                        </td>
                        <td className="muted small">
                          {t.videoUrl && '▶ '}
                          {(t.links?.length ?? 0) > 0 && '↗ '}
                          {photos.some((p) => p.parentType === 'trade' && p.parentId === t.id) && '🖼'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'debrief' && (
          <div className="card">
            <div className="card-title">Daily debrief — {fmtDate(date)}</div>
            <DebriefEditor date={date} />
          </div>
        )}
      </div>

      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)}>
          <img src={preview.dataUrl} alt={preview.name} style={{ maxWidth: '100%', borderRadius: 8 }} />
        </Modal>
      )}
    </>
  );
}
