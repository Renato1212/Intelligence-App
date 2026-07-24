/*
 * Serverless proxy for FRED's keyless CSV endpoint (fredgraph.csv).
 *
 * Why this exists: PCE (the Fed's actual inflation target measure) and retail
 * sales are BEA/Census releases — the BLS API does not carry them, and the
 * only free keyless source with full official history is FRED. fredgraph.csv
 * needs no key but sends no CORS headers, so this function (on the trader's
 * own deployment) fetches server-side and relays JSON in the same shape as
 * /api/bls, giving current + deep official PCE / retail history with zero
 * setup. Edge-cached 24h — these are monthly series.
 */
import { cleanFredParam, parseFredCsv } from './_fred.js';
import { fetchUpstream } from './_upstream.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');

  const ids = cleanFredParam(req.query?.id);
  if (!ids.length) {
    res.status(400).json({ error: 'Pass ?id=PCEPILFE,RSAFS (comma-separated FRED series ids).' });
    return;
  }

  try {
    // cosd bounds the CSV to ~10 years — without it FRED streams the full
    // 1959→now history, which is what made the function slow enough to look
    // "unreachable" on the health board. 8s abort keeps the worst case honest.
    const cosd = new Date(Date.now() - 10 * 365.25 * 86400000).toISOString().slice(0, 10);
    // fredgraph 403s a bot-style agent from datacenter IPs — browser identity + retry
    const r = await fetchUpstream(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${ids.join(',')}&cosd=${cosd}`, {
      accept: 'text/csv',
      timeoutMs: 7000,
    });
    if (!r.ok) {
      res.status(502).json({ error: `FRED responded HTTP ${r.status}`, series: {} });
      return;
    }
    const parsed = parseFredCsv(await r.text());
    const anyData = Object.values(parsed).some((a) => a.length);
    res.status(anyData ? 200 : 502).json({
      series: parsed,
      source: 'fredgraph',
      fetchedAt: new Date().toISOString(),
      ...(anyData ? {} : { error: 'FRED returned no usable data.' }),
    });
  } catch (e) {
    res.status(502).json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'unknown'}`, series: {} });
  }
}
