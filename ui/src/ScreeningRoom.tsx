import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from './api/client.js';
import { ModuleCard } from './components/ModuleCard.js';
import { PipelinePanel, type LanguageEntry, type PipelineItem } from './NewsPipeline.js';
import { ReviewDesk, type ReviewItem } from './ReviewDesk.js';
import { EmergencyDialog } from './EmergencyDialog.js';
import { DecisionDialog, type DecisionKind } from './DecisionDialog.js';
import { Icon } from './dashboard/Icon.js';
import { GoogleModelSelector, type ChatModeOption } from './chat/GoogleModelSelector.js';
import { WorkflowStrip, type WorkflowItem } from './WorkflowStrip.js';

interface Review { decision: 'APPROVED' | 'HELD'; decidedBy: string; decidedAt: string; note: string | null }
interface LogEntry { seq: number; action: 'APPROVE' | 'HOLD' | 'WITHDRAW'; by: string; at: string; note: string | null }
type Stored = PipelineItem & Omit<ReviewItem, 'bulletin' | 'review' | 'plan'> & { captureAt: string; airAt: string; review: Review | null; log: LogEntry[] };
interface AiSuggestion { segmentId: string; original: string; proposal: string | null; unchanged: boolean; ok: boolean; problems: string[]; model: string | null; latencyMs: number | null; costUsd: string | null; jobId: string | null }
interface Screening { now: string; voiceMode?: 'google-tts' | 'browser-stub'; languageCatalog: { languages: LanguageEntry[] }; approvalRequired: boolean; draft: { problems: string[]; bulletin: { estimatedSeconds: number } }; stored: Stored[] }

