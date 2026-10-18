import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiRequest } from './api/client.js';
import { JobCards } from './JobCards.js';

export interface ReviewItem {
  bulletinId: string; slotId: string; review: { decision: 'APPROVED' | 'HELD' } | null;
  bulletin: { segments: { id: string; title: string; text: string }[] } | null;
  plan: { languages: string[] };
  translations: { language: string; status: 'UNREVIEWED' | 'APPROVED' | 'REJECTED'; texts: string[]; back: string[]; problems: string[]; reviewedBy: string | null; reviewNote: string | null }[];
  editLog: { seq: number; segmentId: string; before: string; after: string; by: string; at: string; note: string | null }[];
  protectedSegments: string[];
}
interface Suggestion { segmentId: string; original: string; proposal: string | null; unchanged: boolean; ok: boolean; problems: string[]; model: string | null; usage: { promptTokens: number; outputTokens: number; thoughtsTokens: number } | null; latencyMs: number | null; costUsd: string | null; jobId: string }
/** A small modal for one action (edit a segment, read a suggestion). Escape and a click outside close it. */
function ReviewDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  return <div className="review-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="review-dialog" role="dialog" aria-modal="true" aria-label={title}><header><strong>{title}</strong></header>{children}</div>
  </div>;
}
const LANG: Record<string, string> = { ms: 'Malay', zh: 'Mandarin', ta: 'Tamil' };

/**
 * The standard review workflow of one bulletin (AEG-SOP-003): (1) reword the English script while it is not approved (code refuses a new number or name; official guidance is not editable);
 * (2) translate the ticked languages; (3) each language is approved by a person who reads it, or rejected with a reason; (4) the English bulletin is approved and locked, or rejected (held) with a reason.
 */
