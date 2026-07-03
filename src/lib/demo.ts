import type { DailyDebrief, DayPrep, DomainId, GradeLevel, Strategy, Trade } from '../domain/types';
import { DOMAIN_MAP } from '../domain/taxonomy';
import { pointValue } from './contracts';
import { db, emptyPrep } from './db';
import { makeImportKey } from './importers';

/** Deterministic RNG so the demo dataset is stable between loads. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260702);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;

interface InstrumentSpec {
  symbol: string;
  price: number;
  tick: number;
}

const INSTRUMENTS: InstrumentSpec[] = [
  { symbol: 'MES', price: 6900, tick: 0.25 },
  { symbol: 'MNQ', price: 24800, tick: 0.25 },
  { symbol: 'MCL', price: 78, tick: 0.01 },
  { symbol: '6E', price: 1.17, tick: 0.00005 },
  { symbol: 'ZN', price: 111.5, tick: 0.015625 },
  { symbol: 'MGC', price: 3350, tick: 0.1 },
];

interface DomainProfile {
  id: DomainId;
  weight: number;
  /** probability a trade wins */
  winP: number;
  /** payoff ratio (avg win R vs 1R loss) */
  payoff: number;
  hours: number[];
  narratives: string[];
}

const PROFILES: DomainProfile[] = [
  {
    id: 'technicals', weight: 0.42, winP: 0.52, payoff: 1.5,
    hours: [8, 9, 10, 14, 15, 16],
    narratives: [
      'IB break with LVN continuation. Expected acceptance below and got a clean drive.',
      'Delta reversal at the composite HVN. Footprint showed absorption before the turn.',
      'Flag continuation off VWAP on a trend day. Entry on the retest.',
      'P-shape expectation, faded the elastic band extreme back to value.',
      'Iceberg on the DOM at the overnight low — joined the defence.',
    ],
  },
  {
    id: 'economic-data', weight: 0.2, winP: 0.55, payoff: 1.8,
    hours: [13, 14, 15],
    narratives: [
      'CPI came in 0.2 below consensus. Phase 1 was fully algorithmic, took the phase 2 continuation in bonds.',
      'NFP beat with weak wage growth — mixed read, traded the second leg once direction resolved.',
      'ISM miss. Pre-mapped both directions; took the continuation after the initial spike held.',
      'Jobless claims outlier. Smash and grab on the first reaction, out in 90 seconds.',
      'EIA inventory draw far above expectations — traded MCL continuation.',
    ],
  },
  {
    id: 'flow', weight: 0.16, winP: 0.56, payoff: 1.2,
    hours: [15, 16, 20, 21],
    narratives: [
      'MOC imbalance flow, volume shifted 12 minutes before the close. Rode the pre-close leg.',
      '10y auction tailed — hedging flow into the result, faded the post-auction overreaction.',
      'Cash open rebalance in MES after an overnight gap. Open drive played long.',
      'OPEX pin behaviour around the round number, scalped the reversion twice.',
    ],
  },
  {
    id: 'news', weight: 0.13, winP: 0.48, payoff: 2.2,
    hours: [7, 9, 11, 13, 17],
    narratives: [
      'Tariff headline on the tape — risk-off across the board. Hit and hold in MNQ short.',
      'Middle East escalation headline. Crude popped, took the continuation with bonds confirming.',
      'Denial hit 20 minutes after the original headline — faded the whole move back.',
      'Political headline, market barely reacted — old news. Cut fast.',
    ],
  },
  {
    id: 'central-banks', weight: 0.09, winP: 0.5, payoff: 2.4,
    hours: [13, 14, 15, 19],
    narratives: [
      'FOMC statement dropped the "patient" language — hawkish surprise vs pricing. Traded the repricing in ZN.',
      'Powell presser turned dovish on the labour market question. Scaled in as the language developed.',
      'ECB sources story on faster cuts — 6E move, classic sources fade after the initial spike.',
      'Fed speaker walked back the dot plot — traded the STIR-led move in equities.',
    ],
  },
];

