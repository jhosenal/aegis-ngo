import { useId, useState, type ReactNode } from 'react';

/** Presentation cards wrap pages/modules; persisted data cards retain CardView's contract. */
export function ModuleCard({ cardId, title, eyebrow, action, children, className = '', collapsible = true, kind = 'module' }: {
  cardId: string; title: string; eyebrow?: string; action?: ReactNode; children: ReactNode;
  className?: string; collapsible?: boolean; kind?: 'page' | 'module' | 'section';
}) {
  const id = useId();
  const [collapsed, setCollapsed] = useState(false);
  return <section className={`dashboard-card module-card ${className}`} data-card-id={cardId} data-card-kind={kind} aria-labelledby={id}>
    <header className="dashboard-card-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={id}>{title}</h2></div><div className="module-card-actions">{action}{collapsible && <button className="module-collapse" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`} aria-expanded={!collapsed} aria-controls={`${id}-body`} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '+' : '−'}</button>}</div></header>
    <div className="module-card-body" id={`${id}-body`} hidden={collapsed}>{children}</div>
  </section>;
}

export function PageCard({ pageId, children }: { pageId: string; children: ReactNode }) {
  return <div className="page-card" data-card-kind="page" data-card-id={`page:${pageId}`}>{children}</div>;
}
