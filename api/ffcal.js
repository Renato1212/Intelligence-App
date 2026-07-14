/*
 * Keyless live economic-calendar feed — the same weekly JSON that powers the
 * popular free calendars (published by ForexFactory's data host,
 * nfs.faireconomy.media). No key, no account. It carries every scheduled
 * event for the week with impact, forecast and previous (and, when the host
 * includes it, the actual as released).
 *
 * The host is not CORS-open, so this function relays it server-side — the same
 * proxy pattern as /api/bls and /api/cboe. Short edge cache keeps release-day
 * polling fast while staying friendly to the upstream host.
 */

const FEEDS = {
  this: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  next: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const week = String(req.query?.week || 'this');
  const url = FEEDS[week];
  if (!url) {
    res.status(400).json({ error: 'week must be "this" or "next".' });
    return;
  }
  // The host sits behind bot protection that rejects non-browser user agents
  // from datacenter IPs (the 502s on the health board). Present as a browser
  // and retry once; stale-if-error lets the edge keep serving the last good
  // copy through upstream hiccups.
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) {
        lastErr = `Feed returned ${r.status}.`;
        continue;
      }
      const json = await r.json();
      if (!Array.isArray(json)) {
        lastErr = 'Unexpected feed payload.';
        continue;
      }
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=3600, stale-if-error=86400');
      res.status(200).json(json);
      return;
    } catch (e) {
      lastErr = `Upstream fetch failed: ${e instanceof Error ? e.message : 'timeout'}`;
    }
  }
  res.status(502).json({ error: lastErr });
}
