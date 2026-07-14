import { useEffect, useRef, useState } from 'react';
import { Connects } from '../components/Connects';
import { Principle } from '../components/ui';

/*
 * Charts — TradingView embedded in the platform.
 *
 * Rather than rebuilding a charting engine, this embeds TradingView's free
 * Advanced Chart widget: full price history, live updating quotes, and the
 * complete TA toolset (drawings, indicators, replay-style scrolling) for the
 * exact futures contracts traded from this platform. The widget streams from
 * TradingView's own servers, so it works with zero keys and zero setup.
 *
 * Everything renders in Europe/Lisbon time to match the rest of the app.
 *
 * Honest data note (shown in the UI): CME/CBOT/NYMEX/COMEX futures quotes are
 * exchange-delayed (~10 min) on free TradingView embeds. The cash indices
 * (SPX, NDX, VIX, DXY) update in real time — use them for live timing and the
 * futures chart for levels; the SHAPES are identical.
 */

interface ChartSymbol {
  id: string;
  label: string;
  /** TradingView symbol code */
  tv: string;
  group: 'Futures' | 'Cash / real-time';
  note: string;
}

export const CHART_SYMBOLS: ChartSymbol[] = [
  { id: 'ES', label: 'ES', tv: 'CME_MINI:ES1!', group: 'Futures', note: 'S&P 500 E-mini — continuous front month' },
  { id: 'NQ', label: 'NQ', tv: 'CME_MINI:NQ1!', group: 'Futures', note: 'Nasdaq-100 E-mini — continuous front month' },
  { id: 'RTY', label: 'RTY', tv: 'CME_MINI:RTY1!', group: 'Futures', note: 'Russell 2000 E-mini' },
  { id: 'YM', label: 'YM', tv: 'CBOT_MINI:YM1!', group: 'Futures', note: 'Dow E-mini' },
  { id: 'ZN', label: 'ZN', tv: 'CBOT:ZN1!', group: 'Futures', note: '10-year Treasury note — the honest leg on data prints' },
  { id: 'ZB', label: 'ZB', tv: 'CBOT:ZB1!', group: 'Futures', note: '30-year Treasury bond' },
  { id: '6E', label: '6E', tv: 'CME:6E1!', group: 'Futures', note: 'Euro FX futures' },
  { id: 'GC', label: 'GC', tv: 'COMEX:GC1!', group: 'Futures', note: 'Gold futures' },
  { id: 'CL', label: 'CL', tv: 'NYMEX:CL1!', group: 'Futures', note: 'WTI crude futures' },
  { id: 'SPX', label: 'SPX', tv: 'SP:SPX', group: 'Cash / real-time', note: 'S&P 500 cash index — real-time timing for ES' },
  { id: 'NDX', label: 'NDX', tv: 'NASDAQ:NDX', group: 'Cash / real-time', note: 'Nasdaq-100 cash index — real-time timing for NQ' },
  { id: 'VIX', label: 'VIX', tv: 'TVC:VIX', group: 'Cash / real-time', note: 'Vol regime live — pairs with Options & Vol' },
  { id: 'DXY', label: 'DXY', tv: 'TVC:DXY', group: 'Cash / real-time', note: 'Dollar index — the cross-asset anchor' },
];

const SYMBOL_KEY = 'ei-chart-symbol';
const INTERVAL_KEY = 'ei-chart-interval';

const INTERVALS: { code: string; label: string }[] = [
  { code: '5', label: '5m' },
  { code: '15', label: '15m' },
  { code: '30', label: '30m' },
  { code: '60', label: '1h' },
  { code: '240', label: '4h' },
  { code: 'D', label: 'Daily' },
  { code: 'W', label: 'Weekly' },
];

function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * The TradingView Advanced Chart embed. The widget script reads its JSON
 * config from the script tag's text content and replaces the container, so a
 * symbol/interval change means rebuilding the container with a fresh script.
 */
function TVAdvancedChart({ tvSymbol, interval }: { tvSymbol: string; interval: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setFailed(false);
    host.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'tradingview-widget-container';
    container.style.height = '100%';
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.height = '100%';
    container.appendChild(inner);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.onerror = () => setFailed(true);
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval,
      timezone: 'Europe/Lisbon',
      theme: 'dark',
      style: '1',
      locale: 'en',
      withdateranges: true,
      allow_symbol_change: true,
      hide_side_toolbar: false,
      details: true,
      studies: ['STD;VWAP'],
      support_host: 'https://www.tradingview.com',
    });
    container.appendChild(script);
    host.appendChild(container);

    return () => {
      host.innerHTML = '';
    };
  }, [tvSymbol, interval]);

  return (
    <div style={{ height: 'min(72vh, 680px)', minHeight: 420 }}>
      {failed ? (
        <div className="muted small" style={{ padding: 20 }}>
          Could not load the TradingView widget — the browser could not reach s3.tradingview.com (offline, or the
          network blocks it). The rest of the platform keeps working; reload when back online.
        </div>
      ) : (
        <div ref={hostRef} style={{ height: '100%' }} data-testid="tv-chart-host" />
      )}
    </div>
  );
}

