/*
 * Pure BLS parsing helpers, shared by the /api/bls serverless function and the
 * test suite. Files prefixed with "_" are not exposed as routes by Vercel, so
 * this is a plain module, never an endpoint.
 *
 * The BLS Public Data API (api.bls.gov) is the OFFICIAL source for CPI, the
 * employment situation (NFP), PPI and JOLTS. Its v1 endpoint is keyless. It
 * does not send permissive CORS headers, so the browser cannot call it
 * directly — the serverless function calls it server-side (no CORS there) and
 * relays current, official prints to the app with zero setup for the trader.
 */

/** Map a BLS period like "M07" + year "2026" → "2026-07". Annual "M13" → null. */
export function blsPeriod(year, period) {
  if (!/^M(0[1-9]|1[0-2])$/.test(String(period))) return null; // skip M13 annual avg + quarterly
  return `${year}-${String(period).slice(1)}`;
}

/**
 * Parse a BLS v1/v2 timeseries payload into
 * { [seriesId]: [{ period: "YYYY-MM", value: number }] } ascending.
 */
export function parseBlsResults(json) {
  const series = json && json.Results && Array.isArray(json.Results.series) ? json.Results.series : [];
  const out = {};
  for (const s of series) {
    const id = String(s.seriesID || '');
    if (!id) continue;
    const pts = [];
    for (const d of Array.isArray(s.data) ? s.data : []) {
      const period = blsPeriod(d.year, d.period);
      const value = Number(String(d.value).replace(/,/g, ''));
      if (period && isFinite(value)) pts.push({ period, value });
    }
    pts.sort((a, b) => a.period.localeCompare(b.period));
    out[id] = pts;
  }
  return out;
}

/** Sanitize the caller's ?series= into a safe, de-duped BLS id list (max 25). */
export function cleanSeriesParam(raw) {
  return [...new Set(String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9]{6,20}$/.test(s)))].slice(0, 25);
}
