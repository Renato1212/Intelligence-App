import { NavLink, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/ui';
import Dashboard from './pages/Dashboard';
import Trades from './pages/Trades';
import TradeDetail from './pages/TradeDetail';
import Journal from './pages/Journal';
import Analytics from './pages/Analytics';
import Playbook from './pages/Playbook';
import Strategies from './pages/Strategies';
import ImportPage from './pages/Import';
import Settings from './pages/Settings';

const I = {
  dashboard: <path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />,
  trades: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  journal: <path d="M4 4h12a2 2 0 012 2v14H6a2 2 0 01-2-2V4zM4 4v14M9 9h6M9 13h4" />,
  analytics: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  playbook: <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />,
  strategies: <path d="M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 100 8 4 4 0 000-8z" />,
  import: <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />,
  settings: <path d="M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 01-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 01-2 1.2L14 21h-4l-.5-2.6a7 7 0 01-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 015 12a7 7 0 01.1-1.2l-2-1.6 2-3.4 2.4 1a7 7 0 012-1.2L10 3h4l.5 2.6a7 7 0 012 1.2l2.4-1 2 3.4-2 1.6a7 7 0 01.1 1.2z" />,
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

export default function App() {
  return (
    <ToastProvider>
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
          <div className="nav-section">Journal</div>
          <Nav to="/trades" icon={I.trades} label="Trades" />
          <Nav to="/journal" icon={I.journal} label="Daily Debrief" />
          <div className="nav-section">Development</div>
          <Nav to="/playbook" icon={I.playbook} label="Playbook" />
          <Nav to="/strategies" icon={I.strategies} label="Strategy Lab" />
          <div className="nav-section">Data</div>
          <Nav to="/import" icon={I.import} label="Import" />
          <Nav to="/settings" icon={I.settings} label="Settings" />
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/trades" element={<Trades />} />
            <Route path="/trades/:id" element={<TradeDetail />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/playbook" element={<Playbook />} />
            <Route path="/strategies" element={<Strategies />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </ToastProvider>
  );
}
