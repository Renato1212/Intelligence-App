# Edge Capture — Trader One fills (browser extension)

Trader One only *persists* the averaged round-trip of each trade — the
individual fills (each scale-in/out, its size, price and market/limit type)
exist **only in the live WebSocket stream while you trade**. A bookmarklet
can't reliably capture that because it runs *after* the page's own code. This
extension can: it replaces `WebSocket` (and `fetch`/`XHR`) at `document_start`
in the page's real context, in every frame, **before** Trader One opens its
socket — so every fill is captured from its first frame, including binary
frames.

Everything stays in your browser. Nothing is sent anywhere.

## Install (Chrome / Edge / Brave)

1. Download this `extension/` folder.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this `extension/` folder.

## Use

1. Open **Trader One** (`trader.axiafutures.com`). A small gold **Edge Capture**
   panel appears bottom-right showing a live fill count.
2. Trade as normal. Each fill you get appears in the panel in real time
   (`SELL 10 @ 7515 limit`, …).
3. When you're done, click **Export**. An `edge-capture-*.json` downloads (and
   is copied to your clipboard).
4. In **Edge Intelligence → Import**, drop that file. Your fills become the
   Entry / Scale-in / Scale-out / Exit ladder, matched to your trades.

**Clear** wipes the current session's buffer so the next export is clean.

## Notes

- The panel is draggable-minimisable (click its header).
- The buffer survives page reloads and browser restarts (stored locally), so a
  long session isn't lost — use **Clear** to start fresh.
- If fills still don't appear after trading, export anyway and share the file:
  it carries a sample of the raw stream so the exact frame format can be tuned.
