import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PnL, StatTile } from '../components/ui';
import { domainOf } from '../domain/taxonomy';
import { db } from '../lib/db';
import { eventsForDate, localTime, type CalendarEvent } from '../lib/calendar';
import { reconcileDay, reconciledEventsForDate, reconciledUpcoming } from '../lib/reconcile';
import {
  analyzePrints,
  fmtPeriod,
  fmtPrint,
  indicatorInsight,
  INDICATORS_BY_EVENT,
  loadIndicator,
  NO_HISTORY_NOTE,
  PLAYBOOK_INSTRUMENTS,
  PRINT_PLAYBOOK,
  type IndicatorSeries,
  type IndicatorSpec,
  type PrintStats,
} from '../lib/econData';
import { staleGapMonths } from '../lib/econLive';
import { loadReleaseDetail, RELEASE_DETAILS, type ReleaseDetailLoad } from '../lib/releaseDetail';
import { eventDaySplit, perEventStats, proximitySplit, type PerEventStat } from '../lib/eventStats';
import { fetchUSCalendarRange, getMarketApiKey, liveReadingsFor, parseReading, type LiveEventRow } from '../lib/market';
import { addDays, fmtMoney, todayISO, weekdayName } from '../lib/format';

/** Monday of the week containing `iso`. */
function weekStart(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(iso, -back);
}

function impactDot(impact: string) {
  return <span className="grade-dot" style={{ background: impact === 'high' ? 'var(--loss)' : 'var(--dom-news)' }} />;
}

/** Re-render every `ms` — for the release countdown. */
function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

function countdown(instant: string, now: number): string | null {
  const diff = new Date(instant).getTime() - now;
  if (diff <= 0 || diff > 48 * 3600000) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `in ${h}h ${String(m).padStart(2, '0')}m` : `in ${m}m`;
}

