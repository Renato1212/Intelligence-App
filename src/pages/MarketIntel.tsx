import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { StatTile } from '../components/ui';
import { db } from '../lib/db';
import { buildFocus, type FocusRow } from '../lib/confluence';
import {
  analyzeSeries,
  cachedCot,
  COT_MARKETS,
  FLAG_LABEL,
  loadCot,
  positioningRead,
  type CotAnalysis,
  type CotFlag,
  type CotGroup,
  type CotSnapshot,
} from '../lib/cot';
import { fmtDateShort, todayISO } from '../lib/format';

const GROUP_ORDER: CotGroup[] = ['Equity', 'Vol', 'Rates', 'FX', 'Energy', 'Metals', 'Ags', 'Crypto'];

const FLAG_COLOR: Record<CotFlag, string> = {
  'extreme-high': 'var(--profit)',
  'extreme-low': 'var(--loss)',
  'big-shift': 'var(--gold)',
  flip: '#3987e5',
};

function fmtContracts(v: number, sign = false): string {
  const abs = Math.abs(v);
  const s = abs >= 1000 ? `${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}k` : String(Math.round(abs));
  return `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}${s}`;
}

/** Tiny inline sparkline of the spec-net series (last year). */
function Spark({ a }: { a: CotAnalysis }) {
  const pts = a.weeks.slice(-52).map((w) => w.specLong - w.specShort);
  if (pts.length < 2) return null;
  const w = 88;
  const h = 24;
  const min = Math.min(...pts, 0);
  const max = Math.max(...pts, 0);
  const span = max - min || 1;
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * h;
  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zero = y(0);
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {zero >= 0 && zero <= h && <line x1={0} x2={w} y1={zero} y2={zero} stroke="var(--axis)" strokeDasharray="2 3" strokeWidth={1} />}
      <path d={path} fill="none" stroke={last >= 0 ? 'var(--profit)' : 'var(--loss)'} strokeWidth={1.5} />
    </svg>
  );
}

/** Percentile position bar: where the latest net sits in its 3y range. */
function PctileBar({ p }: { p: number | null }) {
  if (p == null) return <span className="muted small">—</span>;
  const color = p >= 90 || p <= 10 ? 'var(--gold)' : 'var(--axis)';
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <div style={{ position: 'relative', width: 90, height: 8, background: 'var(--surface)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '10%', right: '10%', top: 0, bottom: 0, background: 'rgba(255,255,255,0.05)' }} />
        <div
          style={{
            position: 'absolute',
            left: `calc(${p}% - 3px)`,
            top: 0,
            bottom: 0,
            width: 6,
            borderRadius: 3,
            background: color,
          }}
        />
      </div>
      <span className="mono small" style={{ width: 30, color: p >= 90 || p <= 10 ? 'var(--gold)' : undefined }}>
        {p}
      </span>
    </div>
  );
}

function FlagChips({ flags }: { flags: CotFlag[] }) {
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {flags.map((f) => (
        <span key={f} className="chip" style={{ fontSize: 11, padding: '1px 7px', border: `1px solid ${FLAG_COLOR[f]}`, color: FLAG_COLOR[f] }}>
          {FLAG_LABEL[f]}
        </span>
      ))}
    </span>
  );
}

