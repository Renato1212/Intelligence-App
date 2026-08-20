import { Hub } from '../components/Hub';
import ImportPage from './Import';
import Settings from './Settings';
import Account from './Account';

/**
 * Data — where trades come in, where sources are configured, and where the
 * account/sync lives. Never on the trading surface.
 */
export default function Data() {
  return (
    <Hub
      param="step"
      title="Data"
      sub="Imports, sources and account. Off the trading surface by design."
      steps={[
        { id: 'import', label: 'Import', purpose: 'Bring in fills and trades from Trader One, the extension, or a broker CSV.', body: <ImportPage /> },
        { id: 'settings', label: 'Settings', purpose: 'Sources, keys and preferences.', body: <Settings /> },
        { id: 'account', label: 'Account', purpose: 'Sign-in and cloud sync across devices.', body: <Account /> },
      ]}
    />
  );
}
