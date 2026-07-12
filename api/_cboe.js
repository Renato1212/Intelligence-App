/*
 * Pure CBOE chain helpers, shared by the /api/cboe serverless function and the
 * test suite. Files prefixed with "_" are not exposed as routes by Vercel.
 *
 * CBOE publishes delayed quotes and full option chains through a public CDN,
 * but it does not send browser-friendly CORS headers, so the app cannot fetch
 * it directly (the request throws before it ever returns). The serverless
 * function calls the CDN server-side (no CORS there) and relays it. The full
 * SPX chain is several MB — over Vercel's serverless response limit — so the
 * function SLIMS it to the strikes near spot and only the fields the analytics
 * need, keeping the response small and fast.
 */

/** Strike from an OCC symbol like "SPX240719C05000000" → 5000. */
export function strikeFromOcc(occ) {
  const m = String(occ).replace(/\s+/g, '').match(/[CP](\d{7,8})$/);
  return m ? Number(m[1]) / 1000 : null;
}

/**
 * Reduce a raw CBOE chain payload to { data: { current_price, options: [...] } }
 * keeping only OI>0 strikes within `pct` of spot and the fields parseChain uses.
 */
export function slimChain(json, pct = 0.15) {
  const data = json && json.data;
  if (!data) return null;
  const spot = Number(data.current_price ?? data.close ?? data.last_trade_price);
  if (!isFinite(spot) || spot <= 0) return null;
  const raw = Array.isArray(data.options) ? data.options : [];
  const options = [];
  for (const o of raw) {
    const oi = Number(o.open_interest) || 0;
    if (oi <= 0) continue;
    const k = strikeFromOcc(o.option);
    if (k == null || Math.abs(k - spot) / spot > pct) continue;
    options.push({
      option: o.option,
      open_interest: oi,
      volume: Number(o.volume) || 0,
      gamma: o.gamma,
      iv: o.iv,
    });
  }
  return { data: { current_price: spot, options } };
}

/** Whitelist the symbols we proxy (index roots + VIX complex, e.g. _VIX9D). */
export function okSymbol(s) {
  return /^[A-Z0-9^_.]{2,6}$/.test(String(s || ''));
}
