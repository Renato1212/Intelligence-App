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
  /**
   * The symbol that always works in free embeds: 24h CFD/index proxies
   * (OANDA/FX/TVC feeds). TradingView blocks many licensed exchange symbols
   * (CME/CBOT/NYMEX/COMEX, some cash indices) in free widgets with
   * "this symbol is only available on TradingView" — the proxy tracks the
   * same market tick-for-tick in shape.
   */
  proxy: string;
  /** the actual futures contract — may be refused by the free embed */
  futures?: string;
  note: string;
}

export const CHART_SYMBOLS: ChartSymbol[] = [
  { id: 'ES', label: 'ES', proxy: 'OANDA:SPX500USD', futures: 'CME_MINI:ES1!', note: 'S&P 500 — 24h CFD proxy / E-mini contract' },
  { id: 'NQ', label: 'NQ', proxy: 'OANDA:NAS100USD', futures: 'CME_MINI:NQ1!', note: 'Nasdaq-100 — 24h CFD proxy / E-mini contract' },
  { id: 'RTY', label: 'RTY', proxy: 'OANDA:US2000USD', futures: 'CME_MINI:RTY1!', note: 'Russell 2000 — 24h CFD proxy / E-mini contract' },
  { id: 'YM', label: 'YM', proxy: 'OANDA:US30USD', futures: 'CBOT_MINI:YM1!', note: 'Dow — 24h CFD proxy / E-mini contract' },
  { id: 'ZN', label: 'ZN', proxy: 'TVC:US10Y', futures: 'CBOT:ZN1!', note: '10-year — yield proxy (moves INVERSE to ZN price) / note contract' },
  { id: 'ZB', label: 'ZB', proxy: 'TVC:US30Y', futures: 'CBOT:ZB1!', note: '30-year — yield proxy (inverse to price) / bond contract' },
  { id: '6E', label: '6E', proxy: 'FX:EURUSD', futures: 'CME:6E1!', note: 'Euro — spot EURUSD tracks 6E tick-for-tick' },
  { id: 'GC', label: 'GC', proxy: 'OANDA:XAUUSD', futures: 'COMEX:GC1!', note: 'Gold — spot XAUUSD proxy / COMEX contract' },
  { id: 'CL', label: 'CL', proxy: 'TVC:USOIL', futures: 'NYMEX:CL1!', note: 'WTI crude — USOIL proxy / NYMEX contract' },
  { id: 'VIX', label: 'VIX', proxy: 'TVC:VIX', note: 'Vol regime live — pairs with Options & Vol' },
  { id: 'DXY', label: 'DXY', proxy: 'TVC:DXY', note: 'Dollar index — the cross-asset anchor' },
];

const SYMBOL_KEY = 'ei-chart-symbol';
const INTERVAL_KEY = 'ei-chart-interval';
const MODE_KEY = 'ei-chart-mode';

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
    title: 'Why the 24h proxy feed is the default',
    body:
      'TradingView licenses exchange data, so free embeds refuse many CME/CBOT symbols. The proxy feeds (SPX500USD, NAS100USD, XAUUSD, USOIL…) are 24h CFD/spot markets that arbitrage against the futures — identical structure, always available, live. Draw levels on the proxy, execute on your broker\'s futures quote; the basis shifts the absolute price, never the shape. Only ZN/ZB differ: their proxies are YIELDS, which move inverse to bond price.',
  },
];

/* --------------------------------- page ---------------------------------- */

export default function Charts() {
  const [symId, setSymId] = useState(() => loadPref(SYMBOL_KEY, 'ES'));
  const [interval, setInterval] = useState(() => loadPref(INTERVAL_KEY, '30'));
  const [mode, setMode] = useState<'proxy' | 'futures'>(() => (loadPref(MODE_KEY, 'proxy') === 'futures' ? 'futures' : 'proxy'));

  const sym = CHART_SYMBOLS.find((s) => s.id === symId) ?? CHART_SYMBOLS[0];
  const tvSymbol = mode === 'futures' && sym.futures ? sym.futures : sym.proxy;

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
  const pickMode = (m: 'proxy' | 'futures') => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch { /* private mode */ }
  };

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
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {CHART_SYMBOLS.map((s) => (
              <span key={s.id} className={`chip clickable ${s.id === sym.id ? 'selected' : ''}`} onClick={() => pick(s.id)} title={s.note}>
                {s.label}
              </span>
            ))}
          </div>
          <div className="row" style={{ gap: 4, alignItems: 'center' }}>
            <span className="tile-label" style={{ marginRight: 2 }}>Feed</span>
            <span className={`chip clickable ${mode === 'proxy' ? 'selected' : ''}`} onClick={() => pickMode('proxy')} title="24h CFD/index proxies — always available in the embed, no exchange restrictions">
              24h proxy
            </span>
            <span className={`chip clickable ${mode === 'futures' ? 'selected' : ''}`} onClick={() => pickMode('futures')} title="The actual exchange contract — TradingView may refuse it in free embeds ('only available on TradingView')">
              Futures
            </span>
          </div>
          <div className="row" style={{ gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
            <span className="tile-label" style={{ marginRight: 2 }}>TF</span>
            {INTERVALS.map((iv) => (
              <span key={iv.code} className={`chip clickable ${iv.code === interval ? 'selected' : ''}`} onClick={() => pickInterval(iv.code)}>
                {iv.label}
              </span>
            ))}
          </div>
        </div>
        <TVAdvancedChart tvSymbol={tvSymbol} interval={interval} />
        <div className="muted small" style={{ marginTop: 8 }}>
          Data by TradingView. The <b>24h proxy</b> feed (CFD/spot/index) is always available and tracks the futures
          tick-for-tick in shape — trade the levels, execute on your broker&apos;s quote. The <b>Futures</b> feed shows
          the actual contract but TradingView blocks some exchange symbols in free embeds; if you see &quot;only
          available on TradingView&quot;, flip back to 24h proxy. ZN/ZB proxies are YIELDS — they move inverse to
          bond prices.
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
