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

1. Open **Trader One** (`trader.axiafutures.com`) with the extension already
   installed and enabled — it must be on **before the page loads** so it can
   hook the socket from its first frame. A gold **Edge Capture** panel also
   appears bottom-right with a live fill count.
2. **Click the toolbar icon** any time for the popup: it shows the live
   capture counts (WS text, WS binary, API responses, Workers) and the
   **Export** / **Download diagnostic** / **Clear** buttons.
3. Trade as normal, then click **Export fills**. An `edge-capture-*.json`
   downloads.
4. In **Edge Intelligence → Import**, drop that file. Your fills become the
   Entry / Scale-in / Scale-out / Exit ladder on each trade, editable in the
   Execution Logger.

## If no fills are captured

Trading platforms vary in *where* they stream fills. The popup tells you what
was seen:

- **WS binary > 0 but no fills** — the platform streams fills as a binary
  protocol (protobuf/msgpack). Click **Download diagnostic** and send the file;
  it carries the raw frames (base64) so the exact format can be decoded.
- **Workers > 0 but WS/API all 0** — the fills socket runs inside a Web Worker
  that a page-level hook can't reach. The diagnostic records this explicitly;
  send it so the worker path can be added.
- **Everything 0** — the extension wasn't enabled before the page loaded, or no
  trade happened yet. Reload Trader One with the extension on, then trade.

**Either way, you are never blocked:** every trade in Edge Intelligence has an
**Execution Logger** where you can enter each fill by hand — action, order type
(market / limit / stop), price, size and time — and the running position,
average price and realized P&L are computed for you, exactly as if they'd been
captured. Captured fills land in the same logger and can be corrected there.

## Safety

This build is deliberately **non-invasive**: it only *observes* network traffic
and never rewrites the platform's data, scripts or Workers — so it cannot break
Trader One while you trade. Everything stays in your browser; nothing is sent
anywhere. The buffer survives reloads and restarts (stored locally); use
**Clear** to start a fresh session.
