import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A routine screen with its depth one click down (Law 1).
 *
 * The surface shows one step at a time; everything else is a quiet tab. Panels
 * embedded here are existing screens rendered without their own page heading,
 * so the routine — not the feature list — is what the trader navigates.
 *
 * Pass `param` to bind the active step to a query key, which makes every step
 * deep-linkable (`/brief?step=environment&panel=cal`). That is what lets links
 * elsewhere in the app point at a panel now that panels live inside routine
 * steps rather than at top-level routes.
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
  param,
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
  /** Query-string key to bind the active step to, making it deep-linkable. */
  param?: string;
}) {
  const [search, setSearch] = useSearchParams();
  const fallback = initial ?? steps[0]?.id;
  const [local, setLocal] = useState(fallback);

  const fromUrl = param ? search.get(param) : null;
  const active = (fromUrl && steps.some((s) => s.id === fromUrl) ? fromUrl : null) ?? local;
  const step = steps.find((s) => s.id === active) ?? steps[0];

  const select = (id: string) => {
    setLocal(id);
    if (param) {
      const next = new URLSearchParams(search);
      next.set(param, id);
      setSearch(next, { replace: true });
    }
  };

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
              onClick={() => select(s.id)}
            >
              <span className="muted" style={{ marginRight: 6 }}>{i + 1}</span>
              {s.label}
            </span>
          ))}
        </div>
      )}

      {step?.purpose && <p className="muted small" style={{ margin: '0 0 12px' }}>{step.purpose}</p>}

      <div className="embedded">{step?.body}</div>
    </>
  );
}