function DetailChart({ a }: { a: CotAnalysis }) {
  const data = a.weeks.map((w) => ({
    date: w.date,
    spec: w.specLong - w.specShort,
    comm: w.commLong - w.commShort,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="specFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d3a94f" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#d3a94f" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#262320" vertical={false} />
        <XAxis dataKey="date" stroke="transparent" tick={{ fill: '#8a857a', fontSize: 11 }} tickLine={false} minTickGap={60} tickFormatter={fmtDateShort} />
        <YAxis stroke="transparent" tick={{ fill: '#8a857a', fontSize: 11 }} tickLine={false} width={58} tickFormatter={(v: number) => fmtContracts(v)} />
        <ReferenceLine y={0} stroke="#3a362f" />
        <Tooltip
          cursor={{ stroke: '#3a362f' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { date: string; spec: number; comm: number };
            return (
              <div className="viz-tooltip">
                <div className="tt-title">{fmtDateShort(p.date)}</div>
                <div className="tt-row"><span>Large specs net</span><b>{fmtContracts(p.spec, true)}</b></div>
                <div className="tt-row"><span>Commercials net</span><b>{fmtContracts(p.comm, true)}</b></div>
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="spec" stroke="#d3a94f" strokeWidth={2} fill="url(#specFill)" dot={false} isAnimationActive={false} name="Large specs" />
        <Line type="monotone" dataKey="comm" stroke="#3987e5" strokeWidth={1.5} dot={false} isAnimationActive={false} name="Commercials" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function MarketDetail({ a }: { a: CotAnalysis }) {
  return (
    <div className="card" style={{ borderColor: 'var(--gold)' }}>
      <div className="spread" style={{ alignItems: 'baseline', marginBottom: 4 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          {a.market.label} <span className="mono muted small">{a.market.symbol}</span>
        </div>
        <FlagChips flags={a.flags} />
      </div>
      <p className="small" style={{ margin: '4px 0 12px', color: 'var(--gold)' }}>{positioningRead(a)}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
        <StatTile small label="Large specs net" value={<span className={a.specNet >= 0 ? 'pos' : 'neg'}>{fmtContracts(a.specNet, true)}</span>} delta={`${fmtContracts(a.specWow, true)} wk`} />
        <StatTile small label="Commercials net" value={<span className={a.commNet >= 0 ? 'pos' : 'neg'}>{fmtContracts(a.commNet, true)}</span>} delta={`${fmtContracts(a.commWow, true)} wk`} />
        <StatTile small label="3y percentile" value={a.pctile3y != null ? `${a.pctile3y}` : '—'} delta={a.pctile1y != null ? `1y: ${a.pctile1y}` : undefined} />
        <StatTile small label="Open interest" value={fmtContracts(a.openInterest)} delta={`${fmtContracts(a.oiWow, true)} wk`} />
      </div>
      <DetailChart a={a} />
      <div className="row" style={{ gap: 14, marginTop: 6 }}>
        <span className="small"><span className="grade-dot" style={{ background: '#d3a94f' }} /> Large speculators (net)</span>
        <span className="small"><span className="grade-dot" style={{ background: '#3987e5' }} /> Commercials (net)</span>
        <span className="muted small" style={{ marginLeft: 'auto' }}>3 years, weekly · as of {fmtDateShort(a.reportDate)}</span>
      </div>
    </div>
  );
}

function FocusCard({ row, onOpen }: { row: FocusRow; onOpen?: () => void }) {
  return (
    <div
      className="card"
      style={{ padding: '12px 14px', cursor: onOpen ? 'pointer' : undefined, borderLeft: `3px solid ${row.confluence >= 2 ? 'var(--gold)' : 'var(--hairline)'}` }}
      onClick={onOpen}
    >
      <div className="spread" style={{ alignItems: 'center', marginBottom: 6 }}>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <b className="mono">{row.symbol}</b>
          <span className="muted small">{row.label}</span>
        </div>
        <div className="row" style={{ gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="grade-dot" style={{ background: i < row.confluence ? 'var(--gold)' : 'var(--surface)' }} />
          ))}
        </div>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 3 }}>
        {row.reasons.map((r) => (
          <li key={r} className="small" style={{ color: r.startsWith('Caution') ? 'var(--loss)' : undefined }}>
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MarketIntel() {
  const nav = useNavigate();
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];
  const [snap, setSnap] = useState<CotSnapshot | null>(() => cachedCot());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<CotGroup | null>(null);

  const refresh = async (force: boolean) => {
    setLoading(true);
    const res = await loadCot(force);
    if (res.snapshot) setSnap(res.snapshot);
    setError(res.error);
    setLoading(false);
  };

  useEffect(() => {
    void refresh(false);
  }, []);

  const analyses = useMemo(() => {
    const out: CotAnalysis[] = [];
    for (const s of snap?.series ?? []) {
      const a = analyzeSeries(s);
      if (a) out.push(a);
    }
    const order = new Map(GROUP_ORDER.map((g, i) => [g, i]));
    const idx = new Map(COT_MARKETS.map((m, i) => [m.symbol, i]));
    return out.sort(
      (a, b) =>
        (order.get(a.market.group) ?? 9) - (order.get(b.market.group) ?? 9) ||
        (idx.get(a.market.symbol) ?? 99) - (idx.get(b.market.symbol) ?? 99),
    );
  }, [snap]);

  const focus = useMemo(() => buildFocus(trades, snap, todayISO()), [trades, snap]);
  const topFocus = focus.filter((f) => f.confluence >= 1).slice(0, 6);
  const selectedAnalysis = analyses.find((a) => a.market.symbol === selected) ?? null;
  const visible = groupFilter ? analyses.filter((a) => a.market.group === groupFilter) : analyses;
  const groups = GROUP_ORDER.filter((g) => analyses.some((a) => a.market.group === g));
  const extremes = analyses.filter((a) => a.flags.length > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Market Intel</h1>
          <p className="page-sub">
            Who is positioned where — the CFTC's weekly Commitments of Traders, free and keyless, turned into
            crowdedness reads and crossed with your catalysts and your own edge.
          </p>
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          {snap?.reportDate && (
            <span className="muted small">
              Report: <b>{fmtDateShort(snap.reportDate)}</b>
              {snap.stale ? ' (cached)' : ''} · new data Fridays ~15:30 ET
            </span>
          )}
          <button className="btn sm" disabled={loading} onClick={() => void refresh(true)}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="stack">
        {error && (
          <div className="card" style={{ borderColor: 'var(--loss)', padding: '10px 14px' }}>
            <span className="small">
              <b>Live refresh failed:</b> <span className="muted">{error}</span>
              {snap ? ' Showing the last cached report.' : ' Positioning fills in the first time the app is online — the confluence board below still works from your calendar and trade history.'}
            </span>
          </div>
        )}

        <div className="card">
          <div className="card-title">
            This week's focus{' '}
            <span className="hint">where positioning, catalysts and your own edge line up — dots = agreeing reads</span>
          </div>
          {topFocus.length === 0 ? (
            <div className="muted small">
              Nothing is lining up yet — connect once to pull positioning, and import trades so your own edge joins the read.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 }}>
              {topFocus.map((f) => (
                <FocusCard key={f.symbol} row={f} onOpen={f.cot ? () => setSelected(f.symbol) : undefined} />
              ))}
            </div>
          )}
          <div className="muted small" style={{ marginTop: 10 }}>
            Turn a read into a plan: write the hypothesis in{' '}
            <span style={{ cursor: 'pointer', color: 'var(--gold)', textDecoration: 'underline' }} onClick={() => nav('/day')}>
              Trading Day → Preparation
            </span>
            .
          </div>
        </div>

        {selectedAnalysis && <MarketDetail a={selectedAnalysis} />}

        {analyses.length > 0 && (
          <div className="card">
            <div className="spread" style={{ marginBottom: 10, alignItems: 'center' }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                Positioning board <span className="hint">large speculators' net position — click a market for the full read</span>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <span className={`chip clickable ${groupFilter == null ? 'selected' : ''}`} onClick={() => setGroupFilter(null)}>All</span>
                {groups.map((g) => (
                  <span key={g} className={`chip clickable ${groupFilter === g ? 'selected' : ''}`} onClick={() => setGroupFilter(groupFilter === g ? null : g)}>
                    {g}
                  </span>
                ))}
              </div>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th className="num">Specs net</th>
                    <th className="num">Δ week</th>
                    <th>3y percentile</th>
                    <th>1y trend</th>
                    <th>Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => (
                    <tr
                      key={a.market.symbol}
                      className="clickable"
                      onClick={() => setSelected(selected === a.market.symbol ? null : a.market.symbol)}
                      style={{ background: selected === a.market.symbol ? 'var(--gold-dim)' : undefined }}
                    >
                      <td>
                        <b className="mono">{a.market.symbol}</b>{' '}
                        <span className="muted small">{a.market.label}</span>
                      </td>
                      <td className={`mono num ${a.specNet >= 0 ? 'pos' : 'neg'}`}>{fmtContracts(a.specNet, true)}</td>
                      <td className={`mono num ${a.specWow >= 0 ? 'pos' : 'neg'}`}>{fmtContracts(a.specWow, true)}</td>
                      <td><PctileBar p={a.pctile3y} /></td>
                      <td><Spark a={a} /></td>
                      <td><FlagChips flags={a.flags} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {extremes.length > 0 && !groupFilter && (
              <div className="muted small" style={{ marginTop: 10 }}>
                {extremes.length} market{extremes.length > 1 ? 's' : ''} flashing a positioning signal this week.
              </div>
            )}
          </div>
        )}

        {analyses.length === 0 && !error && (
          <div className="card empty">
            <h3>Pulling positioning data…</h3>
            <p className="muted small">First load fetches ~3 years of weekly CFTC reports (one request, no key). After that it's cached and works offline.</p>
          </div>
        )}

        <div className="card">
          <div className="card-title">How to read COT <span className="hint">the 60-second version</span></div>
          <div className="grid grid-2 small" style={{ gap: 16 }}>
            <div className="stack" style={{ gap: 8 }}>
              <div><b style={{ color: '#d3a94f' }}>Large speculators</b> <span className="muted">(funds, CTAs) are trend-followers. Their net position tracks the trend — until it reaches an extreme, where the trade is crowded and fuel for the move is spent.</span></div>
              <div><b style={{ color: '#3987e5' }}>Commercials</b> <span className="muted">(producers, hedgers) fade price to hedge. They are usually opposite the specs and heaviest at turns.</span></div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <div><b>Percentile ≥ 90 or ≤ 10</b> <span className="muted">— positioning at a multi-year extreme. Not a signal to fade blindly, but squeezes and failed breakouts start here. Pair it with a catalyst and a technical level.</span></div>
              <div><b>Big weekly shift / net flip</b> <span className="muted">— repositioning is information: someone changed their mind in size. Ask what they saw, and whether your markets have priced it.</span></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
