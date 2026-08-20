/*
 * The routine spine.
 *
 * `Trading Routine.md` is the source of truth for the daily loop. Every screen
 * in this app exists to serve one block of that routine, and this module is
 * that routine encoded: the ordered phases, what each is for, and which phase
 * the clock says I should be in right now.
 *
 * Law 1 (calm surface): the app should never make me decide what to open. The
 * home screen asks this module for the single next action and shows that.
 */

export type PhaseId = 'brief' | 'plan' | 'reassess' | 'live' | 'debrief';

export interface Phase {
  id: PhaseId;
  /** Routine block this serves, verbatim from Trading Routine.md */
  block: string;
  label: string;
  /** The single action button label on Today */
  action: string;
  route: string;
  /** Local-hour window [start, end) in the trader's own timezone */
  from: number;
  to: number;
  purpose: string;
}

/**
 * Windows are in Europe/Lisbon terms (the trader's zone): the European session
 * is prepared before ~08:00, the US open is reassessed around 13:00–14:30, the
 * RTH session runs to ~21:00, and the debrief closes the day.
 */
export const PHASES: Phase[] = [
  {
    id: 'brief',
    block: 'Before european session',
    label: 'EU brief',
    action: 'Start EU brief',
    route: '/brief',
    from: 0,
    to: 12,
    purpose: 'Fundamentals, technicals and environment — assemble the context before Europe trades.',
  },
  {
    id: 'plan',
    block: 'Before european session',
    label: 'Plan',
    action: 'Build the plan',
    route: '/plan',
    from: 12,
    to: 13,
    purpose: 'Turn the brief into scenarios, locations, invalidation and size.',
  },
  {
    id: 'reassess',
    block: 'Before US session',
    label: 'US reassess',
    action: 'Reassess for the US open',
    route: '/reassess',
    from: 13,
    to: 14,
    purpose: 'A five-minute reset: what changed, and does the plan still hold?',
  },
  {
    id: 'live',
    block: 'During trade',
    label: 'Live',
    action: 'Open the cockpit',
    route: '/live',
    from: 14,
    to: 21,
    purpose: 'Levels, tape and the plan in front of me — capture what I see as I see it.',
  },
  {
    id: 'debrief',
    block: 'After trade',
    label: 'Debrief',
    action: 'Debrief the day',
    route: '/debrief',
    from: 21,
    to: 24,
    purpose: 'Each trade and the day: lessons and actions to improve.',
  },
];

/** The phase the clock says I am in. */
export function currentPhase(now = new Date()): Phase {
  const h = now.getHours();
  return PHASES.find((p) => h >= p.from && h < p.to) ?? PHASES[0];
}

/** Session blocks for the ribbon, in local hours. */
export const SESSION_BLOCKS: { label: string; from: number; to: number }[] = [
  { label: 'Asia', from: 0, to: 7 },
  { label: 'London', from: 7, to: 13 },
  { label: 'NY pre', from: 13, to: 14.5 },
  { label: 'RTH', from: 14.5, to: 21 },
  { label: 'Close', from: 21, to: 24 },
];

/**
 * The nine instruments the routine studies on the 1-hour chart, in its order.
 * "1 hour chart study of the following instruments: ES, CL, GC, ZT, ZN, UB,
 * 6E, 6J, BTC"
 */
export const ROUTINE_INSTRUMENTS = ['ES', 'CL', 'GC', 'ZT', 'ZN', 'UB', '6E', '6J', 'BTC'] as const;
