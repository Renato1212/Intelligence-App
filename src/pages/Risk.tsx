import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { StatTile, useToast } from '../components/ui';
import { POINT_VALUES } from '../lib/contracts';
import { db } from '../lib/db';
import { fmtMoney } from '../lib/format';
import { computeRisk, getRiskConfig, maxContracts, setRiskConfig, type RiskConfig } from '../lib/risk';

const SIZER_INSTRUMENTS = ['MES', 'ES', 'MNQ', 'NQ', 'MCL', 'CL', 'MGC', 'GC', 'M2K', 'RTY', '6E', 'ZN', 'ZB'];

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
  const [stopPts, setStopPts] = useState(10);
  const [inst, setInst] = useState('MES');
  const [riskPct, setRiskPct] = useState(10);

  const risk = useMemo(() => computeRisk(trades, cfg), [trades, cfg]);

  const save = (patch: Partial<RiskConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    setRiskConfig(next);
  };

  const perContract = stopPts * (POINT_VALUES[inst] ?? 5);
  const contracts = maxContracts(risk.headroom, stopPts, POINT_VALUES[inst] ?? 5, riskPct / 100);

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
              Safe position size <span className="hint">headroom-aware</span>
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              Given your remaining headroom, the most contracts where a single stop-out risks only a set fraction of it.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Instrument</span>
                <select value={inst} onChange={(e) => setInst(e.target.value)}>
                  {SIZER_INSTRUMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Stop (points)</span>
                <input type="number" min={0.25} step={0.25} value={stopPts} onChange={(e) => setStopPts(Number(e.target.value) || 0)} style={{ width: 90 }} />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="small muted">Risk of headroom</span>
                <select value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))}>
                  {[2, 5, 10, 15, 20].map((p) => <option key={p} value={p}>{p}%</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-tiles" style={{ marginTop: 14 }}>
              <StatTile label="Max contracts" value={contracts} valueClass="pos" delta={`${fmtMoney(perContract)} risk / contract`} />
              <StatTile label="Total risk at that size" value={fmtMoney(contracts * perContract)} delta={`${riskPct}% of ${fmtMoney(risk.headroom)} headroom`} />
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
