import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import type { DayPrep, Hypothesis, PrepEvent } from '../domain/types';
import { analyzeSeries, cotMarketForLabel, loadCot, ordinal, type CotAnalysis, type CotSnapshot } from '../lib/cot';
import { db, emptyPrep } from '../lib/db';
import { DayCatalysts } from './DayCatalysts';
import { MarketBriefing } from './MarketBriefing';
import { MediaEditor, VideoField } from './media';
import { useToast } from './ui';

const HYP_COLORS: Record<string, string> = { 'H1 Red': '#e66767', 'H2 Blue': '#3987e5', 'H3 Green': '#0ca30c' };

function fmtContracts(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1000 ? `${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}k` : String(Math.round(abs));
  return `${v < 0 ? '−' : '+'}${s}`;
}

/** One-line COT positioning context for an overnight market, from the cached weekly report. */
function PositioningHint({ a }: { a: CotAnalysis }) {
  const p = a.pctile3y;
  const extreme = p != null && (p >= 90 || p <= 10);
  return (
    <span
      className="small mono"
      title="Large speculators' net futures position (CFTC COT, weekly) and where it sits in the 3-year range — from Market Intel"
      style={{ color: extreme ? 'var(--gold)' : 'var(--muted)', fontWeight: extreme ? 600 : 400 }}
    >
      specs {fmtContracts(a.specNet)}
      {p != null && <> · {ordinal(p)} pctile 3y{extreme ? ' ⚑' : ''}</>}
    </span>
  );
}

/** Common futures markets offered as one-click additions — any custom market can be typed in too. */
const MARKET_SUGGESTIONS = [
  'Dollar / DXY',
  'EUR (6E)',
  'Yen (6J)',
  'GBP (6B)',
  'Gold (GC)',
  'Silver (SI)',
  'Copper (HG)',
  'Crude Oil (CL)',
  'Nat Gas (NG)',
  'S&P 500 (ES)',
  'Nasdaq (NQ)',
  'Russell (RTY)',
  'Dow (YM)',
  'EU Stocks (FESX)',
  'DAX (FDAX)',
  'Bunds (FGBL)',
  '10y Notes (ZN)',
  '30y Bonds (ZB)',
  'VIX',
  'Bitcoin (BTC)',
];

/**
 * Pre-trading-day preparation form for one date, following the AXIA day
 * preparation template: overnights → news → events → chart analysis →
 * hypotheses. Self-loading, self-saving.
 */
