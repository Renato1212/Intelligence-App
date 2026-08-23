/*
 * Isolated-world bridge on the Edge Intelligence page.
 *
 * Receives position events from the background worker and posts them into the
 * page, where the app's `listenForPlatform` picks them up and drives the
 * recorder. The app never talks to the trading platform directly.
 */
try {
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== 'ei/position' || !msg.payload) return;
    var p = msg.payload;
    window.postMessage({
      __eiPosition: true,
      kind: p.kind, instrument: p.instrument, action: p.action,
      qty: p.qty, netQty: p.netQty, at: p.at,
    }, window.location.origin);
  });
  // let the app know a bridge is present
  window.postMessage({ __eiPosition: true, kind: 'hello', at: new Date().toISOString() }, window.location.origin);
} catch (e) {}
