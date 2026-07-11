import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { CRITERIA, DOMAINS } from '../domain/taxonomy';
import { db } from '../lib/db';
import { fmtMoney, fmtPct } from '../lib/format';
import { computeStats } from '../lib/stats';

export default function Playbook() {
  const [active, setActive] = useState(DOMAINS[0].id);
  const trades = useLiveQuery(() => db.trades.toArray(), []) ?? [];
  const d = DOMAINS.find((x) => x.id === active)!;

  const domainStats = useMemo(() => computeStats(trades.filter((t) => t.domain === d.id)), [trades, d]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">The 5 Edge Domain Playbook</h1>
          <p className="page-sub">
            Know what to look for, how to classify a trade and how it is graded — before you put size on.
          </p>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        {DOMAINS.map((dom) => (
          <span
            key={dom.id}
            className={`chip clickable ${active === dom.id ? 'selected' : ''}`}
            style={{ padding: '6px 14px', fontSize: 13 }}
            onClick={() => setActive(dom.id)}
          >
            <span className="dot" style={{ background: dom.color }} />
            {String(dom.index).padStart(2, '0')} · {dom.name}
          </span>
        ))}
      </div>

      <div className="stack">
        <div className="card" style={{ borderLeft: `3px solid ${d.color}` }}>
          <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div className="small muted" style={{ letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                Edge domain {d.index}
              </div>
              <h2 style={{ fontSize: 26, marginTop: 2 }}>{d.name}</h2>
              <div className="muted" style={{ fontStyle: 'italic' }}>{d.tagline}</div>
            </div>
            {domainStats.count > 0 && (
              <div className="row" style={{ gap: 22 }}>
                <MiniStat label="Your trades" value={String(domainStats.count)} />
                <MiniStat
                  label="Net P&L"
                  value={fmtMoney(domainStats.netPnl, { sign: true })}
                  cls={domainStats.netPnl >= 0 ? 'pos' : 'neg'}
                />
                <MiniStat label="Win rate" value={fmtPct(domainStats.winRate)} />
                <MiniStat
                  label="Expectancy"
                  value={fmtMoney(domainStats.expectancy, { sign: true })}
                  cls={domainStats.expectancy >= 0 ? 'pos' : 'neg'}
                />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">
              <span className="row" style={{ gap: 8 }}>
                <span className="pb-section-label">A</span> What to look for
              </span>
              <span className="hint">spot when this domain is in play</span>
            </div>
            <ul className="check">
              {d.lookFor.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
          <div className="card">
            <div className="card-title">
              <span className="row" style={{ gap: 8 }}>
                <span className="pb-section-label">C</span> Common mistakes
              </span>
              <span className="hint">self-check before you size up</span>
            </div>
            <ul className="check">
              {d.mistakes.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span className="row" style={{ gap: 8 }}>
              <span className="pb-section-label">B</span> How to classify a trade — tagging
            </span>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            <div>
              <div className="small" style={{ color: 'var(--gold)', fontWeight: 650, letterSpacing: '0.08em' }}>
                LEVEL 1 — PRIMARY TAG
              </div>
              <div className="muted">{d.level1}</div>
            </div>
            <div>
              <div className="small" style={{ color: 'var(--gold)', fontWeight: 650, letterSpacing: '0.08em' }}>
                LEVEL 2 — CATEGORIES
              </div>
              <div className="stack" style={{ gap: 4, marginTop: 4 }}>
                {d.categories.map((c) => (
                  <div key={c.id}>
                    <b>{c.label}:</b> <span className="muted">{c.hint}.</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="small" style={{ color: 'var(--gold)', fontWeight: 650, letterSpacing: '0.08em' }}>
                LEVEL 3 — SUGGESTIONS
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                {d.level3Suggestions.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span className="row" style={{ gap: 8 }}>
              <span className="pb-section-label">D</span> Grading criteria — coach view
            </span>
            <span className="hint">the bar AXIA coaches hold you to</span>
          </div>
          <div className="table-wrap">
            <table className="data rubric">
              <thead>
                <tr>
                  <th>Criterion</th>
                  <th>Below standard</th>
                  <th>At standard</th>
                  <th>Above standard</th>
                </tr>
              </thead>
              <tbody>
                {d.rubric.map((r) => (
                  <tr key={r.criterion}>
                    <td style={{ fontWeight: 600 }}>{CRITERIA.find((c) => c.id === r.criterion)?.label}</td>
                    <td className="muted">{r.below}</td>
                    <td>{r.at}</td>
                    <td className="above">{r.above}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {active === 'technicals' && <TechDeepDive />}
      </div>
    </>
  );
}

/** The technical sub-disciplines, in depth: what each one reads, the recurring
 *  patterns/behaviors worth money, and the mistakes that give it back. */
const TECH_DISCIPLINES: {
  id: string;
  name: string;
  reads: string;
  patterns: string[];
  mistakes: string[];
}[] = [
  {
    id: 'candles',
    name: 'Candlesticks & chart patterns',
    reads: 'The compressed record of the auction: who tried, who failed, and where. A candle is a battle summary; a pattern is a campaign.',
    patterns: [
      'Rejection wicks AT a level — a long tail into support/resistance is a failed auction; the trade is the failure, not the level itself.',
      'Engulfing bars after an extended run — late entrants trapped in one bar; their stops fuel the reversal leg.',
      'Compression before release: nested inside-bars / triangles near highs — the market building energy; trade the break-and-hold, fade the break-and-fail.',
      'Failed breakout (spring/upthrust): price takes out an obvious level, can’t hold, and closes back inside — one of the highest-expectancy patterns in trading because everyone who chased is now wrong.',
      'Trend integrity: shallow pullbacks holding prior breakout zones = one-timeframe market; keep re-entering, stop looking for tops.',
    ],
    mistakes: [
      'Reading candles in the middle of nowhere — patterns only pay AT levels that matter (prior value, session extremes, walls).',
      'Counter-trend "reversal" candles against a one-timeframe trend — a doji in a freight-train market is a pause, not a signal.',
      'Ignoring the close: a wick that closes strong and one that closes weak are opposite trades with the same shape.',
    ],
  },
  {
    id: 'profile',
    name: 'Market Profile & value',
    reads: 'WHERE the market did business and for how long — value areas, single prints, poor structure. Profile answers the framing question of every session: are we accepting or rejecting these prices?',
    patterns: [
      'Open vs value: opening inside yesterday’s value = rotation day, fade the extremes; opening outside value and holding = acceptance, go with it.',
      'Single prints / ledges — price the market spent no time at; revisits move fast through them (low-volume "air").',
      'Poor highs/lows (flat, multiple-TPO extremes) — unfinished business; the market usually returns to repair them.',
      'Initial balance extension: which side of the first hour breaks, and does it hold? A one-sided IB break with value migrating = trend day, stop fading.',
      'P-shaped profile after a rally (short covering) vs b-shaped after a break (long liquidation) — tells you whether the move had initiative buyers or just forced hands.',
    ],
    mistakes: [
      'Treating the value area as a magic line instead of a CONTEXT — it matters because of who is positioned there.',
      'Fading a value-migration day because "it’s far from the mean" — on trend days the mean is chasing price, not pulling it.',
      'Building profiles across sessions that don’t share participants (mixing Globex and RTH without intent).',
    ],
  },
  {
    id: 'dom',
    name: 'DOM (depth of market)',
    reads: 'The order book’s standing intentions — where passive size is willing to sit. The DOM shows the limit traders; the tape shows the market orders that hit them.',
    patterns: [
      'Reloading/iceberg at a price: the level keeps absorbing hits and refreshing — real passive interest; expect a hold or a slow grind through with a violent break when it pulls.',
      'Spoof-and-pull: large visible size that vanishes when approached — its INFORMATION is the pull, often preceding a push through that price.',
      'Thinning book ahead of a level — liquidity providers stepping away before a stop-run; the move accelerates into the vacuum.',
      'Size imbalance at the spread during a stall: persistent heavier bid/offer near highs/lows tells you which side is trapped.',
    ],
    mistakes: [
      'Trusting displayed size at face value — the book is an advertising space; behaviour (refresh, pull, absorb) is the signal, size alone is not.',
      'DOM-scalping through scheduled events or the roll week, when the book is a ghost town of spoofers and spreaders.',
      'Watching the ladder without a level thesis — depth reading pays as CONFIRMATION at your prepared prices, not as a standalone system.',
    ],
  },
  {
    id: 'footprint',
    name: 'Footprint & order flow',
    reads: 'Executed aggression per price: who actually paid up, and was there anyone on the other side? Delta, imbalances and absorption make the invisible fight visible.',
    patterns: [
      'Absorption at extremes: heavy market selling into a price that will not go down (positive delta divergence at lows) — passive buyers eating the panic; the spring for reversals.',
      'Stacked imbalances with follow-through — 3+ levels of one-sided aggression that HOLD is initiative flow; join pullbacks to the stack.',
      'Exhaustion prints: climactic volume at a new extreme with delta flipping on the next bar — the last buyer bought; air behind.',
      'Trapped delta: big positive delta bar that closes on its low — aggressive buyers underwater immediately; their unwind is your short fuel.',
      'Unfinished auctions at highs/lows (no buy-side finish) — magnets for a revisit, pairs beautifully with poor profile structure.',
    ],
    mistakes: [
      'Reading every imbalance as a signal — flow only means something at location; mid-range aggression is noise.',
      'Confusing high volume with initiative: volume at a level can be absorption AGAINST the move — always ask who won, not who fought.',
      'Letting the footprint override the higher-timeframe frame — order flow times the entry inside a thesis; it doesn’t replace one.',
    ],
  },
];

function TechDeepDive() {
  const [open, setOpen] = useState<string | null>('candles');
  return (
    <div className="card">
      <div className="card-title">
        <span className="row" style={{ gap: 8 }}>
          <span className="pb-section-label">E</span> The technical sub-disciplines — in depth
        </span>
        <span className="hint">candles → profile → DOM → footprint: the same auction at four zoom levels</span>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {TECH_DISCIPLINES.map((t) => (
          <div
            key={t.id}
            className="card"
            style={{ padding: '12px 14px', cursor: 'pointer', borderLeft: `3px solid ${open === t.id ? 'var(--gold)' : 'var(--hairline)'}` }}
            onClick={() => setOpen(open === t.id ? null : t.id)}
          >
            <div className="spread" style={{ alignItems: 'baseline' }}>
              <b>{t.name}</b>
              <span className="muted small">{open === t.id ? '▾' : '▸'}</span>
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>{t.reads}</div>
            {open === t.id && (
              <div className="grid grid-2" style={{ gap: 16, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                <div>
                  <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 6 }}>Patterns & behaviours that pay</div>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>
                    {t.patterns.map((p) => <li key={p} className="muted">{p}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="small" style={{ fontWeight: 700, color: 'var(--loss)', marginBottom: 6 }}>Where the money is given back</div>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>
                    {t.mistakes.map((m) => <li key={m} className="muted">{m}</li>)}
                  </ul>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 10 }}>
        One auction, four zoom levels: the <b>chart</b> frames the trade, the <b>profile</b> tells you if price is accepted,
        the <b>DOM</b> shows who is willing, and the <b>footprint</b> shows who acted. Edge compounds when all four agree at
        a prepared level — and the walls &amp; gamma map in <b>Options &amp; Vol</b> tells you which levels the dealers are
        defending mechanically.
      </div>
    </div>
  );
}

function MiniStat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="tile-label">{label}</div>
      <div className={`tile-value sm ${cls ?? ''}`}>{value}</div>
    </div>
  );
}
