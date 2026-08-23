/*
 * Background worker: fan position events from the Trading Technologies tab out
 * to every open Edge Intelligence tab. Holds no data beyond the last event.
 */
const EI_MATCH = ['*://localhost/*', '*://127.0.0.1/*', '*://*.vercel.app/*'];

chrome.runtime.onMessage.addListener((msg, _sender) => {
  if (!msg || msg.type !== 'ei/position') return;
  chrome.tabs.query({ url: EI_MATCH }, (tabs) => {
    for (const t of tabs) {
      if (t.id != null) {
        try { chrome.tabs.sendMessage(t.id, { type: 'ei/position', payload: msg.payload }); } catch (e) {}
      }
    }
  });
});
