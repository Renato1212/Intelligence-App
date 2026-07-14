/*
 * Serverless relay for the GDELT DOC 2.0 API (global news attention).
 *
 * GDELT is keyless but its CORS behavior is inconsistent across networks and
 * devices (the health board showed it unreachable from mobile). Same pattern
 * as /api/bls: fetch server-side on the trader's own deployment, relay JSON.
 * Only the two modes the app uses are allowed through.
 */
const MODES = new Set(['timelinevol', 'artlist']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600, stale-if-error=86400');

  const query = String(req.query?.query || '').slice(0, 300);
  const mode = String(req.query?.mode || 'timelinevol');
  const timespan = String(req.query?.timespan || '14d');
  const maxrecords = Math.min(50, Math.max(1, Number(req.query?.maxrecords) || 12));
  if (!query.trim() || !MODES.has(mode) || !/^\d{1,3}[dwh]$/.test(timespan)) {
    res.status(400).json({ error: 'Pass ?query=…&mode=timelinevol|artlist&timespan=14d' });
    return;
  }

  const upstream =
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}` +
    `&mode=${mode}&timespan=${timespan}&format=json&sort=hybridrel&maxrecords=${maxrecords}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(upstream, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; edge-intelligence/1.0)' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      res.status(502).json({ error: `GDELT responded ${r.status}.` });
      return;
    }
    // GDELT occasionally returns text/html error pages with 200 — validate JSON
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      res.status(502).json({ error: 'GDELT returned a non-JSON payload.' });
      return;
    }
    res.status(200).json(json);
  } catch (e) {
    res.status(502).json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'timeout'}` });
  }
}
