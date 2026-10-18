import type { ReactNode } from 'react';

/** A small "i" beside a line: hover or focus it (or tab to it) for a plain explanation. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="info-tip">
    <button type="button" className="info-tip-btn" aria-label={label}><span aria-hidden="true">i</span></button>
    <span className="info-tip-pop" role="tooltip">{children}</span>
  </span>;
}
