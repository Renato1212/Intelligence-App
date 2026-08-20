import { Hub } from '../components/Hub';
import TradingDay from './TradingDay';
import AICoach from './AICoach';

/**
 * Debrief — the "After trade" block: each trade and the overall day, with the
 * lessons and actions that make the next session better.
 */
export default function Debrief() {
  return (
    <Hub
      title="Debrief"
      block="After trade"
      sub="Each trade and the day — lessons and actions to improve."
      steps={[
        {
          id: 'day',
          label: 'The day',
          purpose: 'Trades taken, how they were managed, and the written debrief for the session.',
          body: <TradingDay />,
        },
        {
          id: 'coach',
          label: 'Coach',
          purpose: 'What your own record says you should work on next — computed from your results.',
          body: <AICoach />,
        },
      ]}
    />
  );
}
