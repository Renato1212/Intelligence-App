import { fmtLisbon } from './tz';

export function fmtMoney(v: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const abs = Math.abs(v);
  let core: string;
  if (opts.compact && abs >= 100000) {
    core = `$${(abs / 1000).toFixed(0)}K`;
  } else if (opts.compact && abs >= 10000) {
    core = `$${(abs / 1000).toFixed(1)}K`;
  } else {
    core = `$${abs.toLocaleString('en-US', { minimumFractionDigits: abs < 1000 ? 2 : 0, maximumFractionDigits: abs < 1000 ? 2 : 0 })}`;
  }
  if (v < 0) return `-${core}`;
  if (opts.sign && v > 0) return `+${core}`;
  return core;
}

export function fmtPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtNum(v: number, digits = 2): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function fmtR(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
}

export function fmtDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function fmtTime(iso: string): string {
  return fmtLisbon(iso, { seconds: true });
}

export function fmtDuration(entryIso: string, exitIso: string): string {
  const ms = new Date(exitIso).getTime() - new Date(entryIso).getTime();
  if (!isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayName(dateISO: string): string {
  return new Date(`${dateISO}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
}
