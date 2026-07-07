/*
 * Edge Capture — background aggregator.
 *
 * Every frame's content script relays captured WebSocket frames and API
 * responses here. We deduplicate them, do a lightweight shape-based fill
 * detection so the on-page overlay can show a live count, persist the buffer
 * so a service-worker restart never loses data, and on request hand the whole
 * buffer back as an `edge-capture` payload that imports straight into Edge
 * Intelligence.
 */

const CAP_WS = 20000;
const CAP_REQ = 500;
const STORE_KEY = 'ei-capture-buffer';

let buf = { ws: [], requests: [], fills: [], startedAt: new Date().toISOString() };
let wsSeen = new Set();
let reqByUrl = new Map();
let fillSeen = new Set();
let saveTimer = null;

// ---- restore across service-worker restarts ----
chrome.storage.local.get(STORE_KEY).then((r) => {
  const s = r && r[STORE_KEY];
  if (s && Array.isArray(s.ws)) {
    buf = s;
    for (const f of s.ws) wsSeen.add(sigWs(f));
    for (const r2 of s.requests || []) reqByUrl.set(r2.url, r2);
    for (const fl of s.fills || []) fillSeen.add(fillKey(fl));
  }
});

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    chrome.storage.local.set({ [STORE_KEY]: buf }).catch(() => {});
  }, 800);
}

function sigWs(f) { return (f.body || '').length + '|' + (f.body || '').slice(0, 90); }
function fillKey(f) { return [f.time, f.action, f.qty, f.price].join('|'); }

/* ---- lightweight shape-based fill detection (for the live overlay) ---- */
function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,\s]/g, ''));
    return isFinite(n) && v.trim() !== '' ? n : null;
  }
  return null;
}
function flat(obj, out, pre) {
  out = out || {};
  pre = pre || '';
  if (!obj || typeof obj !== 'object') return out;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = (pre + k).toLowerCase();
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, out, pre + k + '.');
    else out[key] = v;
  }
  return out;
}
function fuzzy(f, needles, excl) {
  for (const k of Object.keys(f)) {
    const v = f[k];
    if (v == null || v === '') continue;
    if (excl && excl.some((x) => k.includes(x))) continue;
    if (needles.some((n) => k.includes(n))) return v;
  }
  return undefined;
}
function fuzzyNum(f, needles, excl) {
  for (const k of Object.keys(f)) {
    const v = f[k];
    if (v == null || v === '') continue;
    if (excl && excl.some((x) => k.includes(x))) continue;
    if (needles.some((n) => k.includes(n))) { const n = toNum(v); if (n != null) return n; }
  }
  return null;
}
const SIDE_RE = /^(buy|sell|b|s|long|short|bot|sld|bought|sold|bid|ask|bo|so)$/i;
function findSide(f) {
  const named = fuzzy(f, ['side', 'action', 'direction', 'buysell', 'aggressor', 'way']);
  const cands = named != null ? [named] : Object.values(f);
  for (const v of cands) {
    if (typeof v !== 'string') continue;
    const s = v.trim().toLowerCase();
    if (!SIDE_RE.test(s)) continue;
    if (/^(s|sell|short|sld|sold|ask|so)/.test(s)) return 'SELL';
    if (/^(b|buy|long|bot|bought|bid|bo)/.test(s)) return 'BUY';
  }
  return null;
}
function normType(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('stop') && s.includes('limit')) return 'stop-limit';
  if (s.includes('stop')) return 'stop';
  if (s.includes('limit') || s === 'lmt') return 'limit';
  if (s.includes('market') || s === 'mkt') return 'market';
  return 'unknown';
}
function findOrderType(f) {
  for (const k of Object.keys(f)) {
    if (/(ordertype|ordkind|order_type|ordtype)/.test(k)) { const t = normType(f[k]); if (t !== 'unknown') return t; }
  }
  for (const k of Object.keys(f)) {
    if (k.includes('type') || k.includes('kind')) { const t = normType(f[k]); if (t !== 'unknown') return t; }
  }
  return 'unknown';
}
function detectFillFromObj(obj) {
  const f = flat(obj);
  const hasPnl = fuzzyNum(f, ['pnl', 'profit', 'realized', 'gainloss']) != null;
  const hasEntry = fuzzyNum(f, ['entryprice', 'openprice', 'avgentry']) != null;
  const hasExit = fuzzyNum(f, ['exitprice', 'closeprice', 'avgexit']) != null;
  if (hasPnl || (hasEntry && hasExit)) return null; // a completed round-trip, not a fill
  const price = fuzzyNum(f, ['price', 'px', 'rate'], ['entryprice', 'exitprice', 'stopprice', 'targetprice']);
  const qty = fuzzyNum(f, ['qty', 'quantity', 'size', 'lots', 'contracts', 'volume', 'filled', 'amount'], ['pnl']);
  if (price == null || qty == null || qty === 0) return null;
  const side = findSide(f);
  const timeRaw = fuzzy(f, ['filledat', 'executedat', 'transacttime', 'filltime', 'time', 'ts', 'date', 'at']);
  if (side == null && timeRaw == null) return null;
  const symRaw = fuzzy(f, ['symbol', 'instrument', 'contract', 'product', 'ticker', 'sym']);
  return {
    time: timeRaw != null ? String(timeRaw) : new Date().toISOString(),
    action: side || (qty < 0 ? 'SELL' : 'BUY'),
    qty: Math.abs(qty),
    price,
    orderType: findOrderType(f),
    instrument: typeof symRaw === 'string' ? symRaw : null,
  };
}
function scanFills(node, out, depth) {
  depth = depth || 0;
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) { for (const x of node.slice(0, 200)) scanFills(x, out, depth + 1); return; }
  if (typeof node === 'object') {
    const f = detectFillFromObj(node);
    if (f) out.push(f);
    for (const v of Object.values(node)) scanFills(v, out, depth + 1);
  }
}
function ingestFills(body) {
  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) {
    // newline-delimited JSON
    const lines = body.split(/\r?\n/).filter((l) => l.trim().charAt(0) === '{' || l.trim().charAt(0) === '[');
    for (const l of lines) { try { const p = JSON.parse(l); collectFillsInto(p); } catch (_) {} }
    return;
  }
  collectFillsInto(parsed);
}
function collectFillsInto(parsed) {
  const found = [];
  scanFills(parsed, found);
  for (const fl of found) {
    const k = fillKey(fl);
    if (fillSeen.has(k)) continue;
    fillSeen.add(k);
    buf.fills.push(fl);
    if (buf.fills.length > 5000) buf.fills.shift();
  }
}

