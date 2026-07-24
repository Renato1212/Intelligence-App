import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { StatTile, useToast } from '../components/ui';
import { db } from '../lib/db';
import { fmtMoney } from '../lib/format';
import { INSTRUMENTS, frontMonth, instrumentFor, sizePosition } from '../lib/instruments';
import { computeRisk, getRiskConfig, setRiskConfig, type RiskConfig } from '../lib/risk';

function Gauge({ pct, breached }: { pct: number; breached: boolean }) {
  // semicircle gauge, headroom fraction
  const r = 80;
  const cx = 100;
  const cy = 96;
  const a = Math.PI * (1 - Math.max(0, Math.min(1, pct)));
  const x = cx + r * Math.cos(a);
  const y = cy - r * Math.sin(a);
  const large = pct < 0.5 ? 1 : 0;
  const color = breached ? 'var(--loss)' : pct > 0.5 ? 'var(--profit)' : pct > 0.25 ? 'var(--dom-news)' : 'var(--loss)';
  return (
    <svg viewBox="0 0 200 112" style={{ width: '100%', maxWidth: 260 }}>
      <path d={`M20 96 A${r} ${r} 0 0 1 180 96`} fill="none" stroke="var(--surface)" strokeWidth="14" strokeLinecap="round" />
      <path d={`M20 96 A${r} ${r} 0 ${large} 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" />
      <text x="100" y="82" textAnchor="middle" style={{ fill: 'var(--text)', fontSize: 26, fontWeight: 800 }}>{(pct * 100).toFixed(0)}%</text>
      <text x="100" y="104" textAnchor="middle" style={{ fill: 'var(--muted)', fontSize: 11 }}>headroom left</text>
    </svg>
  );
}

function DrawdownCurve({ curve, limit }: { curve: { drawdown: number }[]; limit: number }) {
  if (curve.length < 2) return <div className="muted small">Not enough trades to plot the drawdown path.</div>;
  const w = 720;
  const h = 140;
  const maxY = Math.max(limit, ...curve.map((c) => c.drawdown)) * 1.05;
  const px = (i: number) => (i / (curve.length - 1)) * w;
  const py = (d: number) => h - (d / maxY) * h;
  const area = `M0 ${h} ` + curve.map((c, i) => `L${px(i).toFixed(1)} ${py(c.drawdown).toFixed(1)}`).join(' ') + ` L${w} ${h} Z`;
  const limitY = py(limit);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 150 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="ddg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--loss)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--loss)" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#ddg)" stroke="var(--loss)" strokeWidth="1.5" />
      <line x1="0" y1={limitY} x2={w} y2={limitY} stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="6 4" />
      <text x={w - 4} y={Math.max(12, limitY - 4)} textAnchor="end" style={{ fill: 'var(--gold)', fontSize: 11 }}>lock limit {fmtMoney(limit)}</text>
    </svg>
  );
}

export default function Risk() {
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];
  const [cfg, setCfg] = useState<RiskConfig>(getRiskConfig());
  const toast = useToast();
  const [inst, setInst] = useState('ES');
  const [riskPct, setRiskPct] = useState(10);
  const [budgetMode, setBudgetMode] = useState<'headroom' | 'daily'>('headroom');
  const [entry, setEntry] = useState(5000);
  const [stop, setStop] = useState(4995);
  const [target, setTarget] = useState('');

  const risk = useMemo(() => computeRisk(trades, cfg), [trades, cfg]);

  const save = (patch: Partial<RiskConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    setRiskConfig(next);
  };

  const sizeSpec = instrumentFor(inst) ?? INSTRUMENTS[0];
  const budgetBase = budgetMode === 'headroom' ? risk.headroom : cfg.dailyLossLimit;
  const riskBudget = budgetBase * (riskPct / 100);
  const sizing = useMemo(
    () => sizePosition({ spec: sizeSpec, riskBudget, entry, stop, target: target.trim() ? Number(target) : null }),
    [sizeSpec, riskBudget, entry, stop, target],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Risk guardrail</h1>
          <p className="page-sub">
            Protect the account. Your drawdown headroom, daily loss limit and safe size — live from your trade
            history, so the eval never locks on a preventable drawdown.
          </p>
        </div>
      </div>

      {risk.breached && (
        <div className="card" style={{ borderLeft: '3px solid var(--loss)', marginBottom: 14 }}>
          <b style={{ color: 'var(--loss)' }}>⚠ Drawdown limit was breached historically.</b>{' '}
          <span className="muted small">On a live eval this would have locked the account. Reset the start date to your current account, or review the run-up in the curve below.</span>
        </div>
      )}

      <div className="stack">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(220px, 1fr) 3fr', gap: 14, alignItems: 'stretch' }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Gauge pct={risk.headroomPct} breached={risk.breached} />
            <div style={{ fontSize: 22, fontWeight: 800, color: risk.headroomPct > 0.25 ? 'var(--profit)' : 'var(--loss)' }}>{fmtMoney(risk.headroom)}</div>
            <div className="muted small">of {fmtMoney(cfg.maxDrawdown)} limit remaining</div>
          </div>
          <div className="grid grid-tiles">
            <StatTile label="Current drawdown" value={<span className={risk.currentDrawdown > 0 ? 'neg' : ''}>{fmtMoney(-risk.currentDrawdown)}</span>} delta={cfg.drawdownMode === 'trailing' ? 'from your high-water mark' : 'from starting balance'} />
            <StatTile label="Worst drawdown seen" value={<span className="neg">{fmtMoney(-risk.maxDrawdownSeen)}</span>} delta={risk.maxDrawdownSeen >= cfg.maxDrawdown ? 'would have locked' : `${((risk.maxDrawdownSeen / cfg.maxDrawdown) * 100).toFixed(0)}% of limit`} />
            <StatTile
              label="Losers until lock"
              value={risk.losersToLock == null ? '—' : risk.losersToLock}
              valueClass={risk.losersToLock != null && risk.losersToLock <= 3 ? 'neg' : undefined}
              delta={risk.avgLoss < 0 ? `at your avg loss ${fmtMoney(risk.avgLoss)}` : 'no losing trades yet'}
            />
            <StatTile label="Today's P&L" value={<span className={risk.todayPnl >= 0 ? 'pos' : 'neg'}>{fmtMoney(risk.todayPnl, { sign: true })}</span>} delta={`equity ${fmtMoney(risk.equity, { sign: true })}`} />
            <StatTile
              label="Daily loss room"
              value={risk.dailyRoom == null ? 'off' : <span className={risk.dailyRoom <= 0 ? 'neg' : ''}>{fmtMoney(risk.dailyRoom)}</span>}
              valueClass={risk.dailyRoom != null && risk.dailyRoom <= 0 ? 'neg' : undefined}
              delta={risk.dailyRoom != null && risk.dailyRoom <= 0 ? 'limit hit — stop for today' : `limit ${fmtMoney(cfg.dailyLossLimit)}`}
            />
            <StatTile label="Trades counted" value={risk.count} delta={cfg.startDate ? `since ${cfg.startDate}` : 'all history'} />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            Drawdown path <span className="hint">how close each trade took you to the lock line</span>
          </div>
          <DrawdownCurve curve={risk.equityCurve} limit={cfg.maxDrawdown} />
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">
              Position sizer <span className="hint">structure first — you choose where the trade is wrong, this chooses the size</span>
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              Enter the price where you get in and the price that proves you wrong. The sizer converts that into
              contract ticks on the real spec, then answers how many contracts fit inside today&apos;s risk budget.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Contract</span>
                <select value={inst} onChange={(e) => setInst(e.target.value)}>
                  {INSTRUMENTS.map((s) => <option key={s.root} value={s.root}>{s.root} — {s.name}</option>)}
                </select>
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Entry</span>
                <input type="number" step="any" value={entry} onChange={(e) => setEntry(Number(e.target.value) || 0)} style={{ width: 100 }} />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Stop</span>
                <input type="number" step="any" value={stop} onChange={(e) => setStop(Number(e.target.value) || 0)} style={{ width: 100 }} />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Target (optional)</span>
                <input type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 100 }} placeholder="—" />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Risk budget</span>
                <select value={budgetMode} onChange={(e) => setBudgetMode(e.target.value as 'headroom' | 'daily')}>
                  <option value="headroom">% of drawdown headroom</option>
                  <option value="daily">% of daily loss limit</option>
                </select>
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Fraction</span>
                <select value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))}>
                  {[2, 5, 10, 15, 20, 25, 33, 50].map((p) => <option key={p} value={p}>{p}%</option>)}
                </select>
              </label>
            </div>

            <div className="grid grid-tiles" style={{ marginTop: 14 }}>
              <StatTile
                label="Position size"
                value={sizing.contracts ? `${sizing.contracts} × ${sizeSpec.root}` : '0 — does not fit'}
                valueClass={sizing.contracts ? 'pos' : 'neg'}
                delta={`${sizing.stopTicks} ticks · ${fmtMoney(sizing.riskPerContract)} per contract`}
              />
              <StatTile label="Risk at that size" value={fmtMoney(sizing.totalRisk)} delta={`budget ${fmtMoney(riskBudget)} (${riskPct}% of ${budgetMode === 'headroom' ? 'headroom' : 'daily limit'})`} />
              <StatTile label="Every tick costs" value={fmtMoney(sizing.tickCost)} delta={`tick ${sizeSpec.tickSize} = ${fmtMoney(sizeSpec.tickValue)}/contract`} />
              <StatTile
                label={sizing.rMultiple != null ? 'Reward : risk' : 'Notional carried'}
                value={sizing.rMultiple != null ? `${sizing.rMultiple.toFixed(2)}R` : fmtMoney(sizing.notional, { compact: true })}
                valueClass={sizing.rMultiple != null && sizing.rMultiple >= 2 ? 'pos' : sizing.rMultiple != null && sizing.rMultiple < 1 ? 'neg' : undefined}
                delta={sizing.rMultiple != null ? `notional ${fmtMoney(sizing.notional, { compact: true })}` : 'exposure at this size'}
              />
            </div>

            {(sizing.warnings.length > 0 || sizing.microSuggestion) && (
              <div className="stack" style={{ gap: 5, marginTop: 12 }}>
                {sizing.warnings.map((w) => (
                  <div key={w.slice(0, 24)} className="small" style={{ color: 'var(--loss)' }}>⚠ {w}</div>
                ))}
                {sizing.microSuggestion && <div className="small" style={{ color: 'var(--gold)' }}>→ {sizing.microSuggestion}</div>}
              </div>
            )}

            <div className="hint" style={{ marginTop: 10 }}>
              {sizeSpec.name} · {sizeSpec.exchange} · tick {sizeSpec.tickSize} = {fmtMoney(sizeSpec.tickValue)} · point = {fmtMoney(sizeSpec.pointValue)} ·
              RTH {sizeSpec.rthOpen}–{sizeSpec.rthClose} ET · front month {frontMonth(sizeSpec)}. {sizeSpec.notes}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Account &amp; limits</div>
            <div className="stack" style={{ gap: 12 }}>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Account label</span>
                <input value={cfg.accountLabel} onChange={(e) => save({ accountLabel: e.target.value })} />
              </label>
              <div className="grid grid-2" style={{ gap: 12 }}>
                <label className="stack" style={{ gap: 4 }}>
                  <span className="small muted">Max drawdown ($)</span>
                  <input type="number" value={cfg.maxDrawdown} onChange={(e) => save({ maxDrawdown: Number(e.target.value) || 0 })} />
                </label>
                <label className="stack" style={{ gap: 4 }}>
                  <span className="small muted">Daily loss limit ($, 0 = off)</span>
                  <input type="number" value={cfg.dailyLossLimit} onChange={(e) => save({ dailyLossLimit: Number(e.target.value) || 0 })} />
                </label>
              </div>
              <div className="grid grid-2" style={{ gap: 12 }}>
                <label className="stack" style={{ gap: 4 }}>
                  <span className="small muted">Drawdown mode</span>
                  <select value={cfg.drawdownMode} onChange={(e) => save({ drawdownMode: e.target.value as RiskConfig['drawdownMode'] })}>
                    <option value="trailing">Trailing (from high-water mark)</option>
                    <option value="static">Static (from start balance)</option>
                  </select>
                </label>
                <label className="stack" style={{ gap: 4 }}>
                  <span className="small muted">Account start date</span>
                  <input type="date" value={cfg.startDate} onChange={(e) => save({ startDate: e.target.value })} />
                </label>
              </div>
              <div className="muted small">
                AXIA Initial Observation defaults are pre-filled ($20,000 trailing max drawdown). Set the start date to
                your current account so only its trades count toward the lock.
              </div>
              <button className="btn sm" onClick={() => toast('Risk settings saved')}>Saved automatically</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
