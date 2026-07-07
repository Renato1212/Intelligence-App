import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BucketBarChart, DailyPnlChart, EquityChart, PnlCalendar } from '../components/charts';
import { CommandCenter } from '../components/CommandCenter';
import { DomainChip, PnL, SideBadge, StatTile, useToast } from '../components/ui';
import { DOMAINS, domainOf } from '../domain/taxonomy';
import { db } from '../lib/db';
import { loadDemoData } from '../lib/demo';
import { addDays, fmtDate, fmtMoney, fmtNum, fmtPct, fmtTime, todayISO } from '../lib/format';
import { bucketStats, computeStats } from '../lib/stats';

const RANGES = [
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '180', label: '6 months', days: 180 },
  { id: 'all', label: 'All time', days: null as number | null },
];

export default function Dashboard() {
  const trades = useLiveQuery(() => db.trades.toArray(), []);
  const [range, setRange] = useState('all');
  const toast = useToast();
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    if (!trades) return [];
    const r = RANGES.find((x) => x.id === range);
    if (!r?.days) return trades;
    const from = addDays(todayISO(), -r.days);
    return trades.filter((t) => t.date >= from);
  }, [trades, range]);

  const stats = useMemo(() => computeStats(filtered), [filtered]);

  const domainBuckets = useMemo(() => {
    const buckets = bucketStats(filtered, (t) => t.domain, (k) => domainOf(k)?.short ?? k);
    const order = new Map(DOMAINS.map((d, i) => [d.id, i]));
    return buckets.sort((a, b) => (order.get(a.key as never) ?? 9) - (order.get(b.key as never) ?? 9));
  }, [filtered]);

  const recent = useMemo(
    () => [...filtered].sort((a, b) => b.exitTime.localeCompare(a.exitTime)).slice(0, 8),
    [filtered],
  );

  if (trades && trades.length === 0) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-sub">Your trading intelligence center — everything starts with data.</p>
          </div>
        </div>
        <div className="card empty">
          <h3>Welcome to Edge Intelligence</h3>
          <p>
            Import your trades from MotiveWave or Rithmic to start tracking performance across the five edge
            domains — or load a realistic demo dataset to explore the full platform first.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to="/import" className="btn primary">
              Import trades
            </Link>
            <button
              className="btn"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                const n = await loadDemoData();
                setLoading(false);
                toast(`Loaded ${n} demo trades — explore, then clear them in Settings`);
              }}
            >
              {loading ? 'Loading…' : 'Load demo data'}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">
            {stats.count} trades · {stats.tradingDays} trading days
          </p>
        </div>
        <div className="row">
          {RANGES.map((r) => (
            <span key={r.id} className={`chip clickable ${range === r.id ? 'selected' : ''}`} onClick={() => setRange(r.id)}>
              {r.label}
            </span>
          ))}
        </div>
      </div>

      <div className="stack">
        <CommandCenter trades={trades ?? []} />
        <div className="grid" style={{ gridTemplateColumns: 'minmax(240px, 1fr) 3fr' }}>
          <div className="card tile" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="tile-label">Net P&L</div>
            <div className={`hero-value ${stats.netPnl > 0 ? 'pos' : stats.netPnl < 0 ? 'neg' : ''}`}>
              {fmtMoney(stats.netPnl, { sign: true })}
            </div>
            <div className="tile-delta">
              Expectancy <b style={{ color: 'var(--text)' }}>{fmtMoney(stats.expectancy, { sign: true })}</b> per trade
              {stats.avgR != null && (
                <>
                  {' · '}
                  <b style={{ color: 'var(--text)' }}>
                    {stats.avgR >= 0 ? '+' : ''}
                    {stats.avgR.toFixed(2)}R
                  </b>{' '}
                  avg
                </>
              )}
            </div>
          </div>
          <div className="grid grid-tiles">
            <StatTile label="Win rate" value={fmtPct(stats.winRate)} delta={`${Math.round(stats.winRate * stats.count)} of ${stats.count} trades`} />
            <StatTile
              label="Profit factor"
              value={isFinite(stats.profitFactor) ? fmtNum(stats.profitFactor) : '∞'}
              delta={
                <>
                  <span className="up">{fmtMoney(stats.grossProfit, { compact: true })}</span> gross ·{' '}
                  <span className="down">{fmtMoney(stats.grossLoss, { compact: true })}</span> loss
                </>
              }
            />
            <StatTile
              label="Avg win / avg loss"
              value={isFinite(stats.payoff) ? fmtNum(stats.payoff) : '—'}
              delta={
                <>
                  <span className="up">{fmtMoney(stats.avgWin, { compact: true })}</span> vs{' '}
                  <span className="down">{fmtMoney(stats.avgLoss, { compact: true })}</span>
                </>
              }
            />
            <StatTile label="Max drawdown" value={<span className="neg">{fmtMoney(-stats.maxDrawdown)}</span>} delta={`Longest losing streak ${stats.maxLossStreak}`} />
            <StatTile
              label="Daily Sharpe (ann.)"
              value={stats.sharpe == null ? '—' : fmtNum(stats.sharpe)}
              delta={`Avg day ${fmtMoney(stats.avgDailyPnl, { sign: true })}`}
            />
            <StatTile label="Review discipline" value={fmtPct(stats.taggedRate, 0)} delta={`tagged · ${fmtPct(stats.gradedRate, 0)} graded`} />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            Equity curve <span className="hint">cumulative net P&L by closed trade</span>
          </div>
          <EquityChart trades={filtered} />
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">
              Daily P&L <span className="hint">one bar per trading day</span>
            </div>
            <DailyPnlChart trades={filtered} />
          </div>
          <div className="card">
            <div className="card-title">
              P&L calendar <span className="hint">last 6 months, weekdays</span>
            </div>
            <PnlCalendar trades={filtered} />
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">
              Edge domains <span className="hint">net P&L by level-1 tag</span>
            </div>
            <BucketBarChart data={domainBuckets} colorBy={(k) => domainOf(k)?.color ?? '#8a857a'} />
            <div className="row" style={{ marginTop: 8 }}>
              {DOMAINS.map((d) => (
                <span key={d.id} className="chip">
                  <span className="dot" style={{ background: d.color }} />
                  {d.short}
                </span>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-title spread">
              <span>Recent trades</span>
              <Link to="/trades" className="small">
                View all →
              </Link>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Inst</th>
                    <th>Side</th>
                    <th>Domain</th>
                    <th className="num">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => nav(`/trades/${t.id}`)}>
                      <td>
                        {fmtDate(t.date)} <span className="muted small">{fmtTime(t.entryTime)}</span>
                      </td>
                      <td className="mono">{t.instrument}</td>
                      <td>
                        <SideBadge side={t.side} />
                      </td>
                      <td>
                        <DomainChip id={t.domain} />
                      </td>
                      <td className="num">
                        <PnL value={t.pnl} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