const LEVEL3: Record<DomainId, string[][]> = {
  'central-banks': [['Hawkish'], ['Dovish'], ['Dovish', 'Powell'], ['Hawkish', 'Timiraos']],
  'economic-data': [
    ['Phase 1', 'Smash and grab', 'NFP'],
    ['Phase 2', 'Continuation', 'CPI'],
    ['Phase 2', 'Fade', 'ISM'],
    ['Phase 3', 'CPI'],
    ['Phase 1', 'Jobless Claims'],
    ['Phase 2', 'Continuation', 'EIA'],
  ],
  news: [['Risk-off', 'Hit & Hold'], ['Risk-on'], ['Smash & Grab'], ['Fade', 'Denial'], ['Tariffs'], ['War']],
  technicals: [['Continuation', 'VWAP'], ['Breakout'], ['Reversal'], ['Trend day'], ['P-shape'], ['Double distribution']],
  flow: [['Long', 'Pre-event'], ['Short', 'Pre-event'], ['Long', 'Post-event'], ['Chop']],
};

function gradeFor(win: boolean, skill: number): GradeLevel {
  const r = rand();
  const aboveP = 0.12 + skill * 0.3 + (win ? 0.08 : 0);
  const belowP = Math.max(0.05, 0.35 - skill * 0.25 + (win ? -0.05 : 0.1));
  if (r < aboveP) return 'above';
  if (r > 1 - belowP) return 'below';
  return 'at';
}

