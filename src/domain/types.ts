export type Side = 'LONG' | 'SHORT';

export type DomainId =
  | 'central-banks'
  | 'economic-data'
  | 'news'
  | 'technicals'
  | 'flow';

export type GradeLevel = 'below' | 'at' | 'above';

export type CriterionId =
  | 'trigger'
  | 'sizing'
  | 'exit'
  | 'articulation'
  | 'review';

export type TradeSource = 'manual' | 'motivewave' | 'rithmic' | 'csv' | 'demo';

export interface Trade {
  id?: number;
  /** Trading day, YYYY-MM-DD */
  date: string;
  instrument: string;
  side: Side;
  /** ISO date-time strings */
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  /** Net P&L in account currency */
  pnl: number;
  fees: number;
  /** Dollar risk planned at entry (distance to stop x size x point value) */
  plannedRisk: number | null;
  /** Level 1 tag — the edge domain */
  domain: DomainId | null;
  /** Level 2 tag — category inside the domain */
  category: string | null;
  /** Level 3 tags — free-form refinements (hawkish, fade, pre-close, ...) */
  tags: string[];
  strategyId: number | null;
  /** What you were expecting and what happened */
  description: string;
  learned: string;
  applyNext: string;
  videoUrl: string;
  grades: Partial<Record<CriterionId, GradeLevel>>;
  source: TradeSource;
  account: string;
  /** Dedupe key computed at import time */
  importKey?: string;
}

export interface DailyDebrief {
  id?: number;
  date: string;
  /** What happened, what you did, how you felt */
  narrative: string;
  /** Compare with preparation and hypothesis */
  comparison: string;
  learned: string;
  applyNext: string;
  /** 1-5 self scores */
  prepScore: number | null;
  executionScore: number | null;
}

export type StrategyStatus = 'incubating' | 'testing' | 'active' | 'retired';

export interface Strategy {
  id?: number;
  name: string;
  domain: DomainId | null;
  category: string | null;
  status: StrategyStatus;
  /** The market hypothesis behind the edge */
  hypothesis: string;
  /** Entry / exit / sizing rules */
  rules: string;
  createdAt: string;
}

export interface TradeFilter {
  from?: string;
  to?: string;
  domain?: DomainId | 'untagged';
  instrument?: string;
  strategyId?: number;
  search?: string;
}
