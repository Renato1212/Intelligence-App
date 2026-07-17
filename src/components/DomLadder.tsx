import { useEffect, useReducer, useRef } from 'react';
import { DomEngine, type LadderRow, type SessionStats } from '../lib/dom';
import type { RProtocolClient } from '../lib/rithmicClient';

/*
 * DomLadder — the professional depth-of-market ladder.
 *
 * Attaches to the R|Protocol client's quote/trade stream, feeds a DomEngine,
 * and renders a price ladder with: resting bid/ask depth, a volume profile
 * histogram per price (buy vs sell split), per-price delta, the inside quote
 * highlighted, POC / VWAP / value-area markers, and a session order-flow
 * header (volume, cumulative delta, inside + book imbalance). Click a bid or
 * ask cell to stage a limit order at that price (click-trading).
 *
 * The engine mutates in place; a lightweight ~12fps tick re-renders while data
 * flows, so the ladder stays smooth without thrashing React on every print.
 */

const BID = '#43a45c';
const ASK = '#cc5f83';
const GOLD = 'var(--gold)';

export function DomLadder({
  client,
  symbol,
  exchange,
  depth = 10,
  onLadderOrder,
}: {
  client: RProtocolClient | null;
  symbol: string;
  exchange: string;
  depth?: number;
  onLadderOrder?: (price: number, side: 'BUY' | 'SELL') => void;
}) {
  const engineRef = useRef<DomEngine | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const dirty = useRef(false);

  // (re)build the engine when the instrument changes
  useEffect(() => {
    engineRef.current = new DomEngine(symbol || 'ESZ6');
    bump();
  }, [symbol]);

  // consume the client's market-data stream
  useEffect(() => {
    if (!client) return;
    const off = client.on((e) => {
      const eng = engineRef.current;
      if (!eng) return;
      if (e.type === 'quote' && e.quote.symbol === symbol) {
        eng.onQuote(e.quote.bid, e.quote.ask);
        dirty.current = true;
      } else if (e.type === 'trade' && e.trade.symbol === symbol) {
        eng.onTrade(e.trade.price, e.trade.size, e.trade.aggressor, e.trade.at);
        dirty.current = true;
      }
    });
    return off;
  }, [client, symbol, exchange]);

  // ~12fps repaint only when new data arrived
  useEffect(() => {
    const id = window.setInterval(() => {
      if (dirty.current) {
        dirty.current = false;
        bump();
      }
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  const eng = engineRef.current;
  if (!eng) return null;
  const rows = eng.ladder(depth);
  const stats = eng.stats();
  const maxVol = Math.max(1, eng.maxLadderVol());
  const maxRest = Math.max(1, ...rows.map((r) => Math.max(r.bidSize, r.askSize)));

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <DomHeader stats={stats} eng={eng} symbol={symbol} />
      <div style={{ maxHeight: 460, overflowY: 'auto' }}>
        <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>
              <th style={hcell}>Bid</th>
              <th style={hcell}>Price</th>
              <th style={hcell}>Ask</th>
              <th style={{ ...hcell, textAlign: 'right' }}>Profile (B/S)</th>
              <th style={{ ...hcell, textAlign: 'right' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <LadderRowView
                key={r.price.toFixed(6)}
                r={r}
                eng={eng}
                stats={stats}
                maxVol={maxVol}
                maxRest={maxRest}
                onOrder={onLadderOrder}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ padding: '6px 10px', borderTop: '1px solid var(--hairline)' }}>
        Click a <span style={{ color: BID }}>bid</span> cell to stage a BUY there, an <span style={{ color: ASK }}>ask</span> cell to stage a SELL. POC ◆ · VWAP ▸ · value area shaded.
      </div>
    </div>
  );
}

function DomHeader({ stats, eng, symbol }: { stats: SessionStats; eng: DomEngine; symbol: string }) {
  const imb = stats.insideImbalance;
  const book = stats.bookImbalance;
  const chip = (label: string, value: string, color?: string) => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span className="tile-label">{label}</span>
      <span className="mono" style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  );
  return (
    <div className="row" style={{ gap: 16, flexWrap: 'wrap', padding: '10px 12px', borderBottom: '1px solid var(--hairline)' }}>
      <div style={{ fontWeight: 700 }}>{symbol || '—'} <span className="muted small">DOM</span></div>
      {chip('Last', stats.last != null ? eng.fmt(stats.last) : '—')}
      {chip('Volume', stats.volume.toLocaleString())}
      {chip('Cum Δ', (stats.cumDelta > 0 ? '+' : '') + stats.cumDelta.toLocaleString(), stats.cumDelta > 0 ? BID : stats.cumDelta < 0 ? ASK : undefined)}
      {chip('VWAP', stats.vwap != null ? eng.fmt(stats.vwap) : '—', GOLD)}
      {chip('POC', stats.poc != null ? eng.fmt(stats.poc) : '—')}
      {chip('Inside imb.', imb != null ? `${Math.round(imb * 100)}% bid` : '—', imb != null ? (imb > 0.55 ? BID : imb < 0.45 ? ASK : undefined) : undefined)}
      {book != null && chip('Book imb.', `${Math.round(book * 100)}% bid`, book > 0.55 ? BID : book < 0.45 ? ASK : undefined)}
    </div>
  );
}

function LadderRowView({
  r,
  eng,
  stats,
  maxVol,
  maxRest,
  onOrder,
}: {
  r: LadderRow;
  eng: DomEngine;
  stats: SessionStats;
  maxVol: number;
  maxRest: number;
  onOrder?: (price: number, side: 'BUY' | 'SELL') => void;
}) {
  const isBid = stats.bid != null && Math.abs(r.price - stats.bid) < eng.tick / 2;
  const isAsk = stats.ask != null && Math.abs(r.price - stats.ask) < eng.tick / 2;
  const isLast = stats.last != null && Math.abs(r.price - stats.last) < eng.tick / 2;
  const isPoc = stats.poc != null && Math.abs(r.price - stats.poc) < eng.tick / 2;
  const isVwap = stats.vwap != null && Math.abs(r.price - stats.vwap) < eng.tick;
  const inVa = stats.valLow != null && stats.valHigh != null && r.price >= stats.valLow - 1e-9 && r.price <= stats.valHigh + 1e-9;

  const bidW = Math.min(100, (r.bidSize / maxRest) * 100);
  const askW = Math.min(100, (r.askSize / maxRest) * 100);
  const buyW = (r.buyVol / maxVol) * 100;
  const sellW = (r.sellVol / maxVol) * 100;

  return (
    <tr style={{ background: inVa ? 'rgba(211,169,79,0.06)' : undefined, borderBottom: '1px solid rgba(138,133,122,0.08)' }}>
      {/* resting bid depth — click to BUY */}
      <td style={{ ...cell, cursor: onOrder ? 'pointer' : 'default', position: 'relative', textAlign: 'right' }} onClick={() => onOrder?.(r.price, 'BUY')}>
        {r.bidSize > 0 && <div style={{ position: 'absolute', right: 0, top: 2, bottom: 2, width: `${bidW}%`, background: 'rgba(67,164,92,0.25)' }} />}
        <span style={{ position: 'relative', fontWeight: isBid ? 700 : 400, color: isBid ? BID : 'var(--text)' }}>{r.bidSize || ''}</span>
      </td>
      {/* price */}
      <td style={{ ...cell, textAlign: 'center', fontWeight: 700, color: isLast ? '#141210' : isPoc ? GOLD : 'var(--muted)', background: isLast ? GOLD : undefined }}>
        {isPoc ? '◆ ' : ''}{isVwap ? '▸ ' : ''}{eng.fmt(r.price)}
      </td>
      {/* resting ask depth — click to SELL */}
      <td style={{ ...cell, cursor: onOrder ? 'pointer' : 'default', position: 'relative' }} onClick={() => onOrder?.(r.price, 'SELL')}>
        {r.askSize > 0 && <div style={{ position: 'absolute', left: 0, top: 2, bottom: 2, width: `${askW}%`, background: 'rgba(204,95,131,0.25)' }} />}
        <span style={{ position: 'relative', fontWeight: isAsk ? 700 : 400, color: isAsk ? ASK : 'var(--text)' }}>{r.askSize || ''}</span>
      </td>
      {/* volume profile: buy (left, green) + sell (right, pink) */}
      <td style={{ ...cell, position: 'relative', minWidth: 120 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end', height: 14 }}>
          <div style={{ width: `${buyW}%`, height: 10, background: BID, opacity: 0.85 }} title={`buy ${r.buyVol}`} />
          <div style={{ width: `${sellW}%`, height: 10, background: ASK, opacity: 0.85 }} title={`sell ${r.sellVol}`} />
          <span className="muted" style={{ marginLeft: 4, fontSize: 10, minWidth: 34, textAlign: 'right' }}>{r.totalVol || ''}</span>
        </div>
      </td>
      {/* per-price delta */}
      <td style={{ ...cell, textAlign: 'right', color: r.delta > 0 ? BID : r.delta < 0 ? ASK : 'var(--muted)' }}>
        {r.delta !== 0 ? (r.delta > 0 ? '+' : '') + r.delta : ''}
      </td>
    </tr>
  );
}

const cell: React.CSSProperties = { padding: '2px 8px', whiteSpace: 'nowrap' };
const hcell: React.CSSProperties = { padding: '4px 8px', textAlign: 'left', color: 'var(--muted)', fontWeight: 500, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4 };