const when = (iso: string): string => iso.replace('T', ' ').slice(0, 16) + ' UTC';
/** "Today · 17 Oct" for the group heading of a bulletin captured on that UTC day. */
const dayLabel = (day: string, nowIso: string): string => {
  const shown = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const diff = Math.round((Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  return diff === 0 ? `Today · ${shown}` : diff === 1 ? `Yesterday · ${shown}` : shown;
};
/** A bulletin nobody decided within an hour of its air time is EXPIRED: it is kept as a record, but it can no longer be approved, so out-of-date news cannot reach the public page. */
const APPROVAL_WINDOW_MS = 60 * 60_000;
const isExpired = (s: Stored, nowIso: string): boolean => !s.review && s.slotId !== 'drill' && Date.parse(s.airAt) + APPROVAL_WINDOW_MS < Date.parse(nowIso);
/** The name of a bulletin in the lists and dialogs: the slot (night, midday...), or EMERGENCY alert / EMERGENCY follow-up. */
const nameOf = (s: { slotId: string; bulletin?: unknown }): string => {
  if (s.slotId !== 'emergency') return s.slotId;
  const first = (s.bulletin as { segments?: { title?: string }[] } | null | undefined)?.segments?.[0]?.title ?? '';
  return first === 'Follow-up' ? 'EMERGENCY follow-up' : 'EMERGENCY alert';
};
/** What the script review can run on today (the chat shows the same list): Auto uses the configured reviewer, Gemini 4 Argon. The others are shown disabled, with the reason, until they are connected and priced. */
const SCRIPT_MODEL_OPTIONS: ChatModeOption[] = [
  { id: 'auto', label: 'Auto', available: true, note: 'Uses Gemini 4 Argon.' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', available: false, note: 'Not connected to the script review yet: it has no price in the price book.' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', available: false, note: 'Not connected to the script review yet: it has no price in the price book.' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', available: true, note: 'Available.' },
];
const state = (s: Stored | null): 'DRAFT' | 'WAITING' | 'APPROVED' | 'HELD' => (!s ? 'DRAFT' : !s.review ? 'WAITING' : s.review.decision);

/**
 * News approval (AEG-NEWS-005, AEG-SOP-003): the administrator sees the bulletin on the real landing page (map and news reader, in a frame) and decides.
 * Approved means LOCKED: the only way back is Withdraw with a written reason, after which it can be approved again. The public page shows approved bulletins only.
 */
export function ScreeningRoom({ token }: { token: string }) {
  const [data, setData] = useState<Screening | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mapLocked, setMapLocked] = useState(true);
  // The landing page preview is hidden for now (owner decision 2026-10-18); open /admin?tab=approval&preview=1 to bring the button back.
  const previewEnabled = new URLSearchParams(window.location.search).get('preview') === '1';
  const [showScript, setShowScript] = useState(false);   // the read-only script opens in a popup from the Read the script button
  // Read the script popup: every editable part is a text box. `draft` holds only the parts changed so far; nothing is saved until Save changes.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState('');   // what to improve, typed to AEGIS Assist
  const [aiModel, setAiModel] = useState('auto');   // the model picker, as in the chat: Auto, or a model that is connected to the script review
  const [showModels, setShowModels] = useState(false);
  const [assist, setAssist] = useState<{ busy: boolean; summary: string; notes: Record<string, { problems: string[]; unchanged: boolean }>; error: string }>({ busy: false, summary: '', notes: {}, error: '' });
  const [popBusy, setPopBusy] = useState(false);
  const [popError, setPopError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [filter, setFilter] = useState<'all' | 'WAITING' | 'APPROVED' | 'HELD' | 'EXPIRED'>('all');   // the landing page preview opens in a dialog from the Preview button
  const [frameHeight, setFrameHeight] = useState(480);
  const [colWidth, setColWidth] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // The hero is as wide as this column, exactly like the landing page's hero (16:9 minus 10 px), so the frame is as wide as the column and that tall.
  useEffect(() => {
    const el = box.current; if (!el) return;
    const update = (): void => { setColWidth(el.clientWidth); setFrameHeight(Math.max(240, Math.round(el.clientWidth * 0.5625 - 10))); frame.current?.contentWindow?.postMessage({ type: 'aegis-preview-width', width: el.clientWidth }, window.location.origin); };
    update(); const o = new ResizeObserver(update); o.observe(el); return () => o.disconnect();
  }, [data, showPreview]);
  useEffect(() => { if (!showPreview) return; const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') setShowPreview(false); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [showPreview]);
  const load = useCallback((): void => {
    apiRequest<Screening>('/api/admin/screening', { token }).then((v) => { setData(v); setError(''); })
      .catch((r: unknown) => setError(r instanceof ApiError ? `${r.code}: ${r.message}` : 'The news approval view could not be loaded.'));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (data && selected === null) setSelected(data.stored.find((x) => x.slotId !== 'drill')?.bulletinId ?? data.stored[0]?.bulletinId ?? 'DRAFT'); }, [data, selected]);
  const act = (bulletinId: string, action: 'approve' | 'hold' | 'withdraw', note?: string): void => {
    setBusy(true);
    apiRequest(`/api/admin/screening/${bulletinId}`, { token, method: 'POST', body: { action, ...(note ? { note } : {}) } })
      .then(() => {
        setDecision(null); setError('');
        // after a decision, move to the next bulletin still waiting (if any), so the queue is worked through in order
        if (action !== 'withdraw') { const next = data?.stored.find((x) => x.bulletinId !== bulletinId && x.slotId !== 'drill' && !x.review); if (next) setSelected(next.bulletinId); }
        load();
      })
      .catch((r: unknown) => setError(r instanceof ApiError ? r.message : 'The decision could not be saved.'))
      .finally(() => setBusy(false));
  };
  const closeScript = (): void => { setShowModels(false); setShowScript(false); setDraft({}); setAsk(''); setAssist({ busy: false, summary: '', notes: {}, error: '' }); setPopError(''); };
  const saveDraft = (bulletinId: string, edits: { id: string; text: string }[]): void => {
    setPopBusy(true); setPopError('');
    apiRequest(`/api/admin/screening/${bulletinId}/script`, { token, method: 'PUT', body: { edits, note: 'Edited by an administrator in the review popup' } })
      .then(() => { setDraft({}); setAssist({ busy: false, summary: '', notes: {}, error: '' }); load(); })
      .catch((r: unknown) => setPopError(r instanceof ApiError ? r.message : 'The changes were not saved.'))
      .finally(() => setPopBusy(false));
  };
  // AEGIS Assist: what the operator typed goes with each editable part to the script review, one part at a time; wording that passes the checks fills that part's box (not saved yet), the rest is listed with the reason.
  const improveAll = async (bulletinId: string, parts: { id: string; text: string }[]): Promise<void> => {
    setAssist({ busy: true, summary: '', notes: {}, error: '' });
    const notes: Record<string, { problems: string[]; unchanged: boolean }> = {}; let used = 0; let firstError = '';
    for (const part of parts) {
      try {
        const r = await apiRequest<AiSuggestion>(`/api/admin/screening/${bulletinId}/script-review`, { token, method: 'POST', body: { segmentId: part.id, text: part.text, instruction: ask, model: aiModel } });
        notes[part.id] = { problems: r.ok ? [] : r.problems, unchanged: r.unchanged };
        if (r.ok && !r.unchanged && r.proposal) { used += 1; setDraft((d) => ({ ...d, [part.id]: r.proposal as string })); }
      } catch (e) { firstError = firstError || (e instanceof ApiError ? e.message : 'AEGIS Assist did not work.'); }
    }
    setAssist({ busy: false, notes, error: firstError, summary: firstError ? '' : `AEGIS Assist reworded ${used} of ${parts.length} parts. Read them, change anything, then Save changes. Nothing is saved yet.` });
  };
  const current = data?.stored.find((s) => s.bulletinId === selected) ?? null;
  const st = state(current);
  const expiredNow = !!current && !!data && isExpired(current, data.now);

  // The preview (and the map in it) starts LOCKED: the mouse wheel and touch scroll the admin page instead of zooming the map or trapping the scroll. Unlock to use the map, Lock to give the page back.
  const hero = <div ref={box} className="news-approval-framebox" style={{ height: frameHeight }}><button type="button" className="news-approval-lock" aria-pressed={!mapLocked} aria-label={mapLocked ? 'Unlock map' : 'Lock map'} title={mapLocked ? 'Map locked: click to unlock' : 'Map unlocked: click to lock'} onClick={() => setMapLocked(!mapLocked)}>{mapLocked ? '🔒' : '🔓'}</button>{selected && colWidth > 0 && <iframe ref={frame} key={`${selected}-${speed}`} className="news-approval-frame" title="Landing page preview" src={`/?previewBulletin=${encodeURIComponent(selected)}&heroWidth=${colWidth}${speed > 1 ? `&speed=${speed}` : ''}`} style={{ width: Math.max(1200, window.innerWidth), height: frameHeight, pointerEvents: mapLocked ? 'none' : 'auto' }} tabIndex={mapLocked ? -1 : 0}/>}</div>;
  return <>{previewEnabled && <div className="news-approval-previewbar"><button type="button" aria-haspopup="dialog" onClick={() => setShowPreview(true)}>Preview landing page</button></div>}{showPreview && <div className="news-preview-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setShowPreview(false); }}><div className="news-preview-dialog" role="dialog" aria-modal="true" aria-label="Landing page preview"><header><strong>Landing page preview</strong><span>Shows the selected bulletin as the public will see it. Not published.</span></header>{hero}<div className="review-dialog-actions"><button type="button" onClick={() => setShowPreview(false)} aria-label="Close preview">Close</button></div></div></div>}<ModuleCard cardId="admin:screening" title="News approval" eyebrow="CHECK THE UPCOMING NEWS BEFORE IT IS PUBLISHED" collapsible={false}>
    {error && <p role="alert">{error}</p>}
    {!data ? <p role="status">Loading…</p> : <>
      {!data.approvalRequired && <p role="alert" className="ne-error"><strong>Approval is switched off on this server:</strong> every bulletin is shown to the public without being approved.</p>}
      <div className="news-approval">
        {(() => {
          const live = data.stored.filter((s) => s.slotId !== 'drill');
          const kind = (s: Stored): 'WAITING' | 'APPROVED' | 'HELD' | 'EXPIRED' => (isExpired(s, data.now) ? 'EXPIRED' : (state(s) as 'WAITING' | 'APPROVED' | 'HELD'));
          const tests = data.stored.filter((s) => s.slotId === 'drill');
          const counts = { all: live.length, WAITING: live.filter((s) => kind(s) === 'WAITING').length, APPROVED: live.filter((s) => kind(s) === 'APPROVED').length, HELD: live.filter((s) => kind(s) === 'HELD').length, EXPIRED: live.filter((s) => kind(s) === 'EXPIRED').length };
          const shown = live.filter((s) => filter === 'all' || kind(s) === filter);
          const groups: { day: string; items: Stored[] }[] = [];
          for (const s of shown) { const day = s.captureAt.slice(0, 10); const g = groups.find((x) => x.day === day); if (g) g.items.push(s); else groups.push({ day, items: [s] }); }
          const item = (s: Stored) => <button key={s.bulletinId} type="button" className={selected === s.bulletinId ? 'is-active' : ''} onClick={() => setSelected(s.bulletinId)}>
            <strong>{nameOf(s)}</strong><small>{s.slotId === 'emergency' ? 'triggered' : 'captured'} {when(s.captureAt)}{s.slotId === 'emergency' ? '' : ` · airs ${when(s.airAt)}`}</small>
            <span className={`admin-badge admin-${kind(s) === 'APPROVED' ? 'ok' : kind(s) === 'WAITING' ? 'warn' : 'off'}`}>{kind(s) === 'APPROVED' ? '🔒 APPROVED' : kind(s)}</span></button>;
          const chips: { id: typeof filter; label: string; n: number }[] = [{ id: 'all', label: 'All', n: counts.all }, { id: 'WAITING', label: 'Waiting', n: counts.WAITING }, { id: 'APPROVED', label: 'Approved', n: counts.APPROVED }, { id: 'HELD', label: 'Held', n: counts.HELD }, ...(counts.EXPIRED > 0 ? [{ id: 'EXPIRED' as const, label: 'Expired', n: counts.EXPIRED }] : [])];
          return <nav className="news-approval-list" aria-label="Bulletins">
            <button type="button" className={selected === 'DRAFT' ? 'is-active' : ''} onClick={() => setSelected('DRAFT')}><strong>Draft as at now</strong><small>preview only · not stored</small></button>
            <div className="news-approval-filters" role="group" aria-label="Filter bulletins">{chips.map((chip) => <button key={chip.id} type="button" aria-pressed={filter === chip.id} className={filter === chip.id ? 'is-on' : ''} onClick={() => setFilter(chip.id)}>{chip.label} ({chip.n})</button>)}</div>
            {groups.map((g) => <div key={g.day} className="news-approval-group"><h4>{dayLabel(g.day, data.now)}</h4>{g.items.map(item)}</div>)}
            {live.length === 0 && <p>No bulletin captured yet. The next one is stored at its capture time.</p>}
            {live.length > 0 && shown.length === 0 && <p>No bulletin matches this filter.</p>}
            {tests.length > 0 && <details className="news-approval-tests" open={tests.some((s) => s.bulletinId === selected)}><summary>Test runs ({tests.length})</summary>{tests.map(item)}</details>}
          </nav>;
        })()}
      </div>
      {(() => {
        const waiting = data.stored.filter((x) => x.slotId !== 'drill' && !x.review && !isExpired(x, data.now));
        const label = (x: Stored): string => (nameOf(x));
        // The decision for the selected bulletin is always in view here (the bar stays at the top while the script is read); the dialog asks for a tick that it was read.
        const actions = st === 'WAITING' && current && !expiredNow
          ? <div className="news-waiting-actions"><span>Selected: <strong>{label(current)}</strong> · captured {when(current.captureAt)}</span>
            <button type="button" className="ne-read-btn" onClick={() => { setDraft({}); setShowScript(true); }}>Read the script</button>
            <button type="button" className="ne-approve" disabled={busy} onClick={() => setDecision('approve')}>Approve and lock</button>
            <button type="button" className="ne-reject" disabled={busy} onClick={() => setDecision('reject')}>Reject</button></div>
          : expiredNow && current
            ? <div className="news-waiting-actions is-expired"><span>Selected: <strong>{label(current)}</strong> · expired: its air time ({when(current.airAt)}) has passed, so it can no longer be approved. It stays here as a record.</span><button type="button" className="ne-read-btn" onClick={() => { setDraft({}); setShowScript(true); }}>Read the script</button></div>
            : null;
        if (waiting.length === 0) return <div className="news-waiting-bar is-clear"><p role="status">Nothing is waiting for approval.</p>{actions}</div>;
        const at = waiting.findIndex((x) => x.bulletinId === selected);
        return <nav className="news-waiting-bar" aria-label="Bulletins waiting for approval">
          <strong>To approve: {waiting.length}</strong>
          {waiting.map((x, i) => <button key={x.bulletinId} type="button" className={x.bulletinId === selected ? 'is-on' : ''} aria-pressed={x.bulletinId === selected} title={`${label(x)}, captured ${when(x.captureAt)}`} onClick={() => setSelected(x.bulletinId)}><span>{i + 1}</span> {label(x)}</button>)}
          <button type="button" className="news-waiting-next" onClick={() => setSelected(waiting[(at + 1) % waiting.length]!.bulletinId)}>{at >= 0 ? `Next waiting (${at + 1} of ${waiting.length}) ›` : 'Review the first ›'}</button>
          {actions}
        </nav>;
      })()}
      <WorkflowStrip gate={expiredNow ? 'EXPIRED' : st} item={current as unknown as WorkflowItem | null} draft={{ problems: data.draft.problems, estimatedSeconds: data.draft.bulletin.estimatedSeconds }} voiceMode={data.voiceMode ?? 'browser-stub'} work={{
        '01': <EmergencyDialog token={token} onCreated={(id) => { setSelected(id); load(); }}/>,
        '03': current ? <ReviewDesk part="script" token={token} item={current as unknown as ReviewItem} onChange={load}/> : <p>Draft as at now: read it in the preview. It is saved at the next capture, then it appears in the list above.</p>,
        '04': current ? <><PipelinePanel part="languages" token={token} item={current} languages={data.languageCatalog.languages} voiceMode={data.voiceMode ?? 'browser-stub'} onChange={load}/><ReviewDesk part="translations" token={token} item={current as unknown as ReviewItem} onChange={load}/></> : undefined,
        '05': <div className="news-approval-decision"><div className="news-approval-actionbar">
            {st === 'DRAFT' && <p><strong>Draft as at now.</strong> About {Math.round(data.draft.bulletin.estimatedSeconds)} s · validator: {data.draft.problems.length === 0 ? 'no problems' : data.draft.problems.join('; ')}. It is saved only at the next capture, then it appears in the list.</p>}
            {expiredNow && current && <p><strong>Expired.</strong> Its air time ({when(current.airAt)}) has passed, so it can no longer be approved: out-of-date news must not reach the public page. It stays here as a record.</p>}
            {st === 'WAITING' && current && !expiredNow && <p><strong>Waiting for your decision.</strong> Use <em>Approve and lock</em> or <em>Reject</em> in the bar at the top of this page; it stays in view while you read.</p>}
            {st === 'APPROVED' && current && <div><p><strong>🔒 Approved and locked</strong> by {current.review?.decidedBy} at {when(current.review!.decidedAt)}. It is what the public page shows. Nothing can be changed while it is approved.</p>
              <p><button type="button" disabled={busy} onClick={() => setDecision('withdraw')}>Withdraw</button></p></div>}
            {st === 'HELD' && current && <p><strong>Not published.</strong> {current.review?.note ?? 'Held.'} ({current.review?.decidedBy}, {when(current.review!.decidedAt)}) <button type="button" disabled={busy} onClick={() => setDecision('reapprove')}>Approve again</button></p>}
            </div>
            {current && current.log.length > 0 && <details><summary>Decision history ({current.log.length})</summary><ul className="admin-list">{current.log.map((e) => <li key={e.seq}>{e.action} · {e.by} · {when(e.at)}{e.note ? ` · ${e.note}` : ''}</li>)}</ul></details>}
          {previewEnabled && <div className="news-approval-sizes" role="group" aria-label="Preview speed"><button type="button" aria-pressed={speed === 8} onClick={() => setSpeed(speed === 8 ? 1 : 8)} title="Play the preview 8 times faster">Fast play (8x)</button></div>}
        </div>,
        '06': current ? <><PipelinePanel part="media" token={token} item={current} languages={data.languageCatalog.languages} voiceMode={data.voiceMode ?? 'browser-stub'} onChange={load}/><ReviewDesk part="jobs" token={token} item={current as unknown as ReviewItem} onChange={load}/></> : undefined,
      }}/>
    </>}
    {showScript && current && (() => {
      const bulletin = (current as unknown as { bulletin: { estimatedSeconds?: number; segments: { id: string; title: string; text: string }[] } | null }).bulletin;
      const canDecide = st === 'WAITING' && !expiredNow;
      const protectedIds = (current as unknown as { protectedSegments?: string[] }).protectedSegments ?? [];
      const segments = bulletin?.segments ?? [];
      const editableParts = canDecide ? segments.filter((x) => !protectedIds.includes(x.id)) : [];
      const dirty = editableParts.filter((x) => draft[x.id] !== undefined && draft[x.id]!.trim() !== x.text);
      const locked = assist.busy || popBusy;
      const partsForAi = editableParts.map((x) => ({ id: x.id, text: draft[x.id] ?? x.text }));
      return <div className="review-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !locked) closeScript(); }}>
        <div className="review-dialog news-read-dialog" role="dialog" aria-modal="true" aria-label="Script to read">
          <header><strong>{nameOf(current)} · {when(current.captureAt)}</strong><span className="ne-note">{bulletin ? `${segments.length} parts${typeof bulletin.estimatedSeconds === 'number' ? ` · about ${Math.round(bulletin.estimatedSeconds)} s spoken` : ''}` : ''}</span></header>
          {canDecide && <p className="ne-note">Click in any text to reword it, or tell AEGIS Assist below what to improve. Code refuses a new number or name, and official guidance cannot be edited. Every change is logged.</p>}
          <div className="news-read-body">{bulletin ? segments.map((seg) => {
            const official = protectedIds.includes(seg.id);
            const value = draft[seg.id] ?? seg.text;
            const note = assist.notes[seg.id];
            return <div key={seg.id} className="news-read-part"><h4>{seg.title}{official && <small> · official guidance, not editable here</small>}</h4>
              {canDecide && !official
                ? <textarea aria-label={seg.title} value={value} rows={Math.max(2, Math.ceil(value.length / 90))} maxLength={1500} disabled={locked} onChange={(e) => setDraft((d) => ({ ...d, [seg.id]: e.target.value }))}/>
                : <p>{seg.text}</p>}
              {note && note.problems.length > 0 && <ul className="admin-list ne-error">{note.problems.map((x) => <li key={x}>AEGIS Assist's wording was not used: {x}</li>)}</ul>}
              {note?.unchanged && <p className="ne-note">AEGIS Assist would leave this part as it is.</p>}
            </div>;
          }) : <p>No script stored.</p>}</div>
          {popError && <p role="alert" className="ne-error">{popError}</p>}
          {assist.error && <p role="alert" className="ne-error">{assist.error}</p>}
          {assist.summary && <p role="status" className="ne-note">{assist.summary}</p>}
          <div className="news-read-footer">
            <button type="button" disabled={locked} onClick={closeScript}>{canDecide ? 'Back' : 'Close'}</button>
            {editableParts.length > 0 && <div className="news-read-ask">
              <span className="news-read-brand"><Icon name="shield" size={14}/> AEGIS Assist</span>
              <span className="news-read-model"><button type="button" className="news-read-model-btn" aria-haspopup="true" aria-expanded={showModels} aria-label="Choose the AI model" disabled={locked} onClick={() => setShowModels((v) => !v)}><Icon name="settings" size={14}/> {aiModel === 'auto' ? 'Auto' : 'Argon'}</button>
                {showModels && <div className="news-read-model-pop"><GoogleModelSelector mode={aiModel} modes={SCRIPT_MODEL_OPTIONS} onSelect={(id) => { setAiModel(id); setShowModels(false); }}/></div>}</span>
              <input type="text" aria-label="Tell AEGIS Assist what to improve" placeholder="Tell AEGIS Assist what to improve, e.g. calmer, simpler words" value={ask} maxLength={200} disabled={locked}
                onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ask.trim().length >= 3 && !locked) void improveAll(current.bulletinId, partsForAi); }}/>
              <button type="button" className="ne-ai" aria-label="Ask AEGIS Assist to improve the script" disabled={locked || ask.trim().length < 3} onClick={() => void improveAll(current.bulletinId, partsForAi)}><Icon name="spark" size={15}/>{assist.busy ? 'Working…' : 'Improve'}</button>
            </div>}
            <span className="news-read-decide">
            {dirty.length > 0 && <button type="button" className="ne-primary" disabled={locked} onClick={() => saveDraft(current.bulletinId, dirty.map((x) => ({ id: x.id, text: draft[x.id]!.trim() })))}>Save changes ({dirty.length})</button>}
            {canDecide && <><button type="button" className="ne-danger" disabled={locked || dirty.length > 0} title={dirty.length > 0 ? 'Save or discard your changes first' : undefined} onClick={() => { closeScript(); setDecision('reject'); }}>Reject</button>
              <button type="button" className="ne-primary" disabled={locked || dirty.length > 0} title={dirty.length > 0 ? 'Save your changes first' : undefined} onClick={() => { closeScript(); setDecision('approve'); }}>Approve and lock</button></>}
            </span>
          </div>
        </div>
      </div>;
    })()}
    {decision && current && <DecisionDialog kind={decision} busy={busy} label={`${nameOf(current)} ${when(current.captureAt)}`}
      onClose={() => setDecision(null)} onConfirm={(note) => act(current.bulletinId, decision === 'reject' ? 'hold' : decision === 'withdraw' ? 'withdraw' : 'approve', note)}/>}
  </ModuleCard></>;
}
