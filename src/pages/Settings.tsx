import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/ui';
import { currentUser } from '../lib/cloud';
import { clearAllData, db, exportBackup, importBackup } from '../lib/db';
import { loadDemoData } from '../lib/demo';
import { POINT_VALUES } from '../lib/contracts';
import { getMarketApiKey, setMarketApiKey } from '../lib/market';
import {
  checkAllSources,
  clearMarketDataCaches,
  DATA_SOURCES,
  summarizeHealth,
  type SourceResult,
  type SourceStatus,
} from '../lib/dataSources';
import {
  connectionReadiness,
  loadConn,
  probeGateway,
  RITHMIC_ENVS,
  saveConn,
  type ProbeResult,
  type RithmicConn,
} from '../lib/rithmic';

function RithmicConnection() {
  const toast = useToast();
  const saved = loadConn();
  const [user, setUser] = useState(saved?.user ?? '');
  const [password, setPassword] = useState(saved?.password ?? '');
  const [env, setEnv] = useState<RithmicConn['env']>(saved?.env ?? 'test');
  const [gatewayUrl, setGatewayUrl] = useState(saved?.gatewayUrl ?? RITHMIC_ENVS[0].defaultUrl);
  const [systemName, setSystemName] = useState(saved?.systemName ?? '');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);

  const current = (): RithmicConn => ({ user, password, systemName, env, gatewayUrl });
  const steps = connectionReadiness(user || password || gatewayUrl ? current() : loadConn());

  const pickEnv = (id: RithmicConn['env']) => {
    setEnv(id);
    // each environment starts from ITS default gateway — including the honest
    // empty one for paper/production (those addresses come from the dev kit)
    setGatewayUrl(RITHMIC_ENVS.find((e) => e.id === id)!.defaultUrl);
    setProbe(null);
  };

  const save = () => {
    if (!user.trim() && !password.trim()) {
      saveConn(null);
      toast('Rithmic connection removed from this device');
      return;
    }
    saveConn(current());
    toast('Rithmic connection saved — on this device only');
  };

  const runProbe = async () => {
    setProbing(true);
    try {
      setProbe(await probeGateway(gatewayUrl.trim()));
    } finally {
      setProbing(false);
    }
  };

  const envMeta = RITHMIC_ENVS.find((e) => e.id === env)!;

  return (
    <div className="card">
      <div className="card-title">
        Trading connection — Rithmic{' '}
        <span className="hint">R | Protocol API runs in the browser (WebSockets + protobuf) — access is what Rithmic gates, and this panel walks that path</span>
      </div>

      <div className="stack" style={{ gap: 8, marginBottom: 12 }}>
        {steps.map((s, i) => (
          <div key={s.step} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span
              className="grade-dot"
              style={{ background: s.done ? 'var(--profit)' : 'var(--muted)', marginTop: 4, flexShrink: 0 }}
            />
            <div>
              <div className="small" style={{ fontWeight: 600 }}>{i + 1}. {s.step}</div>
              <div className="muted small">{s.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
        <span className="tile-label" style={{ marginRight: 4 }}>Environment</span>
        {RITHMIC_ENVS.map((e) => (
          <span key={e.id} className={`chip clickable ${env === e.id ? 'selected' : ''}`} onClick={() => pickEnv(e.id)} title={e.note}>
            {e.label}
          </span>
        ))}
      </div>
      <div className="muted small" style={{ marginBottom: 10 }}>{envMeta.note}</div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="Rithmic user id"
          autoComplete="off"
          style={{ flex: '1 1 180px', minWidth: 160, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--text)' }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password (stays on this device)"
          autoComplete="new-password"
          style={{ flex: '1 1 180px', minWidth: 160, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--text)' }}
        />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          value={gatewayUrl}
          onChange={(e) => { setGatewayUrl(e.target.value); setProbe(null); }}
          placeholder="wss:// gateway (from your dev kit / broker)"
          autoComplete="off"
          style={{ flex: '2 1 260px', minWidth: 220, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--text)' }}
        />
        <input
          value={systemName}
          onChange={(e) => setSystemName(e.target.value)}
          placeholder={env === 'test' ? 'system name (default: Rithmic Test)' : 'registered system name'}
          autoComplete="off"
          style={{ flex: '1 1 180px', minWidth: 180, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--text)' }}
        />
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn primary" onClick={save}>{user.trim() || password.trim() ? 'Save on this device' : 'Remove saved connection'}</button>
        <button className="btn" disabled={probing || !gatewayUrl.trim()} onClick={() => void runProbe()}>
          {probing ? 'Testing…' : 'Test gateway reachability'}
        </button>
        {probe && (
          <span className="small" style={{ color: probe.reachable ? 'var(--profit)' : 'var(--loss)' }}>
            {probe.reachable ? `Reachable · ${probe.latencyMs}ms` : probe.detail}
          </span>
        )}
      </div>

      {steps[0].done && steps[1].done && (
        <div className="small" style={{ marginTop: 12 }}>
          Ready to trade — open the <Link to="/desk" style={{ color: 'var(--gold)', fontWeight: 600 }}>Trade Desk →</Link> to connect live, stream quotes and place orders (safety-gated).
        </div>
      )}

      <div className="muted small" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
        <b>The honest map:</b> your credentials are stored on this device only (never cloud-synced, excluded from
        backups and cache clears). The browser can already reach Rithmic gateways — the production login handshake
        additionally needs the R&nbsp;|&nbsp;Protocol dev kit and a conformance-registered system name from Rithmic
        (request at rithmic.com/api-request, or ask your broker / prop firm to enable API access on your login; prop
        logins are often locked to the firm's platforms until they enable it). Until then, your fills flow in today
        via R&nbsp;Trader&nbsp;Pro's export → the Import page, and every market study here runs alongside whatever
        platform executes.
      </div>
    </div>
  );
}

const STATUS_META: Record<SourceStatus, { color: string; label: string }> = {
  live: { color: 'var(--profit)', label: 'Live' },
  error: { color: 'var(--loss)', label: 'Error' },
  blocked: { color: 'var(--loss)', label: 'Unreachable' },
  nokey: { color: 'var(--muted)', label: 'No key' },
};

function DataConnections() {
  const toast = useToast();
  const [results, setResults] = useState<Record<string, SourceResult>>({});
  const [checking, setChecking] = useState(false);
  const [keyInput, setKeyInput] = useState(getMarketApiKey());

  const run = async () => {
    setChecking(true);
    try {
      setResults(await checkAllSources());
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveKey = () => {
    setMarketApiKey(keyInput.trim());
    toast(keyInput.trim() ? 'Market-data key saved' : 'Market-data key removed');
    void run();
  };

  const summary = summarizeHealth(results);
  const hasResults = Object.keys(results).length > 0;

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Live data connections <span className="hint">pinged from THIS browser — the true test of whether each feed is live for you</span>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {hasResults && <span className="muted small">{summary.text}</span>}
          <button className="btn sm" disabled={checking} onClick={() => void run()}>
            {checking ? 'Checking…' : 'Recheck'}
          </button>
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        {DATA_SOURCES.map((s) => {
          const r = results[s.id];
          const meta = r ? STATUS_META[r.status] : null;
          return (
            <div key={s.id} className="card" style={{ padding: '10px 12px', borderLeft: `3px solid ${meta?.color ?? 'var(--hairline)'}` }}>
              <div className="spread" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 10, alignItems: 'center', minWidth: 0 }}>
                  <span className="grade-dot" style={{ background: meta?.color ?? 'var(--muted)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{s.label} {s.keyless && <span className="chip" style={{ fontSize: 10, padding: '0 5px', color: 'var(--muted)' }}>keyless</span>}</div>
                    <div className="muted small">powers {s.powers}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {r?.sample && <span className="chip mono" style={{ fontSize: 11 }}>{r.sample}</span>}
                  {r?.latencyMs != null && r.status === 'live' && <span className="muted small mono">{r.latencyMs}ms</span>}
                  <span className="chip" style={{ background: r ? meta?.color : 'var(--muted)', color: '#141210', fontWeight: 700, minWidth: 66, textAlign: 'center' }}>
                    {r ? meta?.label : '…'}
                  </span>
                </div>
              </div>
              {r && r.status !== 'live' && (
                <div className="small" style={{ marginTop: 6, color: r.status === 'nokey' ? 'var(--muted)' : 'var(--loss)' }}>{r.detail}</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
        <div className="small" style={{ marginBottom: 6 }}>
          <b>Market-data key</b> <span className="muted">— the free Financial Modeling Prep key that powers live calendar/actuals, breadth, cross-asset and the recent-prints extension. Get one free at financialmodelingprep.com.</span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="paste your FMP API key"
            style={{ flex: 1, minWidth: 220, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--text)' }}
          />
          <button className="btn primary" onClick={saveKey}>{keyInput.trim() ? 'Save & recheck' : 'Remove key'}</button>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
        <div className="spread" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="small muted" style={{ maxWidth: 520 }}>
            Every feed caches locally so the app works offline. If you suspect you're seeing cached data, force a full refetch — it clears the market-data caches (your key and settings are kept) so the next page visit pulls fresh.
          </div>
          <button
            className="btn"
            onClick={() => {
              const n = clearMarketDataCaches();
              toast(`Cleared ${n} cached feed${n === 1 ? '' : 's'} — reopen a market page to refetch`);
              void run();
            }}
          >
            Force-refresh market data
          </button>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        A feed showing <b style={{ color: 'var(--loss)' }}>Unreachable</b> means your browser/network (or the host's CORS policy) blocked it — not a bug in the app; the panel it powers will show its own inline note and fall back to cache where it can.
      </p>
    </div>
  );
}

export default function Settings() {
  const counts = useLiveQuery(async () => ({
    trades: await db.trades.count(),
    debriefs: await db.debriefs.count(),
    strategies: await db.strategies.count(),
    preps: await db.preps.count(),
    photos: await db.photos.count(),
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
            {currentUser()
              ? 'Signed in — your data syncs to your cloud profile automatically. It also stays cached locally for offline use.'
              : 'All data is stored locally in your browser (IndexedDB). Create a profile on the Account page to sync it to the cloud and access it from any device.'}
          </p>
        </div>
        <Link to="/account" className="btn">
          {currentUser() ? 'Manage account & sync' : 'Sign in / create profile'}
        </Link>
      </div>

      <div className="stack">
        <DataConnections />

        <RithmicConnection />

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
            <div>
              <div className="tile-label">Preparations</div>
              <div className="tile-value sm">{counts?.preps ?? '…'}</div>
            </div>
            <div>
              <div className="tile-label">Photos</div>
              <div className="tile-value sm">{counts?.photos ?? '…'}</div>
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
          <p className="muted small">
            Removes every trade, debrief and strategy from this browser. Download a backup first.
            {currentUser() && ' If you are signed in, this only clears the local copy on this device — your cloud copy is untouched, so "Sync now" on the Account page restores it.'}
          </p>
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
