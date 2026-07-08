/*
 * Rates & the policy cycle — the CENTRAL BANKS domain's daily context.
 *
 * The yield curve is where central-bank policy becomes a price. The Fed's own
 * H.15 release (daily Treasury constant-maturity yields) is published through
 * DBnomics keylessly and CORS-open, giving:
 *   - today's curve vs 1 month and 1 year ago (shape = the policy story)
 *   - the 2s10s spread history (inversion / re-steepening = the cycle clock)
 *   - front-end vs policy read (where the market prices the Fed vs the curve)
 */
import { parseDbnomics, type PrintPoint } from './econData';

export interface TenorSpec {
  id: string;
  label: string;
  years: number;
  /** DBnomics FED/H15 series candidates, tried in order */
  series: string[];
}

export const TENORS: TenorSpec[] = [
  { id: 'y3m', label: '3m', years: 0.25, series: ['RIFLGFCM03_N.B', 'RIFLGFCM03_N.D'] },
  { id: 'y2', label: '2y', years: 2, series: ['RIFLGFCY02_N.B', 'RIFLGFCY02_N.D'] },
  { id: 'y5', label: '5y', years: 5, series: ['RIFLGFCY05_N.B', 'RIFLGFCY05_N.D'] },
  { id: 'y10', label: '10y', years: 10, series: ['RIFLGFCY10_N.B', 'RIFLGFCY10_N.D'] },
  { id: 'y30', label: '30y', years: 30, series: ['RIFLGFCY30_N.B', 'RIFLGFCY30_N.D'] },
];

export interface RatesSnapshot {
  fetchedAt: string;
  /** per tenor: daily history ascending (period YYYY-MM-DD, value %) */
  tenors: Record<string, PrintPoint[]>;
  stale?: boolean;
}

export interface CurvePoint {
  label: string;
  years: number;
  now: number;
  m1: number | null;
  y1: number | null;
}

export interface RatesRead {
  asOf: string;
  curve: CurvePoint[];
  /** 2s10s in bp: daily history + latest + changes */
  spread: PrintPoint[];
  spreadNow: number;
  spreadM1: number | null;
  inverted: boolean;
  /** trailing days the curve has been inverted (0 if not) */
  invertedDays: number;
  y10Now: number;
  y10M1: number | null;
}

/** Value on/most recently before a date `back` days ago. */
function valueBack(points: PrintPoint[], back: number): number | null {
  if (!points.length) return null;
  const target = new Date(new Date(points[points.length - 1].period).getTime() - back * 86400000)
    .toISOString()
    .slice(0, 10);
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].period <= target) return points[i].value;
  }
  return null;
}

/** Pure: turn per-tenor histories into the curve/spread read. */
export function analyzeRates(snap: RatesSnapshot): RatesRead | null {
  const t2 = snap.tenors.y2 ?? [];
  const t10 = snap.tenors.y10 ?? [];
  if (t2.length < 30 || t10.length < 30) return null;

  const by2 = new Map(t2.map((p) => [p.period, p.value]));
  const spread: PrintPoint[] = [];
  for (const p of t10) {
    const v2 = by2.get(p.period);
    if (v2 != null) spread.push({ period: p.period, value: Math.round((p.value - v2) * 100) });
  }
  if (spread.length < 30) return null;

  const spreadNow = spread[spread.length - 1].value;
  let invertedDays = 0;
  for (let i = spread.length - 1; i >= 0 && spread[i].value < 0; i--) invertedDays++;

  const curve: CurvePoint[] = [];
  for (const spec of TENORS) {
    const pts = snap.tenors[spec.id] ?? [];
    if (!pts.length) continue;
    curve.push({
      label: spec.label,
      years: spec.years,
      now: pts[pts.length - 1].value,
      m1: valueBack(pts, 30),
      y1: valueBack(pts, 365),
    });
  }
  if (curve.length < 3) return null;

  return {
    asOf: t10[t10.length - 1].period,
    curve,
    spread,
    spreadNow,
    spreadM1: valueBack(spread, 30),
    inverted: spreadNow < 0,
    invertedDays,
    y10Now: t10[t10.length - 1].value,
    y10M1: valueBack(t10, 30),
  };
}

/** One-line policy-cycle read from the curve shape and its motion. */
export function ratesInsight(r: RatesRead): string {
  const d = r.spreadM1 != null ? r.spreadNow - r.spreadM1 : 0;
  const motion = Math.abs(d) < 5 ? 'little changed' : d > 0 ? `steepening (+${d}bp on the month)` : `flattening (${d}bp on the month)`;
  if (r.inverted) {
    return `2s10s is inverted at ${r.spreadNow}bp (${r.invertedDays} sessions) and ${motion}. Inversion = policy restrictive vs the cycle; the dangerous move for risk is the RE-steepening, which historically arrives with cuts — watch the front end lead.`;
  }
  if (r.spreadNow < 40) {
    return `2s10s is flat at +${r.spreadNow}bp and ${motion}. The curve is undecided — data prints (CPI, NFP) will keep whipping the long end; trade the reaction, not the level.`;
  }
  return `2s10s is positively sloped at +${r.spreadNow}bp and ${motion}. A normal curve = the market is pricing a full cycle; bond-driven equity shocks come from the LONG end here — watch 10y auctions and supply.`;
}

/* ------------------------------- fetching ------------------------------- */

const API = 'https://api.db.nomics.world/v22/series/FED/H15';
const CACHE_KEY = 'ei-rates-cache-v1';
const FRESH_MS = 6 * 3600 * 1000;

export interface RatesLoad {
  snapshot: RatesSnapshot | null;
  error: string | null;
}

function readCache(): RatesSnapshot | null {
  try {
    const s = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as RatesSnapshot | null;
    return s && s.tenors ? s : null;
  } catch {
    return null;
  }
}

export async function loadRates(force = false): Promise<RatesLoad> {
  const cached = readCache();
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < FRESH_MS) {
    return { snapshot: cached, error: null };
  }
  const tenors: Record<string, PrintPoint[]> = {};
  let lastErr: string | null = null;
  await Promise.all(
    TENORS.map(async (spec) => {
      for (const code of spec.series) {
        try {
          const res = await fetch(`${API}/${code}?observations=1&format=json`, { headers: { Accept: 'application/json' } });
          if (!res.ok) {
            lastErr = `Rates service returned ${res.status}.`;
            continue;
          }
          const pts = parseDbnomics(await res.json(), 'day');
          if (pts.length >= 30) {
            tenors[spec.id] = pts.slice(Math.max(0, pts.length - 800)); // ~3 years of sessions
            return;
          }
        } catch {
          lastErr = 'Could not reach the rates service (network).';
        }
      }
    }),
  );
  if (Object.keys(tenors).length >= 3) {
    const snap: RatesSnapshot = { fetchedAt: new Date().toISOString(), tenors };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(snap));
    } catch {
      // best effort
    }
    return { snapshot: snap, error: null };
  }
  if (cached) return { snapshot: { ...cached, stale: true }, error: lastErr ?? 'Rates refresh failed.' };
  return { snapshot: null, error: lastErr ?? 'Rates refresh failed.' };
}
