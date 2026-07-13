/*
 * The trading-session clock — the day's structure, in Lisbon time.
 *
 * A discretionary futures trader lives by the session map: liquidity, volatility
 * and who is in control all rotate as Asia hands to Europe hands to the US. The
 * highest-odds windows are the OPENS and the OVERLAPS; the lowest are the
 * handoffs and lunches. This module defines each session in its own market
 * timezone (so DST is always right) and computes, for any instant, whether it
 * is open, how long until it opens/closes, how far into it we are, and which
 * sessions overlap right now — all rendered in Europe/Lisbon by the page.
 *
 * All state is pure over a `now` Date, so it is unit-testable without a clock.
 */
import { zonedInstant, zoneParts } from './tz';

export interface SessionDef {
  id: string;
  name: string;
  short: string;
  /** IANA timezone the session's hours are defined in */
  tz: string;
  /** local open [hour, minute] in tz */
  open: [number, number];
  /** local close [hour, minute] in tz */
  close: [number, number];
  /** days of week it runs, 0=Sun..6=Sat (markets are Mon-Fri) */
  days: number[];
  markets: string[];
  color: string;
  /** why this window matters */
  why: string;
  /** how to trade it */
  play: string;
}

const MONFRI = [1, 2, 3, 4, 5];

/*
 * Hours are the liquid/active window of each session (the pit or cash hours
 * that actually carry the volume), not the 23h electronic session — that is
 * what a discretionary trader times entries around.
 */
export const SESSIONS: SessionDef[] = [
  {
    id: 'asia',
    name: 'Asia — Tokyo',
    short: 'Asia',
    tz: 'Asia/Tokyo',
    open: [9, 0],
    close: [15, 0],
    days: MONFRI,
    markets: ['NKD', 'JPY', 'metals fixings'],
    color: '#c084fc',
    why: 'The first liquidity of the day. Tokyo sets the tone for JPY and gold, and the overnight range it builds becomes the reference the European open trades against.',
    play: 'Mark the Asia high/low — they are the first levels Europe reacts to. Ranges are usually tighter here; a strong Asia trend is a real lead, a listless one means "wait for Europe".',
  },
  {
    id: 'europe',
    name: 'Europe — London / Frankfurt',
    short: 'Europe',
    tz: 'Europe/London',
    open: [8, 0],
    close: [16, 30],
    days: MONFRI,
    markets: ['FESX', 'FDAX', 'EUR', 'GBP', 'Bunds'],
    color: '#38bdf8',
    why: 'The first true volume of the day. The 08:00 London open drives the DAX/Euro Stoxx and sets the European range; London is the deepest FX liquidity on earth.',
    play: 'The European open is a primary edge window — classify it (drive / rejection / range). The range built before the US arrives is the map for the overlap; its high/low are the levels the US session tests.',
  },
  {
    id: 'us-cash',
    name: 'US cash equities — NYSE / RTH',
    short: 'US cash',
    tz: 'America/New_York',
    open: [9, 30],
    close: [16, 0],
    days: MONFRI,
    markets: ['ES', 'NQ', 'RTY', 'YM'],
    color: '#f59e0b',
    why: 'The main event. The 09:30 ET cash open is the single highest-volume moment of the day for index futures; the opening auction resolves the overnight inventory.',
    play: 'Classify the open (drive / test-drive / rejection / auction). The first 30-60 minutes set the day type. The 15:50 MOC and the last hour are the second volume peak — see Options & Vol for the mechanics.',
  },
  {
    id: 'metals',
    name: 'Metals — COMEX pit (GC/SI)',
    short: 'Metals',
    tz: 'America/New_York',
    open: [8, 20],
    close: [13, 30],
    days: MONFRI,
    markets: ['GC', 'SI', 'HG'],
    color: '#eab308',
    why: 'Gold and silver get their deepest US liquidity in the COMEX pit hours, overlapping the London PM fix — the window where metals make their decisive daily move.',
    play: 'Respect the 08:20 ET open and the London PM fix (~10:00 ET) as inflection points. Metals trend best when the dollar (DXY) and real yields agree — cross-check the Macro Map.',
  },
  {
    id: 'oil',
    name: 'Oil — NYMEX pit (CL)',
    short: 'Oil',
    tz: 'America/New_York',
    open: [9, 0],
    close: [14, 30],
    days: MONFRI,
    markets: ['CL', 'RB', 'HO'],
    color: '#f97316',
    why: 'Crude concentrates its volume in the NYMEX pit hours; the Wednesday 10:30 ET EIA inventories land inside this window and are the week\'s biggest oil catalyst.',
    play: 'The 09:00 ET open and 10:30 ET EIA (Wed) are the key moments. Oil respects its own supply story more than risk sentiment — do not assume it follows equities.',
  },
  {
    id: 'bonds',
    name: 'US Treasuries — CBOT (ZN/ZB)',
    short: 'Bonds',
    tz: 'America/New_York',
    open: [8, 20],
    close: [15, 0],
    days: MONFRI,
    markets: ['ZN', 'ZB', 'ZF', 'ZT'],
    color: '#34d399',
    why: 'Treasuries lead everything through yields. The 08:20 ET futures open follows the 08:30 data, and coupon auctions settle at 13:00 ET — bonds move first and equities follow the rates signal.',
    play: 'Watch ZN around 08:30 ET data and 13:00 ET auctions. When stocks and bonds disagree, the bond move is usually the honest one — let the curve lead your index read.',
  },
];

