/*
 * Edge Capture — MAIN-world hook.
 *
 * Runs at document_start in the page's REAL JavaScript context (world:
 * "MAIN"), in every frame, BEFORE Trader One's own code executes — so the
 * socket that streams your fills is captured from its very first frame.
 *
 * This build is deliberately NON-INVASIVE: it observes network traffic and
 * forwards copies to the extension. It never alters the data the platform
 * sends or receives, never rewrites Worker scripts, and swallows all its own
 * errors — so it cannot break Trader One while you are trading.
 *
 * What it captures:
 *   - WebSocket messages, TEXT and BINARY. Binary frames (protobuf/msgpack,
 *     which trading platforms commonly use for fills) are kept as base64 so
 *     the exact format is never lost, even when it is not JSON.
 *   - WebSocket sends (outgoing order submissions carry the order type).
 *   - fetch / XMLHttpRequest JSON responses (the Order History / executions
 *     endpoint the journal UI loads).
 *   - A safe census of Worker / SharedWorker script URLs — WITHOUT modifying
 *     them — so the diagnostic can reveal when the fills socket lives inside a
 *     worker this page-level hook cannot see.
 *   - A small sample of every DISTINCT frame shape, for the diagnostic export.
 */
(function () {
  'use strict';
  if (window.__eiInjected) return;
  window.__eiInjected = true;

  function post(kind, payload) {
    try { window.postMessage({ __eiCapture: true, kind: kind, payload: payload }, '*'); } catch (e) {}
  }
  function looksJson(s) {
    if (!s || typeof s !== 'string') return false;
    var t = s.replace(/^﻿/, '').replace(/^\s+/, '');
    var c = t.charAt(0);
    return c === '{' || c === '[';
  }
  var FILLKW = /fill|exec|filled|"?side"?|avgprice|avg_price|"?qty"?|"?price"?|position|leg|order|trade/i;

  // base64 of a byte array, chunked to avoid call-stack limits
  function bytesToB64(bytes) {
    try {
      var CH = 0x8000, out = '';
      for (var i = 0; i < bytes.length; i += CH) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(out);
    } catch (e) { return ''; }
  }

  var shapeSeen = Object.create(null), shapeCount = 0;
  function recordShape(kind, sample, binary) {
    try {
      var key = kind + '|' + (binary ? 'bin' : 'txt') + '|' + sample.slice(0, 40);
      if (shapeSeen[key]) return;
      if (shapeCount > 120) return;
      shapeSeen[key] = 1; shapeCount++;
      post('shape', { kind: kind, binary: !!binary, sample: sample.slice(0, 300) });
    } catch (e) {}
  }

  function relayWsText(url, t, dir) {
    if (typeof t !== 'string' || !t) return;
    recordShape('ws-' + (dir || 'in'), t, false);
    if (t.length > 1500000) return;
    if (!looksJson(t) && !FILLKW.test(t)) return;
    // incoming frames feed fill detection; outgoing (order submissions) go to
    // a diagnostic-only channel so cancelled/unfilled orders never become fills
    post(dir === 'out' ? 'wsout' : 'ws', { url: String(url || ''), body: t, dir: dir || 'in' });
  }
  function relayWsBinary(url, bytes, dir) {
    try {
      if (!bytes || !bytes.length) return;
      // try a UTF-8 decode first — some platforms send JSON as binary
      var txt = '';
      try { txt = new TextDecoder('utf-8', { fatal: false }).decode(bytes); } catch (e) {}
      if (looksJson(txt) || FILLKW.test(txt)) { relayWsText(url, txt, dir); return; }
      // otherwise keep the raw bytes (base64) so the format can be decoded later
      recordShape('ws-' + (dir || 'in'), txt || '[binary]', true);
      if (bytes.length > 400000) return;
      post('wsbin', { url: String(url || ''), b64: bytesToB64(bytes), len: bytes.length, dir: dir || 'in' });
    } catch (e) {}
  }
  function relayWsData(url, d, dir) {
    try {
      if (typeof d === 'string') { relayWsText(url, d, dir); return; }
      if (d && typeof d === 'object') {
        if (d instanceof ArrayBuffer) { relayWsBinary(url, new Uint8Array(d), dir); return; }
        if (d.buffer && d.byteLength != null) { relayWsBinary(url, new Uint8Array(d.buffer, d.byteOffset || 0, d.byteLength), dir); return; }
        if (typeof Blob !== 'undefined' && d instanceof Blob) {
          if (d.size < 1500000 && d.arrayBuffer) d.arrayBuffer().then(function (ab) { relayWsBinary(url, new Uint8Array(ab), dir); }).catch(function () {});
          return;
        }
      }
    } catch (e) {}
  }

  // ---- WebSocket (receive + send) ----
  try {
    var OWS = window.WebSocket;
    if (OWS) {
      var NWS = function (url, protos) {
        var ws = arguments.length > 1 ? new OWS(url, protos) : new OWS(url);
        try { post('wsopen', { url: String(url || '') }); } catch (e) {}
        try { ws.addEventListener('message', function (ev) { try { relayWsData(url, ev.data, 'in'); } catch (e) {} }); } catch (e) {}
        try {
          var OSend = ws.send;
          ws.send = function (data) { try { relayWsData(url, data, 'out'); } catch (e) {} return OSend.apply(this, arguments); };
        } catch (e) {}
        return ws;
      };
      try {
        NWS.prototype = OWS.prototype;
        NWS.CONNECTING = OWS.CONNECTING; NWS.OPEN = OWS.OPEN; NWS.CLOSING = OWS.CLOSING; NWS.CLOSED = OWS.CLOSED;
      } catch (e) {}
      window.WebSocket = NWS;
    }
  } catch (e) {}

  // ---- fetch ----
  try {
    var OF = window.fetch;
    if (OF) {
      window.fetch = function () {
        var a = arguments;
        var u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
        var p = OF.apply(this, a);
        try {
          p.then(function (r) {
            try { r.clone().text().then(function (s) { if (looksJson(s) && s.length < 4000000) post('req', { url: String(u), body: s }); }).catch(function () {}); } catch (e) {}
          }).catch(function () {});
        } catch (e) {}
        return p;
      };
    }
  } catch (e) {}

  // ---- XMLHttpRequest ----
  try {
    var XP = XMLHttpRequest.prototype, OO = XP.open, OS = XP.send;
    XP.open = function (m, u) { try { this.__eiu = String(u || ''); } catch (e) {} return OO.apply(this, arguments); };
    XP.send = function () {
      var x = this;
      try {
        x.addEventListener('load', function () {
          try {
            var s = x.responseType === '' || x.responseType === 'text' ? x.responseText : (x.responseType === 'json' ? JSON.stringify(x.response) : '');
            if (looksJson(s) && s.length < 4000000) post('req', { url: x.__eiu || '', body: s });
          } catch (e) {}
        });
      } catch (e) {}
      return OS.apply(this, arguments);
    };
  } catch (e) {}

  // ---- SAFE worker census (does NOT modify the worker) ----
  try {
    var OWk = window.Worker;
    if (OWk) {
      window.Worker = function (url, opts) {
        try { post('worker', { url: String(url || ''), kind: 'worker' }); } catch (e) {}
        return arguments.length > 1 ? new OWk(url, opts) : new OWk(url);
      };
      try { window.Worker.prototype = OWk.prototype; } catch (e) {}
    }
    var OSk = window.SharedWorker;
    if (OSk) {
      window.SharedWorker = function (url, opts) {
        try { post('worker', { url: String(url || ''), kind: 'shared' }); } catch (e) {}
        return arguments.length > 1 ? new OSk(url, opts) : new OSk(url);
      };
      try { window.SharedWorker.prototype = OSk.prototype; } catch (e) {}
    }
  } catch (e) {}

  post('ready', { url: location.href });
})();
