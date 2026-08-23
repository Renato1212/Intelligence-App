# Edge Capture v2 — Trader One → Edge Intelligence

One click copies your **visible trading data** (the orders / fills / trade
history tables) as clean text, ready to paste into **Edge Intelligence →
Import**, where fills are split into trades automatically (scale-ins/outs,
flips and all).

## Why v2

v1 tried to intercept the platform's live WebSocket fills. In practice that
produced large diagnostic files without reliable fills. v2 does the simple,
robust thing: it reads what YOU can see on screen. If the table is on your
screen, it captures.

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.

## Use

1. In Trader One, open the panel that shows your **fills / order history**
   for the day (make sure the rows are visible).
2. Click the Edge Capture toolbar icon → **Capture trading data**.
3. It copies the rows to your clipboard (and can download a small .txt).
4. In Edge Intelligence: **Import → paste** — trades are built automatically.

No background recording, no WebSocket interception, no big files: it only
reads the visible tables of the active tab when you click, and nothing leaves
your machine.

---

## Trading Technologies — automatic trade recording

The extension also watches your **Trading Technologies** positions so Edge
Intelligence can record your workspace around every trade without you touching
anything mid-session.

### How it works

1. A content script runs on the TT page at `document_start`, before TT's own
   code, and observes the WebSocket / REST traffic the platform already
   exchanges. It detects **fills** and **position snapshots** by their shape, so
   it does not depend on TT's exact field names.
2. It keeps a running **net position** per instrument. Leaving zero = position
   open; returning to zero = position closed. A scaled entry therefore produces
   **one** recording for the whole position, not one per fill.
3. Those events are relayed to your open Edge Intelligence tab, which starts and
   stops the screen recording and stores the clip.

It only ever **reads**. It never places, modifies or cancels an order, and
nothing leaves your browser.

### Setup

1. Load the extension (see above) — it now also covers `trade.tt` and
   `tradingtechnologies.com`.
2. Open **Edge Intelligence → Today**, and click **Arm recorder** once at the
   start of your session, choosing the screen or window to capture.
3. Open TT in another tab and trade normally.

**Why the one click?** Browsers only allow screen capture to start from a user
gesture — a page cannot silently begin recording your screen. That is a security
rule and cannot be bypassed. Arming grants the capture once and keeps the stream
alive, so from that point every position records automatically.

### If your TT runs on a different host

TT is deployed under several domains. If yours is not `trade.tt` or
`tradingtechnologies.com`, add it to `host_permissions` and to the two TT
entries in `content_scripts` in `manifest.json`, then reload the extension.

### If positions are not detected

Recording still works — use the **Long / Short** buttons in the Trade recorder
panel to start a clip by hand and **Stop & save** to end it. If you want
automatic detection fixed for your TT build, capture what the platform is
sending (DevTools → Network → WS) and share a sample message; the detector is
shape-based and easy to extend.

### Storage

Clips are stored **on your device only** — video is far too large for cloud
sync. The panel shows the total size; save the ones worth keeping and delete the
rest so the browser's storage quota stays healthy.
