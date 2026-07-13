/*
 * Serverless FMP relay — connect FMP ONCE, server-side, for every device.
 *
 * The app's FMP-powered features previously required pasting an API key into
 * each browser. With this function the key can instead live in ONE place: a
 * Vercel environment variable (FMP_API_KEY) on the deployment. The browser
 * calls /api/fmp?p=<path> and the function forwards to
 * financialmodelingprep.com with the server key appended — no key in the
 * browser, no localStorage, works on every device immediately.
 *
 * If the env var is not set the function answers 501 quickly so the client
 * can fall through to its other sources (browser key → keyless calendar feed).
 */

const PATH_OK = /^(api\/v[34]|stable)\/[A-Za-z0-9_\-/.^]+(\?[A-Za-z0-9_\-=&%.,:]*)?$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = process.env.FMP_API_KEY;
  if (!key) {
    res.status(501).json({ error: 'no-server-key', hint: 'Set FMP_API_KEY in the deployment environment (Vercel → Settings → Environment Variables) to activate FMP for every device with no browser setup.' });
    return;
  }
  const p = String(req.query?.p || '');
  if (!PATH_OK.test(p) || p.toLowerCase().includes('apikey')) {
    res.status(400).json({ error: 'p must be an FMP path like api/v3/quote/SPY (no apikey).' });
    return;
  }
  const url = `https://financialmodelingprep.com/${p}${p.includes('?') ? '&' : '?'}apikey=${key}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await r.text();
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.status(r.status).setHeader('Content-Type', 'application/json').send(body);
  } catch (e) {
    res.status(502).json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'unknown'}` });
  }
}
