/*
 * Trading Technologies position watcher — reads the POSITIONS GRID.
 *
 * Why the DOM and not the wire: intercepting the platform's WebSocket means
 * reverse-engineering a private protocol that can be binary, can live inside a
 * Web Worker (where a page-level hook never sees it), and changes without
 * notice. The positions widget, by contrast, is the same thing the trader is
 * looking at — if a human can see "ES  +3", so can this.
 *
 * It only READS the page. It never places, modifies or cancels an order.
 *
 * Every scan also records what it saw into chrome.storage, so the extension
 * popup can hand back a diagnostic when detection does not find the grid.
 */
(function () {
  'use strict';
  if (window.__eiTTPos) return;
  window.__eiTTPos = true;

  var POLL_MS = 1000;

  /** Words that mark a grid as the positions widget rather than orders/fills. */
  var POS_HEADER = /(net\s*pos|position|net\s*qty|netqty|open\s*qty|working\s*pos)/i;
  /** Headers that mean this grid is definitely NOT positions. */
  var NOT_POS_HEADER = /(order\s*id|time\s*in\s*force|fill\s*time|order\s*type|bid|ask|last\s*trade)/i;

  function txt(el) {
    return ((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  }

  /** A futures contract label: ES, ESZ5, MESZ25, 6EZ5, ZN, "CME/ES"… */
  function asInstrument(s) {
    if (!s) return null;
    var t = s.toUpperCase().replace(/^[A-Z]+[:/]/, '').trim(); // drop "CME/" or "CME:"
    t = t.split(/[\s,]/)[0];
    if (!/^[A-Z][A-Z0-9]{0,6}$/.test(t)) return null;
    if (/^\d+$/.test(t)) return null;
    // strip a trailing month+year code so ESZ5 and ESH6 are both "ES"
    var root = t.replace(/([A-Z0-9]{1,4})[FGHJKMNQUVXZ]\d{1,2}$/, '$1');
    return root.slice(0, 6) || null;
  }

  /** A signed quantity cell: 3, -2, +5, (2) = -2. */
  function asQty(s) {
    if (s == null) return null;
    var t = String(s).trim().replace(/,/g, '');
    if (!t) return null;
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
    var n = Number(t);
    if (!isFinite(n)) return null;
    return neg ? -Math.abs(n) : n;
  }

  function cellsOf(row) {
    var cs = row.querySelectorAll('[role="gridcell"], [role="cell"], .ag-cell, td');
    if (!cs.length) cs = row.children;
    return Array.prototype.slice.call(cs).map(txt);
  }

  /** Every grid-like container on the page, across same-origin frames. */
  function docs() {
    var out = [document];
    try {
      var ifr = document.querySelectorAll('iframe');
      for (var i = 0; i < ifr.length; i++) {
        try { if (ifr[i].contentDocument) out.push(ifr[i].contentDocument); } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function gridsIn(doc) {
    var out = [];
    try {
      var nodes = doc.querySelectorAll('table, [role="grid"], [role="table"], [role="treegrid"], .ag-root, .ag-root-wrapper');
      for (var i = 0; i < nodes.length; i++) out.push(nodes[i]);
    } catch (e) {}
    return out;
  }

  function headerTextOf(grid) {
    var h = '';
    try {
      var hs = grid.querySelectorAll('thead, [role="columnheader"], .ag-header-cell-text, .ag-header-cell, th');
      for (var i = 0; i < hs.length && i < 60; i++) h += ' ' + txt(hs[i]);
    } catch (e) {}
    return h;
  }

  function rowsOf(grid) {
    var rs = [];
    try {
      var nodes = grid.querySelectorAll('[role="row"], .ag-row, tbody tr');
      for (var i = 0; i < nodes.length && i < 300; i++) rs.push(nodes[i]);
    } catch (e) {}
    return rs;
  }

  /**
   * Scan the page for the positions grid and return the net position per
   * instrument, plus a diagnostic of what was inspected.
   */
  function scan() {
    var found = {};
    var diag = { url: location.href, grids: [], matchedGrid: null, at: new Date().toISOString() };

    var all = [];
    var ds = docs();
    for (var d = 0; d < ds.length; d++) {
      var gs = gridsIn(ds[d]);
      for (var g = 0; g < gs.length; g++) all.push(gs[g]);
    }

    for (var i = 0; i < all.length && i < 40; i++) {
      var grid = all[i];
      var header = headerTextOf(grid);
      var rows = rowsOf(grid);
      var entry = { header: header.slice(0, 240), rows: rows.length, sample: [] };

      var looksPos = POS_HEADER.test(header) && !NOT_POS_HEADER.test(header);
      var hits = {};
      var hitCount = 0;

      for (var r = 0; r < rows.length; r++) {
        var cells = cellsOf(rows[r]);
        if (!cells.length) continue;
        if (entry.sample.length < 3) entry.sample.push(cells.join(' | ').slice(0, 160));

        // find an instrument cell and a quantity cell in the same row
        var inst = null;
        var qty = null;
        for (var c = 0; c < cells.length; c++) {
          if (inst == null) {
            var maybe = asInstrument(cells[c]);
            if (maybe) { inst = maybe; continue; }
          }
          if (qty == null) {
            var q = asQty(cells[c]);
            // a bare 0 alone is ambiguous; accept it only once an instrument is known
            if (q != null && inst != null) { qty = q; }
          }
        }
        if (inst != null && qty != null) {
          hits[inst] = qty;
          hitCount++;
        }
      }
      entry.positionRows = hitCount;
      entry.looksLikePositions = looksPos;
      diag.grids.push(entry);

      if (looksPos && hitCount > 0 && diag.matchedGrid == null) {
        diag.matchedGrid = { header: entry.header, rows: hitCount };
        for (var k in hits) if (Object.prototype.hasOwnProperty.call(hits, k)) found[k] = hits[k];
      }
    }
    return { positions: found, diag: diag };
  }

  var last = {};

  function tick() {
    var res;
    try { res = scan(); } catch (e) { return; }

    // publish a diagnostic the popup can hand back
    try { chrome.storage.local.set({ 'ei-tt-diag': res.diag }); } catch (e) {}

    var pos = res.positions;
    // anything that disappeared from the grid is flat
    for (var k in last) {
      if (Object.prototype.hasOwnProperty.call(last, k) && !(k in pos)) pos[k] = 0;
    }
    for (var inst in pos) {
      if (!Object.prototype.hasOwnProperty.call(pos, inst)) continue;
      var net = pos[inst];
      if (last[inst] === net) continue;
      last[inst] = net;
      try {
        chrome.runtime.sendMessage({
          type: 'ei/position',
          payload: { kind: 'position', instrument: inst, netQty: net, at: new Date().toISOString() },
        });
      } catch (e) {}
    }
    // forget instruments that are flat so they can re-open cleanly later
    for (var j in last) {
      if (Object.prototype.hasOwnProperty.call(last, j) && last[j] === 0 && !(j in res.positions)) delete last[j];
    }
  }

  setInterval(tick, POLL_MS);
  setTimeout(tick, 1500);
})();
