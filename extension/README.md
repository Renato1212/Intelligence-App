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
