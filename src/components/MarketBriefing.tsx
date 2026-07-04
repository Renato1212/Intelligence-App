import { useCallback, useEffect, useMemo, useState } from 'react';
import { cachedBriefing, fetchBriefing, getMarketApiKey, setMarketApiKey, type Briefing } from '../lib/market';
import { todayISO } from '../lib/format';
import { useToast } from './ui';

const IMPACT_COLOR: Record<string, string> = { High: 'var(--loss)', Medium: 'var(--dom-news)', Low: 'var(--muted)' };

/**
 * Live "day ahead" panel for the preparation page: today's tier-1 events
 * with consensus / previous / actual (surprises highlighted the moment
 * they print) and an overnight risk-sense read across key markets —
 * auto-refreshing while you prepare.
 */
export function MarketBriefing({ date }: { date: string }) {
  const [hasKey, setHasKey] = useState(!!getMarketApiKey());
  const [keyInput, setKeyInput] = useState('');
  const [briefing, setBriefing] = useState<Briefing | null>(() => cachedBriefing(date));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const isToday = date === todayISO();

  const refresh = useCallback(async () => {
    if (!getMarketApiKey()) return;
    setLoading(true);
    try {
      setBriefing(await fetchBriefing(date));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'no-key') setError(msg);
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    setBriefing(cachedBriefing(date));
    setError(null);
    if (hasKey) void refresh();
    // live view auto-refreshes only for today
    if (hasKey && isToday) {
      const t = setInterval(() => void refresh(), 60000);
      return () => clearInterval(t);
    }
  }, [date, hasKey, isToday, refresh]);

  const nextEventIdx = useMemo(() => {
    if (!briefing || !isToday) return -1;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return briefing.events.findIndex((e) => e.time >= hhmm && !e.actual);
  }, [briefing, isToday]);

  if (!hasKey) {
    return (
      <div className="card">
        <div className="card-title">
          Live day-ahead briefing <span className="hint">events, prints and overnight moves — auto-updating</span>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Connect a free market-data key and this panel fills itself every morning: the overnight risk-sense read
          across equities, vol, rates, dollar, metals and energy (via liquid ETF proxies, which work on the free
          plan), plus today's tier-1 economic events with consensus and previous prints — actuals appear live as
          they hit. Get a free key at{' '}
          <a href="https://site.financialmodelingprep.com/developer/docs" target="_blank" rel="noreferrer">
            financialmodelingprep.com
          </a>
          . It stays in your browser only. The overnight read works on the free plan; the economic calendar may
          require one of their paid tiers — either way the panel shows whatever your plan allows and tells you if
          something needs an upgrade.
        </p>
        <div className="row">
          <input
            placeholder="Paste your FMP API key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button
            className="btn primary sm"
            disabled={!keyInput.trim()}
            onClick={() => {
              setMarketApiKey(keyInput);
              setHasKey(true);
              toast('Key saved — loading the briefing');
            }}
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  const maxAbs = Math.max(...(briefing?.quotes.map((q) => Math.abs(q.changePct)) ?? [1]), 0.5);

  return (
    <div className="card stack">
      <div className="card-title">
        Live day-ahead briefing{' '}
        <span className="hint row" style={{ gap: 8 }}>
          {briefing && <span>updated {new Date(briefing.fetchedAt).toLocaleTimeString()}</span>}
          {isToday && <span style={{ color: 'var(--profit)' }}>● live</span>}
          <button className="btn sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            className="btn sm"
            title="Disconnect the market-data key"
            onClick={() => {
              setMarketApiKey('');
              setHasKey(false);
            }}
          >
            ✕
          </button>
        </span>
      </div>

      {error && <div className="small" style={{ color: 'var(--loss)' }}>⚠ {error}</div>}

      <div>
        <div className="small muted" style={{ marginBottom: 6 }}>
          Overnight moves — the risk-sense read <span style={{ opacity: 0.7 }}>(ETF proxies)</span>
        </div>
        {briefing?.quotesError && <div className="small" style={{ color: 'var(--dom-news)', marginBottom: 6 }}>⚠ {briefing.quotesError}</div>}
        {briefing && briefing.quotes.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
            {briefing.quotes.map((q) => {
              const pct = q.changePct;
              const w = Math.min(100, (Math.abs(pct) / maxAbs) * 100);
              return (
                <div key={q.symbol} className="row" style={{ gap: 8, padding: '3px 6px' }} title={`${q.label}: ${q.price}`}>
                  <span className="small" style={{ width: 68, flexShrink: 0 }}>{q.label}</span>
                  <div style={{ flex: 1, height: 14, position: 'relative', background: 'var(--surface)', borderRadius: 4 }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: pct >= 0 ? '50%' : `${50 - w / 2}%`,
                        width: `${w / 2}%`,
                        top: 2,
                        bottom: 2,
                        borderRadius: 3,
                        background: pct >= 0 ? 'var(--profit)' : 'var(--loss)',
                      }}
                    />
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--axis)' }} />
                  </div>
                  <span className={`small mono ${pct > 0 ? 'pos' : pct < 0 ? 'neg' : 'muted'}`} style={{ width: 52, textAlign: 'right' }}>
                    {pct >= 0 ? '+' : ''}
                    {pct.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="small muted" style={{ marginBottom: 6 }}>
          Scheduled events — plan the ones you wish to trade
        </div>
        {briefing?.eventsError && <div className="small" style={{ color: 'var(--dom-news)', marginBottom: 6 }}>⚠ {briefing.eventsError}</div>}
        {!briefing || briefing.events.length === 0 ? (
          <div className="muted small">{briefing?.eventsError ? '' : 'No medium/high-impact events found for this day.'}</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Impact</th>
                  <th className="num">Consensus</th>
                  <th className="num">Previous</th>
                  <th className="num">Actual</th>
                </tr>
              </thead>
              <tbody>
                {briefing.events.map((e, i) => {
                  const surprise = e.actual != null && e.consensus != null && e.actual !== e.consensus;
                  return (
                    <tr key={i} style={i === nextEventIdx ? { background: 'var(--gold-dim)' } : undefined}>
                      <td className="mono">
                        {e.time} {i === nextEventIdx && <span style={{ color: 'var(--gold)' }}>← next</span>}
                      </td>
                      <td>
                        <span className="chip" style={{ marginRight: 6 }}>{e.country}</span>
                        {e.name}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 5 }}>
                          <span className="grade-dot" style={{ background: IMPACT_COLOR[e.impact] ?? 'var(--muted)' }} />
                          <span className="small muted">{e.impact}</span>
                        </span>
                      </td>
                      <td className="num mono">{e.consensus ?? '—'}</td>
                      <td className="num mono">{e.previous ?? '—'}</td>
                      <td className="num mono" style={surprise ? { color: 'var(--gold-strong)', fontWeight: 700 } : undefined}>
                        {e.actual ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
