import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PnL, SideBadge, useToast } from '../components/ui';
import type { Trade } from '../domain/types';
import { db } from '../lib/db';
import { executionsCSV, shareOrDownload } from '../lib/exporters';
import { addDays, fmtDate, fmtMoney, fmtTime, todayISO } from '../lib/format';
import { importCSV, type ImportResult } from '../lib/importers';

export default function ImportPage() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [mirrorScope, setMirrorScope] = useState<'today' | '7' | '30' | 'all'>('today');
  const [mirrorSource, setMirrorSource] = useState<'motivewave' | 'any'>('any');
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const nav = useNavigate();
  const allTrades = useLiveQuery(() => db.trades.toArray(), []) ?? [];

  const mirrorTrades = useMemo(() => {
    let list = allTrades;
    if (mirrorSource === 'motivewave') list = list.filter((t) => t.source === 'motivewave' || t.source === 'csv');
    if (mirrorScope === 'today') list = list.filter((t) => t.date === todayISO());
    else if (mirrorScope !== 'all') list = list.filter((t) => t.date >= addDays(todayISO(), -Number(mirrorScope)));
    return list;
  }, [allTrades, mirrorScope, mirrorSource]);

  const mirror = async () => {
    if (!mirrorTrades.length) {
      toast('No executions in the selected range');
      return;
    }
    const outcome = await shareOrDownload(`executions-${todayISO()}.csv`, executionsCSV(mirrorTrades), 'text/csv');
    toast(
      outcome === 'shared'
        ? 'Share sheet opened — send the file to Trader One'
        : 'Executions CSV downloaded — import it in Trader One',
    );
  };

  const handleText = (text: string, name: string) => {
    setError(null);
    setResult(null);
    setFileName(name);
    try {
      setResult(importCSV(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => handleText(String(reader.result), f.name);
    reader.readAsText(f);
  };

  const confirmImport = async () => {
    if (!result) return;
    setBusy(true);
    const existing = new Set(
      (await db.trades.toArray()).map((t) => t.importKey).filter((k): k is string => !!k),
    );
    const fresh: Trade[] = [];
    let dupes = 0;
    for (const t of result.trades) {
      if (t.importKey && existing.has(t.importKey)) dupes++;
      else fresh.push(t);
    }
    if (fresh.length) await db.trades.bulkAdd(fresh);
    setBusy(false);
    setResult(null);
    toast(`Imported ${fresh.length} trades${dupes ? ` (${dupes} duplicates skipped)` : ''}`);
    if (fresh.length) nav('/trades');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Import trades</h1>
          <p className="page-sub">
            Bring in your data from MotiveWave, Rithmic (R Trader Pro) or any CSV export. Everything stays on your
            machine — no data ever leaves the browser.
          </p>
        </div>
      </div>

      <div className="stack">
        <div
          className="card empty"
          style={{ cursor: 'pointer', borderStyle: 'dashed' }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files[0]);
          }}
        >
          <h3>Drop a CSV file here or click to browse</h3>
          <p className="muted">
            Auto-detects the format: completed trade logs (MotiveWave and similar) are read row-by-row; raw fill
            exports (Rithmic) are matched FIFO into round-trip trades with P&L computed from contract point values.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv"
            style={{ display: 'none' }}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>

        <div className="grid grid-3">
          <div className="card">
            <div className="card-title">MotiveWave</div>
            <p className="muted small" style={{ margin: 0 }}>
              In MotiveWave open <b>Trade Log / Account → Trade History</b>, use <b>Export</b> to CSV and drop the
              file here. Entry/exit times, prices, size and realized P&L are read directly.
            </p>
          </div>
          <div className="card">
            <div className="card-title">Rithmic — R Trader Pro</div>
            <p className="muted small" style={{ margin: 0 }}>
              In R Trader Pro open the <b>Order History</b> or <b>Fills</b> window and export to CSV. Fills are
              paired FIFO per contract into round-trip trades; P&L is computed using CME/Eurex point values.
            </p>
          </div>
          <div className="card">
            <div className="card-title">Any other platform</div>
            <p className="muted small" style={{ margin: 0 }}>
              Any CSV with symbol, entry/exit time, price, quantity and (optionally) P&L columns works — headers are
              matched by name, order does not matter.
            </p>
          </div>
        </div>

        <div className="card" style={{ borderLeft: '3px solid var(--gold)' }}>
          <div className="card-title">
            Mirror executions to Trader One (Axia) <span className="hint">works on iPhone / iPad via the native share sheet</span>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>
            Trader One has no public API, so a live push isn't possible — this is the reliable bridge: import your
            MotiveWave executions here, then generate a clean executions file (one Buy and one Sell row per round
            trip) and hand it to Trader One's importer. On an iOS device the button opens the <b>share sheet</b>, so
            you can send the file straight to the Trader One app or Files; on desktop it downloads.
          </p>
          <div className="row">
            <select value={mirrorSource} onChange={(e) => setMirrorSource(e.target.value as never)} title="Which trades to include">
              <option value="any">All trades</option>
              <option value="motivewave">MotiveWave / CSV imports only</option>
            </select>
            <select value={mirrorScope} onChange={(e) => setMirrorScope(e.target.value as never)} title="Date range">
              <option value="today">Today</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="all">All time</option>
            </select>
            <button className="btn primary" onClick={mirror} disabled={!mirrorTrades.length}>
              Share / export {mirrorTrades.length} trade{mirrorTrades.length === 1 ? '' : 's'} ({mirrorTrades.length * 2} fills)
            </button>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Tip: this app itself works on iOS — open your deployed URL in Safari and use{' '}
            <b>Share → Add to Home Screen</b> to run it like a native app on your iPhone or iPad.
          </p>
        </div>

        {error && (
          <div className="card" style={{ borderColor: 'var(--loss)' }}>
            <div className="card-title" style={{ color: 'var(--loss)' }}>
              Could not parse {fileName}
            </div>
            <div>{error}</div>
          </div>
        )}

        {result && (
          <div className="card">
            <div className="spread" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 15 }}>
                  {result.trades.length} trades parsed from {fileName}
                </h3>
                <div className="muted small">
                  Format detected: {result.format === 'fills' ? 'raw fills (Rithmic-style) → paired FIFO' : 'completed trade log'} · net{' '}
                  <PnL value={result.trades.reduce((s, t) => s + t.pnl, 0)} />
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => setResult(null)}>
                  Cancel
                </button>
                <button className="btn primary" disabled={busy} onClick={confirmImport}>
                  {busy ? 'Importing…' : `Import ${result.trades.length} trades`}
                </button>
              </div>
            </div>
            {result.warnings.length > 0 && (
              <div className="small" style={{ color: 'var(--dom-news)', marginBottom: 10 }}>
                {result.warnings.slice(0, 5).map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}
            <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Inst</th>
                    <th>Side</th>
                    <th className="num">Qty</th>
                    <th className="num">Entry</th>
                    <th className="num">Exit</th>
                    <th className="num">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.slice(0, 100).map((t, i) => (
                    <tr key={i}>
                      <td>{fmtDate(t.date)}</td>
                      <td className="muted">{fmtTime(t.entryTime)}</td>
                      <td className="mono">{t.instrument}</td>
                      <td>
                        <SideBadge side={t.side} />
                      </td>
                      <td className="num">{t.qty}</td>
                      <td className="num mono">{t.entryPrice}</td>
                      <td className="num mono">{t.exitPrice}</td>
                      <td className="num">
                        <PnL value={t.pnl} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.trades.length > 100 && (
                <div className="muted small" style={{ padding: 8 }}>
                  … and {result.trades.length - 100} more. Total net {fmtMoney(result.trades.reduce((s, t) => s + t.pnl, 0), { sign: true })}.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
