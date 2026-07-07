/*
 * Edge Capture — isolated-world content script.
 *
 * Runs in every frame. Its jobs:
 *  1. Relay the frames/responses that inject.js captures (in the MAIN world of
 *     the same frame) to the background aggregator.
 *  2. In the TOP frame only, draw a small live overlay showing how many fills
 *     have been captured, and provide Export (download an edge-capture.json
 *     that imports straight into Edge Intelligence) and Clear.
 */
(function () {
  'use strict';

  // Relay MAIN-world captures to the background service worker.
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__eiCapture !== true) return;
    if (d.kind === 'ready') return;
    try { chrome.runtime.sendMessage({ type: 'ei/frame', kind: d.kind, payload: d.payload }); } catch (e) {}
  });

  // Only the top frame owns the UI.
  if (window.top !== window.self) return;

  var panel, countEl, streamEl, apiEl, listEl, statusEl, minimized = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function build() {
    if (document.getElementById('__eiCapturePanel')) return;
    panel = document.createElement('div');
    panel.id = '__eiCapturePanel';
    panel.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
      'width:290px', 'background:#141210', 'color:#f5f0e6',
      'font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif',
      'border:1px solid #c9a227', 'border-radius:12px',
      'box-shadow:0 10px 40px rgba(0,0,0,.55)', 'overflow:hidden'
    ].join(';');
    panel.innerHTML =
      '<div id="__eiHead" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:linear-gradient(90deg,#c9a227,#e6c34d);color:#141210;cursor:pointer;font-weight:700">' +
        '<span>⏺ Edge Capture</span>' +
        '<span id="__eiMin" style="font-weight:400;opacity:.8">–</span>' +
      '</div>' +
      '<div id="__eiBody" style="padding:12px">' +
        '<div id="__eiCount" style="font-size:26px;font-weight:800;color:#e6c34d;line-height:1">0 fills</div>' +
        '<div style="opacity:.7;font-size:12px;margin:2px 0 10px"><span id="__eiStream">0</span> stream · <span id="__eiApi">0</span> API captured</div>' +
        '<div id="__eiList" style="max-height:150px;overflow:auto;margin-bottom:10px;font-family:ui-monospace,Menlo,monospace;font-size:11.5px"></div>' +
        '<div style="display:flex;gap:6px">' +
          '<button id="__eiExport" style="flex:1;background:#c9a227;color:#141210;border:0;border-radius:7px;padding:8px;font-weight:700;cursor:pointer">Export</button>' +
          '<button id="__eiClear" style="background:#2a2622;color:#f5f0e6;border:1px solid #3a352e;border-radius:7px;padding:8px 10px;cursor:pointer">Clear</button>' +
        '</div>' +
        '<div id="__eiStatus" style="opacity:.7;font-size:11px;margin-top:8px">Records fills while you trade. Keep this open, then Export → import into Edge Intelligence.</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(panel);

    countEl = panel.querySelector('#__eiCount');
    streamEl = panel.querySelector('#__eiStream');
    apiEl = panel.querySelector('#__eiApi');
    listEl = panel.querySelector('#__eiList');
    statusEl = panel.querySelector('#__eiStatus');

    panel.querySelector('#__eiHead').addEventListener('click', function () {
      minimized = !minimized;
      panel.querySelector('#__eiBody').style.display = minimized ? 'none' : 'block';
      panel.querySelector('#__eiMin').textContent = minimized ? '+' : '–';
    });
    panel.querySelector('#__eiExport').addEventListener('click', doExport);
    panel.querySelector('#__eiClear').addEventListener('click', doClear);
  }

  function fmtFill(f) {
    var t = String(f.time || '');
    var hhmm = /\d{2}:\d{2}/.test(t) ? t.slice(11 > t.length ? 0 : t.indexOf('T') + 1, t.indexOf('T') + 9) : '';
    var col = f.action === 'SELL' ? '#e0736b' : '#5fbf7a';
    return '<div style="padding:2px 0"><span style="color:' + col + ';font-weight:700">' + esc(f.action) + '</span> ' +
      esc(f.qty) + ' @ ' + esc(f.price) + ' <span style="opacity:.6">' + esc(f.orderType) + (hhmm ? ' · ' + esc(hhmm) : '') + '</span></div>';
  }

  function refresh() {
    try {
      chrome.runtime.sendMessage({ type: 'ei/stats' }, function (s) {
        if (!s || chrome.runtime.lastError) return;
        if (!panel) return;
        countEl.textContent = s.fills + (s.fills === 1 ? ' fill' : ' fills');
        streamEl.textContent = s.ws;
        apiEl.textContent = s.requests;
        if (s.recent && s.recent.length) listEl.innerHTML = s.recent.slice().reverse().map(fmtFill).join('');
        else listEl.innerHTML = '<div style="opacity:.5">No fills yet — place trades with this open.</div>';
      });
    } catch (e) {}
  }

  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
    } catch (e) {}
  }

  function doExport() {
    chrome.runtime.sendMessage({ type: 'ei/dump' }, function (r) {
      if (!r || chrome.runtime.lastError) { statusEl.textContent = 'Export failed — reopen the page and try again.'; return; }
      var text = JSON.stringify(r.payload);
      download('edge-capture-' + new Date().toISOString().slice(0, 10) + '.json', text);
      try { navigator.clipboard && navigator.clipboard.writeText(text).catch(function () {}); } catch (e) {}
      statusEl.textContent = 'Exported ' + (r.fills ? r.fills.length : 0) + ' fills · file downloaded & copied. Import it in Edge Intelligence.';
    });
  }

  function doClear() {
    if (!confirm('Clear all captured fills for this session?')) return;
    chrome.runtime.sendMessage({ type: 'ei/clear' }, function () { refresh(); statusEl.textContent = 'Cleared. Recording fresh.'; });
  }

  function start() {
    build();
    refresh();
    setInterval(refresh, 1200);
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
