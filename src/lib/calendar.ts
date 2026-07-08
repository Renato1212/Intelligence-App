/*
 * Zero-API economic calendar.
 *
 * The market-moving US releases a discretionary futures trader cares about run
 * on fixed, publicly-documented schedules — so they can be COMPUTED from rules
 * rather than fetched from a paid API. This module derives the tier-1 events
 * for any date deterministically, with the release time in US Eastern and the
 * trader's local zone, plus context: what it moves, why it matters, and how it
 * connects to the AXIA edge domains.
 *
 * Times are the official release times in America/New_York (ET). Because the
 * US observes DST, we resolve the ET→UTC offset for the specific date and then
 * render into the viewer's local zone, so an 08:30 ET print shows correctly
 * whether the trader is in London, Lisbon or Chicago.
 *
 * FOMC decision dates are fixed per year (the Fed publishes them well ahead),
 * so they live in a small table; everything else is rule-derived.
 */

import { flowEventsForMonth } from './flowCalendar';

export type EventImpact = 'high' | 'medium';
export type EdgeDomain = 'central-banks' | 'economic-data' | 'news' | 'technicals' | 'flow';

export interface CalendarEvent {
  id: string;
  /** YYYY-MM-DD in ET (the trading day the release belongs to) */
  date: string;
  /** HH:MM in ET, 24h */
  timeET: string;
  /** Release time as an ISO instant (UTC), for local rendering */
  instant: string;
  name: string;
  short: string;
  impact: EventImpact;
  domain: EdgeDomain;
  /** Markets most sensitive to this release */
  affects: string[];
  /** One-line "why it matters" for the discretionary trader */
  why: string;
  /** How to think about it in AXIA terms */
  playbook: string;
  /** Roughly how often it recurs, for the UI */
  cadence: 'weekly' | 'monthly' | 'scheduled' | '6-weekly';
  /**
   * True when the DATE is estimated from the typical schedule rather than
   * derived from a fixed rule (CPI, PPI, Retail, JOLTS, PCE, auction weeks).
   * The UI marks these and, when a live calendar source is available,
   * reconciles them to the confirmed date (see reconcile.ts).
   */
  approx?: boolean;
}

/* ---------- date helpers (all in terms of a UTC calendar date) ---------- */

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function dowUTC(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m, d)).getUTCDay(); // 0=Sun
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}
/** Nth weekday of a month, e.g. first Friday: nthWeekday(y,m,5,1). Returns day-of-month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  let count = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    if (dowUTC(y, m, d) === weekday) {
      count++;
      if (count === n) return d;
    }
  }
  return -1;
}
/** All dates in a month falling on a given weekday. */
function allWeekdays(y: number, m: number, weekday: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) if (dowUTC(y, m, d) === weekday) out.push(d);
  return out;
}
/** First occurrence of `weekday` on/after day-of-month `from`, or -1. */
function weekdayOnOrAfter(y: number, m: number, from: number, weekday: number): number {
  for (let d = from; d <= daysInMonth(y, m); d++) if (dowUTC(y, m, d) === weekday) return d;
  return -1;
}
/** First business (Mon–Fri) day on/after day-of-month `from`, or -1. */
function businessDayOnOrAfter(y: number, m: number, from: number): number {
  for (let d = from; d <= daysInMonth(y, m); d++) {
    const w = dowUTC(y, m, d);
    if (w !== 0 && w !== 6) return d;
  }
  return -1;
}
/** Next business day strictly after day-of-month `d`, or -1. */
function nextBusinessDay(y: number, m: number, d: number): number {
  return businessDayOnOrAfter(y, m, d + 1);
}

/**
 * Is a given UTC date within US Eastern daylight time?
 * DST: 2nd Sunday of March 02:00 → 1st Sunday of November 02:00.
 */
