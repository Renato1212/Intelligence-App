import { useEffect, useState } from 'react';
import { useToast } from '../components/ui';
import { currentUser, fullSync, getSyncState, onSyncState, signIn, signOut, signUp, supabase, type SyncState } from '../lib/cloud';
import { db } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';

export default function Account() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState(currentUser());
  const [sync, setSync] = useState<SyncState>(getSyncState());
  const toast = useToast();

  const counts = useLiveQuery(async () => ({
    trades: await db.trades.count(),
    debriefs: await db.debriefs.count(),
    preps: await db.preps.count(),
  }), []);

  useEffect(() => onSyncState(setSync), []);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => setUser(currentUser()));
    return () => data.subscription.unsubscribe();
  }, []);

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      toast('Enter your email and a password of at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const res = await signUp(email.trim(), password);
        if (res.status === 'already-registered') {
          setMode('signin');
          toast('That email already has an account — sign in instead');
        } else {
          toast(res.status === 'needs-confirmation' ? 'Account created — check your email to confirm, then sign in' : 'Account created and signed in');
        }
      } else {
        await signIn(email.trim(), password);
        toast('Signed in — syncing your data');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const doSignOut = async () => {
    await signOut();
    toast('Signed out — this device keeps a local copy of the data');
  };

  const syncLabel =
    sync.status === 'idle'
      ? `Synced${sync.lastSync ? ` · ${new Date(sync.lastSync).toLocaleTimeString()}` : ''}`
      : sync.status === 'syncing'
        ? 'Syncing…'
        : sync.status === 'error'
          ? `Sync error — ${sync.detail}`
          : 'Local-only mode';

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Account & Sync</h1>
          <p className="page-sub">
            Create a profile to keep your data protected behind a login, synced to the cloud database and available
            on any device. Without an account the app still works fully — data just stays on this device.
          </p>
        </div>
      </div>

      <div className="stack">
        {!user ? (
          <div className="card stack" style={{ maxWidth: 460 }}>
            <div className="card-title">{mode === 'signin' ? 'Sign in' : 'Create your account'}</div>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="trader@example.com" autoComplete="email" />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </label>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={submit}>
                {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
              <button className="btn" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
                {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Signing in for the first time on a device that already has local data merges that data into your
              profile. If a different trader was signed in on this browser before, their local copy is cleared first
              — accounts never mix.
            </p>
          </div>
        ) : (
          <div className="card stack" style={{ maxWidth: 560 }}>
            <div className="card-title">Signed in</div>
            <div className="row" style={{ gap: 22 }}>
              <div>
                <div className="tile-label">Profile</div>
                <div style={{ fontWeight: 650 }}>{user.email}</div>
              </div>
              <div>
                <div className="tile-label">Sync status</div>
                <div style={{ fontWeight: 650, color: sync.status === 'error' ? 'var(--loss)' : sync.status === 'idle' ? 'var(--profit)' : undefined }}>
                  {syncLabel}
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 22 }}>
              <div>
                <div className="tile-label">Trades</div>
                <div className="tile-value sm">{counts?.trades ?? '…'}</div>
              </div>
              <div>
                <div className="tile-label">Debriefs</div>
                <div className="tile-value sm">{counts?.debriefs ?? '…'}</div>
              </div>
              <div>
                <div className="tile-label">Preparations</div>
                <div className="tile-value sm">{counts?.preps ?? '…'}</div>
              </div>
            </div>
            <div className="row">
              <button
                className="btn primary"
                disabled={sync.status === 'syncing'}
                onClick={async () => {
                  try {
                    await fullSync();
                    toast('Everything synced');
                  } catch {
                    toast('Sync failed — see status above');
                  }
                }}
              >
                Sync now
              </button>
              <button className="btn" onClick={doSignOut}>
                Sign out
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Every change you make is pushed to your profile automatically a couple of seconds after you make it.
              Signing in on another device pulls the same data. Photos sync with your records; videos uploaded via
              “Upload to cloud” are stored in your private media folder.
            </p>
          </div>
        )}

        <div className="card">
          <div className="card-title">How your data is protected</div>
          <ul className="check">
            <li>Each profile's records live in a cloud database protected by row-level security — a signed-in trader can only ever read or write their own rows.</li>
            <li>The app works fully offline; the cloud copy is a mirror that follows your changes.</li>
            <li>You can still download a full JSON backup any time from Settings — your data is never locked in.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
