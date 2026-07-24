/*
 * Serverless relay for keyless OHLC bars (Yahoo Finance chart API).
 *
 * Why this exists: the Market Profile page needs 30-minute RTH bars, and FMP
 * puts intraday history behind a paid tier — a perfectly valid key answers
 * HTTP 402 on historical-chart, which left the whole auction page empty. The
 * Yahoo chart endpoint is keyless and carries the same bars, but sends no CORS
 * headers, so it is relayed here on the trader's own deployment.
 *
 * The response is normalised into the SAME shape FMP returns
 * ([{date, open, high, low, close, volume}], ascending) so the client parser is
 * shared and the profile engine never learns which source it came from.
 *
 * Timestamps are rendered in the EXCHANGE's own timezone (via the gmtoffset
 * Yahoo reports), because Market Profile brackets are defined by exchange time
 * — an RTH profile bucketed in UTC would put the open in the wrong bracket.
 */

const INTERVALS = new Set(['5m', '15m', '30m', '60m', '1h', '1d']);
const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '60d', '10d']);
const SYMBOL_OK = /^[A-Za-z0-9.^=-]{1,12}$/;

/** Epoch seconds → "YYYY-MM-DD HH:MM:SS" shifted into the exchange's offset. */
export function exchangeStamp(epochSeconds, gmtOffsetSeconds) {
  const d = new Date((epochSeconds + (gmtOffsetSeconds || 0)) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

/** Pure: Yahoo chart JSON → FMP-shaped ascending bars. Exported for tests. */
export function normalizeYahooChart(json) {
  const result = json?.chart?.result?.[0];
  if (!result) return [];
  const stamps = result.timestamp;
  const q = result.indicators?.quote?.[0];
  if (!Array.isArray(stamps) || !q) return [];
  const offset = Number(result.meta?.gmtoffset ?? 0);
  const out = [];
  for (let i = 0; i < stamps.length; i++) {
    const open = Number(q.open?.[i]);
    const high = Number(q.high?.[i]);
    const low = Number(q.low?.[i]);
    const close = Number(q.close?.[i]);
    // Yahoo pads gaps with nulls — drop them rather than inventing flat bars
    if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) continue;
    const vol = Number(q.volume?.[i]);
    out.push({
      date: exchangeStamp(Number(stamps[i]), offset),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(vol) && vol > 0 ? vol : 0,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // intraday bars go stale quickly; keep the edge cache short but useful
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800, stale-if-error=86400');

  const symbol = String(req.query?.symbol || '');
  const interval = String(req.query?.interval || '30m');
  const range = String(req.query?.range || '1mo');
  if (!SYMBOL_OK.test(symbol) || !INTERVALS.has(interval) || !RANGES.has(range)) {
    res.status(400).json({ error: 'Pass ?symbol=SPY&interval=30m&range=1mo' });
    return;
  }

  const upstream =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=false`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(upstream, {
      headers: {
        Accept: 'application/json',
        // a datacenter UA gets rejected by Yahoo's edge; a browser UA does not
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      res.status(502).json({ error: `Yahoo responded HTTP ${r.status}.` });
      return;
    }
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      res.status(502).json({ error: 'Yahoo returned a non-JSON payload (edge block or interstitial).' });
      return;
    }
    const bars = normalizeYahooChart(json);
    if (!bars.length) {
      res.status(502).json({ error: `Yahoo returned no usable bars for ${symbol} ${interval}.` });
      return;
    }
    res.status(200).json(bars);
  } catch (e) {
    res.status(502).json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'timeout'}` });
  }
}
