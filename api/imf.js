/*
 * Serverless relay for the IMF DataMapper API (WEO forecasts, commodities).
 *
 * The DataMapper endpoint is keyless but not reliably CORS-open (unreachable
 * from mobile browsers on the health board). Same relay pattern as /api/bls.
 * The path is whitelisted to the DataMapper shape: indicator codes and
 * country/region lists separated by slashes, with optional ?periods=.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400, stale-if-error=604800');

  const path = String(req.query?.path || '');
  if (!/^[A-Za-z0-9_.\-/,+]{2,200}$/.test(path) || path.includes('..')) {
    res.status(400).json({ error: 'Pass ?path=INDICATOR/COUNTRIES, e.g. path=NGDP_RPCH/USA' });
    return;
  }
  const periods = String(req.query?.periods || '');
  const qs = /^[0-9,]{0,60}$/.test(periods) && periods ? `?periods=${periods}` : '';

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`https://www.imf.org/external/datamapper/api/v1/${path}${qs}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; edge-intelligence/1.0)' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      res.status(502).json({ error: `IMF responded ${r.status}.` });
      return;
    }
    res.status(200).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'timeout'}` });
  }
}