/* ----------------------------- teaching layer ----------------------------- */

const CHART_READS: { title: string; body: string }[] = [
  {
    title: 'Mark the dealer levels before you draw anything',
    body:
      'Open Options & Vol first and write down the put wall, call wall, zero-gamma flip and the expected-move band for the instrument. Draw them as horizontal lines here. Technical levels that COINCIDE with dealer levels are the ones that actually hold — confluence of forced flow and chart memory.',
  },
  {
    title: 'Time-stamp the chart with the session windows',
    body:
      'Everything here renders in Lisbon time, same as the Session Clock. The opens (Europe 08:00, US cash 14:30) and the prime-time overlap are when levels get TESTED; lunches are when they get faked. Use vertical lines at the session opens and the scheduled prints from Catalysts.',
  },
  {
    title: 'VWAP is the fairest fair-value line',
    body:
      'The chart loads with session VWAP attached. Above rising VWAP = buyers in control (longs from pullbacks TO it); repeated failures at VWAP after a hot print = the repricing is real. In positive gamma, mean reversion toward VWAP dominates; in negative gamma, VWAP breaks travel.',
  },
  {
    title: 'Futures are delayed on the free embed — use the cash proxies for timing',
    body:
      'CME futures quotes here are ~10 min exchange-delayed. SPX, NDX, VIX and DXY are real-time: watch the cash index for live timing and execute against your broker\'s live futures quote. Levels drawn on ES translate 1:1 to SPX shape (the basis shifts the absolute price, not the structure).',
  },
];

/* --------------------------------- page ---------------------------------- */

export default function Charts() {
  const [symId, setSymId] = useState(() => loadPref(SYMBOL_KEY, 'ES'));
  const [interval, setInterval] = useState(() => loadPref(INTERVAL_KEY, '30'));

  const sym = CHART_SYMBOLS.find((s) => s.id === symId) ?? CHART_SYMBOLS[0];

  const pick = (id: string) => {
    setSymId(id);
    try {
      localStorage.setItem(SYMBOL_KEY, id);
    } catch { /* private mode */ }
  };
  const pickInterval = (code: string) => {
    setInterval(code);
    try {
      localStorage.setItem(INTERVAL_KEY, code);
    } catch { /* private mode */ }
  };

  const groups: ChartSymbol['group'][] = ['Futures', 'Cash / real-time'];

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h1 className="page-title">Charts</h1>
        <div className="page-sub">
          Full TradingView charting — history + live data + the complete drawing/indicator toolset — inside the
          platform, in Lisbon time. Draw the levels the other sections give you.
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          {sym.label} · {sym.note}{' '}
          <span className="hint">symbol search inside the chart works too — these chips are the platform&apos;s instruments</span>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          {groups.map((g) => (
            <div key={g} className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="tile-label" style={{ marginRight: 2 }}>{g}</span>
              {CHART_SYMBOLS.filter((s) => s.group === g).map((s) => (
                <span key={s.id} className={`chip clickable ${s.id === sym.id ? 'selected' : ''}`} onClick={() => pick(s.id)} title={s.note}>
                  {s.label}
                </span>
              ))}
            </div>
          ))}
          <div className="row" style={{ gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
            <span className="tile-label" style={{ marginRight: 2 }}>TF</span>
            {INTERVALS.map((iv) => (
              <span key={iv.code} className={`chip clickable ${iv.code === interval ? 'selected' : ''}`} onClick={() => pickInterval(iv.code)}>
                {iv.label}
              </span>
            ))}
          </div>
        </div>
        <TVAdvancedChart tvSymbol={sym.tv} interval={interval} />
        <div className="muted small" style={{ marginTop: 8 }}>
          Data by TradingView. Futures (ES, NQ, ZN…) are exchange-delayed ~10 min on the free embed; SPX / NDX / VIX /
          DXY update in real time — use them for live timing, the futures chart for levels.
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          How to use the chart with the method <span className="hint">the chart is where the other sections&apos; numbers become lines</span>
        </div>
        <div className="grid grid-2" style={{ gap: 10 }}>
          {CHART_READS.map((r) => (
            <div key={r.title}>
              <div className="small" style={{ fontWeight: 600, color: 'var(--gold)' }}>{r.title}</div>
              <div className="muted small">{r.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <Principle domain="Technical analysis — the chart is the last step, not the first">
          Technical analysis alone is everyone&apos;s edge, which makes it no one&apos;s. The sequence that pays: context
          (Macro Map) → scheduled risk (Catalysts) → dealer levels (Options &amp; Vol) → positioning (Market Intel) →
          THEN the chart, to time an entry at a level you already had reasons to care about. A trendline break at a
          random price is noise; the same break at the put wall during prime time after a cold CPI is a trade.
        </Principle>
      </div>

      <Connects id="charts" />
    </div>
  );
}
