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
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'edge-intelligence/1.0 (trading journal)' } });
    if (!r.ok) {
      res.status(502).json({ error: `Feed returned ${r.status}.` });
      return;
    }
    const json = await r.json();
    if (!Array.isArray(json)) {
      res.status(502).json({ error: 'Unexpected feed payload.' });
      return;
    }
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json(json);
  } catch (e) {
    res.status(502).json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'unknown'}` });
  }
}
