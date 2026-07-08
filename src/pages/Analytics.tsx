import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BucketBarChart, GradeRadar, RollingExpectancyChart } from '../components/charts';
import { EdgeHeatmap } from '../components/EdgeHeatmap';
import { DomainChip, EmptyState } from '../components/ui';
import { DOMAINS, categoryLabel, domainOf } from '../domain/taxonomy';
import { db } from '../lib/db';
import { addDays, fmtMoney, fmtNum, fmtPct, todayISO, weekdayName } from '../lib/format';
import { bucketStats, computeStats, DURATION_ORDER, durationBucket, hourOfTrade, type BucketStat } from '../lib/stats';

const RANGES = [
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: null as number | null },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export default function Analytics() {
  const all = useLiveQuery(() => db.trades.toArray(), []);
  const [range, setRange] = useState('all');
  const [domain, setDomain] = useState<string>('');

  const trades = useMemo(() => {
    let list = all ?? [];
    const r = RANGES.find((x) => x.id === range);
    if (r?.days) {
      const from = addDays(todayISO(), -r.days);
      list = list.filter((t) => t.date >= from);
    }
    if (domain) list = list.filter((t) => t.domain === domain);
    return list;
  }, [all, range, domain]);

  const stats = useMemo(() => computeStats(trades), [trades]);

  const byDomain = useMemo(() => {
    const buckets = bucketStats(trades, (t) => t.domain, (k) => domainOf(k)?.short ?? k);
    const order = new Map(DOMAINS.map((d, i) => [d.id, i]));
    return buckets.sort((a, b) => (order.get(a.key as never) ?? 9) - (order.get(b.key as never) ?? 9));
  }, [trades]);

  const byCategory = useMemo(
    () =>
      bucketStats(
        trades.filter((t) => t.domain && t.category),
        (t) => `${t.domain}|${t.category}`,
        (k) => {
          const [dom, cat] = k.split('|');
          return `${domainOf(dom)?.short ?? dom} · ${categoryLabel(dom, cat)}`;
        },
      ).sort((a, b) => b.netPnl - a.netPnl),
    [trades],
  );

  const byHour = useMemo(
    () => bucketStats(trades, hourOfTrade).sort((a, b) => a.key.localeCompare(b.key)),
    [trades],
  );

  const byWeekday = useMemo(() => {
    const buckets = bucketStats(trades, (t) => weekdayName(t.date));
    return WEEKDAYS.map((w) => buckets.find((b) => b.key === w)).filter((b): b is BucketStat => !!b);
  }, [trades]);

  const byDuration = useMemo(() => {
    const buckets = bucketStats(trades, durationBucket);
    return DURATION_ORDER.map((k) => buckets.find((b) => b.key === k)).filter((b): b is BucketStat => !!b);
  }, [trades]);

  const byInstrument = useMemo(
    () => bucketStats(trades, (t) => t.instrument).sort((a, b) => b.netPnl - a.netPnl),
    [trades],
  );

  const bySide = useMemo(() => bucketStats(trades, (t) => t.side), [trades]);

  if (all && all.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Edge Analytics</h1>
        </div>
        <EmptyState title="No data to analyse yet">
          <p>Import trades to see where your edge actually is — by domain, setup, time of day and more.</p>
          <Link to="/import" className="btn primary">
            Import trades
          </Link>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Edge Analytics</h1>
          <p className="page-sub">Where is the edge, and is it growing? Every cut of your data answers one question.</p>
        </div>
        <div className="row">
          {DOMAINS.map((d) => (
            <DomainChip key={d.id} id={d.id} selected={domain === d.id} onClick={() => setDomain(domain === d.id ? '' : d.id)} />
          ))}
          <span style={{ width: 10 }} />
          {RANGES.map((r) => (
            <span key={r.id} className={`chip clickable ${range === r.id ? 'selected' : ''}`} onClick={() => setRange(r.id)}>
              {r.label}
            </span>
          ))}
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-tiles">
          <Tile label="Trades" value={String(stats.count)} />
          <Tile label="Net P&L" value={fmtMoney(stats.netPnl, { sign: true })} cls={stats.netPnl >= 0 ? 'pos' : 'neg'} />
          <Tile label="Expectancy / trade" value={fmtMoney(stats.expectancy, { sign: true })} cls={stats.expectancy >= 0 ? 'pos' : 'neg'} />
          <Tile label="Win rate" value={fmtPct(stats.winRate)} />
          <Tile label="Profit factor" value={isFinite(stats.profitFactor) ? fmtNum(stats.profitFactor) : '∞'} />
          <Tile label="Avg R" value={stats.avgR == null ? '—' : `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`} />
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">
              Edge by domain <span className="hint">net P&L</span>
            </div>
            <BucketBarChart data={byDomain} colorBy={(k) => domainOf(k)?.color ?? '#8a857a'} />
          </div>
          <div className="card">
            <div className="card-title">
              Edge development <span className="hint">rolling 20-trade expectancy</span>
            </div>
            <RollingExpectancyChart trades={trades} />
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">
              Coach grade profile <span className="hint">avg score per criterion (0 below → 2 above)</span>
            </div>
            <GradeRadar trades={trades} />
          </div>
          <div className="card">
            <div className="card-title">
              Best setups <span className="hint">domain · category, by net P&L</span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Setup</th>
                    <th className="num">Trades</th>
                    <th className="num">Win rate</th>
                    <th className="num">Expectancy</th>
                    <th className="num">Net P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {byCategory.map((b) => (
                    <tr key={b.key}>
                      <td>{b.label}</td>
                      <td className="num">{b.count}</td>
                      <td className="num">{fmtPct(b.winRate, 0)}</td>
                      <td className={`num ${b.expectancy >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(b.expectancy, { sign: true })}</td>
                      <td className={`num ${b.netPnl >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(b.netPnl, { sign: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            Edge timing map <span className="hint">expectancy ($/trade) by weekday × entry hour — trade your green windows</span>
          </div>
          <EdgeHeatmap trades={trades} />
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">
              Time of day <span className="hint">net P&L by entry hour</span>
            </div>
            <BucketBarChart data={byHour} />
          </div>
          <div className="card">
            <div className="card-title">
              Day of week <span className="hint">net P&L</span>
            </div>
            <BucketBarChart data={byWeekday} />
          </div>
        </div>

        <div className="grid grid-3">
          <div className="card">
            <div className="card-title">
              Hold time <span className="hint">net P&L by duration</span>
            </div>
            <BucketBarChart data={byDuration} height={200} />
          </div>
          <div className="card">
            <div className="card-title">
              Instrument <span className="hint">net P&L</span>
            </div>
            <BucketBarChart data={byInstrument} height={200} />
          </div>
          <div className="card">
            <div className="card-title">
              Direction <span className="hint">net P&L long vs short</span>
            </div>
            <BucketBarChart data={bySide} height={200} />
          </div>
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="card tile">
      <div className="tile-label">{label}</div>
      <div className={`tile-value sm ${cls ?? ''}`}>{value}</div>
    </div>
  );
}
