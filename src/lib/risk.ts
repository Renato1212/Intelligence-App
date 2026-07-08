/*
 * Observation / evaluation risk guardrail.
 *
 * AXIA Observation (and most funded-eval) accounts lock the moment a maximum
 * drawdown is breached — for the Initial Observation that limit is $20,000.
 * Blowing the eval on a preventable drawdown is the single most expensive
 * mistake a developing trader can make, so this module turns the trade history
 * into a live risk picture: how much drawdown headroom is left, how today is
 * tracking against a self-imposed daily loss limit, and how much room there is
 * before the account locks — expressed in the trader's own average-loss units.
 *
 * Everything is derived from the local trade history; no account connection is
 * required. Drawdown is measured on the realized-P&L equity curve.
 */
import type { Trade } from '../domain/types';
import { groupBy } from './stats';

export type DrawdownMode = 'trailing' | 'static';

export interface RiskConfig {
  /** Account label, for display only. */
  accountLabel: string;
  /** The hard max-drawdown that locks the account, in $. */
  maxDrawdown: number;
  /**
   * trailing = drawdown measured from the highest equity reached (high-water
   * mark) — the common funded-eval rule. static = from the starting balance.
   */
  drawdownMode: DrawdownMode;
  /** Self-imposed daily loss limit ($, positive number). 0 = off. */
  dailyLossLimit: number;
  /** Only count trades on/after this account start date (YYYY-MM-DD). '' = all. */
  startDate: string;
}

const KEY = 'ei-risk-config';

export const DEFAULT_RISK: RiskConfig = {
  accountLabel: 'Observation account',
  maxDrawdown: 20000,
  drawdownMode: 'trailing',
  dailyLossLimit: 1000,
  startDate: '',
};

export function getRiskConfig(): RiskConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_RISK, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_RISK };
}

export function setRiskConfig(cfg: RiskConfig): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export interface RiskState {
  /** trades used (after startDate filter), in exit order */
  count: number;
  /** cumulative realized P&L */
  equity: number;
  /** high-water mark of the equity curve */
  peak: number;
  /** current drawdown from the reference (peak or start) */
  currentDrawdown: number;
  /** worst drawdown ever reached on the curve (what would have locked you) */
  maxDrawdownSeen: number;
  /** $ of drawdown left before the account locks */
  headroom: number;
  /** headroom as a fraction of the limit, 0..1 */
  headroomPct: number;
  /** today's realized P&L */
  todayPnl: number;
  /** $ left on the daily loss limit today (null if limit off) */
  dailyRoom: number | null;
  /** average losing trade ($, negative) over the account */
  avgLoss: number;
  /** how many average losers fit in the remaining headroom */
  losersToLock: number | null;
  /** true once the historical curve would have breached the limit */
  breached: boolean;
  equityCurve: { i: number; date: string; equity: number; drawdown: number }[];
}

export function computeRisk(trades: Trade[], cfg: RiskConfig): RiskState {
  const scoped = (cfg.startDate ? trades.filter((t) => t.date >= cfg.startDate) : trades)
    .slice()
    .sort((a, b) => a.exitTime.localeCompare(b.exitTime));

  let equity = 0;
  let peak = 0;
  let maxDrawdownSeen = 0;
  let breached = false;
  const curve: RiskState['equityCurve'] = [];
  for (let i = 0; i < scoped.length; i++) {
    equity += scoped[i].pnl;
    peak = Math.max(peak, equity);
    const ref = cfg.drawdownMode === 'trailing' ? peak : 0;
    const dd = Math.max(0, ref - equity);
    maxDrawdownSeen = Math.max(maxDrawdownSeen, dd);
    if (dd >= cfg.maxDrawdown && cfg.maxDrawdown > 0) breached = true;
    curve.push({ i: i + 1, date: scoped[i].date, equity, drawdown: dd });
  }

  const ref = cfg.drawdownMode === 'trailing' ? peak : 0;
  const currentDrawdown = Math.max(0, ref - equity);
  const headroom = Math.max(0, cfg.maxDrawdown - currentDrawdown);
  const headroomPct = cfg.maxDrawdown > 0 ? headroom / cfg.maxDrawdown : 1;

  const losses = scoped.filter((t) => t.pnl < 0);
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const losersToLock = avgLoss < 0 ? Math.floor(headroom / Math.abs(avgLoss)) : null;

  const todayISO = new Date().toISOString().slice(0, 10);
  const byDay = groupBy(scoped, (t) => t.date);
  const todayPnl = (byDay.get(todayISO) ?? []).reduce((s, t) => s + t.pnl, 0);
  const dailyRoom = cfg.dailyLossLimit > 0 ? cfg.dailyLossLimit + Math.min(0, todayPnl) : null;

  return {
    count: scoped.length,
    equity,
    peak,
    currentDrawdown,
    maxDrawdownSeen,
    headroom,
    headroomPct,
    todayPnl,
    dailyRoom,
    avgLoss,
    losersToLock,
    breached,
    equityCurve: curve,
  };
}

/**
 * Position-sizing helper: the max contracts that keep a single stop-out inside
 * a chosen fraction of remaining headroom.
 */
export function maxContracts(headroom: number, stopTicks: number, tickValue: number, riskFraction: number): number {
  const riskBudget = headroom * riskFraction;
  const perContract = stopTicks * tickValue;
  if (perContract <= 0) return 0;
  return Math.max(0, Math.floor(riskBudget / perContract));
}
