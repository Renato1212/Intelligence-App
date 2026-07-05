import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PnL, SideBadge, useToast } from '../components/ui';
import type { Trade } from '../domain/types';
import { bookmarkletCode, bookmarkletHref } from '../lib/bookmarklet';
import { attachExecutionsToTrades, CaptureError, importCapture, isCapturePayload, parseCapture, type CaptureDiagnostics, type CaptureParseResult } from '../lib/capture';
import { db } from '../lib/db';
import { fmtDate, fmtMoney, fmtTime } from '../lib/format';
import { importCSV, type ImportResult } from '../lib/importers';

export default function ImportPage() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const nav = useNavigate();

  const [capture, setCapture] = useState<CaptureParseResult | null>(null);
  const [captureDiag, setCaptureDiag] = useState<CaptureDiagnostics | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const handleText = (text: string, name: string) => {
    setError(null);
    setResult(null);
    setCapture(null);
    setCaptureDiag(null);
    setFileName(name);
    try {
      if (isCapturePayload(text)) setCapture(parseCapture(text));
      else setResult(importCSV(text));
    } catch (e) {
      if (e instanceof CaptureError) setCaptureDiag(e.diagnostics);
      else setError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmCapture = async () => {
    if (!capture) return;
    setBusy(true);
    const res = await importCapture(capture.items);
    setBusy(false);
    setCapture(null);
    toast(`Capture imported — ${res.added} new trades, ${res.enriched} existing trades enriched`);
    if (res.added || res.enriched) nav('/trades');
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

  // Attach the fills from a broker export to trades already in the journal
  // (e.g. a Trader One import) by time-matching — keeps their tags, adds the
  // scale-in/out ladder. Reliable per-fill detail without scraping the platform.
  const attachFillsToExisting = async () => {
    if (!result?.executionPool?.length) return;
    setBusy(true);
    const res = await attachExecutionsToTrades(result.executionPool);
    setBusy(false);
    setResult(null);
    if (res.enriched) {
      toast(`Attached ${res.attached} fills to ${res.enriched} existing trades${res.unmatched ? ` · ${res.unmatched} unmatched` : ''}`);
      nav('/trades');
    } else {
      toast(`No existing trades matched these fills${res.unmatched ? ` (${res.unmatched} fills had no matching trade — import their trades first)` : ''}`);
    }
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
            accept=".csv,.txt,.tsv,.json"
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
            Extract from Trader One — Edge Capture <span className="hint">no API, no CSV export needed</span>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>
            Trader One has no API and no export, so Edge Capture takes the data anyway — two ways at once: it{' '}
            <b>records the data the page itself downloads</b> (works even when the app draws to a canvas and nothing
            is readable on screen) and it reads any visible trade tables. It produces an{' '}
            <span className="mono">edge-capture.json</span> file; drop that file above and your trades, stats, tags,
            notes and photos are merged in — already-imported trades are <b>enriched</b>, never duplicated.
            Everything runs in your own browser; nothing is sent anywhere.
          </p>
          <ol className="muted small" style={{ margin: '0 0 10px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>
              <b>Get the button:</b> on desktop, drag this to your bookmarks bar:{' '}
              <a
                href={bookmarkletHref()}
                className="btn sm"
                style={{ margin: '0 4px' }}
                onClick={(e) => {
                  e.preventDefault();
                  toast('Don’t click here — drag this button to your bookmarks bar, then use it on the Trader One page');
                }}
              >
                ⚡ Edge Capture
              </a>{' '}
              On iPhone / iPad: copy the code, bookmark any page in Safari, then edit that bookmark and paste the code
              as its address.{' '}
              <button
                className="btn sm"
                onClick={() => {
                  navigator.clipboard.writeText(bookmarkletCode());
                  toast('Bookmarklet code copied');
                }}
              >
                Copy bookmarklet code
              </button>
            </li>
            <li>
              <b>Record:</b> log in to Trader One and click the bookmark <b>first</b> — a gold “recording” badge
              appears showing live counts of table rows, API responses and stream messages. Then open your trade log
              / journal and scroll through everything so every row loads.
            </li>
            <li>
              <b>For scale-in/out detail:</b> the trade log only holds the <i>averaged</i> entry/exit. The individual
              fills load only when you <b>open a trade</b>, so while still recording <b>click into each trade</b> whose
              breakdown you want. The recorder now hooks the network <i>inside Trader One's app frames</i> — where its
              WebSocket stream and fill requests actually live — not just the outer page. Watch the badge's “stream
              msg(s)” and “API” counts climb as you open trades; if they stay at 0, share the file and I'll tune it.
            </li>
            <li>
              <b>Finish:</b> click the gold badge — the <span className="mono">edge-capture.json</span> downloads.
              Drop it on this page. If no trades are recognised, import the file anyway and share it: it embeds
              diagnostics that let the extractor be tuned for the exact page layout.
            </li>
          </ol>
          <div className="small" style={{ background: 'var(--surface-2, rgba(201,162,39,.08))', borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 }}>
            <b>Most reliable route for exact fills →</b> export your <b>executions / fills report from your broker</b>{' '}
            (the platform Trader One connects to — Rithmic R&nbsp;Trader Pro, CQG, etc. all offer a Fills/Order-History
            CSV). Drop that CSV here: it has <i>every</i> fill with exact size, price, time and market/limit type. You
            can then <b>“Attach fills to existing trades”</b> to add the scale-in/out ladder to the trades you already
            imported from Trader One — matched by instrument and time, keeping all their tags. This works regardless of
            what Trader One's own page exposes.
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => setPasteOpen(!pasteOpen)}>
              {pasteOpen ? 'Hide paste box' : 'Paste capture JSON instead…'}
            </button>
          </div>
          {pasteOpen && (
            <div className="stack" style={{ marginTop: 10, gap: 8 }}>
              <textarea
                rows={4}
                placeholder='Paste the capture JSON here (it starts with {"source":"edge-capture"...)'
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div>
                <button
                  className="btn primary sm"
                  disabled={!pasteText.trim()}
                  onClick={() => {
                    handleText(pasteText, 'pasted capture');
                    setPasteText('');
                    setPasteOpen(false);
                  }}
                >
                  Parse capture
                </button>
              </div>
            </div>
          )}
        </div>

        {capture && (
          <div className="card">
            <div className="spread" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 15 }}>
                  {capture.items.length} trades captured{capture.sourceUrl ? ` from ${new URL(capture.sourceUrl).hostname}` : ''}
                </h3>
                <div className="muted small">
                  {capture.items.filter((i) => i.trade.tags.length || i.trade.description).length} carry tags/notes ·{' '}
                  {capture.items.reduce((s, i) => s + i.executions.length, 0)} fills matched ·{' '}
                  {capture.items.reduce((s, i) => s + i.images.length, 0)} photos · net{' '}
                  <PnL value={capture.items.reduce((s, i) => s + i.trade.pnl, 0)} />
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => setCapture(null)}>
                  Cancel
                </button>
                <button className="btn primary" disabled={busy} onClick={confirmCapture}>
                  {busy ? 'Importing…' : `Import ${capture.items.length} trades`}
                </button>
              </div>
            </div>
            {capture.warnings.length > 0 && (
              <div className="small" style={{ color: 'var(--dom-news)', marginBottom: 10 }}>
                {capture.warnings.slice(0, 5).map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Inst</th>
                    <th>Side</th>
                    <th className="num">Qty</th>
                    <th className="num">P&L</th>
                    <th>Tags</th>
                    <th>Notes</th>
                    <th className="num">Fills</th>
                    <th className="num">Photos</th>
                  </tr>
                </thead>
                <tbody>
                  {capture.items.slice(0, 100).map((item, i) => (
                    <tr key={i}>
                      <td>{fmtDate(item.trade.date)}</td>
                      <td className="mono">{item.trade.instrument}</td>
                      <td>
                        <SideBadge side={item.trade.side} />
                      </td>
                      <td className="num">{item.trade.qty}</td>
                      <td className="num">
                        <PnL value={item.trade.pnl} />
                      </td>
                      <td className="muted small">{item.trade.tags.slice(0, 3).join(' · ')}</td>
                      <td className="muted small" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.trade.description}
                      </td>
                      <td className="num">{item.executions.length || ''}</td>
                      <td className="num">{item.images.length || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {capture.fillsFound === 0 && capture.structureSamples.length > 0 && (
              <div className="small" style={{ marginTop: 10, padding: 10, border: '1px solid var(--hairline)', borderRadius: 8 }}>
                <div className="spread" style={{ marginBottom: 6 }}>
                  <b style={{ color: 'var(--dom-news)' }}>No per-fill execution detail was found in this capture.</b>
                  <button
                    className="btn sm"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(capture.structureSamples, null, 2));
                      toast('Captured data structure copied — send it so I can map the executions exactly');
                    }}
                  >
                    Copy captured data structure
                  </button>
                </div>
                <p className="muted" style={{ margin: '0 0 6px' }}>
                  To get scale-in/out detail, run the capture again and — while the gold badge is recording —{' '}
                  <b>open a few individual trades</b> so their fills load (Trader One fetches the executions when you
                  view a trade). If it still shows no fills, the field names below are what the platform sent; send me
                  the copied structure and I'll map them precisely.
                </p>
                {capture.structureSamples.slice(0, 6).map((s, i) => (
                  <div key={i} className="mono" style={{ marginBottom: 4, wordBreak: 'break-word', opacity: 0.85 }}>
                    {s.url}: {'{'} {s.keys.slice(0, 16).join(', ')} {'}'}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {captureDiag && (
          <div className="card" style={{ borderColor: 'var(--dom-news)' }}>
            <div className="spread" style={{ marginBottom: 8 }}>
              <div className="card-title" style={{ color: 'var(--dom-news)', marginBottom: 0 }}>
                No trades recognised in {fileName}
              </div>
              <button
                className="btn sm"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(captureDiag, null, 2));
                  toast('Diagnostics copied — paste them to get this platform supported');
                }}
              >
                Copy diagnostics
              </button>
            </div>
            <p style={{ marginTop: 0 }}>{captureDiag.hint}</p>
            {captureDiag.raw && (
              <div className="row" style={{ gap: 16, marginBottom: 10 }}>
                <Mini label="Rows captured" value={captureDiag.raw.accumulatedRows ?? 0} />
                <Mini label="Scan passes" value={captureDiag.raw.scans ?? 0} />
                <Mini label="API responses" value={captureDiag.raw.jsonResponses ?? 0} />
                <Mini label="Tables" value={captureDiag.raw.tables ?? 0} />
                <Mini label="Canvases" value={captureDiag.raw.canvases ?? 0} />
                <Mini label="Iframes" value={captureDiag.raw.iframes ?? 0} />
              </div>
            )}
            {captureDiag.tableSamples.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="small muted" style={{ marginBottom: 4 }}>
                  Table headers found on the page:
                </div>
                {captureDiag.tableSamples.map((t, i) => (
                  <div key={i} className="mono small" style={{ marginBottom: 4, wordBreak: 'break-word' }}>
                    [{t.headers.join(', ')}]
                  </div>
                ))}
              </div>
            )}
            {captureDiag.jsonKeySamples.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <div className="small muted" style={{ marginBottom: 4 }}>
                  Field names seen in the platform's own data:
                </div>
                {captureDiag.jsonKeySamples.map((keys, i) => (
                  <div key={i} className="mono small" style={{ marginBottom: 4, wordBreak: 'break-word' }}>
                    {'{'} {keys.join(', ')} {'}'}
                  </div>
                ))}
              </div>
            )}
            {!captureDiag.tableSamples.length && !captureDiag.jsonKeySamples.length && (
              <p className="muted small" style={{ marginBottom: 0 }}>
                Nothing was captured at all — most likely the bookmarklet was clicked after the trade data had
                already loaded. Re-arm it (click the bookmark) <b>before</b> opening the trade log this time.
              </p>
            )}
            <p className="muted small" style={{ marginBottom: 0 }}>
              Send me the "Copy diagnostics" output (or the full{' '}
              <span className="mono">edge-capture.json</span> if you can) and I'll map these exact field names so
              the import works directly next time.
            </p>
          </div>
        )}

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
                {result.format === 'fills' && !!result.executionPool?.length && (
                  <button className="btn" disabled={busy} onClick={attachFillsToExisting} title="Match these fills to trades already in your journal by instrument + time, keeping their tags">
                    {busy ? 'Attaching…' : 'Attach fills to existing trades'}
                  </button>
                )}
                <button className="btn primary" disabled={busy} onClick={confirmImport}>
                  {busy ? 'Importing…' : `Import ${result.trades.length} trades`}
                </button>
              </div>
            </div>
            {result.format === 'fills' && !!result.executionPool?.length && (
              <div className="small muted" style={{ marginBottom: 10 }}>
                This is a fills export ({result.executionPool.length} executions). <b>Import {result.trades.length} trades</b> creates
                fresh round-trip trades with full ladders, or <b>Attach fills to existing trades</b> adds the scale-in/out detail to
                trades already in your journal (e.g. a Trader One import) — matched by instrument and time, keeping their tags.
              </div>
            )}
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

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="tile-label" style={{ fontSize: 10.5 }}>
        {label}
      </div>
      <div className="small" style={{ fontWeight: 650 }}>
        {value}
      </div>
    </div>
  );
}