function addWs(item) {
  const sig = sigWs(item);
  if (wsSeen.has(sig)) return;
  wsSeen.add(sig);
  if (buf.ws.length < CAP_WS) buf.ws.push(item);
  ingestFills(item.body);
}
function addReq(item) {
  if (!item.url) item.url = 'req';
  reqByUrl.set(item.url, item); // keep latest per URL
  buf.requests = Array.from(reqByUrl.values()).slice(-CAP_REQ);
  ingestFills(item.body);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'ei/frame') {
    try {
      if (msg.kind === 'ws' && msg.payload) addWs(msg.payload);
      else if (msg.kind === 'req' && msg.payload) addReq(msg.payload);
      persist();
    } catch (e) {}
    return; // no response needed
  }
  if (msg.type === 'ei/stats') {
    sendResponse({
      ws: buf.ws.length,
      requests: buf.requests.length,
      fills: buf.fills.length,
      recent: buf.fills.slice(-6),
      startedAt: buf.startedAt,
    });
    return true;
  }
  if (msg.type === 'ei/dump') {
    const payload = {
      source: 'edge-capture',
      version: 8,
      url: 'https://trader.axiafutures.com/index.html',
      title: 'TraderOne (Edge Capture extension)',
      capturedAt: new Date().toISOString(),
      tables: [],
      requests: buf.requests,
      ws: buf.ws,
      diagnostics: {
        extension: true,
        jsonResponses: buf.requests.length,
        wsFrames: buf.ws.length,
        fillsDetected: buf.fills.length,
        startedAt: buf.startedAt,
      },
    };
    sendResponse({ payload, fills: buf.fills });
    return true;
  }
  if (msg.type === 'ei/clear') {
    buf = { ws: [], requests: [], fills: [], startedAt: new Date().toISOString() };
    wsSeen = new Set(); reqByUrl = new Map(); fillSeen = new Set();
    chrome.storage.local.set({ [STORE_KEY]: buf }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});
