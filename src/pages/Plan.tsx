import { Hub } from '../components/Hub';
import Ideas from './Ideas';
import Risk from './Risk';

/**
 * Plan — the brief turned into a decision: the locations I will act at, the
 * invalidation, and the size that keeps the account safe if I am wrong.
 */
export default function Plan() {
  return (
    <Hub
      title="Plan"
      block="Before european session"
      sub="Scenarios, locations and size — one page, decided before the open."
      steps={[
        {
          id: 'ideas',
          label: 'Scenarios & locations',
          purpose: 'Where the edge is, what invalidates it, and what would make today a no-trade day.',
          body: <Ideas />,
        },
        {
          id: 'size',
          label: 'Size & risk',
          purpose: 'You choose where the trade is wrong; this chooses the size that survives being wrong.',
          body: <Risk />,
        },
      ]}
    />
  );
}
