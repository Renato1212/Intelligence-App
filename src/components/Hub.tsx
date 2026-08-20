import { type ReactNode, useState } from 'react';

/**
 * A routine screen with its depth one click down (Law 1).
 *
 * The surface shows one step at a time; everything else is a quiet tab. Panels
 * embedded here are existing screens rendered without their own page heading,
 * so the routine — not the feature list — is what the trader navigates.
 */
export interface HubStep {
  id: string;
  label: string;
  /** One line under the title: what this step is for, in routine language. */
  purpose?: string;
  body: ReactNode;
}

export function Hub({
  title,
  block,
  sub,
  steps,
  initial,
  right,
  bare,
}: {
  title: string;
  /** The routine block this screen serves, shown as an eyebrow. */
  block?: string;
  sub?: string;
  steps: HubStep[];
  initial?: string;
  right?: ReactNode;
  /** Nested inside another hub — render the tabs without a page heading. */
  bare?: boolean;
}) {
  const [active, setActive] = useState(initial ?? steps[0]?.id);
  const step = steps.find((s) => s.id === active) ?? steps[0];

  return (
    <>
      {!bare && (
        <div className="page-head">
          <div>
            {block && <div className="tile-label" style={{ marginBottom: 2 }}>{block}</div>}
            <h1 className="page-title">{title}</h1>
            {sub && <p className="page-sub">{sub}</p>}
          </div>
          {right}
        </div>
      )}

      {steps.length > 1 && (
        <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={`chip clickable ${active === s.id ? 'selected' : ''}`}
              style={{ padding: '6px 14px', fontSize: 13 }}
              onClick={() => setActive(s.id)}
            >
              <span className="muted" style={{ marginRight: 6 }}>{i + 1}</span>
              {s.label}
            </span>
          ))}
        </div>
      )}

      {step?.purpose && (
        <p className="muted small" style={{ margin: '0 0 12px' }}>{step.purpose}</p>
      )}

      <div className="embedded">{step?.body}</div>
    </>
  );
}

/** Renders an existing page inside a hub, suppressing its own page heading. */
export function Panel({ children }: { children: ReactNode }) {
  return <div className="embedded">{children}</div>;
}
