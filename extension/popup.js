/*
 * Edge Capture v2 — simple, reliable: read the VISIBLE trading tables.
 *
 * The old version tried to intercept Trader One's live WebSocket fills; that
 * produced huge diagnostic files without clean fills. This version does the
 * robust thing instead: it reads the rows of whatever grid/table is on screen
 * (orders, fills, trade history) across all frames, keeps only lines that look
 * like trading rows (a time and a price), and hands them to you as clean text
 * that Edge Intelligence's Import-paste understands (it splits fills into
 * trades automatically).
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var out = $('out');
  var status = $('status');

  // Runs INSIDE the page (every frame): harvest grid/table row text.
  function scrapeRows() {
    var lines = [];
    var seen = Object.create(null);
    function push(cells) {
      var txt = cells
        .map(function (c) { return (c.innerText || '').replace(/\s+/g, ' ').trim(); })
        .filter(Boolean)
        .join('\t');
      if (txt.length < 6) return;
      if (seen[txt]) return;
      seen[txt] = 1;
      lines.push(txt);
    }
    // classic tables
    document.querySelectorAll('table tr').forEach(function (tr) {
      push(Array.prototype.slice.call(tr.querySelectorAll('td,th')));
    });
    // ag-grid / ARIA grids (Trader One uses div-based grids)
    document.querySelectorAll('[role="row"], .ag-row').forEach(function (row) {
      var cells = row.querySelectorAll('[role="gridcell"], [role="columnheader"], .ag-cell');
      if (cells.length) push(Array.prototype.slice.call(cells));
    });
    return lines;
  }

  // Keep only rows that plausibly describe an order/fill: a clock time AND a
  // decimal price-ish number. Headers and UI chrome fall away.
  function looksLikeTradeRow(line) {
    var hasTime = /\b\d{1,2}:\d{2}(:\d{2})?\b/.test(line);
    var hasPrice = /\b\d{2,6}([.,']\d{1,4})\b/.test(line);
    return hasTime && hasPrice;
  }

  function setStatus(msg, err) {
    status.textContent = msg;
    status.className = err ? 'err' : '';
  }

  $('capture').addEventListener('click', function () {
    setStatus('Reading tables…');
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !tab.id) return setStatus('No active tab.', true);
      chrome.scripting.executeScript(
        { target: { tabId: tab.id, allFrames: true }, func: scrapeRows },
        function (results) {
          if (chrome.runtime.lastError) return setStatus(chrome.runtime.lastError.message, true);
          var all = [];
          (results || []).forEach(function (r) { if (r && r.result) all = all.concat(r.result); });
          var rows = all.filter(looksLikeTradeRow);
          var text = rows.join('\n');
          out.value = text;
          $('copy').disabled = $('download').disabled = !rows.length;
          if (!rows.length) {
            setStatus('No trading rows visible — open the panel that shows your orders/fills table (scroll it into view) and capture again. Raw rows seen: ' + all.length + '.', true);
            return;
          }
          navigator.clipboard.writeText(text).then(
            function () { setStatus('Captured ' + rows.length + ' rows — copied to clipboard. Paste into Import.'); },
            function () { setStatus('Captured ' + rows.length + ' rows. Use Copy below.'); }
          );
        }
      );
    });
  });

  $('copy').addEventListener('click', function () {
    navigator.clipboard.writeText(out.value).then(function () { setStatus('Copied.'); });
  });

  $('download').addEventListener('click', function () {
    var blob = new Blob([out.value], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trader-one-' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });
})();
