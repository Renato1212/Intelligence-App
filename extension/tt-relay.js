/*
 * Isolated-world relay on the Trading Technologies page.
 * Forwards what tt-hook.js observes to the background service worker.
 */
window.addEventListener('message', function (ev) {
  if (ev.source !== window) return;
  var d = ev.data;
  if (!d || d.__eiTTEvent !== true || !d.payload) return;
  try { chrome.runtime.sendMessage({ type: 'ei/position', payload: d.payload }); } catch (e) {}
});
