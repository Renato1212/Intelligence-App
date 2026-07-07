# Edge Intelligence

**The data-centered intelligence platform for futures traders.** Track, analyse and develop trading
strategies around the 5 Edge Domain framework — with the journal, debrief and coach-grading workflow
built in, stunning analytics that show you exactly where your edge is and whether it is growing,
multi-trader cloud accounts, and an AI Coach that turns any AI subscription into a personal
performance analyst with full access to your data.

![Dashboard](docs/dashboard.png)

## What it does

### Data in — from the platforms you already trade on
- **MotiveWave** — export the Trade Log / Trade History to CSV and drop it on the Import page.
  Entry/exit times, prices, size and realized P&L are read directly.
- **Rithmic (R Trader Pro)** — export Order History / Fills to CSV. Raw fills are paired **FIFO per
  contract** into round-trip trades (scale-ins/outs averaged correctly), and P&L is computed from a
  built-in table of CME/Eurex contract point values (ES, MES, NQ, MNQ, CL, MCL, GC, 6E, ZN, FDAX …).
- **Any other platform** — any CSV with symbol, entry/exit time, price, quantity and (optionally)
  P&L columns works. Headers are matched by name; column order and naming variants don't matter.
- Re-importing the same file is safe — duplicates are detected and skipped.
- **Private by default, synced by choice**: all data lives locally in your browser (IndexedDB) and
  works fully offline. Create a free account (Account page) to sync everything to your own cloud
  profile — protected by row-level security so every trader only ever sees their own data — and
  pick it up on any device. One-click JSON backup / restore in Settings either way.

### The 5 Edge Domain framework, built in
The whole app speaks the AXIA edge-domain language:

1. **Central Banks** — the edge that pays when policy moves the market
2. **Economic Data** — where blowout numbers and policy collide
3. **News (Geo-Macro)** — unscheduled headlines and cross-asset moves
4. **Technicals** — the edge that supports every other domain
5. **Flow Events** — the survival edge when nothing else is in play

Every trade is classified exactly the way a coach would tag it:
- **Level 1** — the edge domain
- **Level 2** — the category inside the domain (Statement/Presser/Speaker…, Candlesticks/Profile/DOM/Footprint…, Auctions/OPEX/Opens/MOC…)
- **Level 3** — refinement tags with per-domain suggestions (Hawkish, Phase 2, Smash & Grab, Pre-close…) plus free-form tags

![Trade debrief](docs/trade-debrief.png)

### Coach grading — the bar coaches hold you to
Each trade can be graded on the five criteria (**Trigger recognition, Sizing, Exit discipline,
Articulation, Post-trade review**) against the *below / at / above standard* rubric of its domain —
the full rubric text is shown in the grading table for the trade's domain. Your average grade
profile is charted as a radar in Edge Analytics, so you can see which skill is lagging.

### The full daily cycle — prepare, execute, debrief
- **Trading Day hub** — preparation, the day's trades and the debrief for one date in a single
  section, with every video, photo and link for that day gathered in one strip.
- **Day preparation** — the AXIA preparation template as a structured form: overnights across the
  markets *you* choose each day (20 common futures one click away — Dollar/DXY, Gold, Crude, ES,
  NQ, DAX, Bunds, ZN… — plus any custom market), news priced-in vs developing, an events table
  with expectations and previous reactions, chart analysis (daily / profile / 60m / 5m) and the
  three hypotheses, each with an in-play trigger and a line-in-the-sand.
- **Trade debrief** — what you expected vs what happened, what you learned, how you'll apply it,
  video link, planned risk (giving automatic R-multiples).
- **Daily debrief** — narrative, comparison with your preparation and hypothesis, lesson, action;
  1–5 self-scores for preparation and execution quality; the day's trades and P&L shown alongside.
- **Photos & videos everywhere** — attach chart screenshots / phone photos (resized and stored
  locally so they work offline) and videos to trades, debriefs and preparations. Sign in and a
  video can be **uploaded and hosted directly in your own private cloud storage folder** with one
  click — no third-party video host required — or just paste any external link instead.
- **Exports** — preparation, trades and debrief each downloadable on their own or combined as a
  full day pack (photos included), in Markdown, JSON or a print-ready page (save as PDF);
  individual trade debriefs too, and any filtered trade list as CSV.
- **Edge Capture — extract from Trader One** (or any web journal with no API/export): a
  bookmarklet records the JSON the page itself downloads (works even on canvas-rendered apps with
  no readable DOM) and continuously scans visible trade tables — including the **Order History /
  executions view**, so every scale-in/scale-out fill (exact size, price, time, market/limit type)
  attaches to its trade. Produces an `edge-capture.json` that imports here — stats, tags,
  descriptions, per-fill execution detail and photos included. Existing trades are enriched, never
  duplicated. If a platform's layout isn't recognised, the app shows the raw headers/field names it
  found so support can be added precisely. Nothing leaves your browser during capture.
- **Execution ladder** — for trades with fill-level detail, the trade page shows every fill labelled
  Entry / Scale-in / Scale-out / Exit, with the running position size and the evolving average price
  of the open position — built for studying your scaling decisions, not just the averaged result.
- **Study filters** — combine domain, instrument, date and multi-tag filters (setups, phases,
  data events like NFP / CPI / ISM…) across trades, and filter journal days by the tags of the
  trades inside them.