function isUSDST(y: number, m: number, d: number): boolean {
  const marSecondSun = nthWeekday(y, 2, 0, 2);
  const novFirstSun = nthWeekday(y, 10, 0, 1);
  if (m < 2 || m > 10) return false;
  if (m > 2 && m < 10) return true;
  if (m === 2) return d >= marSecondSun;
  if (m === 10) return d < novFirstSun;
  return false;
}
/** ET offset from UTC in hours (EDT = -4, EST = -5). */
function etOffset(y: number, m: number, d: number): number {
  return isUSDST(y, m, d) ? -4 : -5;
}
/** Build the UTC instant for an ET wall-clock time on a given date. */
export function etInstant(y: number, m: number, d: number, hh: number, mm: number): string {
  const off = etOffset(y, m, d);
  // wall ET = UTC + off  →  UTC = wall - off
  return new Date(Date.UTC(y, m, d, hh - off, mm)).toISOString();
}

/* ---------- FOMC meeting dates (Fed-published; decision on day 2, 14:00 ET) ---------- */
// [year][ [month(0-idx), dayOfDecision], ... ]. Extend yearly as the Fed publishes.
const FOMC: Record<number, [number, number][]> = {
  2024: [[0, 31], [2, 20], [4, 1], [5, 12], [6, 31], [8, 18], [10, 7], [11, 18]],
  2025: [[0, 29], [2, 19], [4, 7], [5, 18], [6, 30], [8, 17], [10, 29], [11, 10]],
  2026: [[0, 28], [2, 18], [3, 29], [5, 17], [6, 29], [8, 16], [10, 28], [11, 9]],
  2027: [[0, 27], [2, 17], [3, 28], [5, 16], [6, 28], [8, 15], [10, 3], [11, 8]],
};

/* ---------- event templates ---------- */
interface Template {
  short: string;
  name: string;
  impact: EventImpact;
  domain: EdgeDomain;
  affects: string[];
  why: string;
  playbook: string;
}
const T = {
  nfp: {
    short: 'NFP', name: 'Non-Farm Payrolls', impact: 'high', domain: 'economic-data',
    affects: ['ES', 'NQ', 'ZN', 'ZB', '6E', 'GC'],
    why: 'The month’s biggest labour read — sets the tone for rate-cut/hike expectations and drives the largest scheduled volatility of the month.',
    playbook: 'Expect a fast two-sided reaction. Trade the second move, not the knee-jerk; watch the revisions and the unemployment/AHE combo, not just the headline.',
  },
  cpi: {
    short: 'CPI', name: 'Consumer Price Index', impact: 'high', domain: 'economic-data',
    affects: ['ES', 'NQ', 'ZN', 'ZB', '6E', 'GC'],
    why: 'The primary inflation gauge — the single most rate-sensitive print. Surprises reprice the entire curve instantly.',
    playbook: 'Core MoM is the number that matters. A hot core = bonds down, dollar up, risk down. Let the spread settle before committing.',
  },
  ppi: {
    short: 'PPI', name: 'Producer Price Index', impact: 'medium', domain: 'economic-data',
    affects: ['ES', 'NQ', 'ZN', 'ZB'],
    why: 'Pipeline inflation and a partial tell for the PCE the Fed targets.',
    playbook: 'Secondary to CPI but can confirm/deny its narrative. Watch when it lands the day after a surprising CPI.',
  },
  fomc: {
    short: 'FOMC', name: 'FOMC Rate Decision', impact: 'high', domain: 'central-banks',
    affects: ['ES', 'NQ', 'ZN', 'ZB', '6E', 'GC'],
    why: 'The rate decision + statement, then the press conference 30 min later. The defining central-bank event.',
    playbook: 'Two distinct events: 14:00 ET statement, 14:30 ET Powell. The presser often reverses the statement move — size accordingly and respect the whipsaw.',
  },
  fomcMins: {
    short: 'FOMC Minutes', name: 'FOMC Meeting Minutes', impact: 'medium', domain: 'central-banks',
    affects: ['ES', 'NQ', 'ZN', 'ZB'],
    why: 'Detail behind a decision from three weeks prior — can shift the tone even with no new policy.',
    playbook: 'Read for dissent and forward-guidance nuance. Reaction is smaller than the decision but tradable on a hawkish/dovish surprise.',
  },
  retail: {
    short: 'Retail Sales', name: 'Retail Sales', impact: 'medium', domain: 'economic-data',
    affects: ['ES', 'NQ', 'ZN'],
    why: 'The consumer is ~70% of GDP — the cleanest monthly read on demand.',
    playbook: 'Control group is the signal. Strong sales = growth-on but can also mean higher-for-longer rates; read it against the current regime.',
  },
  claims: {
    short: 'Jobless Claims', name: 'Initial Jobless Claims', impact: 'medium', domain: 'economic-data',
    affects: ['ES', 'ZN', '6E'],
    why: 'The highest-frequency labour signal — a weekly pulse on the job market.',
    playbook: 'Usually background, but matters most near turning points and in NFP week. Watch the 4-week trend, not one print.',
  },
  pce: {
    short: 'PCE', name: 'Core PCE Price Index', impact: 'high', domain: 'economic-data',
    affects: ['ES', 'NQ', 'ZN', 'ZB', '6E'],
    why: 'The Fed’s preferred inflation measure — the number policy actually targets.',
    playbook: 'Lands late in the month, often pre-telegraphed by CPI/PPI, so the surprise is usually smaller — but a divergence from CPI is a genuine catalyst.',
  },
  ism_mfg: {
    short: 'ISM Mfg', name: 'ISM Manufacturing PMI', impact: 'medium', domain: 'economic-data',
    affects: ['ES', 'NQ', 'ZN'],
    why: 'First survey of the new month — a timely read on the manufacturing cycle and prices-paid inflation.',
    playbook: 'The 50 line is the regime boundary. Prices-paid sub-index is an early inflation tell that can move bonds.',
  },
  ism_svc: {
    short: 'ISM Svcs', name: 'ISM Services PMI', impact: 'medium', domain: 'economic-data',
    affects: ['ES', 'NQ', 'ZN'],
    why: 'Services are the bulk of the US economy — often a bigger mover than the manufacturing survey.',
    playbook: 'Watch employment and prices sub-indices as a pre-NFP and pre-CPI tell.',
  },
  jolts: {
    short: 'JOLTS', name: 'JOLTS Job Openings', impact: 'medium', domain: 'economic-data',
    affects: ['ES', 'ZN'],
    why: 'Labour-demand gauge the Fed watches for wage-pressure signals.',
    playbook: 'Openings-to-unemployed ratio is the Fed’s tightness metric. A big miss/beat can move rate expectations.',
  },
} satisfies Record<string, Template>;

