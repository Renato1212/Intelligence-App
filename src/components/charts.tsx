import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Trade } from '../domain/types';
import { CRITERIA } from '../domain/taxonomy';
import { fmtDateShort, fmtMoney } from '../lib/format';
import { dailyPnlSeries, equityCurve, gradeProfile, rollingExpectancy, type BucketStat } from '../lib/stats';

const INK = { grid: '#262320', axis: '#8a857a', gold: '#d3a94f', profit: '#0ca30c', loss: '#e66767' };

const axisProps = {
  stroke: 'transparent',
  tick: { fill: INK.axis, fontSize: 11 },
  tickLine: false,
} as const;

function TT({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="viz-tooltip">
      <div className="tt-title">{title}</div>
      {rows.map(([k, v]) => (
        <div className="tt-row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

export function EquityChart({ trades, height = 260 }: { trades: Trade[]; height?: number }) {
  const data = equityCurve(trades);
  if (data.length < 2) return <div className="muted small">Not enough trades to draw a curve.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={INK.gold} stopOpacity={0.22} />
            <stop offset="100%" stopColor={INK.gold} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={INK.grid} vertical={false} />
        <XAxis dataKey="index" {...axisProps} minTickGap={40} tickFormatter={(i: number) => `#${i}`} />
        <YAxis {...axisProps} tickFormatter={(v: number) => fmtMoney(v, { compact: true })} width={64} />
        <ReferenceLine y={0} stroke="#3a362f" />
        <Tooltip
          cursor={{ stroke: '#3a362f' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            return (
              <TT
                title={`Trade #${p.index} · ${fmtDateShort(p.date)}`}
                rows={[
                  ['Equity', fmtMoney(p.equity)],
                  ['Trade P&L', fmtMoney(p.pnl, { sign: true })],
                ]}
              />
            );
          }}
        />
        {/* isAnimationActive=false: recharts Area fails to draw under React StrictMode when animated */}
        <Area type="monotone" dataKey="equity" stroke={INK.gold} strokeWidth={2} fill="url(#eqFill)" dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#1a1815' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DailyPnlChart({ trades, height = 200 }: { trades: Trade[]; height?: number }) {
  const data = dailyPnlSeries(trades);
  if (!data.length) return <div className="muted small">No daily data yet.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }} barCategoryGap={2}>
        <CartesianGrid stroke={INK.grid} vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={50} tickFormatter={fmtDateShort} />
        <YAxis {...axisProps} tickFormatter={(v: number) => fmtMoney(v, { compact: true })} width={64} />
        <ReferenceLine y={0} stroke="#3a362f" />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            return (
              <TT
                title={fmtDateShort(p.date)}
                rows={[
                  ['Day P&L', fmtMoney(p.pnl, { sign: true })],
                  ['Trades', String(p.count)],
                ]}
              />
            );
          }}
        />
        <Bar dataKey="pnl" radius={[4, 4, 0, 0]} maxBarSize={24}>
          {data.map((d) => (
            <Cell key={d.date} fill={d.pnl >= 0 ? INK.profit : INK.loss} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BucketBarChart({
  data,
  height = 220,
  colorBy,
  valueKey = 'netPnl',
  valueLabel = 'Net P&L',
}: {
  data: BucketStat[];
  height?: number;
  /** fixed color per bucket key (domain identity); default = sign of value */
  colorBy?: (key: string) => string;
  valueKey?: 'netPnl' | 'expectancy';
  valueLabel?: string;
}) {
  if (!data.length) return <div className="muted small">No trades in this view.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }} barCategoryGap="28%">
        <CartesianGrid stroke={INK.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval={0} angle={data.length > 7 ? -28 : 0} textAnchor={data.length > 7 ? 'end' : 'middle'} height={data.length > 7 ? 52 : 30} />
        <YAxis {...axisProps} tickFormatter={(v: number) => fmtMoney(v, { compact: true })} width={64} />
        <ReferenceLine y={0} stroke="#3a362f" />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as BucketStat;
            return (
              <TT
                title={p.label}
                rows={[
                  [valueLabel, fmtMoney(p[valueKey], { sign: true })],
                  ['Trades', String(p.count)],
                  ['Win rate', `${(p.winRate * 100).toFixed(0)}%`],
                  ['Expectancy', fmtMoney(p.expectancy, { sign: true }) + ' / trade'],
                ]}
              />
            );
          }}
        />
        <Bar dataKey={valueKey} radius={[4, 4, 0, 0]} maxBarSize={24}>
          {data.map((d) => (
            <Cell key={d.key} fill={colorBy ? colorBy(d.key) : d[valueKey] >= 0 ? INK.profit : INK.loss} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RollingExpectancyChart({ trades, window = 20, height = 220 }: { trades: Trade[]; window?: number; height?: number }) {
  const data = rollingExpectancy(trades, window);
  if (data.length < 2) return <div className="muted small">Needs at least {window + 1} trades.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={INK.grid} vertical={false} />
        <XAxis dataKey="index" {...axisProps} minTickGap={40} tickFormatter={(i: number) => `#${i}`} />
        <YAxis {...axisProps} tickFormatter={(v: number) => fmtMoney(v, { compact: true })} width={64} />
        <ReferenceLine y={0} stroke="#3a362f" />
        <Tooltip
          cursor={{ stroke: '#3a362f' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            return (
              <TT
                title={`Trade #${p.index} · ${fmtDateShort(p.date)}`}
                rows={[[`Expectancy (last ${window})`, fmtMoney(p.value, { sign: true })]]}
              />
            );
          }}
        />
        <Line type="monotone" dataKey="value" stroke="#3987e5" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#1a1815' }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GradeRadar({ trades, height = 260 }: { trades: Trade[]; height?: number }) {
  const profile = gradeProfile(trades);
  const graded = profile.some((p) => p.count > 0);
  if (!graded) return <div className="muted small">Grade some trades to see your coach profile.</div>;
  const data = profile.map((p) => ({
    criterion: CRITERIA.find((c) => c.id === p.criterion)?.label ?? p.criterion,
    score: Number(p.avg.toFixed(2)),
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={INK.grid} />
        <PolarAngleAxis dataKey="criterion" tick={{ fill: INK.axis, fontSize: 11 }} />
        <Radar dataKey="score" stroke={INK.gold} fill={INK.gold} fillOpacity={0.18} strokeWidth={2} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            const v = p.score as number;
            const band = v < 0.67 ? 'Below standard' : v < 1.34 ? 'At standard' : 'Above standard';
            return <TT title={p.criterion} rows={[['Avg score', `${v.toFixed(2)} / 2`], ['Band', band]]} />;
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/** GitHub-style calendar of daily P&L. Diverging: loss red ↔ neutral ↔ profit green. */
export function PnlCalendar({ trades }: { trades: Trade[] }) {
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.pnl);
  if (!byDay.size) return <div className="muted small">No daily data yet.</div>;

  const days = [...byDay.keys()].sort();
  const last = new Date(`${days[days.length - 1]}T12:00:00`);
  const first = new Date(last);
  first.setDate(first.getDate() - 7 * 26); // ~6 months window
  // align to Monday
  while (first.getDay() !== 1) first.setDate(first.getDate() - 1);

  const max = Math.max(...[...byDay.values()].map(Math.abs), 1);
  const cells: { date: string; pnl: number | null }[] = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    cells.push({ date: iso, pnl: byDay.has(iso) ? byDay.get(iso)! : null });
  }

  const color = (pnl: number | null) => {
    if (pnl == null) return 'rgba(255,255,255,0.045)';
    const mag = Math.min(1, Math.abs(pnl) / max);
    const alpha = 0.25 + mag * 0.75;
    return pnl >= 0 ? `rgba(12,163,12,${alpha.toFixed(2)})` : `rgba(230,103,103,${alpha.toFixed(2)})`;
  };

  return (
    <div>
      <div className="cal-grid" style={{ overflowX: 'auto', paddingBottom: 4 }}>
        {cells.map((c) => (
          <div
            key={c.date}
            className="cal-cell"
            style={{ background: color(c.pnl) }}
            title={`${fmtDateShort(c.date)} · ${c.pnl == null ? 'no trades' : fmtMoney(c.pnl, { sign: true })}`}
          />
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <span className="cal-legend">
          <span>Loss</span>
          {[-1, -0.5, 0, 0.5, 1].map((v) => (
            <span key={v} className="cal-cell" style={{ background: v === 0 ? 'rgba(255,255,255,0.045)' : color(v * max) }} />
          ))}
          <span>Profit</span>
        </span>
      </div>
    </div>
  );
}
