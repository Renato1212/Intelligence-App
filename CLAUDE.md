# Edge Intelligence — project contract

## Mission

A personal, single-user, local-first trading environment for a discretionary
CME futures trader working in an auction-market-theory / order-flow framework
organised around **Context, Edge, Process**.

This is **not** a trading platform. Execution and charts live in Trader One /
MotiveWave / Rithmic. This is *the environment around the screen*: it assembles
context before the session, keeps the trader honest during it, scores the day
after it, and turns years of sessions into a searchable body of knowledge
instead of a pile of forgotten days.

## The three product laws

Every design decision resolves against these, in order.

**Law 1 — Calm surface, deep archive.** The live screen must be quiet enough to
read a price ladder next to it. Depth lives one click down, never on the
surface. If a panel does not change a decision about to be made, it does not
belong on the live screen.

**Law 2 — Every input becomes a scored record.** Nothing is typed into a
free-text box and lost. Free text is always *in addition to* structured fields,
never instead of them.

**Law 3 — Nothing is displayed that cannot be acted on or learned from.** No
decorative gauges. If you can't ask "is this high?" and get an answer, cut it.

## Guardrails (non-negotiable)

- **No order routing, no auto-trading, no broker write access.** Read-only.
- **No financial advice framing.** The app surfaces conditions, distributions
  and the trader's own historical behaviour. The judgement is the trader's.
- **Delayed data must be labelled delayed.** A stale price shown as live is a
  bug of the highest severity.
- **Free only.** No paid tier without asking first.
- **Local-first.** Data lives in the browser (IndexedDB); cloud sync is opt-in.

## The routine is the spine

`Trading Routine.md` is the source of truth for the daily loop. Every screen
exists to serve one block of it. The mapping is encoded in `src/lib/routine.ts`
and drives the home screen's single next action.

| Routine block | Screen | What it serves |
|---|---|---|
| Before european session | `/brief` | Fundamentals → Technicals → Environment → written prep |
| Before european session | `/plan` | Scenarios, locations, invalidation, size |
| Before US session | `/reassess` | Five-minute reset; plan holds / adjust / stand down |
| During trade | `/live` | Levels, tape, ladders, plan card |
| After trade | `/debrief` | Each trade and the day; lessons and actions |
| — | `/` (Today) | Session ribbon, one line of state, one next action |
| — | `/archive` | Trades, debriefs, edge analytics, strategies, method |
| — | `/data` | Import, settings, account. Off the trading surface. |

Navigation is **8 items**, grouped *The loop* and *Body of work*. Market panels,
analytics and settings all still exist — they live one click inside the routine
step they serve. Adding a top-level nav item requires removing one.

## Stack

React 18 + TypeScript + Vite · Dexie (IndexedDB) · Recharts + hand-built SVG ·
react-router (HashRouter) · Supabase (opt-in auth + sync) · Vercel.

Deviation from the original build spec, deliberately: the spec proposed
Next.js + Drizzle + pgvector. This codebase was already a working React/Vite/
Dexie app with substantial tested engines; migrating the stack would have
destroyed working features to gain nothing the trader can see. The *structure*
of the spec (routine spine, laws, screens) was adopted; the stack was not.

## Layout

```
src/lib/       engines — pure logic (routine, calendar, risk, stats, insights,
               confluence, cot, options, profile, sessions …)
src/pages/     one screen per routine block, plus deep-link records
src/components/ shared UI, panels, charts, the Hub (routine step shell)
extension/     Edge Capture — MV3 extension that records live Trader One fills
```

## Conventions

- Engines are pure and unit-testable; UI composes them, never re-implements them.
- No new top-level nav without removing one (Law 1).
- Verify in a real browser before claiming a screen works.
