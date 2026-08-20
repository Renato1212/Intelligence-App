import { useSearchParams } from 'react-router-dom';
import { Hub } from '../components/Hub';
import { PrepEditor } from '../components/PrepEditor';
import { todayISO } from '../lib/format';
import Terminal from './Terminal';
import Charts from './Charts';
import Profile from './Profile';
import Catalysts from './Catalysts';
import Flows from './Flows';
import OptionsVol from './OptionsVol';
import MacroMap from './MacroMap';

/**
 * Pre-EU brief — the "Before european session" block of the routine, as a
 * three-step flow in the routine's own order: Fundamentals → Technicals →
 * Environment, closing with the written plan and hypotheses.
 */
export default function Brief() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayISO();

  return (
    <Hub
      title="EU brief"
      block="Before european session"
      sub="Assemble the context before Europe trades — fundamentals, technicals, environment."
      initial={params.get('step') ?? undefined}
      right={
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setParams({ date: e.target.value })}
        />
      }
      steps={[
        {
          id: 'fundamentals',
          label: 'Fundamentals',
          purpose:
            'Recent attention, the headlines since the previous session, and the cumulative sentiment they add up to.',
          body: <Terminal />,
        },
        {
          id: 'technicals',
          label: 'Technicals',
          purpose:
            'One-hour study of ES, CL, GC, ZT, ZN, UB, 6E, 6J, BTC — then the deep dive on what you intend to trade.',
          body: (
            <Hub
              bare
              title=""
              steps={[
                { id: 'charts', label: 'Charts', body: <Charts /> },
                { id: 'profile', label: 'Market profile', body: <Profile /> },
              ]}
            />
          ),
        },
        {
          id: 'environment',
          label: 'Environment',
          purpose:
            'Calendar for the day and week, flow events, previous session type, volume/volatility regime and options data.',
          body: (
            <Hub
              bare
              title=""
              steps={[
                { id: 'cal', label: 'Calendar', body: <Catalysts /> },
                { id: 'flow', label: 'Flow calendar', body: <Flows /> },
                { id: 'opt', label: 'Options & vol', body: <OptionsVol /> },
                { id: 'macro', label: 'Macro', body: <MacroMap /> },
              ]}
            />
          ),
        },
        {
          id: 'writeup',
          label: 'Write-up',
          purpose: 'The brief becomes a record: overnight read, news, levels and your hypotheses for the day.',
          body: <PrepEditor date={date} />,
        },
      ]}
    />
  );
}
