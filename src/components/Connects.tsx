import { Link } from 'react-router-dom';
import { CONNECTS } from '../lib/method';

/**
 * The "use this with…" footer: how this section combines with the others.
 * One line per connection with the WHY, so the platform teaches the
 * combinations, not just the pieces. Content lives in lib/method.ts.
 */
export function Connects({ id }: { id: string }) {
  const items = CONNECTS[id];
  if (!items?.length) return null;
  return (
    <div className="card" style={{ borderStyle: 'dashed' }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Use this with… <span className="hint">the combinations are the edge — <Link to="/method" style={{ color: 'var(--gold)' }}>see the full method</Link></span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {items.map((c) => (
          <div key={c.route} className="small">
            <Link to={c.route} style={{ color: 'var(--gold)', fontWeight: 600, textDecoration: 'none' }}>{c.label} →</Link>{' '}
            <span className="muted">{c.why}.</span>
          </div>
        ))}
      </div>
    </div>
  );
}
