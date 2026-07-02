import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DomainChip, EmptyState, PnL, SideBadge } from '../components/ui';
import { DOMAINS, categoryLabel } from '../domain/taxonomy';
import type { Trade } from '../domain/types';
import { db } from '../lib/db';
import { fmtDate, fmtDuration, fmtMoney, fmtPct, fmtR, fmtTime } from '../lib/format';
import { computeStats, rMultiple } from '../lib/stats';

type SortKey = 'time' | 'pnl' | 'instrument';

export default function Trades() {
  const trades = useLiveQuery(() => db.trades.toArray(), []);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const strategyId = params.get('strategy') ? Number(params.get('strategy')) : null;
  const [domain, setDomain] = useState<string>('');
  const [instrument, setInstrument] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<SortKey>('time');
  const [asc, setAsc] = useState(false);

  const instruments = useMemo(
    () => [...new Set((trades ?? []).map((t) => t.instrument))].sort(),
    [trades],
  );

  const filtered = useMemo(() => {
    let list = trades ?? [];
    if (strategyId != null) list = list.filter((t) => t.strategyId === strategyId);
    if (domain === 'untagged') list = list.filter((t) => !t.domain);
    else if (domain) list = list.filter((t) => t.domain === domain);
    if (instrument) list = list.filter((t) => t.instrument === instrument);
    if (from) list = list.filter((t) => t.date >= from);
    if (to) list = list.filter((t) => t.date <= to);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.instrument.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          (t.category ?? '').toLowerCase().includes(q),
      );
    }
    const dir = asc ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort === 'pnl') return (a.pnl - b.pnl) * dir;
      if (sort === 'instrument') return a.instrument.localeCompare(b.instrument) * dir;
      return a.entryTime.localeCompare(b.entryTime) * dir;
    });
  }, [trades, strategyId, domain, instrument, search, from, to, sort, asc]);

  const stats = useMemo(() => computeStats(filtered), [filtered]);

  const header = (label: string, key: SortKey, num = false) => (
    <th
      className={num ? 'num' : ''}
      style={{ cursor: 'pointer' }}
      onClick={() => {
        if (sort === key) setAsc(!asc);
        else {
          setSort(key);
          setAsc(false);
        }
      }}
    >
      {label} {sort === key ? (asc ? '↑' : '↓') : ''}
    </th>
  );

  if (trades && trades.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Trades</h1>
        </div>
        <EmptyState title="No trades yet">
          <p>Import your MotiveWave or Rithmic exports to populate the journal.</p>
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
          <h1 className="page-title">Trades</h1>
          <p className="page-sub">
            {filtered.length} trades · net <PnL value={stats.netPnl} /> · win rate {fmtPct(stats.winRate)} ·
            expectancy {fmtMoney(stats.expectancy, { sign: true })}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <DomainChip id={null} selected={domain === 'untagged'} onClick={() => setDomain(domain === 'untagged' ? '' : 'untagged')} />
          {DOMAINS.map((d) => (
            <DomainChip key={d.id} id={d.id} selected={domain === d.id} onClick={() => setDomain(domain === d.id ? '' : d.id)} />
          ))}
          <span style={{ flex: 1 }} />
          <select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
            <option value="">All instruments</option>
            {instruments.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From date" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To date" />
          <input placeholder="Search notes, tags…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 170 }} />
        </div>
      </div>

      <div className="card table-wrap">
        <table className="data">
          <thead>
            <tr>
              {header('Date / time', 'time')}
              {header('Inst', 'instrument')}
              <th>Side</th>
              <th className="num">Size</th>
              <th>Duration</th>
              <th>Domain</th>
              <th>Sub tag</th>
              <th>Tags</th>
              <th className="num">R</th>
              {header('P&L', 'pnl', true)}
              <th>Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <TradeRow key={t.id} t={t} onClick={() => nav(`/trades/${t.id}`)} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TradeRow({ t, onClick }: { t: Trade; onClick: () => void }) {
  const r = rMultiple(t);
  const reviewed = t.description || t.learned || Object.keys(t.grades ?? {}).length > 0;
  return (
    <tr className="clickable" onClick={onClick}>
      <td>
        {fmtDate(t.date)} <span className="muted small">{fmtTime(t.entryTime)}</span>
      </td>
      <td className="mono">{t.instrument}</td>
      <td>
        <SideBadge side={t.side} />
      </td>
      <td className="num">{t.qty}</td>
      <td className="muted">{fmtDuration(t.entryTime, t.exitTime)}</td>
      <td>
        <DomainChip id={t.domain} />
      </td>
      <td className="muted">{categoryLabel(t.domain, t.category)}</td>
      <td className="muted small">{t.tags.slice(0, 3).join(' · ')}</td>
      <td className="num">{fmtR(r)}</td>
      <td className="num">
        <PnL value={t.pnl} />
      </td>
      <td>{reviewed ? <span style={{ color: 'var(--gold)' }}>●</span> : <span className="muted">○</span>}</td>
    </tr>
  );
}
