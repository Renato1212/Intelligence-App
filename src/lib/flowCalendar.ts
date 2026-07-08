/*
 * The FLOW calendar — the AXIA survival edge, computed from exchange rules.
 *
 * Flow events (expirations, rolls, rebalancing, auctions) move markets on
 * MECHANICS, not information: dealers hedge expiring options, index funds
 * rebalance at month-end, liquidity migrates during the roll. Every one of
 * these runs on a fixed, publicly documented schedule — so, like the economic
 * calendar, they can be computed deterministically with zero API.
 *
 * Each event carries the educational read (why it matters, how to play it) so
 * the calendar itself teaches the flow playbook every time it is used.
 */
import type { CalendarEvent } from './calendar';

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function dowUTC(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m, d)).getUTCDay();
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}
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
/** last business (Mon–Fri) day of the month */
function lastBusinessDay(y: number, m: number): number {
  for (let d = daysInMonth(y, m); d >= 1; d--) {
    const w = dowUTC(y, m, d);
    if (w !== 0 && w !== 6) return d;
  }
  return -1;
}
function isUSDST(y: number, m: number, d: number): boolean {
  const marSecondSun = nthWeekday(y, 2, 0, 2);
  const novFirstSun = nthWeekday(y, 10, 0, 1);
  if (m < 2 || m > 10) return false;
  if (m > 2 && m < 10) return true;
  if (m === 2) return d >= marSecondSun;
  if (m === 10) return d < novFirstSun;
  return false;
}
function etInstant(y: number, m: number, d: number, hh: number, mm: number): string {
  const off = isUSDST(y, m, d) ? -4 : -5;
  return new Date(Date.UTC(y, m, d, hh - off, mm)).toISOString();
}

const QUARTER_MONTHS = new Set([2, 5, 8, 11]); // Mar, Jun, Sep, Dec

interface FlowTemplate {
  short: string;
  name: string;
  impact: 'high' | 'medium';
  affects: string[];
  why: string;
  playbook: string;
}

function make(t: FlowTemplate, y: number, m: number, d: number, hh: number, mm: number, approx = false): CalendarEvent {
  return {
    id: `${t.short}-${ymd(y, m, d)}`,
    date: ymd(y, m, d),
    timeET: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    instant: etInstant(y, m, d, hh, mm),
    name: t.name,
    short: t.short,
    impact: t.impact,
    domain: 'flow',
    affects: t.affects,
    why: t.why,
    playbook: t.playbook,
    cadence: 'monthly',
    approx,
  };
}

