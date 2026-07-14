/*
 * Pure FRED parsing helpers, shared by the /api/fred serverless function and
 * the test suite. Files prefixed with "_" are not exposed as routes by Vercel.
 *
 * FRED (fred.stlouisfed.org) republishes the official BEA / Census series the
 * app needs that BLS does not carry: Core PCE (PCEPILFE), headline PCE (PCEPI)
 * and advance retail sales (RSAFS). Its `fredgraph.csv` endpoint is KEYLESS
 * but does not send CORS headers, hence the serverless relay (same pattern as
 * /api/bls).
 */

/** Sanitize ?id= into a safe, de-duped FRED id list (max 6). */
export function cleanFredParam(raw) {
  return [...new Set(String(raw || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9]{3,20}$/.test(s)))].slice(0, 6);
}

/**
 * Parse a fredgraph.csv payload (one or more value columns) into
 * { [seriesId]: [{ period: "YYYY-MM", value: number }] } ascending.
 * Tolerates both header styles ("DATE" and "observation_date"), missing
 * observations ("." or empty), and CRLF line endings. Monthly series arrive as
 * the first of the month; daily/weekly rows collapse to the last value seen in
 * each month so the output is always monthly.
 */
export function parseFredCsv(csv) {
  const lines = String(csv || '').split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return {};
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const ids = header.slice(1);
  if (!ids.length) return {};
  const byId = {};
  for (const id of ids) byId[id] = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const date = (cols[0] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const period = date.slice(0, 7);
    for (let c = 0; c < ids.length; c++) {
      const v = Number((cols[c + 1] || '').trim());
      if (isFinite(v) && (cols[c + 1] || '').trim() !== '') byId[ids[c]].set(period, v);
    }
  }
  const out = {};
  for (const id of ids) {
    out[id] = [...byId[id].entries()]
      .map(([period, value]) => ({ period, value }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }
  return out;
}
