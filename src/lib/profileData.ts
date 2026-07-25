/*
 * profileData.ts — fetch the bars a multi-session Market Profile chart needs.
 *
 * A single profile can size its own price bucket from its own range. Profiles
 * drawn SIDE BY SIDE cannot: they have to share one grid or the same price
 * lands at different heights in adjacent columns. This loader therefore pulls
 * the whole window first, derives one bucket from the combined range, and only
 * then builds each session on that shared grid.
 *
 * Source order is the same everywhere in the app: FMP when the plan carries
 * intraday, then the keyless relay — so the chart works with no key at all.
 */
import { intradayBarUrls, parseFmpIntraday } from './market';
import { buildProfile, groupSessions, sharedBucket, type IntradayBar, type SessionProfile } from './marketProfile';

export interface SessionProfileLoad {
  /** newest session first */
  profiles: SessionProfile[];
  bars: IntradayBar[];
  error: string | null;
}

const NO_DATA =
  'No intraday history came back. Profiles are built from 30-minute bars: FMP serves them on plans that include intraday, and the keyless relay on your deployment covers the rest — check Settings → Data connections.';

export async function loadSessionProfiles(
  symbol: string,
  opts: { maxSessions?: number; range?: string; targetRows?: number } = {},
): Promise<SessionProfileLoad> {
  const maxSessions = opts.maxSessions ?? 5;
  for (const url of intradayBarUrls(symbol, '30min', { range: opts.range ?? '1mo' })) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      continue; // a 200 carrying HTML is a failed candidate, not a crash
    }
    const bars = parseFmpIntraday(json);
    if (bars.length < 10) continue;

    // newest sessions first, capped, then one bucket across all of them
    const days = [...groupSessions(bars).entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, maxSessions);
    const window = days.flatMap(([, list]) => list);
    const bucket = sharedBucket(window, opts.targetRows ?? 60);
    const profiles = days
      .map(([date, list]) => buildProfile(list, { date, symbol, bucket }))
      .filter((p): p is SessionProfile => !!p);
    if (!profiles.length) continue;
    return { profiles, bars: window, error: null };
  }
  return { profiles: [], bars: [], error: NO_DATA };
}
