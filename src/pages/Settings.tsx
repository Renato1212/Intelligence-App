import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { useToast } from '../components/ui';
import { clearAllData, db, exportBackup, importBackup } from '../lib/db';
import { loadDemoData } from '../lib/demo';
import { POINT_VALUES } from '../lib/contracts';

export default function Settings() {
  const counts = useLiveQuery(async () => ({
    trades: await db.trades.count(),
    debriefs: await db.debriefs.count(),
    strategies: await db.strategies.count(),
  }), []);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    const json = await exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `edge-intelligence-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup downloaded');
  };

  const restore = (f: File | undefined) => {
    if (!f) return;
    if (!confirm('Restoring a backup replaces ALL current data. Continue?')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await importBackup(String(reader.result));
        toast(`Restored ${res.trades} trades, ${res.debriefs} debriefs, ${res.strategies} strategies`);
      } catch (e) {
        toast(`Restore failed: ${e instanceof Error ? e.message : e}`);
      }
    };
    reader.readAsText(f);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings & data</h1>
          <p className="page-sub">
            All data is stored locally in your browser (IndexedDB). Nothing is sent anywhere — back it up regularly.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-title">Your data</div>
          <div className="row" style={{ gap: 26 }}>
            <div>
              <div className="tile-label">Trades</div>
              <div className="tile-value sm">{counts?.trades ?? '…'}</div>
            </div>
            <div>
              <div className="tile-label">Daily debriefs</div>
              <div className="tile-value sm">{counts?.debriefs ?? '…'}</div>
            </div>
            <div>
              <div className="tile-label">Strategies</div>
              <div className="tile-value sm">{counts?.strategies ?? '…'}</div>
            </div>
          </div>
          <hr className="divider" />
          <div className="row">
            <button className="btn primary" onClick={download}>
              Download backup (JSON)
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Restore backup…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => restore(e.target.files?.[0])}
            />
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const n = await loadDemoData();
                setBusy(false);
                toast(`Loaded ${n} demo trades`);
              }}
            >
              {busy ? 'Loading…' : 'Load demo data'}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            Contract point values <span className="hint">used to compute P&L from raw fills (Rithmic imports)</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {Object.entries(POINT_VALUES).map(([sym, pv]) => (
              <span key={sym} className="chip">
                <b className="mono">{sym}</b>&nbsp;${pv.toLocaleString()}
              </span>
            ))}
          </div>
        </div>

        <div className="card" style={{ borderColor: 'rgba(230,103,103,0.3)' }}>
          <div className="card-title" style={{ color: 'var(--loss)' }}>
            Danger zone
          </div>
          <p className="muted small">Removes every trade, debrief and strategy from this browser. Download a backup first.</p>
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm('Delete ALL data? This cannot be undone.')) return;
              if (!confirm('Really sure? Consider downloading a backup first.')) return;
              await clearAllData();
              toast('All data cleared');
            }}
          >
            Clear all data
          </button>
        </div>
      </div>
    </>
  );
}
