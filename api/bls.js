/*
 * Serverless proxy for the official BLS Public Data API.
 *
 * Why this exists: the free keyless mirror the app used (DBnomics) can lag the
 * real BLS releases by many months, and the BLS API itself does not send
 * browser-friendly CORS headers, so the app cannot call it directly. This
 * function runs on the trader's own Vercel deployment, calls BLS server-side
 * (no CORS restriction there), and relays current, official prints — giving
 * the trader up-to-date CPI / NFP / PPI / JOLTS with NO key and NO setup.
 *
 * Keyless by default (BLS v1, ~25 requests/day/IP, up to 10 years, 25 series
 * per call). If a BLS_API_KEY env var is present it uses v2 for higher limits.
 * Responses are edge-cached (6h) so repeated visits share one upstream call.
 */
import { parseBlsResults, cleanSeriesParam } from './_bls.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');

  const series = cleanSeriesParam(req.query?.series);
  if (!series.length) {
    res.status(400).json({ error: 'Pass ?series=CUSR0000SA0,CES0000000001 (comma-separated BLS series ids).' });
    return;
  }

  const nowYear = new Date().getUTCFullYear();
  const key = process.env.BLS_API_KEY;
  const endpoint = key
    ? 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
    : 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
  const body = { seriesid: series, startyear: String(nowYear - 9), endyear: String(nowYear) };
  if (key) body.registrationkey = key;

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      res.status(502).json({ error: `BLS API returned ${r.status}.`, series: {} });
      return;
    }
    const json = await r.json();
    if (json && json.status && json.status !== 'REQUEST_SUCCEEDED') {
      res.status(502).json({ error: `BLS: ${json.status}`, messages: json.message ?? [], series: {} });
      return;
    }
    res.status(200).json({ series: parseBlsResults(json), fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'unknown'}`, series: {} });
  }
}