export async function loadDemoData(): Promise<number> {
  const strategies: Strategy[] = [
    {
      name: 'IB Break / LVN Continuation',
      domain: 'technicals',
      category: 'profile',
      status: 'active',
      hypothesis:
        'On out-of-balance opens, an initial-balance break that accepts through a low-volume node continues to the next HVN. Volatility filter: works best VIX > 20.',
      rules:
        'Entry: retest of the IB extreme after acceptance (2 x 5m closes beyond). Stop: back inside IB mid. Target: next HVN. Size to 1R = 0.5% of account.',
      createdAt: '2025-11-20T09:00:00',
    },
    {
      name: 'CPI Phase 2 Continuation',
      domain: 'economic-data',
      category: 'inflation',
      status: 'active',
      hypothesis:
        'When CPI surprises ≥ 0.2 vs consensus and the phase-1 algo move holds its first pullback, the discretionary second leg extends the move for 30–90 minutes.',
      rules:
        'Pre-map both directions. No position into the print. Enter on the first pullback that holds after the initial spike; stop behind the pullback low/high. Scale out in thirds.',
      createdAt: '2025-12-05T08:30:00',
    },
    {
      name: 'MOC Imbalance Ride',
      domain: 'flow',
      category: 'moc',
      status: 'testing',
      hypothesis:
        'Volume shift ~10 minutes before cash close signals the imbalance direction; joining that flow pays until the 2-minute MOC print.',
      rules:
        'Watch cumulative delta from 15:45. Enter only if flow direction is clear by 15:50. Exit at 15:59 or on flow reversal. Never hold past the close.',
      createdAt: '2026-02-10T15:00:00',
    },
    {
      name: 'Headline Fade After Denial',
      domain: 'news',
      category: 'squawk',
      status: 'incubating',
      hypothesis:
        'Geo-political headlines that are denied or walked back within 30 minutes fully retrace; the fade after the denial prints is high-probability.',
      rules:
        'Only fade after an explicit denial headline. Enter in the direction of the retrace, stop beyond the post-headline extreme.',
      createdAt: '2026-04-18T11:00:00',
    },
    {
      name: 'Presser Language Scale-In',
      domain: 'central-banks',
      category: 'presser',
      status: 'testing',
      hypothesis:
        'When the press conference language diverges from the statement, the repricing develops over the full presser — scaling in on each confirming answer outperforms a single entry.',
      rules:
        'Grade each Q&A answer hawkish/dovish. Add a clip per confirming answer, max 3 clips. Flat by presser end.',
      createdAt: '2026-01-28T14:00:00',
    },
  ];
  const strategyIds = (await db.strategies.bulkAdd(strategies, { allKeys: true })) as number[];
  const strategyByDomain = new Map<DomainId, number>();
  strategies.forEach((s, i) => {
    if (s.domain && !strategyByDomain.has(s.domain)) strategyByDomain.set(s.domain, strategyIds[i]);
  });

  const trades: Trade[] = [];
  const debriefs: DailyDebrief[] = [];
  const preps: DayPrep[] = [];
  const start = new Date('2025-11-03T12:00:00');
  const end = new Date('2026-07-01T12:00:00');
  const totalMs = end.getTime() - start.getTime();

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    if (!chance(0.72)) continue;
    const date = d.toISOString().slice(0, 10);
    /** 0 → 1 across the dataset: the trader is developing */
    const skill = (d.getTime() - start.getTime()) / totalMs;
    const nTrades = 1 + Math.floor(rand() * (chance(0.25) ? 5 : 3));
    const dayTrades: Trade[] = [];

    for (let i = 0; i < nTrades; i++) {
      // weighted domain pick
      let r = rand();
      let profile = PROFILES[0];
      for (const p of PROFILES) {
        if (r < p.weight) {
          profile = p;
          break;
        }
        r -= p.weight;
      }
      const domain = DOMAIN_MAP[profile.id];
      const inst = pick(INSTRUMENTS);
      const pv = pointValue(inst.symbol);
      const hour = pick(profile.hours);
      const minute = Math.floor(rand() * 60);
      const durMin = profile.id === 'news' || profile.id === 'economic-data' ? 1 + rand() * 25 : 2 + rand() * 55;
      const entry = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`);
      const exit = new Date(entry.getTime() + durMin * 60000);

      const qty = 2 + Math.floor(rand() * 10);
      // risk per trade grows slightly with skill/confidence
      const riskDollars = Math.round((120 + rand() * 280) * (0.7 + skill * 0.8));
      const winP = profile.winP + skill * 0.06;
      const win = chance(winP);
      const rMult = win
        ? profile.payoff * (0.35 + rand() * 1.3)
        : -(0.4 + rand() * 0.75);
      const pnl = Math.round(riskDollars * rMult * 100) / 100;

      const priceMove = Math.abs(pnl) / (pv * qty);
      const side = chance(0.53) ? 'LONG' : 'SHORT';
      const entryPrice = inst.price * (1 + (rand() - 0.5) * 0.02);
      const dir = (side === 'LONG' ? 1 : -1) * (pnl >= 0 ? 1 : -1);
      const exitPrice = entryPrice + dir * priceMove;
      const roundTo = (v: number) => Math.round(v / inst.tick) * inst.tick;

      const graded = chance(0.55 + skill * 0.3);
      const grades: Trade['grades'] = graded
        ? {
            trigger: gradeFor(win, skill),
            sizing: gradeFor(win, skill),
            exit: gradeFor(win, skill),
            articulation: gradeFor(win, skill),
            review: gradeFor(win, skill),
          }
        : {};

      const iso = (x: Date) => {
        const p = (n: number) => String(n).padStart(2, '0');
        return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
      };

      const t: Trade = {
        date,
        instrument: inst.symbol,
        side,
        entryTime: iso(entry),
        exitTime: iso(exit),
        entryPrice: roundTo(entryPrice),
        exitPrice: roundTo(exitPrice),
        qty,
        pnl,
        fees: Math.round(qty * 1.24 * 100) / 100,
        plannedRisk: riskDollars,
        domain: domain.id,
        category: pick(domain.categories).id,
        tags: pick(LEVEL3[domain.id]),
        strategyId: chance(0.4) ? strategyByDomain.get(domain.id) ?? null : null,
        description: pick(profile.narratives),
        learned: chance(0.5)
          ? pick([
              'Patience at the level paid — waiting for confirmation kept me out of the first fake move.',
              'I sized this one to conviction instead of default size and it made the difference.',
              'Exited on plan even though it kept going. Process over outcome.',
              'I hesitated on the trigger and gave up half the move. The read was right, execution late.',
              'Correlation check saved me — bonds were not confirming so I kept size small.',
            ])
          : '',
        applyNext: chance(0.4)
          ? pick([
              'Pre-map both directions before every tier-1 release, write it down.',
              'Set the alert at the level so the entry is mechanical.',
              'Template this setup and track the next 10 occurrences.',
              'Reduce default clip until the win rate stabilises above 50%.',
            ])
          : '',
        videoUrl: '',
        grades,
        source: 'demo',
        account: 'SIM-1',
      };
      // scale-in/out execution detail (weighted so averages match the trade)
      if (chance(0.6)) {
        const mkFills = (
          total: number,
          around: number,
          startMs: number,
          spanMs: number,
          action: 'BUY' | 'SELL',
        ) => {
          const n = Math.min(total, 1 + Math.floor(rand() * 3));
          const sizes: number[] = [];
          let left = total;
          for (let k = 0; k < n; k++) {
            const s = k === n - 1 ? left : Math.max(1, Math.floor(left / (n - k)));
            sizes.push(s);
            left -= s;
          }
          return sizes.map((s2, k) => ({
            time: iso(new Date(startMs + (spanMs * k) / Math.max(1, n))),
            action,
            qty: s2,
            price: roundTo(around * (1 + (rand() - 0.5) * 0.0008)),
            orderType: pick(['limit', 'limit', 'market', 'stop'] as const),
          }));
        };
        const spanMs = exit.getTime() - entry.getTime();
        const inAction = side === 'LONG' ? ('BUY' as const) : ('SELL' as const);
        const outAction = side === 'LONG' ? ('SELL' as const) : ('BUY' as const);
        t.executions = [
          ...mkFills(qty, t.entryPrice, entry.getTime(), spanMs * 0.4, inAction),
          ...mkFills(qty, t.exitPrice, entry.getTime() + spanMs * 0.6, spanMs * 0.4, outAction),
        ];
      }
      t.importKey = makeImportKey(t);
      dayTrades.push(t);
    }
    trades.push(...dayTrades);

    if (chance(0.5)) {
      const dayPnl = dayTrades.reduce((s, t) => s + t.pnl, 0);
      const good = dayPnl >= 0;
      debriefs.push({
        date,
        narrative: good
          ? 'Focused session. Followed the plan from the morning prep, took the A setups and passed on the marginal ones. Felt calm and deliberate through the data window.'
          : 'Choppy day and I let the first loss affect the second entry. Traded slightly oversized relative to the conditions and forced a setup that was not fully formed.',
        comparison: good
          ? 'Hypothesis from prep played out — balance overnight, expansion after the data. I was positioned for the right scenario.'
          : 'My prep scenario expected trend continuation but the market stayed balanced. I was slow to flip to a rotational playbook.',
        learned: good
          ? 'When the first hypothesis confirms early, conviction sizing on the second entry is justified.'
          : 'A balanced overnight profile plus no tier-1 data means rotational trading — fade the extremes, do not chase breaks.',
        applyNext: good
          ? 'Keep the same prep template; add the correlation check before sizing up.'
          : 'Write the day-type call on the screen before the open and re-read it after any loss.',
        prepScore: Math.min(5, 2 + Math.floor(rand() * 3) + (good ? 1 : 0)),
        executionScore: Math.min(5, 1 + Math.floor(rand() * 3) + (good ? 2 : 0)),
      });
    }

    if (chance(0.4)) {
      const prep = emptyPrep(date);
      prep.overnightMarkets = [
        { market: 'Dollar / DXY', note: pick(['DXY flat, inside day', 'Dollar bid overnight, +0.3%', 'Euro squeeze on ECB sources story']) },
        { market: 'Gold (GC)', note: pick(['Quiet, holding the range', 'Gold +0.8% — risk-off tone', 'Drifting lower with yields up']) },
        { market: 'Crude Oil (CL)', note: pick(['Crude flat into inventories', 'MCL +1.2% on supply headline', 'Selling off from the bounce']) },
        ...(chance(0.6) ? [{ market: pick(['S&P 500 (ES)', 'Nasdaq (NQ)', 'DAX (FDAX)']), note: pick(['Balanced overnight, low volume', 'Gap higher with US futures', 'Weak, holding VWAP']) }] : []),
        ...(chance(0.5) ? [{ market: pick(['10y Notes (ZN)', 'Bunds (FGBL)', 'Yen (6J)']), note: pick(['Unchanged', 'Bid with the risk-off move', 'Offered into supply']) }] : []),
      ];
      prep.overnightMoved = pick([
        'Gold and bonds both bid — consistent risk-off read across markets.',
        'One-market move only (crude on the headline); others quiet, so not a regime signal.',
        'Nothing significant overnight; expect the data window to set the tone.',
      ]);
      prep.overnightImplication = pick([
        'Risk-off backdrop favours short setups in equities; keep size smaller against the trend.',
        'No overnight lean — trade the profile levels and let the open show direction.',
        'If the dollar move holds, 6E continuation is the cleanest expression.',
      ]);
      prep.newsPricedIn = 'Yesterday’s CPI reaction fully played out; market treats it as done.';
      prep.newsDeveloping = 'Tariff story still open — watch for counter-response headlines; crude and MNQ react best.';
      if (chance(0.6)) {
        prep.events = [
          { time: '13:30', name: pick(['NFP', 'CPI', 'Jobless Claims', 'Retail Sales']), expectations: 'consensus in line, range tight', notes: 'last release: phase-1 spike then continuation' },
          { time: '15:00', name: pick(['ISM', 'Consumer Confidence', 'Fed speaker']), expectations: 'watch prices-paid component', notes: 'usually second-tier unless big miss' },
        ];
      }
      prep.dailyChart = pick([
        'Uptrend intact, no significant swing broken. Volume average, ranges contracting.',
        'Yesterday broke the swing low — direction now down/ranging. ATR elevated.',
        'Ranging week; yesterday an inside day. No weight on the candle shape.',
      ]);
      prep.profile = pick([
        'Yesterday a neutral day, close mid-value — balance likely; fade the extremes.',
        'Trend day up yesterday; look for one-time-framing continuation or early liquidation break.',
        'Double distribution with a clean LVN — that node is the line in the sand.',
      ]);
      prep.sixtyMin = 'Move built in two legs; next leg needs the overnight high cleared. Open space above, sticky below.';
      prep.fiveMin = 'Areas of interest at yesterday’s VAL and the single prints; delta ended positive — longs may be trapped if we open below.';
      prep.hypotheses = [
        { title: 'H1 Red', inPlay: 'On break of overnight low', expectation: 'Sweep to yesterday’s single prints, rotational after', lineInSand: 'Back above VWAP' },
        { title: 'H2 Blue', inPlay: 'Inside yesterday’s value at the open', expectation: 'Balance day, fade the elastic band extremes', lineInSand: 'Value break either side' },
        { title: 'H3 Green', inPlay: 'Open above value and hold first pullback', expectation: 'Trend into the open space above', lineInSand: 'Acceptance back inside value' },
      ];
      preps.push(prep);
    }
  }

  await db.trades.bulkAdd(trades);
  await db.debriefs.bulkAdd(debriefs);
  await db.preps.bulkAdd(preps);
  return trades.length;
}
