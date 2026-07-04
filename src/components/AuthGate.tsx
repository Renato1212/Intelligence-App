import { useEffect, useState, type ReactNode } from 'react';
import { currentUser, isAuthReady, isLocalOnly, onAuthChange, setLocalOnly, signIn, signUp } from '../lib/cloud';

/**
 * Login wall. The app requires a profile so it can be shared across traders,
 * each with their own protected, synced data. A trader can opt out into a
 * local-only mode (data stays on this device) via a secondary link.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [, force] = useState(0);
  useEffect(() => onAuthChange(() => force((n) => n + 1)), []);

  const ready = isAuthReady();
  const user = currentUser();
  const localOnly = isLocalOnly();

  if (!ready) return <Splash />;
  if (user || localOnly) return <>{children}</>;
  return <LoginScreen />;
}

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page)' }}>
      <div className="row" style={{ gap: 12 }}>
        <div className="brand-mark">Ei</div>
        <div className="muted">Loading Edge Intelligence…</div>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'ok' } | null>(null);

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      setMsg({ text: 'Enter your email and a password of at least 6 characters.', kind: 'error' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'signup') {
        const res = await signUp(email.trim(), password);
        if (res.needsConfirmation) {
          setMsg({ text: 'Account created. Check your email to confirm, then sign in.', kind: 'ok' });
          setMode('signin');
        }
        // if a session came back, AuthGate re-renders into the app automatically
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page)', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="row" style={{ gap: 12, justifyContent: 'center', marginBottom: 4 }}>
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 19 }}>Ei</div>
          <div>
            <div className="brand-name" style={{ fontSize: 20 }}>Edge Intelligence</div>
            <div className="brand-sub">Trader Development</div>
          </div>
        </div>
        <div className="card stack" style={{ marginTop: 20 }}>
          <div className="card-title" style={{ marginBottom: 4 }}>
            {mode === 'signin' ? 'Sign in to your profile' : 'Create your profile'}
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>
            Your trades, journal and analytics are protected behind your login and synced to the cloud, available on
            any device.
          </p>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="trader@example.com" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          {msg && (
            <div className="small" style={{ color: msg.kind === 'error' ? 'var(--loss)' : 'var(--profit)' }}>
              {msg.kind === 'error' ? '⚠ ' : '✓ '}
              {msg.text}
            </div>
          )}
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button className="btn" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg(null); }}>
            {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button
            className="btn sm"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
            onClick={() => setLocalOnly(true)}
            title="Use the app without an account — your data stays only on this device"
          >
            or continue on this device without an account →
          </button>
        </div>
      </div>
    </div>
  );
}
