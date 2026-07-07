/*
 * Edge Capture — MAIN-world hook.
 *
 * This runs at document_start in the page's REAL JavaScript context (world:
 * "MAIN"), in every frame, BEFORE Trader One's own code executes. That is the
 * whole reason this is an extension and not a bookmarklet: we replace
 * window.WebSocket / fetch / XMLHttpRequest before the app ever constructs
 * them, so the socket that streams your fills is captured from its very first
 * frame — including binary frames, which trading platforms commonly use.
 *
 * We do no parsing here. Each relevant frame/response is forwarded (via
 * window.postMessage) to the isolated-world content script, which relays it to
 * the background service worker. Nothing is sent anywhere off your machine.
 */
(function () {
  'use strict';
  if (window.__eiInjected) return;
  window.__eiInjected = true;

  function post(kind, payload) {
    try {
      window.postMessage({ __eiCapture: true, kind: kind, payload: payload }, '*');
    } catch (e) {}
  }
  function looksJson(s) {
    if (!s || typeof s !== 'string') return false;
    var t = s.replace(/^﻿/, '').replace(/^\s+/, '');
    var c = t.charAt(0);
    return c === '{' || c === '[';
  }
  // Fill / order frames always kept, even amid high-volume market data.
  var FILLKW = /fill|exec|filled|"?side"?|avgprice|avg_price|"?qty"?|"?price"?|position|leg|order|trade/i;

  function relayWsText(url, t) {
    if (typeof t !== 'string' || !t) return;
    if (t.length > 1500000) return;
    if (!looksJson(t) && !FILLKW.test(t)) return;
    post('ws', { url: String(url || ''), body: t });
  }
  function relayWsData(url, d) {
    try {
      if (typeof d === 'string') { relayWsText(url, d); return; }
      if (d && typeof d === 'object') {
        if (d instanceof ArrayBuffer) { relayWsText(url, new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(d))); return; }
        if (d.buffer && d.byteLength != null) { relayWsText(url, new TextDecoder('utf-8', { fatal: false }).decode(d)); return; }
        if (typeof Blob !== 'undefined' && d instanceof Blob) {
          if (d.size < 1500000 && d.text) d.text().then(function (t) { relayWsText(url, t); }).catch(function () {});
          return;
        }
      }
    } catch (e) {}
  }

  // ---- WebSocket ----
  try {
    var OWS = window.WebSocket;
    if (OWS) {
      var NWS = function (url, protos) {
        var ws = arguments.length > 1 ? new OWS(url, protos) : new OWS(url);
        try { ws.addEventListener('message', function (ev) { try { relayWsData(url, ev.data); } catch (e) {} }); } catch (e) {}
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
            try {
              r.clone().text().then(function (s) { if (looksJson(s) && s.length < 4000000) post('req', { url: String(u), body: s }); }).catch(function () {});
            } catch (e) {}
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

  post('ready', { url: location.href });
})();
