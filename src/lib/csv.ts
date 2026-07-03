/** Minimal RFC-4180-ish CSV parser handling quotes, commas and newlines in fields. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',' || c === ';' || c === '\t') {
      // support comma, semicolon and tab separated exports
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Case/space/punctuation-insensitive header key. */
export function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  const negParen = /^\(.*\)$/.test(s);
  s = s.replace(/[()$€£\s]/g, '').replace(/,/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  if (isNaN(n)) return null;
  return negParen ? -n : n;
}

/**
 * Parse the date-time formats seen in MotiveWave / Rithmic / generic exports
 * into an ISO string (local time). Returns null when unparseable.
 */
export function toISODateTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return null;

  // ISO already (also tolerate "2026-07-02 - 17:24:07" style separators)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|\s+-\s+)(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;

  // YYYY-MM-DD or YYYYMMDD date only
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00`;

  // DD/MM/YYYY or MM/DD/YYYY, with optional time and AM/PM; the date/time
  // separator may be a space, " - " (Trader One) or a comma
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s*(?:-|,)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM|am|pm)?)?$/);
  if (m) {
    let [, a, b, yr, hh, mm, ss, ampm] = m;
    let year = Number(yr.length === 2 ? `20${yr}` : yr);
    let day: number;
    let month: number;
    const A = Number(a);
    const B = Number(b);
    if (A > 12) {
      day = A; month = B;
    } else if (B > 12) {
      month = A; day = B;
    } else {
      // ambiguous — assume DD/MM (European convention, matches the journal templates)
      day = A; month = B;
    }
    let hour = Number(hh ?? 0);
    if (ampm) {
      const isPM = ampm.toLowerCase() === 'pm';
      if (isPM && hour < 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${mm ?? '00'}:${ss ?? '00'}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return null;
}
