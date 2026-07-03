import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { domainOf } from '../domain/taxonomy';
import { fmtMoney } from '../lib/format';

export function PnL({ value, sign = true, compact = false }: { value: number; sign?: boolean; compact?: boolean }) {
  const cls = value > 0 ? 'pos' : value < 0 ? 'neg' : 'muted';
  return <span className={cls}>{fmtMoney(value, { sign, compact })}</span>;
}

export function StatTile({
  label,
  value,
  delta,
  valueClass,
  small,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  valueClass?: string;
  small?: boolean;
}) {
  return (
    <div className="card tile">
      <div className="tile-label">{label}</div>
      <div className={`tile-value ${small ? 'sm' : ''} ${valueClass ?? ''}`}>{value}</div>
      {delta != null && <div className="tile-delta">{delta}</div>}
    </div>
  );
}

export function DomainChip({ id, onClick, selected }: { id: string | null; onClick?: () => void; selected?: boolean }) {
  const d = domainOf(id);
  if (!d) {
    return (
      <span className={`chip ${onClick ? 'clickable' : ''} ${selected ? 'selected' : ''}`} onClick={onClick}>
        Untagged
      </span>
    );
  }
  return (
    <span className={`chip ${onClick ? 'clickable' : ''} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className="dot" style={{ background: d.color }} />
      {d.short}
    </span>
  );
}

export function SideBadge({ side }: { side: 'LONG' | 'SHORT' }) {
  return <span className={`side-badge ${side === 'LONG' ? 'long' : 'short'}`}>{side}</span>;
}

export function Modal({ onClose, children, title }: { onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        {title && (
          <div className="spread" style={{ marginBottom: 14 }}>
            <h3>{title}</h3>
            <button className="btn sm" onClick={onClose}>
              Close
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---- toast ---- */

const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
