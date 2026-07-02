/**
 * Point values (USD per full point of price movement, per contract) for
 * common futures. Used to compute P&L when importing raw fills (Rithmic)
 * that carry prices but no realized P&L column.
 */
export const POINT_VALUES: Record<string, number> = {
  // Equity index
  ES: 50, MES: 5, NQ: 20, MNQ: 2, RTY: 50, M2K: 5, YM: 5, MYM: 0.5, EMD: 100,
  // Energy
  CL: 1000, MCL: 100, QM: 500, NG: 10000, QG: 2500, RB: 42000, HO: 42000,
  // Metals
  GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000, MHG: 2500, PL: 50,
  // Rates
  ZT: 2000, ZF: 1000, ZN: 1000, TN: 1000, ZB: 1000, UB: 1000, SR3: 2500,
  // FX
  '6E': 125000, '6B': 62500, '6J': 12500000, '6A': 100000, '6C': 100000, '6S': 125000, '6N': 100000,
  M6E: 12500, M6A: 10000, M6B: 6250,
  // Ags
  ZC: 50, ZS: 50, ZW: 50, ZL: 600, ZM: 100, LE: 400, HE: 400,
  // Eurex
  FDAX: 25, FDXM: 5, FDXS: 1, FESX: 10, FGBL: 1000, FGBM: 1000, FGBS: 1000,
};

const MONTH_CODES = 'FGHJKMNQUVXZ';

/**
 * Reduce a full contract symbol (ESZ5, MESM26, CLQ2025, 6EU5) to its root
 * so it can be matched against POINT_VALUES and grouped across rolls.
 */
export function symbolRoot(symbol: string): string {
  let s = symbol.trim().toUpperCase();
  // strip exchange suffix/prefix noise like ".CME" or "CME:"
  s = s.replace(/\.[A-Z]+$/, '').replace(/^[A-Z]+:/, '');
  // strip trailing year digits then a month code: ESZ5, ESZ25, CLQ2025
  const m = s.match(/^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,4})$/);
  if (m && POINT_VALUES[m[1]] !== undefined) return m[1];
  if (m && MONTH_CODES.includes(m[2]) && m[1].length >= 1) return m[1];
  return s;
}

export function pointValue(symbol: string): number {
  return POINT_VALUES[symbolRoot(symbol)] ?? 1;
}
