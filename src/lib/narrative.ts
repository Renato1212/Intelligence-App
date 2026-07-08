/*
 * Narrative monitor — the UNSCHEDULED NEWS domain, measured.
 *
 * Geo-macro headlines can't be scheduled, but the ATTENTION they command can
 * be measured: the GDELT project indexes global news every 15 minutes and
 * exposes, free and keyless, the share of world coverage matching any query.
 * A narrative that is surging (tariffs, war risk, banking stress) is exactly
 * the AXIA "News" edge — this module tracks the volume curves per theme,
 * flags surges vs each theme's own baseline, and pulls the latest headlines
 * so the trader sees WHAT is driving the spike.
 */

export interface NarrativeTheme {
  id: string;
  label: string;
  /** GDELT DOC 2.0 query */
  query: string;
  affects: string[];
  why: string;
}

export const THEMES: NarrativeTheme[] = [
  {
    id: 'fed', label: 'Fed & central banks', query: '"federal reserve" OR "jerome powell" OR FOMC OR "rate cut" OR "rate hike"',
    affects: ['ES', 'NQ', 'ZN', '6E'],
    why: 'Policy repricing is the fastest lever on every market — attention spikes around speakers and leaks, not just meetings.',
  },
  {
    id: 'tariffs', label: 'Tariffs & trade war', query: 'tariffs OR "trade war" OR "export controls"',
    affects: ['ES', 'NQ', '6E', 'HG'],
    why: 'Trade headlines hit equities and FX in minutes and often land OUTSIDE US hours — the classic overnight gap driver.',
  },
  {
    id: 'war', label: 'War & geopolitics', query: 'missile OR airstrike OR "military escalation" OR invasion',
    affects: ['CL', 'GC', 'ES', 'ZN'],
    why: 'Escalation buys crude, gold and bonds before details are known; de-escalation unwinds it just as fast.',
  },
  {
    id: 'energy', label: 'OPEC & energy', query: 'OPEC OR "oil supply" OR "production cut" OR "oil sanctions"',
    affects: ['CL', 'RB', 'HO'],
    why: 'Supply policy is crude’s central bank — the meetings leak for days before the statement.',
  },
  {
    id: 'banking', label: 'Banking & credit stress', query: '"bank failure" OR "credit crunch" OR "deposit flight" OR "banking crisis"',
    affects: ['ES', 'ZN', 'GC'],
    why: 'Credit stress narratives flip the regime: bad news becomes bond-bullish and equity-toxic within a session.',
  },
  {
    id: 'inflation', label: 'Inflation narrative', query: '"sticky inflation" OR "price pressures" OR disinflation OR stagflation',
    affects: ['ZN', 'ES', 'GC'],
    why: 'The story the market tells about inflation between prints decides how the next CPI is traded.',
  },
];

export interface VolPoint {
  /** YYYY-MM-DD (daily buckets) */
  date: string;
  value: number;
}

export interface ThemeSeries {
  theme: NarrativeTheme;
  points: VolPoint[]; // ascending, ~ last 14 days
  latest: number;
  baseline: number;
  /** latest vs the theme's own trailing mean, in σ */
  z: number | null;
  surging: boolean;
}

export interface Headline {
  title: string;
  url: string;
  domain: string;
  seendate: string;
}