/** Live consensus → actual chips for one event row. */
function LiveChips({ readings }: { readings: LiveEventRow[] }) {
  if (!readings.length) return null;
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {readings.map((r) => {
        const a = parseReading(r.actual);
        const c = parseReading(r.consensus);
        const dev = a != null && c != null ? a - c : null;
        return (
          <span
            key={r.name}
            className="chip mono"
            title={`${r.name} — consensus ${r.consensus ?? '—'} · previous ${r.previous ?? '—'} · actual ${r.actual ?? 'pending'}`}
            style={{ fontSize: 11, padding: '1px 7px', borderColor: r.actual ? 'var(--gold)' : undefined }}
          >
            {r.consensus ?? '—'}
            {' → '}
            {r.actual ? (
              <b style={{ color: dev != null && dev !== 0 ? 'var(--gold)' : undefined }}>
                {r.actual}
                {dev != null && dev !== 0 ? (dev > 0 ? ' ▲' : ' ▼') : ''}
              </b>
            ) : (
              <span className="muted">…</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function EventRow({ e, isNext, now, live }: { e: CalendarEvent; isNext: boolean; now: number; live: LiveEventRow[] }) {
  const [open, setOpen] = useState(false);
  const dom = domainOf(e.domain);
  const cd = isNext ? countdown(e.instant, now) : null;
  return (
    <div
      className="card"
      style={{
        padding: '10px 12px',
        cursor: 'pointer',
        borderLeft: `3px solid ${dom?.color ?? 'var(--muted)'}`,
        background: isNext ? 'var(--gold-dim)' : undefined,
      }}
      onClick={() => setOpen((o) => !o)}
    >
      <div className="spread" style={{ gap: 10, alignItems: 'center' }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', minWidth: 0 }}>
          <span className="mono" style={{ fontWeight: 700, width: 46 }} title={e.approx ? 'Estimated date — the agency shifts this release month to month. Connect the free FMP key and dates auto-confirm.' : undefined}>
            {e.approx ? '~' : ''}{localTime(e.instant)}
          </span>
          <span className="muted small" style={{ width: 58 }}>{e.timeET} ET</span>
          {impactDot(e.impact)}
          <span style={{ fontWeight: 600 }}>{e.short}</span>
          {e.approx && <span className="chip" style={{ fontSize: 10, padding: '0 5px', color: 'var(--muted)' }} title="Estimated date — confirm before trading it">est.</span>}
          <span className="muted small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
          {isNext && <span className="chip" style={{ background: 'var(--gold)', color: '#141210' }}>{cd ?? 'next'}</span>}
        </div>
        <div className="row" style={{ gap: 4, flexShrink: 0 }}>
          <LiveChips readings={live} />
          {live.length === 0 &&
            e.affects.slice(0, 6).map((a) => (
              <span key={a} className="chip mono" style={{ fontSize: 11, padding: '1px 6px' }}>{a}</span>
            ))}
        </div>
      </div>
      {open && (
        <div className="small" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--hairline)', display: 'grid', gap: 6 }}>
          <div><b style={{ color: dom?.color }}>{dom?.short ?? e.domain}</b> · {e.cadence} · moves {e.affects.join(', ')}</div>
          {e.approx && <div style={{ color: 'var(--gold)' }}>Date is estimated from this release's typical slot — the agency's exact date varies. With the free market-data key connected, the calendar confirms or moves it automatically.</div>}
          <div><b>Why it matters:</b> <span className="muted">{e.why}</span></div>
          <div><b>How to play it:</b> <span className="muted">{e.playbook}</span></div>
        </div>
      )}
    </div>
  );
}

/** A horizontal timeline of one day's cash-session window with events plotted. */
function SessionRadar({ events }: { events: CalendarEvent[] }) {
  const startMin = 7 * 60;
  const endMin = 17 * 60;
  const span = endMin - startMin;
  const pos = (instant: string) => {
    const d = new Date(instant);
    const min = d.getHours() * 60 + d.getMinutes();
    return Math.max(0, Math.min(100, ((min - startMin) / span) * 100));
  };
  const inWindow = events.filter((e) => {
    const d = new Date(e.instant);
    const min = d.getHours() * 60 + d.getMinutes();
    return min >= startMin && min <= endMin;
  });
  const hours = [7, 9, 11, 13, 15, 17];
  return (
    <div className="card">
      <div className="card-title">
        Session radar <span className="hint">where the scheduled volatility sits today (Lisbon time)</span>
      </div>
      {inWindow.length === 0 ? (
        <div className="muted small">No tier-1 releases inside the 07:00–17:00 window {events.length ? '(some fall outside it)' : 'today'}.</div>
      ) : (
        <div style={{ position: 'relative', height: 88, marginTop: 20 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 40, height: 3, background: 'var(--surface-2, #2a2622)', borderRadius: 2 }} />
          {hours.map((h) => {
            const left = ((h * 60 - startMin) / span) * 100;
            return (
              <div key={h} style={{ position: 'absolute', left: `${left}%`, top: 30, bottom: 0 }}>
                <div style={{ width: 1, height: 12, background: 'var(--axis)', margin: '0 auto' }} />
                <div className="mono" style={{ fontSize: 10, opacity: 0.6, transform: 'translateX(-50%)', marginTop: 2 }}>{String(h).padStart(2, '0')}:00</div>
              </div>
            );
          })}
          {inWindow.map((e, i) => {
            const left = pos(e.instant);
            const dom = domainOf(e.domain);
            const up = i % 2 === 0;
            return (
              <div key={e.id} style={{ position: 'absolute', left: `${left}%`, top: up ? 0 : 44, transform: 'translateX(-50%)' }}>
                {!up && <div style={{ width: 2, height: 8, background: dom?.color, margin: '0 auto' }} />}
                <div
                  title={`${localTime(e.instant)} — ${e.name}`}
                  style={{
                    background: e.impact === 'high' ? dom?.color : 'transparent',
                    border: `1.5px solid ${dom?.color}`,
                    color: e.impact === 'high' ? '#fff' : dom?.color,
                    borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                  }}
                >
                  {e.short}
                </div>
                {up && <div style={{ width: 2, height: 8, background: dom?.color, margin: '0 auto' }} />}
              </div>
            );
          })}
          <div style={{ position: 'absolute', left: 0, top: 40, width: 8, height: 8, borderRadius: 8, background: 'var(--profit)', transform: 'translate(-50%,-30%)' }} />
        </div>
      )}
    </div>
  );
}

/* ------------------------- release intelligence ------------------------- */

/** Print-history bar chart: latest highlighted, mean ±1σ band of the prior 2y. */
function PrintChart({ series, stats }: { series: IndicatorSeries; stats: PrintStats | null }) {
  const spec = series.spec;
  const data = series.points.slice(-48).map((p) => ({ ...p }));
  const signColored = spec.transform !== 'level';
  const latestPeriod = data[data.length - 1]?.period;
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }} barCategoryGap={1}>
        <CartesianGrid stroke="#262320" vertical={false} />
        <XAxis dataKey="period" stroke="transparent" tick={{ fill: '#8a857a', fontSize: 11 }} tickLine={false} minTickGap={46} tickFormatter={fmtPeriod} />
        <YAxis stroke="transparent" tick={{ fill: '#8a857a', fontSize: 11 }} tickLine={false} width={54} tickFormatter={(v: number) => v.toFixed(spec.decimals)} />
        {stats?.mean24 != null && stats.sd24 != null && (
          <ReferenceArea y1={stats.mean24 - stats.sd24} y2={stats.mean24 + stats.sd24} fill="rgba(255,255,255,0.05)" stroke="none" />
        )}
        {stats?.mean24 != null && <ReferenceLine y={stats.mean24} stroke="#8a857a" strokeDasharray="4 4" />}
        <ReferenceLine y={0} stroke="#3a362f" />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { period: string; value: number };
            const z = stats?.mean24 != null && stats.sd24 ? (p.value - stats.mean24) / stats.sd24 : null;
            return (
              <div className="viz-tooltip">
                <div className="tt-title">{fmtPeriod(p.period)}</div>
                <div className="tt-row"><span>{spec.label}</span><b>{fmtPrint(p.value, spec, true)}</b></div>
                {z != null && <div className="tt-row"><span>vs 2y trend</span><b>{z >= 0 ? '+' : ''}{z.toFixed(1)}σ</b></div>}
              </div>
            );
          }}
        />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false}>
          {data.map((p) => (
            <Cell
              key={p.period}
              fill={
                p.period === latestPeriod
                  ? '#d3a94f'
                  : signColored
                    ? p.value >= 0
                      ? 'rgba(12,163,12,0.75)'
                      : 'rgba(230,103,103,0.8)'
                    : 'rgba(57,135,229,0.65)'
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Events offered in the intelligence panel: everything with history or a note. */
const INTEL_EVENTS = ['NFP', 'CPI', 'PPI', 'JOLTS', 'ISM Mfg', 'ISM Svcs', 'Jobless Claims', 'Retail Sales', 'PCE', 'FOMC'];

/** Data provenance under the chart: where official history ends, what the live layer added. */
function ProvenanceLine({ series }: { series: IndicatorSeries }) {
  const last = series.points[series.points.length - 1]?.period ?? null;
  const gap = staleGapMonths(last);
  const officialThrough = series.officialThrough ?? null;
  const liveCount = series.liveCount ?? 0;
  return (
    <div className="small" style={{ marginTop: 4 }}>
      {officialThrough == null ? (
        <span className="muted">History reconstructed from your market-data key's release calendar (as-released prints, not revised).</span>
      ) : liveCount > 0 ? (
        <span className="muted">
          Official history to <b>{fmtPeriod(officialThrough)}</b> · extended with <b>{liveCount}</b> as-released prints from your
          market-data key to <b>{last ? fmtPeriod(last) : '—'}</b>.
        </span>
      ) : gap >= 2 ? (
        <span style={{ color: 'var(--loss)' }}>
          ⚠ History ends {last ? fmtPeriod(last) : '—'} — the official sources are lagging or unreachable. On the live site the app
          auto-fetches current prints straight from the BLS API; if you still see this, connect the free FMP key (Trading Day → Preparation)
          as a backup.
        </span>
      ) : (
        <span className="muted">Official source (BLS), current to {last ? fmtPeriod(last) : '—'}.</span>
      )}
    </div>
  );
}

/** The last handful of prints as a table — the raw record behind the chart. */
function RecentPrints({ series }: { series: IndicatorSeries }) {
  const spec = series.spec;
  const pts = series.points.slice(-7);
  if (pts.length < 2) return null;
  const rows = pts
    .map((p, i) => ({ p, d: i > 0 ? p.value - pts[i - 1].value : null }))
    .slice(1)
    .reverse();
  const liveFrom = series.officialThrough;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>Recent prints — {spec.label} ({spec.unit})</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data" style={{ minWidth: 380 }}>
          <thead>
            <tr><th>Period</th><th style={{ textAlign: 'right' }}>Print</th><th style={{ textAlign: 'right' }}>Δ vs prior</th><th>Source</th></tr>
          </thead>
          <tbody>
            {rows.map(({ p, d }) => (
              <tr key={p.period}>
                <td className="mono">{fmtPeriod(p.period)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtPrint(p.value, spec, true)}</td>
                <td className={`mono ${d != null && d > 0 ? 'pos' : d != null && d < 0 ? 'neg' : ''}`} style={{ textAlign: 'right' }}>
                  {d != null ? fmtPrint(d, spec, true) : '—'}
                </td>
                <td className="muted small">{liveFrom != null && p.period > liveFrom ? 'live calendar' : liveFrom == null ? 'live calendar' : 'official'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The subprint breakdown: real levels + MoM + YoY per component, cross-read. */
function ReleaseDetail({ short }: { short: string }) {
  const spec = RELEASE_DETAILS[short];
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReleaseDetailLoad | null>(null);
  const [loading, setLoading] = useState(false);

  const load = (force: boolean) => {
    setLoading(true);
    void loadReleaseDetail(short, force).then((d) => {
      setData(d);
      setLoading(false);
    });
  };
  useEffect(() => {
    if (open && !data && !loading) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pct = (v: number | null) =>
    v == null ? <span className="muted">—</span> : (
      <span className="mono" style={{ color: v > 0 ? 'var(--profit)' : v < 0 ? 'var(--loss)' : undefined }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>
    );

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
      <div className="spread" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <b className="small" style={{ color: 'var(--gold)' }}>{open ? '▾' : '▸'} {spec.title} — real levels &amp; every subcomponent (MoM · YoY)</b>
        {open && (
          <button className="btn sm" disabled={loading} onClick={(e) => { e.stopPropagation(); load(true); }}>{loading ? 'Loading…' : 'Refresh'}</button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {!data ? (
            <div className="muted small">Loading the full BLS breakdown…</div>
          ) : data.error ? (
            <div className="muted small">{data.error}</div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="data" style={{ minWidth: 620 }}>
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th style={{ textAlign: 'right' }}>Weight</th>
                      <th style={{ textAlign: 'right' }}>Index</th>
                      <th style={{ textAlign: 'right' }}>MoM</th>
                      <th style={{ textAlign: 'right' }}>YoY</th>
                      <th style={{ textAlign: 'right' }}>3m ann.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reads.map((r) => (
                      <tr key={r.comp.series} style={{ fontWeight: r.comp.role === 'headline' ? 700 : r.comp.role === 'core' ? 600 : 400 }}>
                        <td title={r.comp.note}>
                          {r.comp.label}
                          {r.comp.note && <span className="muted" style={{ marginLeft: 4 }}>ⓘ</span>}
                        </td>
                        <td className="muted mono small" style={{ textAlign: 'right' }}>{r.comp.weight != null ? `${r.comp.weight}%` : '—'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{r.level != null ? r.level.toFixed(1) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{pct(r.momPct)}</td>
                        <td style={{ textAlign: 'right' }}>{pct(r.yoyPct)}</td>
                        <td style={{ textAlign: 'right' }}>{pct(r.annualized3m)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>
                {spec.unitNote} · latest period {data.reads.find((r) => r.period)?.period ?? '—'} · hover a component for what it means.
              </div>
              {data.cross && <p className="small" style={{ margin: '10px 0 0', color: 'var(--gold)' }}>{data.cross}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The market-implications study: how this print maps onto each instrument. */
function ImplicationsStudy({ short }: { short: string }) {
  const pb = PRINT_PLAYBOOK[short];
  const [open, setOpen] = useState(false);
  if (!pb) return null;
  const arrowColor = (a: string) => (a.includes('↑') ? 'var(--profit)' : a.includes('↓') ? 'var(--loss)' : 'var(--muted)');
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
      <div className="spread" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <b className="small" style={{ color: 'var(--gold)' }}>{open ? '▾' : '▸'} Market implications — what a {short} surprise does to each instrument</b>
      </div>
      {open && (
        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          <div className="small"><b>What actually moves the market:</b> <span className="muted">{pb.driver}</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th>Print</th>
                  {PLAYBOOK_INSTRUMENTS.map((s) => <th key={s} style={{ textAlign: 'center' }}>{s}</th>)}
                  <th>Read</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ whiteSpace: 'nowrap' }}><b>Hot</b> <span className="muted small">(above cons.)</span></td>
                  {PLAYBOOK_INSTRUMENTS.map((s) => (
                    <td key={s} className="mono" style={{ textAlign: 'center', color: arrowColor(pb.hot[s] ?? '≈'), fontWeight: 700 }}>{pb.hot[s] ?? '≈'}</td>
                  ))}
                  <td className="muted small">{pb.hotNote}</td>
                </tr>
                <tr>
                  <td style={{ whiteSpace: 'nowrap' }}><b>Cold</b> <span className="muted small">(below cons.)</span></td>
                  {PLAYBOOK_INSTRUMENTS.map((s) => (
                    <td key={s} className="mono" style={{ textAlign: 'center', color: arrowColor(pb.cold[s] ?? '≈'), fontWeight: 700 }}>{pb.cold[s] ?? '≈'}</td>
                  ))}
                  <td className="muted small">{pb.coldNote}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {pb.regimeFlip && (
            <div className="small"><b style={{ color: 'var(--loss)' }}>When the mapping flips:</b> <span className="muted">{pb.regimeFlip}</span></div>
          )}
          <div className="small"><b style={{ color: 'var(--gold)' }}>Principle:</b> <span className="muted">{pb.principle}</span></div>
          <div className="muted small" style={{ opacity: 0.7 }}>
            Arrows are the typical FIRST move — mechanics, not a promise. Positioning (Market Intel), the vol regime (Options &amp; Vol) and the
            active narrative (Macro Map) decide whether it extends or fades.
          </div>
        </div>
      )}
    </div>
  );
}

function ReleaseIntel({ record, now }: { record: PerEventStat[]; now: number }) {
  const today = todayISO();
  const defaultShort = useMemo(() => {
    const up = reconciledUpcoming(today, 14).filter((e) => e.impact === 'high' && INDICATORS_BY_EVENT.has(e.short));
    return up[0]?.short ?? 'NFP';
  }, [today]);

  const [short, setShort] = useState(defaultShort);
  const [indicatorId, setIndicatorId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, { series: IndicatorSeries | null; error: string | null }>>({});
  const loading = useRef(new Set<string>());

  const specs = INDICATORS_BY_EVENT.get(short) ?? [];
  const activeSpec: IndicatorSpec | null = specs.find((s) => s.id === indicatorId) ?? specs[0] ?? null;

  useEffect(() => {
    setIndicatorId(null);
    for (const spec of INDICATORS_BY_EVENT.get(short) ?? []) {
      if (loaded[spec.id] || loading.current.has(spec.id)) continue;
      loading.current.add(spec.id);
      void loadIndicator(spec).then((res) => {
        loading.current.delete(spec.id);
        setLoaded((m) => ({ ...m, [spec.id]: res }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [short]);

  const active = activeSpec ? loaded[activeSpec.id] : undefined;
  const stats = useMemo(
    () => (active?.series ? analyzePrints(active.series.points) : null),
    [active],
  );

  const nextOccurrence = useMemo(() => {
    return reconciledUpcoming(today, 45).find((e) => e.short === short && new Date(e.instant).getTime() > now) ?? null;
  }, [short, today, now]);

  const myRecord = record.find((r) => r.short === short) ?? null;
  const note = NO_HISTORY_NOTE[short];

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Release intelligence <span className="hint">what the data itself has been printing — official history + as-released live prints</span>
        </div>
        {nextOccurrence && (
          <span className="muted small">
            next {short}: <b style={{ color: 'var(--text)' }}>{nextOccurrence.approx ? '~' : ''}{weekdayName(nextOccurrence.date)} {nextOccurrence.date.slice(5)}</b> at {localTime(nextOccurrence.instant)}{nextOccurrence.approx ? ' (est.)' : ''}
            {countdown(nextOccurrence.instant, now) ? <span style={{ color: 'var(--gold)' }}> · {countdown(nextOccurrence.instant, now)}</span> : ''}
          </span>
        )}
      </div>

      <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        {INTEL_EVENTS.map((s) => (
          <span key={s} className={`chip clickable ${short === s ? 'selected' : ''}`} onClick={() => setShort(s)}>
            {s}
          </span>
        ))}
      </div>

      {specs.length === 0 ? (
        <div className="muted small">{note ?? 'No data series is attached to this event yet.'}</div>
      ) : (
        <>
          {specs.length > 1 && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
              {specs.map((s) => (
                <span
                  key={s.id}
                  className={`chip clickable ${activeSpec?.id === s.id ? 'selected' : ''}`}
                  style={{ fontSize: 11 }}
                  onClick={() => setIndicatorId(s.id)}
                >
                  {s.label}
                </span>
              ))}
            </div>
          )}

          {!active ? (
            <div className="muted small">Loading print history…</div>
          ) : active.series == null ? (
            <div className="muted small">
              <b>History unavailable:</b> {active.error} The rest of the page still works — history fills in when the data service is reachable.
            </div>
          ) : (
            <>
              {active.series.stale && (
                <div className="muted small" style={{ marginBottom: 8 }}>Showing cached history — the latest refresh failed ({active.error}).</div>
              )}
              {stats && activeSpec && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
                  <StatTile
                    small
                    label={`Last print (${fmtPeriod(stats.latest.period)})`}
                    value={fmtPrint(stats.latest.value, activeSpec, true)}
                    delta={stats.delta != null ? `${fmtPrint(stats.delta, activeSpec, true)} vs prior` : undefined}
                  />
                  <StatTile
                    small
                    label="vs 2y trend"
                    value={stats.z != null ? `${stats.z >= 0 ? '+' : ''}${stats.z.toFixed(1)}σ` : '—'}
                    valueClass={stats.z != null && Math.abs(stats.z) >= 2 ? 'neg' : undefined}
                    delta={stats.mean24 != null ? `avg ${fmtPrint(stats.mean24, activeSpec, true)}` : undefined}
                  />
                  <StatTile
                    small
                    label="3m vs 12m pace"
                    value={stats.avg12 != null ? `${fmtPrint(stats.avg3, activeSpec, true)} / ${fmtPrint(stats.avg12, activeSpec, true)}` : '—'}
                    delta={stats.avg12 != null ? (stats.avg3 > stats.avg12 ? 'momentum building' : stats.avg3 < stats.avg12 ? 'momentum fading' : 'flat') : undefined}
                  />
                  <StatTile
                    small
                    label="5y percentile"
                    value={stats.pctile5y != null ? `${stats.pctile5y}` : '—'}
                    delta={Math.abs(stats.streak) >= 3 ? `${Math.abs(stats.streak)} prints ${stats.streak > 0 ? 'higher' : 'lower'} in a row` : undefined}
                  />
                </div>
              )}
              <PrintChart series={active.series} stats={stats} />
              <div className="row" style={{ gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
                <span className="small"><span className="grade-dot" style={{ background: '#d3a94f' }} /> Latest print</span>
                <span className="small muted">band = ±1σ of the prior 2 years · dashed = 2y average</span>
              </div>
              <ProvenanceLine series={active.series} />
              {stats && activeSpec && (
                <p className="small" style={{ margin: '12px 0 0', color: 'var(--gold)' }}>{indicatorInsight(activeSpec, stats)}</p>
              )}
              <RecentPrints series={active.series} />
            </>
          )}
        </>
      )}

      {RELEASE_DETAILS[short] && <ReleaseDetail short={short} />}

      <ImplicationsStudy short={short} />

      <div className="small" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
        <b>Your record on {short} days:</b>{' '}
        {myRecord ? (
          <span>
            {myRecord.count} trades over {myRecord.days} days · net <PnL value={myRecord.netPnl} /> · win {(myRecord.winRate * 100).toFixed(0)}% ·
            expectancy {fmtMoney(myRecord.expectancy, { sign: true })}/trade
          </span>
        ) : (
          <span className="muted">no trades on {short} days yet — your stats appear here once you've traded one.</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- the page ------------------------------- */

function CompareBar({ label, value, max, money }: { label: string; value: number; max: number; money?: boolean }) {
  const w = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  const pos = value >= 0;
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <span className="small" style={{ width: 96, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 16, position: 'relative', background: 'var(--surface)', borderRadius: 4 }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--axis)' }} />
        <div style={{ position: 'absolute', left: pos ? '50%' : `${50 - w / 2}%`, width: `${w / 2}%`, top: 2, bottom: 2, borderRadius: 3, background: pos ? 'var(--profit)' : 'var(--loss)' }} />
      </div>
      <span className={`small mono ${pos ? 'pos' : 'neg'}`} style={{ width: 78, textAlign: 'right' }}>
        {money ? fmtMoney(value, { sign: true }) : value.toFixed(0)}
      </span>
    </div>
  );
}

type EventFilter = 'all' | 'econ' | 'flow' | 'cb' | 'high';
const EVENT_FILTERS: { id: EventFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'econ', label: 'Economic' },
  { id: 'flow', label: 'Flow' },
  { id: 'cb', label: 'Central banks' },
  { id: 'high', label: 'High impact' },
];
function passesFilter(e: CalendarEvent, f: EventFilter): boolean {
  if (f === 'all') return true;
  if (f === 'high') return e.impact === 'high';
  if (f === 'econ') return e.domain === 'economic-data';
  if (f === 'flow') return e.domain === 'flow';
  return e.domain === 'central-banks';
}

export default function Catalysts() {
  const [anchor, setAnchor] = useState(todayISO());
  const [filter, setFilter] = useState<EventFilter>('all');
  const nav = useNavigate();
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];
  const now = useNow(30000);

  const ws = weekStart(anchor);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(ws, i)), [ws]);
  const today = todayISO();

  // live consensus/actual layer — polls while the viewed week contains today
  const [liveRows, setLiveRows] = useState<LiveEventRow[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const hasKey = !!getMarketApiKey();
  const weekHasToday = today >= ws && today <= addDays(ws, 6);
  useEffect(() => {
    // live layer now works keyless (server key or the free weekly feed) — always poll
    let alive = true;
    const pull = async () => {
      const res = await fetchUSCalendarRange(ws, addDays(ws, 6));
      if (!alive) return;
      if (res.rows.length) setLiveRows(res.rows);
      setLiveError(res.error);
    };
    void pull();
    const id = weekHasToday ? window.setInterval(pull, 60000) : undefined;
    return () => {
      alive = false;
      if (id) window.clearInterval(id);
    };
  }, [ws, hasKey, weekHasToday]);

  // day views reconcile estimated dates against the live rows (or their cache)
  const dayEvents = useMemo(() => {
    return (d: string): CalendarEvent[] =>
      liveRows.length >= 8 && d >= ws && d <= addDays(ws, 6)
        ? reconcileDay(d, eventsForDate(d), liveRows, ws, addDays(ws, 6))
        : reconciledEventsForDate(d).events;
  }, [liveRows, ws]);

  const nextEventId = useMemo(() => {
    return reconciledUpcoming(today, 10).find((e) => new Date(e.instant).getTime() >= now)?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, now, liveRows]);

  const split = useMemo(() => eventDaySplit(trades, 'high'), [trades]);
  const perEvent = useMemo(() => perEventStats(trades), [trades]);
  const prox = useMemo(() => proximitySplit(trades, 30), [trades]);
  const hasTrades = trades.length > 0;
  const maxEventNet = Math.max(1, ...perEvent.map((e) => Math.abs(e.netPnl)));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Catalysts</h1>
          <p className="page-sub">
            The scheduled volatility that moves your markets — with the printed history behind every release,
            live consensus &amp; actuals, and how you actually trade around it. All times in Lisbon (WET/WEST).
          </p>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setAnchor(addDays(ws, -7))}>← Prev</button>
          <button className="btn sm" onClick={() => setAnchor(today)}>This week</button>
          <button className="btn sm" onClick={() => setAnchor(addDays(ws, 7))}>Next →</button>
        </div>
      </div>

      <div className="stack">
        <SessionRadar events={dayEvents(today)} />

        <ReleaseIntel record={perEvent} now={now} />

        <div className="card">
          <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              Week ahead <span className="hint">click an event for why it matters &amp; how to play it</span>
            </div>
            <div className="row" style={{ gap: 4 }}>
              {EVENT_FILTERS.map((f) => (
                <span key={f.id} className={`chip clickable ${filter === f.id ? 'selected' : ''}`} onClick={() => setFilter(f.id)}>
                  {f.label}
                </span>
              ))}
            </div>
            {liveRows.length ? (
              <span className="muted small">
                <span className="grade-dot" style={{ background: 'var(--profit)' }} /> live consensus → actual{weekHasToday ? ', refreshing every minute' : ''}{!hasKey ? ' (keyless feed)' : ''}
              </span>
            ) : liveError ? (
              <span className="muted small">live layer: {liveError}</span>
            ) : (
              <span className="muted small">connecting the live layer…</span>
            )}
          </div>
          <div className="stack" style={{ gap: 14 }}>
            {weekDays.map((d) => {
              const evs = dayEvents(d).filter((e) => passesFilter(e, filter));
              const isToday = d === today;
              return (
                <div key={d}>
                  <div className="spread" style={{ marginBottom: 6 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                      <b style={{ color: isToday ? 'var(--gold)' : undefined }}>{weekdayName(d)}</b>
                      <span className="muted small">{d.slice(5)}</span>
                      {isToday && <span className="chip" style={{ background: 'var(--gold)', color: '#141210' }}>today</span>}
                    </div>
                    <span className="muted small">{evs.length ? `${evs.length} event${evs.length > 1 ? 's' : ''}` : 'quiet'}</span>
                  </div>
                  {evs.length === 0 ? (
                    <div className="muted small" style={{ paddingLeft: 4, opacity: 0.6 }}>No tier-1 catalysts — a technicals / flow day.</div>
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      {evs.map((e) => (
                        <EventRow key={e.id} e={e} isNext={e.id === nextEventId} now={now} live={liveReadingsFor(e.short, d, liveRows)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            Your edge around catalysts <span className="hint">from your own trade history</span>
          </div>
          {!hasTrades ? (
            <div className="muted small">Import or record trades and this fills in — you'll see whether event days are your edge or your leak.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
                <StatTile label="Event-day net" value={<PnL value={split.eventDays.netPnl} />} delta={`${split.eventDays.count} trades`} />
                <StatTile label="Event-day win rate" value={`${(split.eventDays.winRate * 100).toFixed(0)}%`} delta={`exp ${fmtMoney(split.eventDays.expectancy, { sign: true })}/tr`} />
                <StatTile label="Quiet-day net" value={<PnL value={split.quietDays.netPnl} />} delta={`${split.quietDays.count} trades`} />
                <StatTile label="Quiet-day win rate" value={`${(split.quietDays.winRate * 100).toFixed(0)}%`} delta={`exp ${fmtMoney(split.quietDays.expectancy, { sign: true })}/tr`} />
              </div>

              <div className="grid grid-2" style={{ gap: 20 }}>
                <div>
                  <div className="small muted" style={{ marginBottom: 8 }}>Net P&amp;L: into the print (±30m) vs the aftermath</div>
                  <div className="stack" style={{ gap: 8 }}>
                    <CompareBar label={`Into print (${prox.nearCount})`} value={prox.near.netPnl} max={Math.max(1, Math.abs(prox.near.netPnl), Math.abs(prox.clear.netPnl))} money />
                    <CompareBar label={`Aftermath (${prox.clearCount})`} value={prox.clear.netPnl} max={Math.max(1, Math.abs(prox.near.netPnl), Math.abs(prox.clear.netPnl))} money />
                  </div>
                  <div className="muted small" style={{ marginTop: 8, opacity: 0.75 }}>
                    {prox.near.expectancy < prox.clear.expectancy && prox.nearCount >= 3
                      ? 'You do better waiting for the dust to settle than trading into the release.'
                      : prox.nearCount >= 3
                        ? 'Trading into the release is working for you — keep sizing it deliberately.'
                        : 'Not enough into-the-print trades yet to read a pattern.'}
                  </div>
                </div>
                <div>
                  <div className="small muted" style={{ marginBottom: 8 }}>Net P&amp;L by catalyst you traded</div>
                  {perEvent.length === 0 ? (
                    <div className="muted small">No trades on tier-1 event days yet.</div>
                  ) : (
                    <div className="stack" style={{ gap: 8 }}>
                      {perEvent.slice(0, 7).map((e) => (
                        <CompareBar key={e.short} label={`${e.short} (${e.count})`} value={e.netPnl} max={maxEventNet} money />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          <div className="muted small" style={{ marginTop: 12 }}>
            Prepare a specific day in <span style={{ cursor: 'pointer', color: 'var(--gold)', textDecoration: 'underline' }} onClick={() => nav('/day')}>Trading Day → Preparation</span>, where these catalysts appear inline.
          </div>
        </div>
      </div>
    </>
  );
}
