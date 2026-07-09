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
const CAP_WSBIN = 4000;
const CAP_SHAPES = 200;
const STORE_KEY = 'ei-capture-buffer';

function emptyBuf() {
  return { ws: [], wsout: [], wsbin: [], requests: [], fills: [], shapes: [], workers: [], wsOpens: [], startedAt: new Date().toISOString() };
}
let buf = emptyBuf();
let wsSeen = new Set();
let wsbinSeen = new Set();
let shapeSeen = new Set();
let workerSeen = new Set();
let reqByUrl = new Map();
let fillSeen = new Set();
let saveTimer = null;

// ---- restore across service-worker restarts ----
chrome.storage.local.get(STORE_KEY).then((r) => {
  const s = r && r[STORE_KEY];
  if (s && Array.isArray(s.ws)) {
    buf = Object.assign(emptyBuf(), s);
    for (const f of s.ws) wsSeen.add(sigWs(f));
    for (const b of s.wsbin || []) wsbinSeen.add((b.len || 0) + '|' + (b.b64 || '').slice(0, 32));
    for (const sh of s.shapes || []) shapeSeen.add(sh.kind + '|' + sh.binary + '|' + (sh.sample || '').slice(0, 40));
    for (const w of s.workers || []) workerSeen.add(w.url);
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
function addWsBin(item) {
  const sig = (item.len || 0) + '|' + (item.b64 || '').slice(0, 32);
  if (wsbinSeen.has(sig)) return;
  wsbinSeen.add(sig);
  if (buf.wsbin.length < CAP_WSBIN) buf.wsbin.push(item);
}
function addReq(item) {
  if (!item.url) item.url = 'req';
  reqByUrl.set(item.url, item); // keep latest per URL
  buf.requests = Array.from(reqByUrl.values()).slice(-CAP_REQ);
  ingestFills(item.body);
}
function addShape(item) {
  const sig = item.kind + '|' + item.binary + '|' + (item.sample || '').slice(0, 40);
  if (shapeSeen.has(sig)) return;
  shapeSeen.add(sig);
  if (buf.shapes.length < CAP_SHAPES) buf.shapes.push(item);
}
function addWorker(item) {
  if (!item.url || workerSeen.has(item.url)) return;
  workerSeen.add(item.url);
  buf.workers.push(item);
}
function addWsOpen(item) {
  if (buf.wsOpens.length < 200 && item.url) buf.wsOpens.push({ url: item.url, at: new Date().toISOString() });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'ei/frame') {
    try {
      const p = msg.payload;
      if (msg.kind === 'ws' && p) addWs(p);
      else if (msg.kind === 'wsout' && p) { if (buf.wsout.length < 2000) buf.wsout.push(p); }
      else if (msg.kind === 'wsbin' && p) addWsBin(p);
      else if (msg.kind === 'req' && p) addReq(p);
      else if (msg.kind === 'shape' && p) addShape(p);
      else if (msg.kind === 'worker' && p) addWorker(p);
      else if (msg.kind === 'wsopen' && p) addWsOpen(p);
      persist();
    } catch (e) {}
    return; // no response needed
  }
  if (msg.type === 'ei/stats') {
    sendResponse({
      ws: buf.ws.length,
      wsbin: buf.wsbin.length,
      requests: buf.requests.length,
      fills: buf.fills.length,
      workers: buf.workers.length,
      wsOpens: buf.wsOpens.length,
      shapes: buf.shapes.length,
      recent: buf.fills.slice(-6),
      startedAt: buf.startedAt,
    });
    return true;
  }
  if (msg.type === 'ei/dump' || msg.type === 'ei/diag') {
    const diag = msg.type === 'ei/diag';
    const payload = {
      source: 'edge-capture',
      version: 9,
      url: 'https://trader.axiafutures.com/index.html',
      title: 'TraderOne (Edge Capture extension)',
      capturedAt: new Date().toISOString(),
      tables: [],
      requests: buf.requests,
      ws: buf.ws,
      // binary frames + outgoing sends only in the full diagnostic export
      wsbin: diag ? buf.wsbin : [],
      wsout: diag ? buf.wsout : [],
      diagnostics: {
        extension: true,
        jsonResponses: buf.requests.length,
        wsFrames: buf.ws.length,
        wsBinaryFrames: buf.wsbin.length,
        wsConnections: buf.wsOpens.length,
        workers: buf.workers,
        fillsDetected: buf.fills.length,
        frameShapes: diag ? buf.shapes : buf.shapes.slice(0, 20),
        startedAt: buf.startedAt,
        note:
          buf.ws.length === 0 && buf.wsbin.length === 0 && buf.requests.length === 0
            ? (buf.workers.length
                ? 'No page-level socket/API traffic seen, but ' + buf.workers.length + ' worker(s) were created — the fills feed likely runs inside a Web Worker. Send this diagnostic file to support.'
                : 'No network traffic captured yet. Make sure Edge Capture was enabled BEFORE the page loaded, then place or view a trade.')
            : 'ok',
      },
    };
    sendResponse({ payload, fills: buf.fills });
    return true;
  }
  if (msg.type === 'ei/clear') {
    buf = emptyBuf();
    wsSeen = new Set(); wsbinSeen = new Set(); shapeSeen = new Set();
    workerSeen = new Set(); reqByUrl = new Map(); fillSeen = new Set();
    chrome.storage.local.set({ [STORE_KEY]: buf }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});
