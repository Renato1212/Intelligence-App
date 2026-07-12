/*
 * Release detail — the full breakdown behind a headline print, the way a
 * trader actually needs to read it: the real index level, the month-over-month
 * AND year-over-year for the headline and every major subcomponent, side by
 * side, with the cross-component read that tells you what the number MEANS
 * (is the disinflation in goods or services? is shelter still the sticky
 * driver?). This is the layer economic-calendar sites don't give you.
 *
 * All series come from BLS through our own /api/bls proxy (keyless, current).
 * The math is pure and unit-tested; one proxy call fetches the whole family.
 */
import { parseBlsProxy } from './econData';

export interface Component {
  /** BLS SA index series id */
  series: string;
  label: string;
  /** approx CPI relative importance (% of basket), for context */
  weight?: number;
  role: 'headline' | 'core' | 'sub';
  note?: string;
}

export interface ReleaseDetailSpec {
  short: string;
  title: string;
  unitNote: string;
  components: Component[];
}

/* The CPI family — headline, core, and the subcomponents that drive them. */
export const RELEASE_DETAILS: Record<string, ReleaseDetailSpec> = {
  CPI: {
    short: 'CPI',
    title: 'CPI — the full basket',
    unitNote: 'SA index; MoM = 1-month change, YoY = 12-month change of the index.',
    components: [
      { series: 'CUSR0000SA0', label: 'All items (headline)', weight: 100, role: 'headline', note: 'The number that hits the tape first — but energy noise lives here.' },
      { series: 'CUSR0000SA0L1E', label: 'Core (ex food & energy)', weight: 79, role: 'core', note: 'What the Fed and the bond market actually trade — the signal, not the noise.' },
      { series: 'CUSR0000SAH1', label: 'Shelter', weight: 36, role: 'sub', note: 'The stickiest, heaviest core component. Lags real-time rents by ~12 months, so its turn is slow but decisive.' },
      { series: 'CUSR0000SASLE', label: 'Core services (ex energy svcs)', weight: 57, role: 'sub', note: '"Supercore" territory — wage-driven, the last mile of inflation. The Fed watches this most.' },
      { series: 'CUSR0000SACL1E', label: 'Core goods (ex food & energy)', weight: 19, role: 'sub', note: 'Supply-chain sensitive. Was the disinflation engine; a turn higher here is an early re-acceleration warning.' },
      { series: 'CUSR0000SAF1', label: 'Food', weight: 13, role: 'sub', note: 'Politically loud, but the Fed looks through it. Grocery vs restaurant split matters for the consumer read.' },
      { series: 'CUSR0000SA0E', label: 'Energy', weight: 7, role: 'sub', note: 'The swing factor behind headline surprises — cross-check it against crude (Options & Vol / Macro Map).' },
    ],
  },
};

/* --------------------------------- math ---------------------------------- */

export interface ComponentRead {
  comp: Component;
  period: string | null;
  level: number | null;
  momPct: number | null;
  yoyPct: number | null;
  /** 3-month annualized run rate — the momentum the market actually reprices on */
  annualized3m: number | null;
}

function pctChange(points: { period: string; value: number }[], lag: number): number | null {
  if (points.length <= lag) return null;
  const last = points[points.length - 1].value;
  const base = points[points.length - 1 - lag].value;
  return base ? (last / base - 1) * 100 : null;
}

export function readComponent(comp: Component, points: { period: string; value: number }[]): ComponentRead {
  const last = points[points.length - 1] ?? null;
  const mom = pctChange(points, 1);
  const ann3 = points.length > 3 && points[points.length - 4].value
    ? (Math.pow(points[points.length - 1].value / points[points.length - 4].value, 4) - 1) * 100
    : null;
  return {
    comp,
    period: last?.period ?? null,
    level: last?.value ?? null,
    momPct: mom,
    yoyPct: pctChange(points, 12),
    annualized3m: ann3,
  };
}