export type Phase = 'open' | 'preopen';

export interface SessionState {
  def: SessionDef;
  phase: Phase;
  openInstant: Date;
  closeInstant: Date;
  durationMs: number;
  /** ms until open (phase preopen) or null */
  msToOpen: number | null;
  /** ms until close (phase open) or null */
  msToClose: number | null;
  /** ms since open (phase open) or null */
  elapsedMs: number | null;
  /** 0..1 through the session when open */
  progress: number;
}

/**
 * State of one session relative to `now`: the current session if it is open,
 * otherwise the next upcoming one (skipping weekends / non-run days). Pure.
 */
export function sessionState(def: SessionDef, now: Date): SessionState {
  const nowMs = now.getTime();
  const base = zoneParts(now, def.tz);
  for (let i = 0; i <= 8; i++) {
    // anchor at noon UTC of base-day + i, then read the tz-local calendar day
    const anchor = new Date(Date.UTC(base.y, base.mon, base.day + i, 12, 0));
    const p = zoneParts(anchor, def.tz);
    if (!def.days.includes(p.dow)) continue;
    const openInstant = zonedInstant(def.tz, p.y, p.mon, p.day, def.open[0], def.open[1]);
    const closeInstant = zonedInstant(def.tz, p.y, p.mon, p.day, def.close[0], def.close[1]);
    if (nowMs >= closeInstant.getTime()) continue; // already ended, look further ahead
    const isOpen = nowMs >= openInstant.getTime();
    const durationMs = closeInstant.getTime() - openInstant.getTime();
    return {
      def,
      phase: isOpen ? 'open' : 'preopen',
      openInstant,
      closeInstant,
      durationMs,
      msToOpen: isOpen ? null : openInstant.getTime() - nowMs,
      msToClose: isOpen ? closeInstant.getTime() - nowMs : null,
      elapsedMs: isOpen ? nowMs - openInstant.getTime() : null,
      progress: isOpen ? Math.min(1, (nowMs - openInstant.getTime()) / durationMs) : 0,
    };
  }
  // fallback: treat as far-future preopen (never hit in practice)
  const openInstant = zonedInstant(def.tz, base.y, base.mon, base.day + 8, def.open[0], def.open[1]);
  const closeInstant = zonedInstant(def.tz, base.y, base.mon, base.day + 8, def.close[0], def.close[1]);
  return { def, phase: 'preopen', openInstant, closeInstant, durationMs: closeInstant.getTime() - openInstant.getTime(), msToOpen: openInstant.getTime() - nowMs, msToClose: null, elapsedMs: null, progress: 0 };
}

export function allSessionStates(now: Date): SessionState[] {
  return SESSIONS.map((s) => sessionState(s, now));
}

/** Sessions open at `now`. */
export function openNow(now: Date): SessionState[] {
  return allSessionStates(now).filter((s) => s.phase === 'open');
}

export interface Overlap {
  a: SessionDef;
  b: SessionDef;
  start: Date;
  end: Date;
  active: boolean;
  msToStart: number | null;
  msToEnd: number | null;
}

/**
 * The intersection window of two sessions on the relevant day. Used for the
 * Europe×US "prime time" overlap — the deepest-liquidity window of the day.
 */
export function overlap(aDef: SessionDef, bDef: SessionDef, now: Date): Overlap | null {
  const a = sessionState(aDef, now);
  const b = sessionState(bDef, now);
  // align to the same calendar window: use each session's open/close and intersect
  const start = new Date(Math.max(a.openInstant.getTime(), b.openInstant.getTime()));
  const end = new Date(Math.min(a.closeInstant.getTime(), b.closeInstant.getTime()));
  if (start.getTime() >= end.getTime()) return null; // they don't overlap on this cycle
  const nowMs = now.getTime();
  const active = nowMs >= start.getTime() && nowMs < end.getTime();
  return {
    a: aDef,
    b: bDef,
    start,
    end,
    active,
    msToStart: active || nowMs >= start.getTime() ? null : start.getTime() - nowMs,
    msToEnd: active ? end.getTime() - nowMs : null,
  };
}

/** The trader's prime-time window: Europe still open while US cash is open. */
export function primeTime(now: Date): Overlap | null {
  const eu = SESSIONS.find((s) => s.id === 'europe')!;
  const us = SESSIONS.find((s) => s.id === 'us-cash')!;
  return overlap(eu, us, now);
}

/** "1h 23m" / "12m" / "45s" from a millisecond duration. */
export function fmtCountdown(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}
