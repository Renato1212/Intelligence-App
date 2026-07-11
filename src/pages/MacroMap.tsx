import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Principle, StatTile } from '../components/ui';
import { upcomingEvents } from '../lib/calendar';
import { loadBreadth, loadCrossAsset, type BreadthRead, type CrossAssetRead, type PairCorr } from '../lib/crossAsset';
import { analyzeRates, loadRates, ratesInsight, type RatesRead } from '../lib/rates';
import { loadHeadlines, loadNarrative, THEMES, type Headline, type NarrativeLoad, type ThemeSeries } from '../lib/narrative';
import { cellFor, loadCommodities, loadWeoBoard, weoRead, type CommodityRow, type WeoBoard } from '../lib/imf';
import { fmtDateShort, todayISO, weekdayName } from '../lib/format';

const AXIS = { stroke: 'transparent', tick: { fill: '#8a857a', fontSize: 11 }, tickLine: false } as const;

/* ------------------------------ rates panel ------------------------------ */

function SpreadChart({ r }: { r: RatesRead }) {
  const data = r.spread.slice(-500).map((p) => ({ date: p.period, bp: p.value }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="spreadFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ca30c" stopOpacity={0.25} />
            <stop offset="50%" stopColor="#0ca30c" stopOpacity={0.02} />
            <stop offset="50%" stopColor="#e66767" stopOpacity={0.02} />
            <stop offset="100%" stopColor="#e66767" stopOpacity={0.25} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#262320" vertical={false} />
        <XAxis dataKey="date" {...AXIS} minTickGap={70} tickFormatter={fmtDateShort} />
        <YAxis {...AXIS} width={44} tickFormatter={(v: number) => `${v}`} />
        <ReferenceLine y={0} stroke="#8a857a" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ stroke: '#3a362f' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { date: string; bp: number };
            return (
              <div className="viz-tooltip">
                <div className="tt-title">{fmtDateShort(p.date)}</div>
                <div className="tt-row"><span>2s10s</span><b>{p.bp >= 0 ? '+' : ''}{p.bp}bp</b></div>
                <div className="tt-row"><span>State</span><b>{p.bp < 0 ? 'inverted' : 'normal'}</b></div>
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="bp" stroke="#d3a94f" strokeWidth={1.8} fill="url(#spreadFill)" dot={false} isAnimationActive={false} baseValue={0} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function CurveChart({ r }: { r: RatesRead }) {
  const data = r.curve.map((c) => ({ label: c.label, now: c.now, m1: c.m1, y1: c.y1 }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="#262320" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} width={40} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(1)} />
        <Tooltip
          cursor={{ stroke: '#3a362f' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { now: number; m1: number | null; y1: number | null };
            return (
              <div className="viz-tooltip">
                <div className="tt-title">{String(label)} yield</div>
                <div className="tt-row"><span>Today</span><b>{p.now.toFixed(2)}%</b></div>
                {p.m1 != null && <div className="tt-row"><span>1m ago</span><b>{p.m1.toFixed(2)}%</b></div>}
                {p.y1 != null && <div className="tt-row"><span>1y ago</span><b>{p.y1.toFixed(2)}%</b></div>}
              </div>
            );
          }}
        />
        <Line type="monotone" dataKey="y1" stroke="#5c564c" strokeWidth={1.4} strokeDasharray="5 4" dot={false} isAnimationActive={false} name="1y ago" />
        <Line type="monotone" dataKey="m1" stroke="#3987e5" strokeWidth={1.6} dot={false} isAnimationActive={false} name="1m ago" />
        <Line type="monotone" dataKey="now" stroke="#d3a94f" strokeWidth={2.4} dot={{ r: 3, fill: '#d3a94f' }} isAnimationActive={false} name="Today" />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RatesPanel() {
  const [read, setRead] = useState<RatesRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadRates(false).then((res) => {
      if (!alive) return;
      if (res.snapshot) {
        setRead(analyzeRates(res.snapshot));
        setStale(!!res.snapshot.stale);
      }
      setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  const nextFomc = useMemo(() => upcomingEvents(todayISO(), 60).find((e) => e.short === 'FOMC') ?? null, []);

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Rates &amp; the policy cycle <span className="hint">daily Treasury yields from the Fed's H.15 — free, keyless</span>
        </div>
        {read && <span className="muted small">as of {fmtDateShort(read.asOf)}{stale ? ' (cached)' : ''}</span>}
      </div>

      {!read ? (
        <div className="muted small">{error ? <><b>Rates feed unreachable:</b> {error} History fills in when the app can reach the data service.</> : 'Loading the curve…'}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            <StatTile
              small
              label="2s10s spread"
              value={<span className={read.spreadNow < 0 ? 'neg' : 'pos'}>{read.spreadNow >= 0 ? '+' : ''}{read.spreadNow}bp</span>}
              delta={read.spreadM1 != null ? `${read.spreadNow - read.spreadM1 >= 0 ? '+' : ''}${read.spreadNow - read.spreadM1}bp vs 1m` : undefined}
            />
            <StatTile
              small
              label="Curve state"
              value={read.inverted ? 'Inverted' : 'Normal'}
              valueClass={read.inverted ? 'neg' : 'pos'}
              delta={read.inverted ? `${read.invertedDays} sessions` : undefined}
            />
            <StatTile
              small
              label="10-year yield"
              value={`${read.y10Now.toFixed(2)}%`}
              delta={read.y10M1 != null ? `${read.y10Now - read.y10M1 >= 0 ? '+' : ''}${((read.y10Now - read.y10M1) * 100).toFixed(0)}bp vs 1m` : undefined}
            />
            <StatTile
              small
              label="Next FOMC"
              value={nextFomc ? `${weekdayName(nextFomc.date).slice(0, 3)} ${nextFomc.date.slice(5)}` : '—'}
              delta={nextFomc ? '14:00 ET statement · 14:30 presser' : undefined}
            />
          </div>
          <div className="grid grid-2" style={{ gap: 16 }}>
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>2s10s spread — the cycle clock (2 years, daily)</div>
              <SpreadChart r={read} />
            </div>
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>The curve — today vs 1 month vs 1 year ago</div>
              <CurveChart r={read} />
              <div className="row" style={{ gap: 14, marginTop: 4 }}>
                <span className="small"><span className="grade-dot" style={{ background: '#d3a94f' }} /> today</span>
                <span className="small"><span className="grade-dot" style={{ background: '#3987e5' }} /> 1m ago</span>
                <span className="small"><span className="grade-dot" style={{ background: '#5c564c' }} /> 1y ago</span>
              </div>
            </div>
          </div>
          <p className="small" style={{ margin: '12px 0 0', color: 'var(--gold)' }}>{ratesInsight(read)}</p>
        </>
      )}

      <Principle domain="Central Banks">
        The curve is policy made visible. The FRONT end (3m–2y) is the market's Fed forecast — it moves on prints and
        speakers. The LONG end (10y–30y) is growth + inflation + supply. When they disagree, the curve inverts: policy
        is tighter than the cycle can bear. The tradeable moments are the TRANSITIONS — first cut priced in, re-steepening,
        a long-end supply shock — not the level itself. Before any CPI or FOMC, ask: which END of the curve does this hit,
        and what does that do to equities' discount rate?
      </Principle>
    </div>
  );
}

/* --------------------------- cross-asset panel --------------------------- */

function corrColor(c: number): string {
  const a = Math.min(1, Math.abs(c));
  return c >= 0 ? `rgba(12,163,12,${(0.08 + a * 0.72).toFixed(2)})` : `rgba(230,103,103,${(0.08 + a * 0.72).toFixed(2)})`;
}

function CorrHeatmap({ read }: { read: CrossAssetRead }) {
  const shorts = read.states.map((s) => s.short);
  const get = (a: string, b: string): PairCorr | null =>
    read.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)) ?? null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
        <thead>
          <tr>
            <th />
            {shorts.map((s) => (
              <th key={s} className="mono small muted" style={{ fontWeight: 600, padding: '2px 4px' }}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shorts.map((row) => (
            <tr key={row}>
              <td className="mono small muted" style={{ fontWeight: 600, paddingRight: 6, textAlign: 'right' }}>{row}</td>
              {shorts.map((col) => {
                if (row === col) return <td key={col} style={{ width: 44, height: 30, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }} />;
                const p = get(row, col);
                if (!p) return <td key={col} />;
                const broke = p.break_ >= 0.35;
                return (
                  <td
                    key={col}
                    title={`${row} × ${col} — 20d: ${p.c20.toFixed(2)} · 60d: ${p.c60.toFixed(2)}${broke ? ' · regime break' : ''}`}
                    className="mono"
                    style={{
                      width: 44, height: 30, textAlign: 'center', fontSize: 11, borderRadius: 4,
                      background: corrColor(p.c20),
                      color: Math.abs(p.c20) > 0.55 ? '#fff' : 'var(--muted)',
                      outline: broke ? '1.5px solid #d3a94f' : undefined,
                    }}
                  >
                    {p.c20.toFixed(1).replace('0.', '.')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CrossAssetPanel() {
  const [read, setRead] = useState<CrossAssetRead | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadCrossAsset(false).then((res) => {
      if (!alive) return;
      setRead(res.read);
      setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Cross-asset map <span className="hint">"same movement across markets, or one alone?" — computed</span>
        </div>
        {read && <span className="muted small">20-day correlations · as of {fmtDateShort(read.asOf)}</span>}
      </div>

      {!read ? (
        <div className="muted small">
          {error === 'no-key' ? (
            <>Connect the free FMP key in <b>Trading Day → Preparation</b> and this panel computes rolling cross-asset correlations, regime breaks and each market's trend/vol state from daily closes.</>
          ) : error ? (
            <><b>Market data unreachable:</b> {error}</>
          ) : (
            'Loading cross-asset data…'
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-2" style={{ gap: 18 }}>
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>Correlation heatmap — gold outline = pair broke from its 60d norm</div>
              <CorrHeatmap read={read} />
            </div>
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>Trend &amp; volatility state (20d)</div>
              <div className="stack" style={{ gap: 6 }}>
                {read.states.map((s) => (
                  <div key={s.symbol} className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="mono small" style={{ width: 44, fontWeight: 700 }}>{s.short}</span>
                    <span className={`mono small ${s.ret20 >= 0 ? 'pos' : 'neg'}`} style={{ width: 56, textAlign: 'right' }}>
                      {s.ret20 >= 0 ? '+' : ''}{s.ret20.toFixed(1)}%
                    </span>
                    <div style={{ flex: 1, height: 10, background: 'var(--surface)', borderRadius: 4, position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--axis)' }} />
                      <div
                        style={{
                          position: 'absolute',
                          left: s.ret20 >= 0 ? '50%' : `${50 - Math.min(48, Math.abs(s.ret20) * 5)}%`,
                          width: `${Math.min(48, Math.abs(s.ret20) * 5)}%`,
                          top: 1.5, bottom: 1.5, borderRadius: 3,
                          background: s.ret20 >= 0 ? 'var(--profit)' : 'var(--loss)',
                        }}
                      />
                    </div>
                    <span
                      className="mono small"
                      style={{ width: 88, textAlign: 'right', color: s.volPctile != null && s.volPctile >= 80 ? 'var(--gold)' : 'var(--muted)' }}
                      title="20d realized volatility (annualized) and its percentile vs the last ~2 quarters"
                    >
                      vol {s.vol20.toFixed(0)}%{s.volPctile != null ? ` ·${s.volPctile}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {read.breaks.length > 0 && (
            <div className="small" style={{ marginTop: 12 }}>
              <b>Correlation breaks</b> <span className="muted">— relationships that changed regime this month:</span>
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {read.breaks.map((p) => (
                  <span key={`${p.a}-${p.b}`} className="chip" style={{ borderColor: 'var(--gold)' }}>
                    {p.a} × {p.b}: {p.c60.toFixed(2)} → <b>{p.c20.toFixed(2)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Principle domain="Technicals & Correlation">
        One market moving alone is a LOCAL story (positioning, a single order, idiosyncratic news) — fade-able. All
        markets moving together is a GLOBAL story (policy, risk regime) — respect it. Correlation BREAKS are early
        information: when bonds stop hedging equities, or the dollar decouples from rates, the old playbook is expiring.
        Check this map before assuming yesterday's relationships still hold — it is the quantified version of the
        preparation question "same movement across markets, or one alone?"
      </Principle>
    </div>
  );
}

/* ---------------------------- narrative panel ---------------------------- */

function ThemeSpark({ s }: { s: ThemeSeries }) {
  const pts = s.points;
  if (pts.length < 3) return null;
  const w = 120;
  const h = 30;
  const max = Math.max(...pts.map((p) => p.value), 0.0001);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => h - (v / max) * (h - 2) - 1;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path d={path} fill="none" stroke={s.surging ? '#d3a94f' : '#8a857a'} strokeWidth={1.6} />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].value)} r={2.6} fill={s.surging ? '#d3a94f' : '#8a857a'} />
    </svg>
  );
}

function NarrativePanel() {
  const [load, setLoad] = useState<NarrativeLoad | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [hlError, setHlError] = useState<string | null>(null);

  const refresh = async (force: boolean) => {
    const res = await loadNarrative(force);
    setLoad(res);
  };

  useEffect(() => {
    void refresh(false);
    const id = window.setInterval(() => void refresh(false), 5 * 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const theme = THEMES.find((t) => t.id === selected);
    if (!theme) return;
    setHeadlines([]);
    setHlError(null);
    void loadHeadlines(theme).then((r) => {
      setHeadlines(r.headlines);
      setHlError(r.error);
    });
  }, [selected]);

  const series = load?.series ?? [];
  const surging = series.filter((s) => s.surging);
  const selectedTheme = THEMES.find((t) => t.id === selected) ?? null;

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Narrative monitor <span className="hint">global news attention per market theme — free, keyless, ~15-min updates</span>
        </div>
        {load?.fetchedAt && (
          <span className="muted small">
            {surging.length ? <b style={{ color: 'var(--gold)' }}>{surging.length} surging</b> : 'no surges'} · updated {new Date(load.fetchedAt).toLocaleTimeString().slice(0, 5)}
            {load.stale ? ' (cached)' : ''}
          </span>
        )}
      </div>

      {!load ? (
        <div className="muted small">Measuring the world's attention…</div>
      ) : series.length === 0 ? (
        <div className="muted small"><b>News service unreachable:</b> {load.error} The monitor fills in when the app can reach it.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
            {series.map((s) => (
              <div
                key={s.theme.id}
                className="card"
                style={{
                  padding: '10px 12px', cursor: 'pointer',
                  borderColor: selected === s.theme.id ? 'var(--gold)' : s.surging ? 'rgba(211,169,79,0.5)' : undefined,
                }}
                onClick={() => setSelected(selected === s.theme.id ? null : s.theme.id)}
              >
                <div className="spread" style={{ alignItems: 'baseline', marginBottom: 4 }}>
                  <b className="small">{s.theme.label}</b>
                  {s.surging && <span className="chip" style={{ background: 'var(--gold)', color: '#141210', fontSize: 10, padding: '1px 6px' }}>SURGE {s.z != null ? (s.z > 9 ? '>9σ' : `+${s.z.toFixed(1)}σ`) : ''}</span>}
                </div>
                <div className="spread" style={{ alignItems: 'flex-end' }}>
                  <ThemeSpark s={s} />
                  <span className="muted small mono" title="share of global news coverage vs the theme's own 2-week baseline">
                    {s.baseline > 0 ? `${(s.latest / s.baseline).toFixed(1)}×` : '—'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{s.theme.affects.join(' · ')}</div>
              </div>
            ))}
          </div>

          {selectedTheme && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
              <div className="small" style={{ marginBottom: 6 }}>
                <b>{selectedTheme.label}</b> <span className="muted">— {selectedTheme.why}</span>
              </div>
              {hlError ? (
                <div className="muted small">Headlines unavailable: {hlError}</div>
              ) : headlines.length === 0 ? (
                <div className="muted small">Pulling the latest headlines…</div>
              ) : (
                <div className="stack" style={{ gap: 5 }}>
                  {headlines.map((h) => (
                    <a key={h.url} href={h.url} target="_blank" rel="noreferrer" className="small" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                      <span className="muted mono" style={{ fontSize: 10, marginRight: 8 }}>{h.domain}</span>
                      {h.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Principle domain="Unscheduled News (Geo-Macro)">
        You cannot schedule a headline, but you can watch the market's ATTENTION. A narrative surging above its own
        baseline means the market is building a story — and stories create sustained, tradeable flows (tariffs 2018,
        banks 2023). The discipline: trade the REACTION, not the headline. Ask three questions — is this priced in
        (check the narrative curve: old surge = priced), which market carries it cleanest (the affects tags), and what
        would invalidate it? A fading narrative curve while price still trends = the move is running on fumes.
      </Principle>
    </div>
  );
}

/* ------------------------------ breadth panel ---------------------------- */

function BreadthPanel() {
  const [read, setRead] = useState<BreadthRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<'momentum' | 'trend'>('momentum');

  useEffect(() => {
    let alive = true;
    void loadBreadth(false).then((r) => {
      if (!alive) return;
      setRead(r.read);
      setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  const sectors = useMemo(() => {
    if (!read) return [];
    const xs = [...read.sectors];
    if (sort === 'trend') xs.sort((a, b) => b.dist50 - a.dist50);
    return xs;
  }, [read, sort]);

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Breadth &amp; sector rotation <span className="hint">is the average stock confirming the index?</span>
        </div>
        <div className="row" style={{ gap: 4, alignItems: 'center' }}>
          <span className={`chip clickable ${sort === 'momentum' ? 'selected' : ''}`} onClick={() => setSort('momentum')}>20d momentum</span>
          <span className={`chip clickable ${sort === 'trend' ? 'selected' : ''}`} onClick={() => setSort('trend')}>vs 50DMA</span>
          {read && <span className="muted small" style={{ marginLeft: 8 }}>as of {fmtDateShort(read.asOf)}</span>}
        </div>
      </div>

      {!read ? (
        <div className="muted small">
          {error === 'no-key' ? (
            <>Connect the free FMP key in <b>Trading Day → Preparation</b> and this panel computes sector rotation, % of sectors above their 50DMA, and the equal-weight vs cap-weight participation check.</>
          ) : error ? (
            <><b>Market data unreachable:</b> {error}</>
          ) : (
            'Computing breadth…'
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            <StatTile
              small
              label="Sectors above 50DMA"
              value={<span className={read.above50Count >= 8 ? 'pos' : read.above50Count <= 4 ? 'neg' : ''}>{read.above50Count}/{read.sectors.length}</span>}
            />
            <StatTile
              small
              label="Equal-weight vs SPY (20d)"
              value={read.rspSpy20 != null ? <span className={read.rspSpy20 >= 0 ? 'pos' : 'neg'}>{read.rspSpy20 >= 0 ? '+' : ''}{read.rspSpy20.toFixed(1)}%</span> : '—'}
              delta="RSP − SPY"
            />
            <StatTile small label="Leading" value={read.sectors[0]?.label ?? '—'} delta={read.sectors[0] ? `${read.sectors[0].ret20 >= 0 ? '+' : ''}${read.sectors[0].ret20.toFixed(1)}% 20d` : undefined} />
            <StatTile small label="Lagging" value={read.sectors[read.sectors.length - 1]?.label ?? '—'} delta={`${read.sectors[read.sectors.length - 1]?.ret20.toFixed(1)}% 20d`} />
          </div>

          <div className="stack" style={{ gap: 5 }}>
            {sectors.map((s) => {
              const v = sort === 'momentum' ? s.ret20 : s.dist50;
              const w = Math.min(48, Math.abs(v) * (sort === 'momentum' ? 4 : 6));
              return (
                <div key={s.symbol} className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="mono small" style={{ width: 40, fontWeight: 700 }}>{s.symbol}</span>
                  <span className="small muted" style={{ width: 88 }}>{s.label}</span>
                  <span className="grade-dot" title={s.above50 ? 'above 50DMA' : 'below 50DMA'} style={{ background: s.above50 ? 'var(--profit)' : 'var(--loss)', flexShrink: 0 }} />
                  <div style={{ flex: 1, height: 10, background: 'var(--surface)', borderRadius: 4, position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--axis)' }} />
                    <div
                      style={{
                        position: 'absolute',
                        left: v >= 0 ? '50%' : `${50 - w}%`,
                        width: `${w}%`,
                        top: 1.5,
                        bottom: 1.5,
                        borderRadius: 3,
                        background: v >= 0 ? 'var(--profit)' : 'var(--loss)',
                      }}
                    />
                  </div>
                  <span className={`mono small ${v >= 0 ? 'pos' : 'neg'}`} style={{ width: 62, textAlign: 'right' }}>
                    {v >= 0 ? '+' : ''}{v.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
          <p className="small" style={{ margin: '12px 0 0', color: 'var(--gold)' }}>{read.read}</p>
        </>
      )}

      <Principle domain="Breadth & participation">
        An index is an average — breadth tells you whether the average is honest. When most sectors hold their 50DMA
        and equal-weight keeps pace with cap-weight, the advance has soldiers behind the generals: buy dips. When the
        index grinds up while breadth thins (few sectors above trend, RSP lagging SPY), the move rides a handful of
        mega-caps — that's the tape where breakdowns travel furthest. Rotation without direction (split sectors) is a
        relative-value market: the edge moves from "long or short the index" to "long the leader, short the laggard".
      </Principle>
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

/* --------------------------- global macro (IMF) --------------------------- */

function GlobalMacroPanel() {
  const [board, setBoard] = useState<WeoBoard | null>(null);
  const [weoErr, setWeoErr] = useState<string | null>(null);
  const [commods, setCommods] = useState<CommodityRow[]>([]);
  const [pcpsErr, setPcpsErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadWeoBoard().then((r) => {
      if (!alive) return;
      setBoard(r.board);
      setWeoErr(r.error);
    });
    void loadCommodities().then((r) => {
      if (!alive) return;
      setCommods(r.rows);
      setPcpsErr(r.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  const thisYear = new Date().getFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1];
  const read = useMemo(() => (board ? weoRead(board.rows, thisYear) : null), [board, thisYear]);

  const fmtCell = (v: number | null, forecast: boolean) =>
    v == null ? <span className="muted">—</span> : (
      <span className="mono" style={{ fontStyle: forecast ? 'italic' : undefined, color: v < 0 ? 'var(--loss)' : undefined }}>
        {v.toFixed(1)}
      </span>
    );

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Global growth &amp; the IMF outlook <span className="hint">World Economic Outlook forecasts + commodity price system — IMF data, keyless, auto-connected</span>
        </div>
        {board && (
          <span className="muted small">
            source: {board.source === 'imf-datamapper' ? 'IMF DataMapper' : 'IMF via DBnomics mirror'}{board.stale ? ' (cached)' : ''}
          </span>
        )}
      </div>

      {!board ? (
        <div className="muted small">{weoErr ?? 'Connecting to the IMF…'}</div>
      ) : (
        <>
          {weoErr && <div className="muted small" style={{ marginBottom: 8 }}>{weoErr}</div>}
          <div style={{ overflowX: 'auto' }}>
            <table className="data" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Economy</th>
                  {years.map((y) => (
                    <th key={`g${y}`} style={{ textAlign: 'right' }}>GDP {y}{y >= thisYear ? '*' : ''}</th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Infl {thisYear}*</th>
                  <th style={{ textAlign: 'right' }}>Infl {thisYear + 1}*</th>
                  <th>Moves</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((r) => (
                  <tr key={r.economy.code}>
                    <td style={{ fontWeight: r.economy.code === 'WEOWORLD' ? 700 : 500 }}>{r.economy.label}</td>
                    {years.map((y) => (
                      <td key={y} style={{ textAlign: 'right' }}>{fmtCell(cellFor(r.gdp, y), y >= thisYear)}</td>
                    ))}
                    <td style={{ textAlign: 'right' }}>{fmtCell(cellFor(r.inflation, thisYear), true)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCell(cellFor(r.inflation, thisYear + 1), true)}</td>
                    <td className="muted small">{r.economy.affects.join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>* IMF forecast (italic) — annual %, World Economic Outlook.</div>
          {read && <p className="small" style={{ margin: '10px 0 0', color: 'var(--gold)' }}>{read}</p>}
        </>
      )}

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
        <div className="small muted" style={{ marginBottom: 8 }}>IMF commodity price system — monthly, the demand/supply current under the futures</div>
        {!commods.length ? (
          <div className="muted small">{pcpsErr ?? 'Loading commodity indices…'}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            {commods.map((c) => (
              <StatTile
                key={c.spec.id}
                small
                label={`${c.spec.label} (${c.spec.affects})`}
                value={
                  <span className={c.trend === 'rising' ? 'pos' : c.trend === 'falling' ? 'neg' : ''}>
                    {c.chg3m != null ? `${c.chg3m > 0 ? '+' : ''}${c.chg3m.toFixed(1)}% 3m` : '—'}
                  </span>
                }
                delta={c.chg12m != null ? `${c.chg12m > 0 ? '+' : ''}${c.chg12m.toFixed(1)}% 12m` : undefined}
              />
            ))}
          </div>
        )}
        {pcpsErr && commods.length > 0 && <div className="muted small" style={{ marginTop: 6 }}>{pcpsErr}</div>}
      </div>

      <Principle domain="Global growth & the commodity cycle">
        The WEO board is the SLOW current every fast trade swims in. Growth differentials vs the US decide which way
        the dollar leans for months (a Europe or China that lags the US keeps 6E offered on rallies); world growth near
        or below ~3% means crude rallies need supply stories because demand won't carry them; and when the IMF has
        advanced-economy inflation back at target, growth data quietly replaces inflation data as the release that owns
        the tape. Check this board after each WEO round (April and October) — the REVISIONS, not the levels, are what
        reprice narratives. The commodity tiles are the monthly reality-check on that story: rising energy with falling
        copper is a supply squeeze, both rising is a demand cycle — very different crude playbooks.
      </Principle>
    </div>
  );
}

export default function MacroMap() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Macro Map</h1>
          <p className="page-sub">
            The context layer for all five edge domains — the policy cycle in the curve, cross-asset agreement and
            breaks, and the narratives commanding the world's attention. Free data, no keys required except where noted.
          </p>
        </div>
      </div>
      <div className="stack">
        <NarrativePanel />
        <RatesPanel />
        <GlobalMacroPanel />
        <BreadthPanel />
        <CrossAssetPanel />
      </div>
    </>
  );
}