/** The cross-component read: what the breakdown MEANS for a trader. */
export function crossRead(reads: ComponentRead[]): string {
  const by = (id: string) => reads.find((r) => r.comp.series === id);
  const parts: string[] = [];

  const svc = by('CUSR0000SASLE');
  const goods = by('CUSR0000SACL1E');
  if (svc?.yoyPct != null && goods?.yoyPct != null) {
    if (goods.yoyPct < 0.5 && svc.yoyPct > 3) {
      parts.push(
        `The split that matters: core SERVICES still hot at ${svc.yoyPct.toFixed(1)}% y/y while core GOODS are flat/deflating at ${goods.yoyPct.toFixed(1)}% — classic late-cycle disinflation carried entirely by goods. The services stickiness is what keeps the Fed cautious; a goods turn higher would remove the offset and reprice cuts hard`,
      );
    } else {
      parts.push(`Core services ${svc.yoyPct.toFixed(1)}% vs core goods ${goods.yoyPct.toFixed(1)}% y/y — track the gap: goods re-accelerating is the early re-inflation tell`);
    }
  }

  const shelter = by('CUSR0000SAH1');
  if (shelter?.momPct != null && shelter.annualized3m != null) {
    parts.push(
      `Shelter (36% of the basket) is running ${shelter.annualized3m.toFixed(1)}% annualized on the last 3 months — ${shelter.annualized3m < 3.5 ? 'finally cooling toward the pre-Covid ~3.3%, the biggest disinflation lever left' : 'still sticky above trend, the main thing keeping core elevated'}`,
    );
  }

  const head = by('CUSR0000SA0');
  const core = by('CUSR0000SA0L1E');
  if (head?.momPct != null && core?.momPct != null) {
    const gap = head.momPct - core.momPct;
    if (Math.abs(gap) >= 0.1) {
      parts.push(
        `Headline ${head.momPct >= 0 ? '+' : ''}${head.momPct.toFixed(2)}% vs core ${core.momPct >= 0 ? '+' : ''}${core.momPct.toFixed(2)}% m/m — ${gap > 0 ? 'energy/food ADDED to the print (headline hotter than core); expect the first algo spike to fade toward the core read' : 'energy/food SUBTRACTED; the underlying core is firmer than the headline suggests — the more hawkish read for bonds'}`,
      );
    }
  }

  return parts.join('. ') + (parts.length ? '.' : '');
}

/* -------------------------------- loading -------------------------------- */

export interface ReleaseDetailLoad {
  reads: ComponentRead[];
  cross: string;
  fetchedAt: string | null;
  error: string | null;
}

const CACHE_KEY = 'ei-release-detail-v1';
const FRESH_MS = 20 * 3600 * 1000;

/** Fetch a whole release family in one proxy call, compute per-component reads. */
export async function loadReleaseDetail(short: string, force = false): Promise<ReleaseDetailLoad> {
  const spec = RELEASE_DETAILS[short];
  if (!spec) return { reads: [], cross: '', fetchedAt: null, error: 'No breakdown configured for this release.' };

  const cacheKey = `${CACHE_KEY}:${short}`;
  if (!force) {
    try {
      const hit = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as ReleaseDetailLoad | null;
      if (hit && hit.fetchedAt && Date.now() - new Date(hit.fetchedAt).getTime() < FRESH_MS && hit.reads.length) return hit;
    } catch {
      // ignore
    }
  }

  const ids = spec.components.map((c) => c.series).join(',');
  let json: unknown;
  try {
    const res = await fetch(`/api/bls?series=${encodeURIComponent(ids)}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    json = await res.json();
  } catch (e) {
    return { reads: [], cross: '', fetchedAt: null, error: `Live breakdown needs the BLS proxy (deployed app). ${e instanceof Error ? e.message : ''}`.trim() };
  }

  const reads = spec.components.map((c) => readComponent(c, parseBlsProxy(json, c.series)));
  if (!reads.some((r) => r.level != null)) {
    return { reads: [], cross: '', fetchedAt: null, error: 'The BLS proxy returned no data for this family yet — try Refresh in a moment.' };
  }
  const out: ReleaseDetailLoad = { reads, cross: crossRead(reads), fetchedAt: new Date().toISOString(), error: null };
  try {
    localStorage.setItem(cacheKey, JSON.stringify(out));
  } catch {
    // best effort
  }
  return out;
}
