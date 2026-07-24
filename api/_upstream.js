/*
 * Shared upstream-fetch helper for the serverless relays.
 *
 * Several of the keyless sources (FRED, GDELT, IMF) sit behind edge protection
 * that rejects datacenter traffic identifying itself as a bot: a
 * "Mozilla/5.0 (compatible; edge-intelligence/1.0)" UA drew 403s from Vercel's
 * IPs, which surfaced on the health board as anonymous 502s. The weekly
 * calendar relay already proved the fix — a full browser UA plus one retry — so
 * that behaviour lives here and every relay shares it.
 *
 * Official APIs that WANT to be identified (BLS, CBOE) keep their own honest
 * agent string and do not use this helper.
 */

export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Fetch an upstream with a browser identity, a hard timeout and one retry.
 * Returns the Response; throws only when every attempt failed.
 */
export async function fetchUpstream(url, { accept = 'application/json', timeoutMs = 7000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        headers: { ...BROWSER_HEADERS, Accept: accept },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      // 5xx and 429 are worth one more try; 4xx is a definitive answer
      if (r.ok || (r.status < 500 && r.status !== 429) || attempt === retries) return r;
      lastErr = new Error(`upstream HTTP ${r.status}`);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt === retries) throw e;
    }
  }
  throw lastErr ?? new Error('upstream fetch failed');
}