const T = {
  opex: {
    short: 'OPEX', name: 'Monthly options expiration', impact: 'medium',
    affects: ['ES', 'NQ', 'RTY', 'YM'],
    why: 'Dealers hedge expiring index options; their gamma pins price to big strikes into the close and the hedges unwind Monday.',
    playbook: 'Expect magnetism to round-number strikes and fading range breaks late in the day. The cleaner trend trade often comes the session AFTER expiration, once the pin is off.',
  } as FlowTemplate,
  quadWitching: {
    short: 'Quad Witching', name: 'Quarterly expiration (index futures + options)', impact: 'high',
    affects: ['ES', 'NQ', 'RTY', 'YM'],
    why: 'Stock index futures, index options, stock options and single-stock futures all expire together — the biggest mechanical volume days of the quarter.',
    playbook: 'Volume is huge but much of it is expiration plumbing, not opinion. Opening auction and the 15:50–16:00 MOC are the flow windows; mid-day moves often mean less than they look.',
  } as FlowTemplate,
  roll: {
    short: 'Futures Roll', name: 'Equity index futures roll begins', impact: 'medium',
    affects: ['ES', 'NQ', 'RTY', 'YM'],
    why: 'Open interest migrates to the next quarterly contract; liquidity splits across two expiries for about a week.',
    playbook: 'Check you are trading the new front month. Spread activity distorts the tape and DOM depth — footprint/DOM reads are less reliable during the roll.',
  } as FlowTemplate,
  vixExp: {
    short: 'VIX Expiry', name: 'VIX futures & options expiration (AM settle)', impact: 'medium',
    affects: ['ES', 'NQ', 'VX'],
    why: 'VIX derivatives settle on the special opening quotation — vol positions roll and hedges reset, often marking short-term inflections in index vol.',
    playbook: 'Watch the 09:30 ET settlement print. Vol-control and hedge re-striking can flip the tape’s character mid-week; a vol crush after expiry often fuels an index grind higher.',
  } as FlowTemplate,
  monthEnd: {
    short: 'Month-End', name: 'Month-end rebalancing', impact: 'medium',
    affects: ['ES', 'NQ', 'ZN', 'ZB', '6E'],
    why: 'Pension/index rebalancing between stocks and bonds lands in the last sessions; fixed-income index extensions buy duration into the close.',
    playbook: 'The 15:00–16:00 ET window carries the flow. After a big equity month, expect the OPPOSITE flow (sell winners / buy losers). Bond index extension buying supports ZN/ZB into the bell.',
  } as FlowTemplate,
  quarterEnd: {
    short: 'Quarter-End', name: 'Quarter-end rebalancing & window dressing', impact: 'high',
    affects: ['ES', 'NQ', 'ZN', 'ZB', '6E'],
    why: 'The month-end flows, squared: quarterly mandates, window dressing and FX hedge rebalancing all land together.',
    playbook: 'Estimates of the equity/bond rebalance direction circulate all week — the move often front-runs the actual day. Fade capitulations into the final close, respect the first day of the new quarter as fresh-money day.',
  } as FlowTemplate,
  auctionMid: {
    short: 'UST Auction', name: 'Treasury auctions week — 3y/10y/30y (typical: Tue/Wed/Thu, 13:00 ET)', impact: 'medium',
    affects: ['ZN', 'ZB', 'ZF'],
    why: 'Coupon supply concentrates duration risk at 13:00 ET; a weak auction (big tail, low bid-to-cover) can move the whole curve and drag equities.',
    playbook: 'Mark 13:00 ET. Bonds often cheapen into the auction (concession) and rally after a clean one. The 30y is the one that bites equities. Confirm exact dates at TreasuryDirect.',
  } as FlowTemplate,
  firstDay: {
    short: 'New-Month Flow', name: 'First trading day of the month', impact: 'medium',
    affects: ['ES', 'NQ'],
    why: 'Fresh monthly inflows (401k, target-date funds) get put to work — first sessions of the month carry a persistent buy-side tilt in equities.',
    playbook: 'A weak open on day one often gets absorbed. Do not fight obvious programmatic buying without a catalyst on your side.',
  } as FlowTemplate,
};

/** All computed flow events for a month (0-indexed). */
export function flowEventsForMonth(y: number, m: number): CalendarEvent[] {
  const ev: CalendarEvent[] = [];
  const thirdFri = nthWeekday(y, m, 5, 3);
  const quarterly = QUARTER_MONTHS.has(m);

  if (thirdFri > 0) {
    ev.push(make(quarterly ? T.quadWitching : T.opex, y, m, thirdFri, 9, 30));
    if (quarterly) {
      // roll begins ~8 days before quarterly expiry (the prior Thursday)
      const rollDay = thirdFri - 8;
      if (rollDay >= 1) ev.push(make(T.roll, y, m, rollDay, 9, 30));
    }
  }

  // VIX expiry: the Wednesday 30 days before the NEXT month's 3rd Friday
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 0 : m + 1;
  const nextThirdFri = nthWeekday(ny, nm, 5, 3);
  if (nextThirdFri > 0) {
    const exp = new Date(Date.UTC(ny, nm, nextThirdFri) - 30 * 86400000);
    if (exp.getUTCFullYear() === y && exp.getUTCMonth() === m && exp.getUTCDay() === 3) {
      ev.push(make(T.vixExp, y, m, exp.getUTCDate(), 9, 30));
    }
  }

  // month-end / quarter-end rebalancing (last business day)
  const lbd = lastBusinessDay(y, m);
  if (lbd > 0) ev.push(make(quarterly ? T.quarterEnd : T.monthEnd, y, m, lbd, 15, 0));

  // first trading day of the month
  for (let d = 1; d <= 7; d++) {
    const w = dowUTC(y, m, d);
    if (w !== 0 && w !== 6) {
      ev.push(make(T.firstDay, y, m, d, 9, 30));
      break;
    }
  }

  // typical mid-month coupon auction anchor: Wednesday of the 2nd full week (10y day)
  const secondWed = nthWeekday(y, m, 3, 2);
  if (secondWed > 0) ev.push(make(T.auctionMid, y, m, secondWed, 13, 0, true));

  return ev.sort((a, b) => a.instant.localeCompare(b.instant));
}
