/*
 * Trading Technologies position watcher — MAIN-world hook.
 *
 * Runs at document_start in the page's real JavaScript context, before TT's own
 * code, and replaces WebSocket / fetch / XHR so every message the platform
 * exchanges is observed from the first frame. TT streams fills and position
 * updates, so this is where "am I in a position?" is actually knowable.
 *
 * It only ever READS. It never sends anything to the platform, never places or
 * modifies an order, and nothing leaves the browser: detected events are handed
 * to the extension, which relays them to your own Edge Intelligence tab.
 */
(function () {
  'use strict';
  if (window.__eiTT) return;
  window.__eiTT = true;

  function post(payload) {
    try {
      window.postMessage({ __eiTTEvent: true, payload: payload }, '*');
    } catch (e) {}
  }

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v.replace(/[, ]/g, ''));
      return isFinite(n) ? n : null;
    }
    return null;
  }

  // Flatten nested objects so field lookup is order-independent.
  function flat(o, out, pre) {
    out = out || {}; pre = pre || '';
    if (!o || typeof o !== 'object') return out;
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      var v = o[k];
      var key = (pre + k).toLowerCase();
      if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, out, pre + k + '.');
      else out[key] = v;
    }
    return out;
  }
  function pick(f, needles, excl) {
    for (var k in f) {
      var v = f[k];
      if (v == null || v === '') continue;
      if (excl && excl.some(function (x) { return k.indexOf(x) >= 0; })) continue;
      for (var i = 0; i < needles.length; i++) if (k.indexOf(needles[i]) >= 0) return v;
    }
    return undefined;
  }
  function pickNum(f, needles, excl) {
    for (var k in f) {
      var v = f[k];
      if (v == null || v === '') continue;
      if (excl && excl.some(function (x) { return k.indexOf(x) >= 0; })) continue;
      for (var i = 0; i < needles.length; i++) {
        if (k.indexOf(needles[i]) >= 0) { var n = num(v); if (n != null) return n; }
      }
    }
    return null;
  }

  var SIDE_RE = /^(buy|sell|b|s|bot|sld|bought|sold|long|short)$/i;
  function findSide(f) {
    var named = pick(f, ['side', 'buysell', 'action', 'direction', 'way']);
    var cands = named != null ? [named] : [];
    for (var k in f) if (typeof f[k] === 'string') cands.push(f[k]);
    for (var i = 0; i < cands.length; i++) {
      var v = cands[i];
      if (typeof v !== 'string') continue;
      var s = v.trim().toLowerCase();
      if (!SIDE_RE.test(s)) continue;
      if (/^(s|sell|sld|sold|short)/.test(s)) return 'SELL';
      if (/^(b|buy|bot|bought|long)/.test(s)) return 'BUY';
    }
    // numeric conventions: 1 = buy, 2 = sell
    var n = pickNum(f, ['side']);
    if (n === 1) return 'BUY';
    if (n === 2) return 'SELL';
    return null;
  }

  function instrumentOf(f) {
    var s = pick(f, ['contract', 'instrument', 'symbol', 'secid', 'product', 'ticker', 'alias']);
    if (typeof s !== 'string' || !s.trim()) return null;
    // ESZ5 / ES Dec25 / ES -> ES
    var root = s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ' ').split(' ')[0];
    root = root.replace(/([A-Z]{1,4})[FGHJKMNQUVXZ]\d{1,2}$/, '$1');
    return root.slice(0, 6) || null;
  }

  /** A position snapshot: instrument + a signed net quantity. Authoritative. */
  function asPosition(obj) {
    var f = flat(obj);
    var inst = instrumentOf(f);
    if (!inst) return null;
    // require a key that actually names a position quantity
    var netKey = null;
    for (var k in f) {
      if (/(netpos|net_pos|netquantity|net_qty|netqty|position|openqty|open_qty)/.test(k) && num(f[k]) != null) { netKey = k; break; }
    }
    if (netKey == null) return null;
    var net = num(f[netKey]);
    if (net == null) return null;
    // a separate long/short marker may carry the sign
    if (net > 0) {
      var side = findSide(f);
      var dir = pick(f, ['posside', 'positionside', 'longshort']);
      if ((typeof dir === 'string' && /short|sell/i.test(dir)) || side === 'SELL') net = -net;
    }
    return { kind: 'position', instrument: inst, netQty: net, at: new Date().toISOString() };
  }

  /** A fill: price + quantity + side, and NOT a completed round trip. */
  function asFill(obj) {
    var f = flat(obj);
    var status = String(pick(f, ['status', 'state', 'exectype']) || '').toLowerCase();
    if (status && /cancel|reject|pending|working|new|expired|replaced/.test(status) && !/fill|trade|partial/.test(status)) return null;
    if (pickNum(f, ['pnl', 'profit', 'realized']) != null) return null; // a trade summary, not a fill
    var qty = pickNum(f, ['lastqty', 'fillqty', 'execqty', 'filledqty', 'tradeqty', 'qty', 'quantity', 'size'], ['pnl', 'ordqty', 'leaves']);
    var px = pickNum(f, ['lastpx', 'fillprice', 'execprice', 'price', 'px'], ['stop', 'limit', 'target', 'avg']);
    if (qty == null || qty === 0 || px == null) return null;
    var side = findSide(f);
    if (!side) return null;
    var inst = instrumentOf(f);
    if (!inst) return null;
    return { kind: 'fill', instrument: inst, action: side, qty: Math.abs(qty), at: new Date().toISOString() };
  }

  var seen = Object.create(null);
  function emit(ev) {
    if (!ev) return;
    var k = ev.kind + '|' + ev.instrument + '|' + (ev.netQty != null ? ev.netQty : ev.action + ev.qty) + '|' + Math.floor(Date.now() / 1500);
    if (seen[k]) return;
    seen[k] = 1;
    post(ev);
  }

  function scan(node, depth) {
    depth = depth || 0;
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) { for (var i = 0; i < node.length && i < 300; i++) scan(node[i], depth + 1); return; }
    if (typeof node !== 'object') return;
    emit(asPosition(node));
    emit(asFill(node));
    for (var k in node) { if (Object.prototype.hasOwnProperty.call(node, k)) scan(node[k], depth + 1); }
  }

  function ingest(text) {
    if (!text || typeof text !== 'string' || text.length > 2000000) return;
    var t = text.replace(/^﻿/, '').replace(/^\s+/, '');
    if (t.charAt(0) !== '{' && t.charAt(0) !== '[') return;
    try { scan(JSON.parse(t)); return; } catch (e) {}
    // newline-delimited JSON
    var lines = t.split(/\r?\n/);
    for (var i = 0; i < lines.length && i < 200; i++) {
      var l = lines[i].trim();
      if (l.charAt(0) !== '{' && l.charAt(0) !== '[') continue;
      try { scan(JSON.parse(l)); } catch (e2) {}
    }
  }

  function decode(d) {
    try {
      if (typeof d === 'string') { ingest(d); return; }
      if (d instanceof ArrayBuffer) { ingest(new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(d))); return; }
      if (d && d.buffer && d.byteLength != null) { ingest(new TextDecoder('utf-8', { fatal: false }).decode(d)); return; }
      if (typeof Blob !== 'undefined' && d instanceof Blob && d.size < 2000000 && d.text) d.text().then(ingest).catch(function () {});
    } catch (e) {}
  }

  // ---- WebSocket (how TT streams positions and fills) ----
  try {
    var OWS = window.WebSocket;
    if (OWS) {
      var NWS = function (url, protos) {
        var ws = arguments.length > 1 ? new OWS(url, protos) : new OWS(url);
        try { ws.addEventListener('message', function (ev) { decode(ev.data); }); } catch (e) {}
        return ws;
      };
      try {
        NWS.prototype = OWS.prototype;
        NWS.CONNECTING = OWS.CONNECTING; NWS.OPEN = OWS.OPEN; NWS.CLOSING = OWS.CLOSING; NWS.CLOSED = OWS.CLOSED;
      } catch (e) {}
      window.WebSocket = NWS;
    }
  } catch (e) {}

  // ---- fetch / XHR (REST position snapshots) ----
  try {
    var OF = window.fetch;
    if (OF) {
      window.fetch = function () {
        var p = OF.apply(this, arguments);
        try { p.then(function (r) { try { r.clone().text().then(ingest).catch(function () {}); } catch (e) {} }).catch(function () {}); } catch (e) {}
        return p;
      };
    }
  } catch (e) {}
  try {
    var XP = XMLHttpRequest.prototype, OS = XP.send;
    XP.send = function () {
      var x = this;
      try {
        x.addEventListener('load', function () {
          try {
            var s = x.responseType === '' || x.responseType === 'text' ? x.responseText
              : x.responseType === 'json' ? JSON.stringify(x.response) : '';
            ingest(s);
          } catch (e) {}
        });
      } catch (e) {}
      return OS.apply(this, arguments);
    };
  } catch (e) {}

  post({ kind: 'hello', at: new Date().toISOString() });
})();
