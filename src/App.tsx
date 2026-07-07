import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { ToastProvider } from './components/ui';
import { currentUser, isLocalOnly, onSyncState, supabase, type SyncState } from './lib/cloud';
import Dashboard from './pages/Dashboard';
import Trades from './pages/Trades';
import TradeDetail from './pages/TradeDetail';
import TradingDay from './pages/TradingDay';
import Catalysts from './pages/Catalysts';
import MarketIntel from './pages/MarketIntel';
import Journal from './pages/Journal';
import Analytics from './pages/Analytics';
import Risk from './pages/Risk';
import Playbook from './pages/Playbook';
import Strategies from './pages/Strategies';
import ImportPage from './pages/Import';
import AICoach from './pages/AICoach';
import Account from './pages/Account';
import Settings from './pages/Settings';

const I = {
  dashboard: <path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />,
  trades: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  journal: <path d="M4 4h12a2 2 0 012 2v14H6a2 2 0 01-2-2V4zM4 4v14M9 9h6M9 13h4" />,
  day: <path d="M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM9 14l2 2 4-4" />,
  analytics: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  playbook: <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />,
  strategies: <path d="M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 100 8 4 4 0 000-8z" />,
  import: <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />,
  settings: <path d="M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 01-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 01-2 1.2L14 21h-4l-.5-2.6a7 7 0 01-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 015 12a7 7 0 01.1-1.2l-2-1.6 2-3.4 2.4 1a7 7 0 012-1.2L10 3h4l.5 2.6a7 7 0 012 1.2l2.4-1 2 3.4-2 1.6a7 7 0 01.1 1.2z" />,
  ai: <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8M12 8a4 4 0 100 8 4 4 0 000-8z" />,
  catalysts: <path d="M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM12 12v5M9.5 14.5h5" />,
  intel: <path d="M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2c2.5 2.6 4 6.2 4 10s-1.5 7.4-4 10c-2.5-2.6-4-6.2-4-10s1.5-7.4 4-10z" />,
  risk: <path d="M12 2l8 4v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-4zM12 8v4M12 16h.01" />,
  account: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />,
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

function Nav({ to, icon, label, end }: { to: string; icon: React.ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      <Icon d={icon} />
      {label}
    </NavLink>
  );
}

function AccountStatus() {
  const [email, setEmail] = useState(currentUser()?.email ?? null);
  const [sync, setSync] = useState<SyncState>({ status: 'off' });

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => setEmail(currentUser()?.email ?? null));
    const unsub = onSyncState(setSync);
    return () => {
      data.subscription.unsubscribe();
      unsub();
    };
  }, []);

  const dotColor =
    sync.status === 'idle' ? 'var(--profit)' : sync.status === 'syncing' ? 'var(--gold)' : sync.status === 'error' ? 'var(--loss)' : 'var(--muted)';

  const label = email ?? (isLocalOnly() ? 'Local only — sign in' : 'Sign in');
  return (
    <NavLink to="/account" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} style={{ marginTop: 4 }}>
      <Icon d={I.account} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {email && <span className="grade-dot" style={{ background: dotColor, flexShrink: 0 }} title={sync.status} />}
    </NavLink>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthGate>
        <Shell />
      </AuthGate>
    </ToastProvider>
  );
}

function Shell() {
  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">Ei</div>
            <div>
              <div className="brand-name">Edge Intelligence</div>
              <div className="brand-sub">Trader Development</div>
            </div>
          </div>
          <div className="nav-section">Performance</div>
          <Nav to="/" icon={I.dashboard} label="Dashboard" end />
          <Nav to="/analytics" icon={I.analytics} label="Edge Analytics" />
          <Nav to="/risk" icon={I.risk} label="Risk Guardrail" />
          <div className="nav-section">Markets</div>
          <Nav to="/intel" icon={I.intel} label="Market Intel" />
          <Nav to="/catalysts" icon={I.catalysts} label="Catalysts" />
          <div className="nav-section">Journal</div>
          <Nav to="/day" icon={I.day} label="Trading Day" />
          <Nav to="/trades" icon={I.trades} label="Trades" />
          <Nav to="/journal" icon={I.journal} label="Daily Debrief" />
          <div className="nav-section">Development</div>
          <Nav to="/playbook" icon={I.playbook} label="Playbook" />
          <Nav to="/strategies" icon={I.strategies} label="Strategy Lab" />
          <Nav to="/ai-coach" icon={I.ai} label="AI Coach" />
          <div className="nav-section">Data</div>
          <Nav to="/import" icon={I.import} label="Import" />
          <Nav to="/settings" icon={I.settings} label="Settings" />
          <span style={{ flex: 1 }} />
          <AccountStatus />
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/day" element={<TradingDay />} />
            <Route path="/catalysts" element={<Catalysts />} />
            <Route path="/intel" element={<MarketIntel />} />
            <Route path="/trades" element={<Trades />} />
            <Route path="/trades/:id" element={<TradeDetail />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/risk" element={<Risk />} />
            <Route path="/playbook" element={<Playbook />} />
            <Route path="/strategies" element={<Strategies />} />
            <Route path="/ai-coach" element={<AICoach />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/account" element={<Account />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