function make(tpl: Template, y: number, m: number, d: number, hh: number, mm: number, cadence: CalendarEvent['cadence'], approx = false): CalendarEvent {
  return {
    id: `${tpl.short}-${ymd(y, m, d)}`,
    date: ymd(y, m, d),
    timeET: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    instant: etInstant(y, m, d, hh, mm),
    name: tpl.name,
    short: tpl.short,
    impact: tpl.impact,
    domain: tpl.domain,
    affects: tpl.affects,
    why: tpl.why,
    playbook: tpl.playbook,
    cadence,
    approx,
  };
}

/** All computed tier-1 events for a given month (0-indexed). */
export function eventsForMonth(y: number, m: number): CalendarEvent[] {
  const ev: CalendarEvent[] = [];

  // NFP: first Friday 08:30. Around July 4th the BLS moves the release to the
  // preceding Thursday when the first Friday is the (observed) holiday.
  let nfpDay = nthWeekday(y, m, 5, 1);
  if (m === 6 && (nfpDay === 3 || nfpDay === 4)) nfpDay -= 1; // Jul 3 observed / Jul 4 holiday
  if (nfpDay > 0) ev.push(make(T.nfp, y, m, nfpDay, 8, 30, 'monthly'));

  // ISM Manufacturing: 1st business day; ISM Services: 3rd business day (10:00 ET).
  // Jan 1 is a market holiday, so January's count starts on the 2nd.
  let bd = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const w = dowUTC(y, m, d);
    if (w === 0 || w === 6) continue;
    if (m === 0 && d === 1) continue; // New Year's Day
    bd++;
    if (bd === 1) ev.push(make(T.ism_mfg, y, m, d, 10, 0, 'monthly'));
    if (bd === 3) { ev.push(make(T.ism_svc, y, m, d, 10, 0, 'monthly')); break; }
  }

  // The following dates are ESTIMATES anchored to the typical pattern — the
  // agencies shift them by a few days month to month, so they carry
  // approx: true and get reconciled to the confirmed date when a live
  // calendar source is connected (reconcile.ts).

  // CPI ~ the Tue–Thu window around the 10th–15th; anchor = first Tuesday
  // on/after the 10th (matches the BLS pattern within ~a day most months)
  const cpiDay = weekdayOnOrAfter(y, m, 10, 2);
  if (cpiDay > 0) ev.push(make(T.cpi, y, m, cpiDay, 8, 30, 'monthly', true));
  // PPI usually lands the business day after CPI
  const ppiDay = cpiDay > 0 ? nextBusinessDay(y, m, cpiDay) : -1;
  if (ppiDay > 0) ev.push(make(T.ppi, y, m, ppiDay, 8, 30, 'monthly', true));

  // Retail Sales ~ mid-month (Census, usually the 15th–17th)
  const retailDay = businessDayOnOrAfter(y, m, 15);
  if (retailDay > 0) ev.push(make(T.retail, y, m, retailDay, 8, 30, 'monthly', true));

  // JOLTS ~ turn of the month
  const joltsDay = nthWeekday(y, m, 2, 1);
  if (joltsDay > 0) ev.push(make(T.jolts, y, m, joltsDay, 10, 0, 'monthly', true));

  // Core PCE ~ late month
  const pceDay = nthWeekday(y, m, 5, 4);
  if (pceDay > 0) ev.push(make(T.pce, y, m, pceDay, 8, 30, 'monthly', true));

  // Weekly initial jobless claims: every Thursday 08:30
  for (const d of allWeekdays(y, m, 4)) ev.push(make(T.claims, y, m, d, 8, 30, 'weekly'));

  // FOMC decisions (from table): 14:00 ET statement + Minutes 3 weeks later 14:00
  const meetings = FOMC[y] ?? [];
  for (const [fm, fd] of meetings) {
    if (fm === m) ev.push(make(T.fomc, y, m, fd, 14, 0, 'scheduled'));
    // minutes = 21 days after the decision, 14:00 ET
    const minutes = new Date(Date.UTC(y, fm, fd + 21));
    if (minutes.getUTCFullYear() === y && minutes.getUTCMonth() === m) {
      ev.push(make(T.fomcMins, y, m, minutes.getUTCDate(), 14, 0, 'scheduled'));
    }
  }

  // the FLOW domain: expirations, rolls, rebalancing, auctions (computed too)
  ev.push(...flowEventsForMonth(y, m));

  return ev.sort((a, b) => a.instant.localeCompare(b.instant));
}

/** Events on a specific YYYY-MM-DD (ET calendar day). */
export function eventsForDate(dateISO: string): CalendarEvent[] {
  const [y, m] = dateISO.split('-').map(Number);
  return eventsForMonth(y, m - 1).filter((e) => e.date === dateISO);
}

/** Upcoming events within `days` from a start date (inclusive), sorted. */
export function upcomingEvents(startISO: string, days = 7): CalendarEvent[] {
  const start = new Date(startISO + 'T00:00:00Z');
  const out: CalendarEvent[] = [];
  const months = new Set<string>();
  for (let i = 0; i <= days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    months.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
  }
  for (const key of months) {
    const [yy, mm] = key.split('-').map(Number);
    out.push(...eventsForMonth(yy, mm));
  }
  const startT = start.getTime();
  const endT = startT + days * 86400000 + 86400000;
  return out
    .filter((e) => {
      const t = new Date(e.date + 'T00:00:00Z').getTime();
      return t >= startT && t < endT;
    })
    .sort((a, b) => a.instant.localeCompare(b.instant));
}

/** Render an event's release time in the viewer's local zone as HH:MM. */
export function localTime(instant: string): string {
  const d = new Date(instant);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
