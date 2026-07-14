/*
 * Serverless proxy for the official BLS Public Data API.
 *
 * Why this exists: the free keyless mirror the app used (DBnomics) can lag the
 * real BLS releases by many months, and the BLS API itself does not send
 * browser-friendly CORS headers, so the app cannot call it directly. This
 * function runs on the trader's own Vercel deployment, calls BLS server-side
 * (no CORS restriction there), and relays current, official prints — giving
 * up-to-date CPI / NFP / PPI / JOLTS with NO key and NO setup.
 *
 * IMPORTANT: BLS v1 is GET-only (series id in the URL path); the JSON POST body
 * with startyear/endyear is a v2 feature that needs a registration key. So the
 * keyless path here does one GET per series (v1, ~3 recent years, current) and
 * the app merges that current tail onto the deep DBnomics history. If a
 * BLS_API_KEY env var is present the function uses the v2 POST for the full
 * 10-year range in one call. Responses are edge-cached 24h (prints are
 * monthly) to stay comfortably inside the keyless 25-requests/day limit.
 */
import { parseBlsResults, cleanSeriesParam } from './_bls.js';

const UA = { 'User-Agent': 'edge-intelligence/1.0 (trading journal; contact via deployment)', Accept: 'application/json' };

/** Keyless v1: one GET per series (the only shape v1 supports). */
async function fetchV1(seriesIds) {
  const series = [];
  const errors = [];
  await Promise.all(
    seriesIds.map(async (id) => {
      try {
        const r = await fetch(`https://api.bls.gov/publicAPI/v1/timeseries/data/${encodeURIComponent(id)}`, { headers: UA });
        if (!r.ok) {
          errors.push(`${id}: HTTP ${r.status}`);
          return;
        }
        const j = await r.json();
        if (j && j.status && j.status !== 'REQUEST_SUCCEEDED') errors.push(`${id}: ${j.status}`);
        if (j && j.Results && Array.isArray(j.Results.series)) series.push(...j.Results.series);
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message : 'fetch failed'}`);
      }
    }),
  );
  return { Results: { series }, errors };
}

/** With a key: v2 POST returns up to 10 series x 10y in one call. */
async function fetchV2(seriesIds, key) {
  const now = new Date().getUTCFullYear();
  const r = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seriesid: seriesIds, startyear: String(now - 9), endyear: String(now), registrationkey: key }),
  });
  if (!r.ok) return { Results: { series: [] }, errors: [`v2 HTTP ${r.status}`] };
  const j = await r.json();
  const errors = j && j.status && j.status !== 'REQUEST_SUCCEEDED' ? [j.status, ...(j.message || [])] : [];
  return { Results: (j && j.Results) || { series: [] }, errors };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 2h edge cache: long enough to stay far inside the keyless daily limit,
  // short enough that a release-morning print reaches the app the same day.
  res.setHeader('Cache-Control', 's-maxage=7200, stale-while-revalidate=86400');

  const series = cleanSeriesParam(req.query?.series);
  if (!series.length) {
    res.status(400).json({ error: 'Pass ?series=CUSR0000SA0,CES0000000001 (comma-separated BLS series ids).' });
    return;
  }

  const key = process.env.BLS_API_KEY;
  try {
    const { Results, errors } = key ? await fetchV2(series, key) : await fetchV1(series);
    const parsed = parseBlsResults({ Results });
    const anyData = Object.values(parsed).some((a) => a.length);
    res.status(anyData ? 200 : 502).json({
      series: parsed,
      source: key ? 'bls-v2' : 'bls-v1',
      fetchedAt: new Date().toISOString(),
      ...(anyData ? {} : { error: 'BLS returned no usable data.', detail: errors.slice(0, 6) }),
    });
  } catch (e) {
    res.status(502).json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'unknown'}`, series: {} });
  }
}
