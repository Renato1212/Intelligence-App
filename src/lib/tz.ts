/*
 * Timezone layer — the whole app renders in Europe/Lisbon.
 *
 * The trader is in Portugal, so every time in the app (scheduled releases,
 * option expiries, the VIX feed timestamp, trade times, the session clock) is
 * shown in Lisbon local time (WET in winter, WEST = UTC+1 in summer),
 * regardless of the device's own timezone — so the same instant reads the same
 * on a laptop in Lisbon and a phone set to New York.
 *
 * Everything here is a pure function over the standard Intl timezone database
 * (no external dependency), so it is DST-correct and unit-testable.
 */

export const LISBON = 'Europe/Lisbon';

function partsInZone(date: Date, tz: string): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return map;
}

/** Offset in minutes of `tz` at `date` (positive = ahead of UTC). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const m = partsInZone(date, tz);
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * The UTC instant of a wall-clock time in `tz`. Iterates twice so it is
 * correct across DST transitions (the offset depends on the instant we're
 * solving for). Pure.
 */
export function zonedInstant(tz: string, y: number, m: number, d: number, hh: number, mm: number): Date {
  let utc = Date.UTC(y, m, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const off = tzOffsetMinutes(new Date(utc), tz);
    const next = Date.UTC(y, m, d, hh, mm) - off * 60000;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "HH:MM" (or "HH:MM:SS") for an instant, in Lisbon. */
export function fmtLisbon(instant: string | number | Date, opts: { seconds?: boolean } = {}): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(d.getTime())) return '—';
  const m = partsInZone(d, LISBON);
  const hh = pad(+m.hour % 24);
  return opts.seconds ? `${hh}:${m.minute}:${m.second}` : `${hh}:${m.minute}`;
}

export interface LisbonParts {
  y: number;
  mon: number; // 1-12
  day: number;
  h: number; // 0-23
  m: number;
  s: number;
  weekday: string; // "Mon"…"Sun"
  dow: number; // 0=Sun..6=Sat
  dateISO: string; // YYYY-MM-DD in Lisbon
  /** minutes since Lisbon midnight */
  minutesOfDay: number;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function lisbonParts(date: Date = new Date()): LisbonParts {
  const m = partsInZone(date, LISBON);
  const h = +m.hour % 24;
  const min = +m.minute;
  return {
    y: +m.year,
    mon: +m.month,
    day: +m.day,
    h,
    m: min,
    s: +m.second,
    weekday: m.weekday,
    dow: DOW[m.weekday] ?? 0,
    dateISO: `${m.year}-${m.month}-${m.day}`,
    minutesOfDay: h * 60 + min,
  };
}

/** Generic wall-clock parts of `date` in any IANA zone — for session math. */
export function zoneParts(date: Date, tz: string): { y: number; mon: number; day: number; h: number; min: number; dow: number } {
  const m = partsInZone(date, tz);
  return { y: +m.year, mon: +m.month - 1, day: +m.day, h: +m.hour % 24, min: +m.minute, dow: DOW[m.weekday] ?? 0 };
}

/** Lisbon's current date as YYYY-MM-DD (not the UTC date). */
export function lisbonTodayISO(now: Date = new Date()): string {
  return lisbonParts(now).dateISO;
}

/** Standard-time abbreviation for Lisbon at `date`: WET (UTC+0) or WEST (UTC+1). */
export function lisbonAbbr(date: Date = new Date()): string {
  return tzOffsetMinutes(date, LISBON) >= 60 ? 'WEST' : 'WET';
}

/** "Mon 14 Jul" in Lisbon — for the live clock header. */
export function fmtLisbonDate(date: Date = new Date()): string {
  const m = partsInZone(date, LISBON);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m.weekday} ${m.day} ${months[+m.month - 1]}`;
}
