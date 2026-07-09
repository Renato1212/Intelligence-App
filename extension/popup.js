/* Edge Capture popup — the toolbar-icon UI. Talks to the background aggregator. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function setStatus(msg, warn) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'hint' + (warn ? ' warn' : '');
  }

  function refresh() {
    chrome.runtime.sendMessage({ type: 'ei/stats' }, function (s) {
      if (chrome.runtime.lastError || !s) { setStatus('Background not ready — reopen this popup.', true); return; }
      $('count').textContent = s.fills + (s.fills === 1 ? ' fill' : ' fills');
      $('ws').textContent = s.ws;
      $('wsbin').textContent = s.wsbin;
      $('req').textContent = s.requests;
      $('workers').textContent = s.workers;
      var total = s.ws + s.wsbin + s.requests;
      if (total === 0 && s.workers > 0) {
        $('sub').textContent = 'No page traffic — data likely in a Worker.';
        setStatus(s.workers + ' worker(s) detected but no page-level socket. Use Download diagnostic and send it to support.', true);
      } else if (total === 0) {
        $('sub').textContent = 'Waiting for trading traffic…';
        setStatus('Enable BEFORE the page loads, then place or view a trade.', false);
      } else {
        $('sub').textContent = 'Recording while you trade.';
        setStatus('', false);
      }
    });
  }

  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 2000);
    } catch (e) {}
  }

  $('export').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'ei/dump' }, function (r) {
      if (chrome.runtime.lastError || !r) { setStatus('Export failed — reload Trader One and retry.', true); return; }
      download('edge-capture-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(r.payload));
      setStatus('Exported ' + (r.fills ? r.fills.length : 0) + ' fills. Import the file in Edge Intelligence.', false);
    });
  });

  $('diag').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'ei/diag' }, function (r) {
      if (chrome.runtime.lastError || !r) { setStatus('Diagnostic failed — reload Trader One and retry.', true); return; }
      download('edge-capture-diagnostic-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(r.payload, null, 2));
      setStatus('Diagnostic downloaded — send this file to support to add your fill format.', false);
    });
  });

  $('clear').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'ei/clear' }, function () { refresh(); setStatus('Cleared. Recording fresh.', false); });
  });

  refresh();
  setInterval(refresh, 1200);
})();