/** Parse GDELT timelinevol JSON into daily buckets (averages intraday steps). */
export function parseTimeline(json: unknown): VolPoint[] {
  const timeline = (json as { timeline?: { data?: { date?: string; value?: number }[] }[] })?.timeline;
  const data = Array.isArray(timeline) && timeline[0]?.data ? timeline[0].data : [];
  const byDay = new Map<string, { sum: number; n: number }>();
  for (const d of data) {
    const raw = String(d.date ?? '');
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) continue;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    const v = Number(d.value);
    if (!isFinite(v)) continue;
    const cur = byDay.get(day) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n++;
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .map(([date, { sum, n }]) => ({ date, value: sum / n }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Pure: surge detection vs the theme's own baseline. */
export function analyzeTheme(theme: NarrativeTheme, points: VolPoint[]): ThemeSeries {
  const latest = points.length ? points[points.length - 1].value : 0;
  const base = points.slice(0, Math.max(0, points.length - 1)).map((p) => p.value);
  const mean = base.length ? base.reduce((s, x) => s + x, 0) / base.length : 0;
  const sd = base.length >= 5 ? Math.sqrt(base.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (base.length - 1)) : null;
  const z = sd != null && sd > 0 ? (latest - mean) / sd : null;
  return { theme, points, latest, baseline: mean, z, surging: z != null && z >= 2 };
}

export function parseHeadlines(json: unknown): Headline[] {
  const arts = (json as { articles?: Record<string, unknown>[] })?.articles;
  if (!Array.isArray(arts)) return [];
  const seen = new Set<string>();
  const out: Headline[] = [];
  for (const a of arts) {
    const title = String(a.title ?? '').trim();
    const url = String(a.url ?? '');
    if (!title || !url || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({ title, url, domain: String(a.domain ?? ''), seendate: String(a.seendate ?? '') });
    if (out.length >= 8) break;
  }
  return out;
}

/* ------------------------------- fetching ------------------------------- */

const API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const CACHE_KEY = 'ei-narrative-cache-v1';
const FRESH_MS = 20 * 60 * 1000; // GDELT updates ~15-minutely

interface NarrativeCache {
  fetchedAt: string;
  series: { themeId: string; points: VolPoint[] }[];
}

export interface NarrativeLoad {
  series: ThemeSeries[];
  error: string | null;
  fetchedAt: string | null;
  stale?: boolean;
}

function fromCache(c: NarrativeCache, stale: boolean): NarrativeLoad {
  const series = c.series
    .map((s) => {
      const theme = THEMES.find((t) => t.id === s.themeId);
      return theme ? analyzeTheme(theme, s.points) : null;
    })
    .filter((s): s is ThemeSeries => !!s);
  return { series, error: null, fetchedAt: c.fetchedAt, stale };
}

export async function loadNarrative(force = false): Promise<NarrativeLoad> {
  let cached: NarrativeCache | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as NarrativeCache | null;
  } catch {
    cached = null;
  }
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < FRESH_MS) {
    return fromCache(cached, false);
  }

  const results: { themeId: string; points: VolPoint[] }[] = [];
  let lastErr: string | null = null;
  await Promise.all(
    THEMES.map(async (theme) => {
      const url = `${API}?query=${encodeURIComponent(theme.query)}&mode=timelinevol&timespan=14d&format=json`;
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          lastErr = `News service returned ${res.status}.`;
          return;
        }
        const points = parseTimeline(await res.json());
        if (points.length >= 5) results.push({ themeId: theme.id, points });
      } catch {
        lastErr = 'Could not reach the news service (network).';
      }
    }),
  );

  if (results.length >= 3) {
    const cache: NarrativeCache = { fetchedAt: new Date().toISOString(), series: results };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // best effort
    }
    return fromCache(cache, false);
  }
  if (cached) return { ...fromCache(cached, true), error: lastErr ?? 'News refresh failed.' };
  return { series: [], error: lastErr ?? 'News refresh failed.', fetchedAt: null };
}

/** Latest headlines for one theme (not cached — always fresh on demand). */
export async function loadHeadlines(theme: NarrativeTheme): Promise<{ headlines: Headline[]; error: string | null }> {
  const url = `${API}?query=${encodeURIComponent(theme.query)}&mode=artlist&maxrecords=20&timespan=2d&sort=datedesc&format=json`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { headlines: [], error: `News service returned ${res.status}.` };
    return { headlines: parseHeadlines(await res.json()), error: null };
  } catch {
    return { headlines: [], error: 'Could not reach the news service (network).' };
  }
}