export function ReviewDesk({ token, item: raw, onChange, part = 'all' }: { token: string; item: ReviewItem; onChange: () => void; part?: 'all' | 'script' | 'translations' | 'jobs' }) {
  // An older server may not send the review fields yet: show an empty review instead of failing.
  const item: ReviewItem = { ...raw, translations: raw.translations ?? [], editLog: raw.editLog ?? [], protectedSegments: raw.protectedSegments ?? [] };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editNote, setEditNote] = useState('');
  const [reads, setReads] = useState<Record<string, boolean>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [showJobs, setShowJobs] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const suggest = (segmentId: string): void => {
    setBusy(true); setError(''); setMessage(''); setSuggestion(null);
    apiRequest<Suggestion>(`/api/admin/screening/${item.bulletinId}/script-review`, { token, method: 'POST', body: { segmentId } }).then(setSuggestion)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The review did not work.')).finally(() => setBusy(false));
  };
  const locked = item.review?.decision === 'APPROVED';
  const run = (path: string, method: 'POST' | 'PUT', body: unknown, done?: string): void => {
    setBusy(true); setError(''); setMessage('');
    apiRequest<{ note?: string; results?: { language: string; ok: boolean; error?: string }[] }>(`/api/admin/screening/${item.bulletinId}/${path}`, { token, method, body })
      .then((r) => {
        const failed = r.results?.filter((x) => !x.ok).map((x) => `${LANG[x.language] ?? x.language}: ${x.error ?? 'failed'}`);
        setMessage(failed && failed.length > 0 ? failed.join(' · ') : (r.note ?? done ?? ''));
        setEditing(null); onChange();
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'That did not work.'))
      .finally(() => setBusy(false));
  };
  const others = item.plan.languages.filter((l) => l !== 'en');
  const editingSegment = item.bulletin?.segments.find((x) => x.id === editing) ?? null;
  const suggestionSegment = item.bulletin?.segments.find((x) => x.id === suggestion?.segmentId) ?? null;
  if (!item.bulletin) return null;
  return <section className="review-desk" aria-label="Script and translation review">
    {(part === 'all' || part === 'script') && <>
    <h3>Script (English)</h3>
    {locked && <p><small>🔒 Approved and locked. Withdraw it to edit the script.</small></p>}
    <ol className="review-segments">{item.bulletin.segments.map((s) => {
      const official = item.protectedSegments.includes(s.id);
      return <li key={s.id} className="review-card">
        <header><strong>{s.title}</strong>{official && <small>official guidance, not editable here</small>}</header>
        <p className="review-card-text">{s.text}</p>
        {!locked && !official && <footer className="review-card-actions">
          <button type="button" disabled={busy} onClick={() => { setEditing(s.id); setDraft(s.text); setEditNote(''); }} aria-label={`Edit ${s.title}`}>Edit</button>
          <button type="button" disabled={busy} onClick={() => suggest(s.id)} aria-label={`Suggest wording for ${s.title}`}>Suggest wording (Argon)</button>
        </footer>}
      </li>;
    })}</ol>
    {editingSegment && <ReviewDialog title={`Edit: ${editingSegment.title}`} onClose={() => setEditing(null)}>
      <textarea aria-label={`Edit ${editingSegment.title}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} maxLength={1500}/>
      <input type="text" aria-label="Why this change (optional)" placeholder="why (optional)" value={editNote} maxLength={300} onChange={(e) => setEditNote(e.target.value)}/>
      <div className="review-dialog-actions">
        <button type="button" disabled={busy || draft.trim() === editingSegment.text} onClick={() => run('script', 'PUT', { edits: [{ id: editingSegment.id, text: draft }], note: editNote })}>Save script</button>
        <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
      </div></ReviewDialog>}
    {suggestion && suggestionSegment && <ReviewDialog title={`Suggested wording: ${suggestionSegment.title}`} onClose={() => setSuggestion(null)}>
      <div className="review-suggestion" role="group" aria-label={`Suggestion for ${suggestionSegment.title}`}>
        <p><small>Current wording</small></p><p>{suggestion.original}</p>
        {suggestion.unchanged ? <p><strong>Argon would leave it unchanged.</strong></p> : <><p><small>Suggested wording</small></p><p><strong>{suggestion.proposal}</strong></p></>}
        {suggestion.problems.length > 0 && <ul className="admin-list">{suggestion.problems.map((p) => <li key={p}>Rejected by the checks: {p}</li>)}</ul>}
        <small>{suggestion.model} on Vertex AI · {suggestion.usage ? `${suggestion.usage.promptTokens} in, ${suggestion.usage.outputTokens} out, ${suggestion.usage.thoughtsTokens} thinking tokens` : ''} · {suggestion.latencyMs ?? '?'} ms · cost {suggestion.costUsd ?? 'UNKNOWN'} USD · job {suggestion.jobId}</small>
      <div className="review-dialog-actions">
        {suggestion.ok && !suggestion.unchanged && suggestion.proposal && <button type="button" disabled={busy} onClick={() => { run('script', 'PUT', { edits: [{ id: suggestion.segmentId, text: suggestion.proposal }], note: 'Argon suggestion accepted by an administrator' }); setSuggestion(null); }}>Accept this wording</button>}
        <button type="button" onClick={() => setSuggestion(null)}>Dismiss</button>
      </div></div></ReviewDialog>}
    {item.editLog.length > 0 && <details><summary>Script changes ({item.editLog.length})</summary><ul className="admin-list">{item.editLog.map((e) => <li key={e.seq}>{e.segmentId} · {e.by} · {e.at.replace('T', ' ').slice(0, 16)} UTC{e.note ? ` · ${e.note}` : ''}<br/><small>before: {e.before}</small><br/><small>after: {e.after}</small></li>)}</ul></details>}
    </>}
    {(part === 'all' || part === 'translations') && <>
    {(others.length > 0 || item.translations.length > 0) && <>
      <h3>Translations</h3>
      {others.length > 0 && !locked && <p><button type="button" disabled={busy} onClick={() => run('translate', 'POST', { languages: others.filter((l) => !item.translations.some((t) => t.language === l && t.status === 'APPROVED')) })}>Translate {others.map((l) => LANG[l] ?? l).join(', ')}</button> <small>A model translates, code checks every number and name, a second model translates back for you.</small></p>}
      {item.translations.map((t) => <article key={t.language} className="review-translation" aria-label={`${LANG[t.language] ?? t.language} translation`}>
        <p><strong>{LANG[t.language] ?? t.language}</strong> <span className={`admin-badge admin-${t.status === 'APPROVED' ? 'ok' : t.status === 'REJECTED' ? 'off' : 'warn'}`}>{t.status === 'APPROVED' ? '🔒 APPROVED' : t.status}</span>
          {t.problems.length > 0 && <span className="admin-badge admin-off">{t.problems.length} problem(s)</span>}</p>
        {t.problems.length > 0 && <ul className="admin-list">{t.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <div className="review-pair"><div><small>{LANG[t.language] ?? t.language}</small><p lang={t.language}>{t.texts.join(' ')}</p></div><div><small>Back to English (for you)</small><p>{t.back.join(' ')}</p></div></div>
        {t.status === 'APPROVED' && <p><small>Approved by {t.reviewedBy}. It gets its voice and public card.</small></p>}
        {t.status === 'REJECTED' && <p><small>Rejected: {t.reviewNote}. Translate again.</small></p>}
        {t.status === 'UNREVIEWED' && <p>
          <label><input type="checkbox" checked={reads[t.language] === true} onChange={(e) => setReads({ ...reads, [t.language]: e.target.checked })}/> I read {LANG[t.language] ?? t.language}</label>{' '}
          <button type="button" disabled={busy || reads[t.language] !== true || t.problems.length > 0} onClick={() => run(`translation/${t.language}`, 'POST', { action: 'approve', readsLanguage: true })}>Approve {LANG[t.language] ?? t.language}</button>{' '}
          <input type="text" aria-label={`Reason to reject ${LANG[t.language] ?? t.language}`} placeholder="reason to reject (5+ characters)" value={why[t.language] ?? ''} maxLength={300} onChange={(e) => setWhy({ ...why, [t.language]: e.target.value })}/>{' '}
          <button type="button" disabled={busy || (why[t.language] ?? '').trim().length < 5} onClick={() => run(`translation/${t.language}`, 'POST', { action: 'reject', note: (why[t.language] ?? '').trim() })}>Reject {LANG[t.language] ?? t.language}</button></p>}
      </article>)}
    </>}
    </>}
    {(part === 'all' || part === 'jobs') && <>
    <details onToggle={(e) => setShowJobs((e.target as HTMLDetailsElement).open)}><summary>Jobs and cost of this bulletin</summary>{showJobs && <JobCards token={token} bulletinId={item.bulletinId} canTopUp={false}/>}</details>
    </>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