export function PrepEditor({ date }: { date: string }) {
  const existing = useLiveQuery(() => db.preps.where('date').equals(date).first(), [date]);
  const [draft, setDraft] = useState<DayPrep>(emptyPrep(date));
  const [customMarket, setCustomMarket] = useState('');
  const [cot, setCot] = useState<CotSnapshot | null>(null);
  const toast = useToast();

  // positioning context for the overnights (cached-first; refreshes silently)
  useEffect(() => {
    let alive = true;
    void loadCot(false).then((r) => alive && r.snapshot && setCot(r.snapshot));
    return () => {
      alive = false;
    };
  }, []);
  const positioning = useMemo(() => {
    const map = new Map<string, CotAnalysis>();
    for (const s of cot?.series ?? []) {
      const a = analyzeSeries(s);
      if (a) map.set(a.market.symbol, a);
    }
    return map;
  }, [cot]);

  useEffect(() => {
    setDraft(existing ? { ...emptyPrep(date), ...existing } : emptyPrep(date));
  }, [existing, date]);

  const set = <K extends keyof DayPrep>(k: K, v: DayPrep[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const persist = async (record: DayPrep): Promise<number> => {
    if (record.id) {
      await db.preps.put(record);
      return record.id;
    }
    const id = await db.preps.add({ ...record, date });
    setDraft((d) => ({ ...d, id }));
    return id;
  };

  const save = async () => {
    await persist({ ...draft, date });
    toast('Preparation saved');
  };

  const setEvent = (i: number, patch: Partial<PrepEvent>) =>
    set('events', draft.events.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  const setHyp = (i: number, patch: Partial<Hypothesis>) =>
    set('hypotheses', draft.hypotheses.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'center', gap: 22 }}>
        {['Keep perspective on moves', 'What is the implication?', 'Add risk to high value trades'].map((m) => (
          <span key={m} className="small" style={{ color: 'var(--gold)', fontWeight: 600, fontStyle: 'italic' }}>
            {m}
          </span>
        ))}
      </div>

      <DayCatalysts date={date} />

      <MarketBriefing date={date} />

      <div className="card stack">
        <div className="card-title">
          Overnights <span className="hint">the session before your market opens — pick the markets you want to analyse today</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="small muted">Add market:</span>
          {MARKET_SUGGESTIONS.filter((m) => !draft.overnightMarkets.some((o) => o.market === m)).map((m) => (
            <span
              key={m}
              className="chip clickable"
              onClick={() => set('overnightMarkets', [...draft.overnightMarkets, { market: m, note: '' }])}
            >
              + {m}
            </span>
          ))}
          <input
            placeholder="Other market ↵"
            value={customMarket}
            onChange={(e) => setCustomMarket(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customMarket.trim()) {
                set('overnightMarkets', [...draft.overnightMarkets, { market: customMarket.trim(), note: '' }]);
                setCustomMarket('');
              }
            }}
            style={{ width: 140 }}
          />
        </div>
        {draft.overnightMarkets.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {draft.overnightMarkets.map((m, i) => {
              const cm = cotMarketForLabel(m.market);
              const a = cm ? positioning.get(cm.symbol) : undefined;
              return (
              <label key={i} className="field">
                <span className="spread">
                  <span className="row" style={{ gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                    {m.market}
                    {a && <PositioningHint a={a} />}
                  </span>
                  <span
                    style={{ cursor: 'pointer', color: 'var(--muted)' }}
                    title="Remove market"
                    onClick={(e) => {
                      e.preventDefault();
                      set('overnightMarkets', draft.overnightMarkets.filter((_, j) => j !== i));
                    }}
                  >
                    ✕
                  </span>
                </span>
                <textarea
                  rows={2}
                  value={m.note}
                  onChange={(e) =>
                    set('overnightMarkets', draft.overnightMarkets.map((o, j) => (j === i ? { ...o, note: e.target.value } : o)))
                  }
                  placeholder="Moved significantly? Read?"
                />
              </label>
              );
            })}
          </div>
        )}
        <div className="grid grid-2">
          <label className="field">
            <span>Have any moved significantly? Same movement across markets, or one alone?</span>
            <textarea rows={2} value={draft.overnightMoved} onChange={(e) => set('overnightMoved', e.target.value)} />
          </label>
          <label className="field">
            <span>What is the implication for your main markets?</span>
            <textarea rows={2} value={draft.overnightImplication} onChange={(e) => set('overnightImplication', e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">News</div>
        <div className="grid grid-2">
          <label className="field">
            <span>Priced in — story that has happened. How have markets reacted? Do they see it as important?</span>
            <textarea rows={3} value={draft.newsPricedIn} onChange={(e) => set('newsPricedIn', e.target.value)} />
          </label>
          <label className="field">
            <span>Developing — story yet to conclude. How will you trade a development? Where will it come from?</span>
            <textarea rows={3} value={draft.newsDeveloping} onChange={(e) => set('newsDeveloping', e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">
          Events <span className="hint">list events, check previous reactions; plan events you wish to trade and factor in prep time</span>
        </div>
        {draft.events.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Time</th>
                  <th>Data / Speaker</th>
                  <th>Expectations</th>
                  <th>Previous reaction / plan</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.events.map((e, i) => (
                  <tr key={i}>
                    <td>
                      <input value={e.time} onChange={(ev) => setEvent(i, { time: ev.target.value })} placeholder="13:30" style={{ width: 80 }} />
                    </td>
                    <td>
                      <input value={e.name} onChange={(ev) => setEvent(i, { name: ev.target.value })} placeholder="NFP" style={{ width: '100%', minWidth: 110 }} />
                    </td>
                    <td>
                      <input value={e.expectations} onChange={(ev) => setEvent(i, { expectations: ev.target.value })} placeholder="cons 180k, range 140–220k" style={{ width: '100%', minWidth: 150 }} />
                    </td>
                    <td>
                      <input value={e.notes} onChange={(ev) => setEvent(i, { notes: ev.target.value })} placeholder="last time faded the spike" style={{ width: '100%', minWidth: 150 }} />
                    </td>
                    <td>
                      <button className="btn sm danger" onClick={() => set('events', draft.events.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <button className="btn sm" onClick={() => set('events', [...draft.events, { time: '', name: '', expectations: '', notes: '' }])}>
            + Add event
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">Chart analysis</div>
        <label className="field">
          <span>Daily chart — significant change of direction? Current direction? Yesterday's candle, volume, ranges/ATR</span>
          <textarea rows={3} value={draft.dailyChart} onChange={(e) => set('dailyChart', e.target.value)} />
        </label>
        <label className="field">
          <span>Profile analysis (RTH) — yesterday's day type and likely follow-on, who is in control, open vs value, line-in-sand / in-play point, incomplete auctions & single prints</span>
          <textarea rows={3} value={draft.profile} onChange={(e) => set('profile', e.target.value)} />
        </label>
        <label className="field">
          <span>60 min — scope of movement, structure (how the move was built, next leg, hurdles, open space vs sticky areas), positioning</span>
          <textarea rows={3} value={draft.sixtyMin} onChange={(e) => set('sixtyMin', e.target.value)} />
        </label>
        <label className="field">
          <span>5 min — areas of interest and precision, scalp vs directional entry, where the market accelerates or gets sticky, yesterday's delta</span>
          <textarea rows={3} value={draft.fiveMin} onChange={(e) => set('fiveMin', e.target.value)} />
        </label>
      </div>

      <div className="card stack">
        <div className="card-title">
          Hypotheses <span className="hint">typically 3 — each needs an in-play point and a line-in-the-sand; re-assess as the day goes on</span>
        </div>
        {draft.hypotheses.map((h, i) => (
          <div key={i} className="card stack" style={{ background: 'var(--surface)', borderLeft: `3px solid ${HYP_COLORS[h.title] ?? 'var(--gold)'}`, gap: 8 }}>
            <input
              value={h.title}
              onChange={(e) => setHyp(i, { title: e.target.value })}
              style={{ fontWeight: 700, width: 140, background: 'transparent', border: 'none', padding: 0, fontSize: 14 }}
            />
            <div className="grid grid-3">
              <label className="field">
                <span>In play when…</span>
                <textarea rows={2} value={h.inPlay} onChange={(e) => setHyp(i, { inPlay: e.target.value })} placeholder="on break of 5630…" />
              </label>
              <label className="field">
                <span>Expectation — likely movement & type of day</span>
                <textarea rows={2} value={h.expectation} onChange={(e) => setHyp(i, { expectation: e.target.value })} placeholder="sweep to 5613 single print, target 5595-85" />
              </label>
              <label className="field">
                <span>Line in the sand — dismissed when…</span>
                <textarea rows={2} value={h.lineInSand} onChange={(e) => setHyp(i, { lineInSand: e.target.value })} placeholder="LIS 5632" />
              </label>
            </div>
          </div>
        ))}
        <div>
          <button
            className="btn sm"
            onClick={() => set('hypotheses', [...draft.hypotheses, { title: `H${draft.hypotheses.length + 1}`, inPlay: '', lineInSand: '', expectation: '' }])}
          >
            + Add hypothesis
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">Preparation media</div>
        <VideoField label="Preparation video (recording of your prep / market walk-through)" value={draft.videoUrl ?? ''} onChange={(v) => set('videoUrl', v)} />
        <MediaEditor
          parentType="prep"
          parentId={draft.id ?? null}
          links={draft.links ?? []}
          onLinksChange={(links) => set('links', links)}
          ensureParentId={() => persist({ ...draft, date })}
        />
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={save}>
          {existing ? 'Update preparation' : 'Save preparation'}
        </button>
      </div>
    </div>
  );
}
