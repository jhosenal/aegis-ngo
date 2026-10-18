import { useState } from 'react';
import { ApiError, apiRequest } from './api/client.js';

/** Money with 4 decimals, as the rest of the card (display only). */
const usd4 = (value: string): string => (/^-?\d+(\.\d+)?$/.test(value) ? Number(value).toFixed(4) : value);

/** A small pen. */
const Pen = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>;

type Field = 'monthly' | 'auto';
interface Props { token: string; budget: string; committed: string; remaining: string; auto: string; onSaved: () => void }

/**
 * The four numbers at the top of the Spend card. The monthly budget and the per-action auto-approve limit are the owner's own limits: each has a small pen next to it. Click the pen (or the
 * number) and that number becomes a field with a short Why box and an OK button; OK saves it (a reason of 5 characters or more is required) and Cancel closes it. One number at a time. The change is
 * kept in the budget file with who, when, from, to and why. Committed and Remaining are results, not settings, so they have no pen.
 */
export function SpendStats({ token, budget, committed, remaining, auto, onSaved }: Props) {
  const [edit, setEdit] = useState<{ field: Field; value: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = (field: Field): string => (field === 'monthly' ? budget : auto);
  const open = (field: Field): void => { if (busy) return; setError(''); setReason(''); setEdit({ field, value: current(field) }); };
  const cancel = (): void => { setEdit(null); setReason(''); setError(''); };
  const changed = edit !== null && edit.value.trim() !== '' && Number(edit.value) !== Number(current(edit.field));
  const ready = changed && reason.trim().length >= 5 && !busy;
  const save = (): void => {
    if (!edit) return;
    setBusy(true); setError('');
    const body = { monthlyBudgetUsd: edit.field === 'monthly' ? edit.value : budget, autoApproveUsd: edit.field === 'auto' ? edit.value : auto, reason: reason.trim() };
    apiRequest('/api/admin/spend-limits', { token, method: 'PUT', body })
      .then(() => { cancel(); onSaved(); })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The limit was not saved.'))
      .finally(() => setBusy(false));
  };
  const editable = (field: Field, label: string, note?: string) => {
    const editing = edit?.field === field;
    return <div className={`admin-stat spend-stat${editing ? ' is-editing' : ''}`}>
      <span>{label}</span>
      {!editing
        ? <strong className="spend-stat-value"><button type="button" className="spend-value" aria-label={`Edit the ${label.toLowerCase()}`} onClick={() => open(field)}>{usd4(current(field))} USD <span className="spend-pen"><Pen/></span></button></strong>
        : <form className="spend-inline" aria-label={`Save the ${label.toLowerCase()}`} onSubmit={(e) => { e.preventDefault(); if (ready) save(); }}>
          <div className="spend-inline-row"><input type="number" inputMode="decimal" min={field === 'monthly' ? '1' : '0.01'} max="50" step="0.01" autoFocus aria-label={`${label} (USD)`} value={edit.value} disabled={busy}
            onChange={(e) => setEdit({ field, value: e.target.value })}/> <b>USD</b></div>
          <input type="text" className="spend-why" aria-label="Why" value={reason} maxLength={200} placeholder="why (5+ characters)" disabled={busy} onChange={(e) => setReason(e.target.value)}/>
          <div className="spend-inline-actions"><button type="submit" className="spend-ok" disabled={!ready}>OK</button><button type="button" disabled={busy} onClick={cancel}>Cancel</button></div>
          <small>{field === 'monthly' ? '1.00 to 50.00 USD (console caps are 50.00 a month).' : '0.01 USD up to the monthly budget.'}</small>
          {error && <p role="alert" className="ne-error">{error}</p>}
        </form>}
      {note && !editing && <small>{note}</small>}
    </div>;
  };
  return <div className="admin-stats">
    {editable('monthly', 'Monthly budget')}
    <div className="admin-stat"><span>Committed</span><strong>{usd4(committed)} USD</strong></div>
    <div className="admin-stat"><span>Remaining</span><strong>{usd4(remaining)} USD</strong></div>
    {editable('auto', 'Auto-approve up to', 'per action')}
  </div>;
}
