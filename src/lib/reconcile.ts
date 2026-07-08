/*
 * Date reconciliation — estimated release dates vs the confirmed schedule.
 *
 * The zero-API calendar anchors a few releases (CPI, PPI, Retail, JOLTS, PCE,
 * auction weeks) to their TYPICAL slot in the month, because the agencies
 * shift exact dates a few days month to month. Those events carry
 * approx: true. When live provider rows are available (fetched by the
 * Catalysts page and cached), this module reconciles the estimates:
 *
 *  - estimate confirmed on its date  → approx flag cleared
 *  - release confirmed on ANOTHER date in the covered range → the event is
 *    removed from the estimated day and shown on the confirmed day instead
 *  - no matching row anywhere in a well-covered range → the estimate is
 *    removed (the provider covers all US releases; absence = not scheduled)
 *
 * Without coverage the estimates stay visible, marked "~" in the UI — an
 * honest estimate beats silently wrong data.
 */
import { etInstant, eventsForDate, type CalendarEvent } from './calendar';
import { cachedRowsCovering, fetchUSCalendarRange, getMarketApiKey, hasLiveMatcher, rowsMatching, type LiveEventRow } from './market';

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Rebuild an event on a new date, keeping its template ET time. */
function movedTo(e: CalendarEvent, dateISO: string): CalendarEvent {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm] = e.timeET.split(':').map(Number);
  return {
    ...e,
    id: `${e.short}-${dateISO}`,
    date: dateISO,
    instant: etInstant(y, m - 1, d, hh, mm),
    approx: false,
  };
}

/**
 * Reconcile one day's rule events against provider rows covering [from, to].
 * Pure — testable without the network or localStorage.
 */
export function reconcileDay(
  dateISO: string,
  base: CalendarEvent[],
  rows: LiveEventRow[],
  from: string,
  to: string,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const e of base) {
    if (!e.approx || !hasLiveMatcher(e.short)) {
      // exact-rule events, and estimates the feed can't confirm or deny
      // (e.g. Treasury auctions), pass through untouched
      out.push(e);
      continue;
    }
    const matches = rowsMatching(e.short, rows);
    if (!matches.length) continue; // covered range, no such release scheduled → drop the estimate
    if (matches.some((r) => r.date === dateISO)) out.push({ ...e, approx: false });
    // else: confirmed on another day — it will appear there via the move-in pass
  }

  // move-in pass: approx events whose release is confirmed on THIS date.
  // The rule slot may sit outside the covered range (e.g. estimated last
  // week, confirmed this week), so the rule scan extends ±14 days beyond it.
  const present = new Set(out.map((e) => e.short));
  const scanFrom = addDaysISO(from, -14);
  const scanTo = addDaysISO(to, 14);
  for (let d = scanFrom; d <= scanTo; d = addDaysISO(d, 1)) {
    if (d === dateISO) continue;
    for (const e of eventsForDate(d)) {
      if (!e.approx || present.has(e.short)) continue;
      if (rowsMatching(e.short, rows).some((r) => r.date === dateISO)) {
        out.push(movedTo(e, dateISO));
        present.add(e.short);
      }
    }
  }

  return out.sort((a, b) => a.instant.localeCompare(b.instant));
}

/**
 * Day view with reconciliation applied when cached provider rows cover the
 * date; falls back to the rule calendar (estimates marked approx) otherwise.
 */
export function reconciledEventsForDate(dateISO: string): { events: CalendarEvent[]; reconciled: boolean } {
  const base = eventsForDate(dateISO);
  const cov = cachedRowsCovering(dateISO);
  if (!cov.covered) return { events: base, reconciled: false };
  return { events: reconcileDay(dateISO, base, cov.rows, cov.from, cov.to), reconciled: true };
}

/** Reconciled events over the next `days` days (estimates kept where uncovered). */
export function reconciledUpcoming(startISO: string, days: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (let i = 0; i <= days; i++) out.push(...reconciledEventsForDate(addDaysISO(startISO, i)).events);
  return out.sort((a, b) => a.instant.localeCompare(b.instant));
}

/* Fetch coverage from ANY consumer (prep, command center) — reconciliation
 * must not depend on the trader visiting the Catalysts page first. Attempts
 * are throttled so multiple components mounting together fetch once. */
let lastCoverageTry = 0;

/**
 * Ensure cached provider rows cover `dateISO` (3-week window), fetching them
 * if a market-data key is connected. Resolves true when coverage exists.
 */
export async function ensureLiveCoverage(dateISO: string): Promise<boolean> {
  if (cachedRowsCovering(dateISO).covered) return true;
  if (!getMarketApiKey()) return false;
  if (Date.now() - lastCoverageTry < 60000) return false;
  lastCoverageTry = Date.now();
  const res = await fetchUSCalendarRange(addDaysISO(dateISO, -7), addDaysISO(dateISO, 14));
  return res.rows.length >= 8;
}
