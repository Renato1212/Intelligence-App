import { Hub } from '../components/Hub';
import Trades from './Trades';
import Analytics from './Analytics';
import Strategies from './Strategies';
import Playbook from './Playbook';

/**
 * Archive — the reason the whole thing exists: every session as a queryable,
 * comparable record, and what the body of work says about the edge.
 */
export default function Archive() {
  return (
    <Hub
      title="Archive"
      sub="Three years of sessions as a searchable body of knowledge, not a pile of forgotten days."
      steps={[
        { id: 'trades', label: 'Trades', purpose: 'Every trade, filterable — click one for its full record.', body: <Trades /> },
        { id: 'edge', label: 'Edge analytics', purpose: 'Where the edge actually is, and whether it is growing.', body: <Analytics /> },
        { id: 'patterns', label: 'Strategies', purpose: 'Observations promoted to tested strategies, with the evidence behind each.', body: <Strategies /> },
        { id: 'method', label: 'Method', purpose: 'The framework and the grading rubric the record is scored against.', body: <Playbook /> },
      ]}
    />
  );
}
