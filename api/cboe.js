/*
 * Serverless proxy for CBOE's delayed-quotes CDN.
 *
 * The CDN is public and keyless but not CORS-enabled, so the browser cannot
 * call it directly — every fetch throws and the Options & Vol page comes up
 * empty ("Could not reach the CBOE data CDN"). This function fetches the CDN
 * server-side (no CORS restriction) and relays the result. Quotes pass through
 * (small); the full option chain is slimmed to strikes near spot to stay under
 * the serverless response-size limit. Edge-cached so repeat visits are cheap
 * and CBOE sees minimal traffic.
 *
 *   /api/cboe?kind=quote&symbol=_VIX
 *   /api/cboe?kind=chain&symbol=_SPX
 */
import { slimChain, okSymbol } from './_cboe.js';

const CDN = 'https://cdn.cboe.com/api/global/delayed_quotes';
const UA = { 'User-Agent': 'edge-intelligence/1.0 (trading journal)', Accept: 'application/json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const kind = String(req.query?.kind || '');
  const symbol = String(req.query?.symbol || '');
  if (!okSymbol(symbol)) {
    res.status(400).json({ error: 'symbol must be a 1-6 char index/VIX root, e.g. _SPX or _VIX.' });
    return;
  }

  try {
    if (kind === 'quote') {
      const r = await fetch(`${CDN}/quotes/${encodeURIComponent(symbol)}.json`, { headers: UA });
      if (!r.ok) {
        res.status(502).json({ error: `CBOE returned ${r.status} for ${symbol}.` });
        return;
      }
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.status(200).json(await r.json());
      return;
    }
    if (kind === 'chain') {
      const r = await fetch(`${CDN}/options/${encodeURIComponent(symbol)}.json`, { headers: UA });
      if (!r.ok) {
        res.status(502).json({ error: `CBOE returned ${r.status} for the ${symbol} chain.` });
        return;
      }
      const slim = slimChain(await r.json(), 0.15);
      if (!slim || !slim.data.options.length) {
        res.status(502).json({ error: `Unexpected or empty CBOE chain payload for ${symbol}.` });
        return;
      }
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
      res.status(200).json(slim);
      return;
    }
    res.status(400).json({ error: 'kind must be "quote" or "chain".' });
  } catch (e) {
    res.status(502).json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'unknown'}` });
  }
}
