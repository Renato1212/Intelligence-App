/*
 * Keyless calendar rows from the weekly feed relayed by /api/ffcal.
 *
 * Feed item shape (defensive — fields vary slightly over time):
 *   { title, country, date, impact, forecast, previous, actual? }
 * where `country` is a currency code (USD, EUR …) and `date` is ISO-8601 with
 * an explicit offset. We map US rows into the app's LiveEventRow shape so the
 * existing matchers, reconciliation and consensus→actual chips all work with
 * ZERO keys. Pure mapper + thin fetch, unit-testable offline.
 */
import type { LiveEventRow } from './market';

export interface FfItem {
  title?: unknown;
  country?: unknown;
  date?: unknown;
  impact?: unknown;
  forecast?: unknown;
  previous?: unknown;
  actual?: unknown;
}

function val(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Map raw feed items to US LiveEventRows. Pure. */
export function mapFfRows(json: unknown): LiveEventRow[] {
  if (!Array.isArray(json)) return [];
  const out: LiveEventRow[] = [];
  for (const it of json as FfItem[]) {
    if (String(it.country ?? '').toUpperCase() !== 'USD') continue;
    const name = val(it.title);
    const date = String(it.date ?? '').slice(0, 10);
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parsed = new Date(String(it.date));
    out.push({
      date,
      name,
      consensus: val(it.forecast),
      previous: val(it.previous),
      actual: val(it.actual),
      instant: isNaN(parsed.getTime()) ? undefined : parsed.toISOString(),
    });
  }
  return out;
}

/** Fetch one week ('this' | 'next') through the keyless proxy. Null on failure. */
export async function fetchFfWeek(week: 'this' | 'next'): Promise<LiveEventRow[] | null> {
  try {
    const res = await fetch(`/api/ffcal?week=${week}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const rows = mapFfRows(await res.json());
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

/** Both weeks, concatenated (either may be null in local dev). */
export async function fetchFfRows(): Promise<LiveEventRow[]> {
  const [a, b] = await Promise.all([fetchFfWeek('this'), fetchFfWeek('next')]);
  return [...(a ?? []), ...(b ?? [])];
}
