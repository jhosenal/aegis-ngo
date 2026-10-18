import { useEffect, useState } from 'react';

export type DecisionKind = 'approve' | 'reapprove' | 'reject' | 'withdraw';

const COPY: Record<DecisionKind, { title: string; body: string; confirm: string; needsReason: boolean; reasonLabel?: string }> = {
  approve: { title: 'Approve and lock', body: 'It will be shown on the public page and locked. The only way back is Withdraw, with a written reason.', confirm: 'Approve and lock', needsReason: false },
  reapprove: { title: 'Approve again', body: 'It will be shown on the public page again and locked. The only way back is Withdraw, with a written reason.', confirm: 'Approve and lock', needsReason: false },
  reject: { title: 'Reject', body: 'It is held and not published.', confirm: 'Reject', needsReason: true, reasonLabel: 'Why is it rejected?' },
  withdraw: { title: 'Withdraw', body: 'It comes down from the public page. It can be approved again afterwards.', confirm: 'Withdraw', needsReason: true, reasonLabel: 'Why must it come down?' },
};

/** The one dialog for every decision on a bulletin (approve, approve again, reject, withdraw), in place of the browser's own confirm and prompt boxes: it names the bulletin, says what happens, and checks the reason as you type. */
export function DecisionDialog({ kind, label, busy, onConfirm, onClose }: { kind: DecisionKind; label: string; busy: boolean; onConfirm: (note?: string) => void; onClose: () => void }) {
  const copy = COPY[kind];
  const [reason, setReason] = useState('');
  const [read, setRead] = useState(false);
  const ok = copy.needsReason ? reason.trim().length >= 5 : read;
  useEffect(() => { const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  return <div className="review-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="review-dialog" role="dialog" aria-modal="true" aria-label={copy.title}>
      <header><strong>{copy.title}: {label}</strong></header>
      <p className="ne-note">{copy.body}</p>
      {!copy.needsReason && <label className="ne-read"><input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)}/> I have read this bulletin (the script and its checks).</label>}
      {copy.needsReason && <label className="ne-field">{copy.reasonLabel} <small>(at least 5 characters)</small>
        <textarea aria-label={copy.reasonLabel} value={reason} rows={3} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)}/></label>}
      <div className="review-dialog-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className={kind === 'approve' || kind === 'reapprove' ? 'ne-primary' : 'ne-danger'} disabled={busy || !ok} onClick={() => onConfirm(copy.needsReason ? reason.trim() : undefined)}>{copy.confirm}</button>
      </div>
    </div>
  </div>;
}