### Accounts & cloud sync — one app, every trader has their own data
The app opens on a **login wall**: each trader signs in to their own profile, so the same deployment
can be shared across a whole desk. Everything — trades, debriefs, preparations, strategies, photos —
syncs automatically to a cloud database a couple of seconds after you make a change, and pulls down
on sign-in anywhere else. Row-level security means a signed-in trader can only ever read or write
their own rows; two traders never see each other's data. Demo data is automatically kept out of your
real cloud profile. (A "continue on this device without an account" link is available for local-only
use, and the app keeps working fully offline either way — the cloud copy is a mirror, not a
requirement.)

### AI Coach — turn your AI subscription into a trading analyst
One click builds a complete Markdown dossier of your journal — overview stats, edge tables by
domain/setup/hour/instrument, your coach grade profile, every strategy with its sample stats, the
full chronological trade log (including per-fill scaling detail, tags, descriptions and lessons),
every daily debrief and every preparation with its hypotheses — sized for pasting or attaching to
Claude, ChatGPT or Gemini. Ready-made prompts find hidden patterns, audit your scaling decisions,
grade you like an AXIA coach, and build next week's plan.

### Market Intel — who is positioned where (free, keyless)
The CFTC publishes every trader group's futures positioning weekly through a public API that needs
no key and no account. Market Intel pulls three years of Commitments of Traders history for ~30
futures (ES, NQ, ZN, 6E, CL, GC, BTC …) straight from the trader's browser and turns it into the
read paid COT services sell:

- **Positioning board** — large speculators' net position per market, week-over-week change, where
  it sits in the 3-year range (percentile), a 1-year trend sparkline, and signal chips for
  multi-year extremes, top-decile weekly shifts and net flips.
- **Full market read** — click any market for the 3-year large-spec vs commercial net chart, open
  interest, and a one-line interpretation in trader language (crowded long, drained shorts,
  regime-change flips…).
- **This week's focus** — the idea engine. Positioning extremes × this week's tier-1 catalysts ×
  *your own* per-instrument expectancy, ranked by how many independent reads agree — with every
  reason stated explicitly. A negative personal edge on a market is called out as a caution, not
  hidden. Data is cached locally, so the board keeps working offline between weekly reports.
- **Woven into the workflow** — the Dashboard command center shows the week's focus markets at a
  glance; every market added to the day-preparation *Overnights* section carries its live
  positioning read inline (extremes flagged ⚑); and the AI Coach dossier includes the full
  positioning table + confluence list, so your AI analyst sees the market context alongside your
  trades.

### Release intelligence — the data behind every catalyst (free, keyless)
The Catalysts section doesn't just list NFP and CPI — it shows what each release has actually been
**printing**, pulled keylessly from DBnomics (the official BLS/ISM data, CORS-open, no account):

- **Print history charts** — 4 years of prints per indicator (payrolls change, unemployment, AHE,
  headline & core CPI m/m, core CPI y/y, PPI, JOLTS openings, both ISMs), with the ±1σ band and
  2-year average drawn in and the latest print highlighted — outliers are visible at a glance.
- **Pre-release read, computed** — z-score of the last print vs the 2-year trend, 3-month vs
  12-month pace (momentum building or fading), 5-year percentile, consecutive-print streaks and a
  print-volatility regime check — condensed into one plain-language insight line, plus **your own
  record** on that event's days from your trade history.
- **Live consensus → actual** — connect the free FMP key and the week-ahead list carries each
  event's consensus, refreshing every minute on release days; the actual lands next to it with a
  deviation arrow the moment it prints. A countdown chip runs on the next scheduled release.
- Everything caches locally: history keeps working offline, and each indicator degrades
  independently with an inline note if a source is unreachable.

### Live day-ahead briefing
The preparation page can connect a free market-data key (financialmodelingprep.com) and fills
itself in every morning: today's tier-1 economic events with consensus and previous prints —
actuals appear the moment they're released — plus an overnight risk-sense read across equities,
vol, rates, dollar, metals and energy. Auto-refreshes while you prepare.

### Analytics that answer real questions
![Analytics](docs/analytics.png)

- Equity curve, daily P&L, 6-month P&L calendar heatmap
- Net P&L, win rate, profit factor, expectancy ($ and R), payoff ratio, max drawdown, streaks,
  annualized daily Sharpe, average hold time
- **Edge by domain** and **best setups** (domain × category) ranked by expectancy
- **Edge development** — rolling 20-trade expectancy shows edge growing or decaying
- Time-of-day, day-of-week, hold-time, instrument and direction breakdowns
- **Review discipline** — % of trades tagged and graded, because the review *is* the development
- Coach grade radar across the five criteria

### Strategy Lab
Turn observations into templates and templates into tested strategies: each strategy has a
hypothesis, rules and a lifecycle (**incubating → testing → active → retired**). Link trades to a
strategy from the debrief page and the sample stats (trades, net P&L, win rate, expectancy, avg R)
build automatically.

### The Playbook
The full 5 Edge Domain playbook as an interactive reference — what to look for, how to classify,
common mistakes and the grading rubric for every domain — with **your own live stats** (trades, P&L,
win rate, expectancy) displayed next to each domain.

![Playbook](docs/playbook.png)

## Getting started

```bash
npm install
npm run dev       # development server
npm run build     # production build (output in dist/)
npm run preview   # serve the production build
```

Open the app, click **Load demo data** to explore the full platform with a realistic 8-month
dataset, then clear it in Settings and import your own trades.

## Tech

- React 18 + TypeScript + Vite
- Dexie (IndexedDB) — local-first, offline-capable
- Supabase (Postgres + Auth + Storage) — optional cloud accounts, row-level-security-protected
  sync, and private media storage
- Recharts — visualizations follow a validated dark-surface palette (colorblind-safe categorical
  colors, diverging profit/loss encoding)
- No telemetry; data never leaves your device unless you create an account
