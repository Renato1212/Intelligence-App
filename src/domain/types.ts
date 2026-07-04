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

export type TradeSource = 'manual' | 'motivewave' | 'rithmic' | 'csv' | 'demo' | 'capture';

export interface LinkItem {
  label: string;
  url: string;
}

export type OrderType = 'market' | 'limit' | 'stop' | 'stop-limit' | 'unknown';

/** A single fill — the building block of a scaled trade. */
export interface Execution {
  /** ISO date-time of the fill */
  time: string;
  action: 'BUY' | 'SELL';
  qty: number;
  price: number;
  orderType: OrderType;
}

export interface Trade {
  id?: number;
  /** Stable cross-device identity for cloud sync */
  uid?: string;
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
  /** Clickable reference links (news headline, replay, chart share, ...) */
  links?: LinkItem[];
  grades: Partial<Record<CriterionId, GradeLevel>>;
  /** Individual fills (scale-ins/outs) when the source provides them */
  executions?: Execution[];
  source: TradeSource;
  account: string;
  /** Dedupe key computed at import time */
  importKey?: string;
}

export interface DailyDebrief {
  id?: number;
  /** Stable cross-device identity for cloud sync */
  uid?: string;
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
  /** Recording of the trading day / review video */
  videoUrl?: string;
  links?: LinkItem[];
}

export interface PrepEvent {
  time: string;
  name: string;
  expectations: string;
  notes: string;
}

export interface Hypothesis {
  /** e.g. "H1 Red", "H2 Blue", "H3 Green" */
  title: string;
  inPlay: string;
  lineInSand: string;
  expectation: string;
}

export interface OvernightMarket {
  /** e.g. "Gold (GC)", "Dollar / DXY", "DAX (FDAX)" */
  market: string;
  note: string;
}

/** Pre-trading-day preparation, following the AXIA day preparation template. */
export interface DayPrep {
  id?: number;
  /** Stable cross-device identity for cloud sync */
  uid?: string;
  date: string;
  /** Overnight read per market — chosen per day, any futures market can be added */
  overnightMarkets: OvernightMarket[];
  /** Moved significantly? Same movement or one market alone? */
  overnightMoved: string;
  /** Implication for your main markets */
  overnightImplication: string;
  /** News: story that has happened — how did markets react, is it important? */
  newsPricedIn: string;
  /** News: story yet to conclude — how to trade a development, where from? */
  newsDeveloping: string;
  events: PrepEvent[];
  /** Daily chart: direction change, current direction, candle, volume, ranges/ATR */
  dailyChart: string;
  /** Profile analysis (RTH): day type, control, value, open vs value, LIS, references */
  profile: string;
  /** 60m: scope of movement, structure, positioning */
  sixtyMin: string;
  /** 5m: areas of interest, how trades play out, delta read */
  fiveMin: string;
  hypotheses: Hypothesis[];
  videoUrl?: string;
  links?: LinkItem[];
}

/** Image attachment stored locally (IndexedDB), linked to a parent record. */
export interface Photo {
  id?: number;
  /** Stable cross-device identity for cloud sync */
  uid?: string;
  parentType: 'trade' | 'debrief' | 'prep';
  parentId: number;
  name: string;
  dataUrl: string;
  createdAt: string;
}

export type StrategyStatus = 'incubating' | 'testing' | 'active' | 'retired';

export interface Strategy {
  id?: number;
  /** Stable cross-device identity for cloud sync */
  uid?: string;
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
