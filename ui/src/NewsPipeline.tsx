import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from './api/client.js';
import { RenderSpeed } from './RenderSpeed.js';

export interface PipelineItem {
  bulletinId: string; slotId: string; review: { decision: 'APPROVED' | 'HELD' } | null;
  bulletin: { segments: { text: string }[] } | null;
  plan: { scenario: 'daily' | 'emergency'; output: 'voice' | 'voice_presenter'; languages: string[]; explicit: boolean };
  steps: { seq: number; step: string; at: string; by: string; mode: string; note: string | null }[];
  kpi: { id: string; label: string; target: string; dueAt: string | null; doneAt: string | null; actualMs: number | null; status: 'ok' | 'late' | 'pending' | 'at_risk' | 'not_applicable' }[];
}
export interface LanguageEntry { code: string; label: string; native: string; group: 'pilot' | 'asean'; state: 'active' | 'locked' }
const STATUS_TEXT: Record<PipelineItem['kpi'][number]['status'], string> = { ok: 'On target', late: 'Late', pending: 'Pending', at_risk: 'At risk', not_applicable: 'Not used' };
const clock = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' MYT' : '');
const span = (ms: number | null): string => (ms === null ? '' : ms < 120_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);
const STEP_TEXT: Record<string, string> = { VOICE_REQUESTED: 'Voice requested', VOICE_READY: 'Voice ready', PRESENTER_REQUESTED: 'Presenter requested', PRESENTER_READY: 'Presenter ready' };

/**
 * The pipeline of one bulletin (AEG-NEWS-007): scenario, output choice (voice only, or voice then presenter), the timing rows against their targets, and the production steps.
 * Review comes first; the voice is a STUB (the browser reads the approved script; Google Cloud Text-to-Speech is planned); the presenter is a gated cloud render that this panel only records.
 */
export function PipelinePanel({ token, item, languages, voiceMode = 'browser-stub', onChange, part = 'all' }: { part?: 'all' | 'languages' | 'media'; token: string; item: PipelineItem; languages: LanguageEntry[]; voiceMode?: 'google-tts' | 'browser-stub'; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const approved = item.review?.decision === 'APPROVED';
  const has = (step: string): boolean => item.steps.some((s) => s.step === step);
  const post = (path: string, body: unknown): void => {
    setBusy(true); setError('');
    apiRequest(`/api/admin/screening/${item.bulletinId}/${path}`, { token, method: 'POST', body })
      .then(() => { setNote(''); onChange(); })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'That did not work.'))
      .finally(() => setBusy(false));
  };
  const text = item.bulletin?.segments.map((s) => s.text).join(' ') ?? '';
  const googleVoice = item.steps.some((s) => s.step === 'VOICE_READY' && s.mode === 'google-tts');
  const audio = useRef<HTMLAudioElement | null>(null);
  const listen = (): void => {
    if (googleVoice) {   // the real voice: the MP3 Google Cloud Text-to-Speech made from this script (the bulletin is approved, so the public route serves it)
      audio.current?.pause(); const a = new Audio(`/public/broadcast/voice/${item.bulletinId}`); audio.current = a; a.onended = () => setSpeaking(false); a.onerror = () => { setSpeaking(false); setError('The voice file could not be played.'); };
      setSpeaking(true); void a.play().catch(() => { setSpeaking(false); setError('The voice file could not be played.'); }); return;
    }
    if (!('speechSynthesis' in window)) { setError('This browser has no speech voice.'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en'; const en = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('en')); if (en) u.voice = en;
    u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    setSpeaking(true); window.speechSynthesis.speak(u);
  };
  const stop = (): void => { audio.current?.pause(); window.speechSynthesis?.cancel(); setSpeaking(false); };
  useEffect(() => () => { audio.current?.pause(); window.speechSynthesis?.cancel(); }, [item.bulletinId]);
  return <section className="news-pipeline" aria-label="Pipeline" data-testid={part === 'languages' ? 'news-languages-part' : 'news-pipeline'}>
    {part !== 'languages' && <>
    <h4>Pipeline <span className={`admin-badge ${item.plan.scenario === 'emergency' ? 'admin-off' : 'admin-ok'}`}>{item.plan.scenario === 'emergency' ? 'EMERGENCY' : 'DAILY'}</span></h4>
    <fieldset className="news-pipeline-output" disabled={busy || has('PRESENTER_REQUESTED')}><legend>Output</legend>
      <label><input type="radio" name={`out-${item.bulletinId}`} checked={item.plan.output === 'voice'} onChange={() => post('plan', { output: 'voice' })}/> Voice only</label>
      <label><input type="radio" name={`out-${item.bulletinId}`} checked={item.plan.output === 'voice_presenter'} onChange={() => post('plan', { output: 'voice_presenter' })}/> Voice, then presenter</label>
    </fieldset>
    </>}
    {part !== 'media' && <>
    <div className="news-languages" role="group" aria-label="Languages">
      <strong>Languages</strong>
      {item.plan.languages.map((code) => { const l = languages.find((x) => x.code === code); if (!l) return null; return <button key={code} type="button" className={`news-lang is-on${l.state === 'locked' ? ' is-stub' : ''}`} aria-pressed="true" disabled={busy || code === 'en'}
        title={code === 'en' ? 'English is always made' : `Untick ${l.label}`} onClick={() => post('plan', { languages: item.plan.languages.filter((c) => c !== code) })}>{'\u2713'} {l.label}{l.state === 'locked' && <small> stub</small>}</button>; })}
      <button type="button" className="news-lang-add" aria-label="Add a language" aria-expanded={adding} disabled={busy} onClick={() => setAdding((v) => !v)}>+</button>
      {adding && <div className="news-lang-menu" role="group" aria-label="Add a language">{(['pilot', 'asean'] as const).map((g) => { const rest = languages.filter((l) => l.group === g && !item.plan.languages.includes(l.code)); return rest.length === 0 ? null : <div key={g}><small>{g === 'pilot' ? 'Pilot countries' : 'Other ASEAN languages'}</small>{rest.map((l) => <button key={l.code} type="button" onClick={() => { setAdding(false); post('plan', { languages: [...item.plan.languages, l.code] }); }}>+ {l.label} <small>{l.native}</small></button>)}</div>; })}</div>}
      <small>English is always made. A ticked language is translated on request (Google Cloud Translation first pass, checked by code, with a back-translation). Each one needs a person who reads it to approve it before it gets its voice. Translations are not reviewed by native speakers.</small>
    </div>
    </>}
    {part !== 'languages' && <>
    <ol className="news-pipeline-kpi" aria-label="Timing against targets">{item.kpi.map((r) => <li key={r.id} className={`kpi-${r.status}`}>
      <span className="kpi-chip">{STATUS_TEXT[r.status]}</span><strong>{r.label}</strong><small>{r.target}{r.doneAt ? ` · done ${clock(r.doneAt)}${r.actualMs !== null ? ` (${span(r.actualMs)})` : ''}` : r.dueAt && r.status !== 'not_applicable' ? ` · due ${clock(r.dueAt)}` : ''}</small></li>)}</ol>
    <div className="news-pipeline-actions">
      <button type="button" onClick={speaking ? stop : listen} disabled={!text}>{speaking ? 'Stop listening' : googleVoice ? 'Listen (Google voice)' : 'Listen (browser voice)'}</button>
      <button type="button" disabled={busy || !approved || has('VOICE_READY')} title={approved ? undefined : 'Approve the bulletin first'} onClick={() => post('voice', {})}>{has('VOICE_READY') ? (googleVoice ? 'Voice ready' : 'Voice ready (stub)') : voiceMode === 'google-tts' ? 'Make voice (Google Text-to-Speech)' : 'Prepare voice (stub)'}</button>
      {item.plan.output === 'voice_presenter' && <RenderSpeed token={token} bulletinId={item.bulletinId} disabled={busy || !has('VOICE_READY')} requested={has('PRESENTER_REQUESTED')} onRequest={(speed) => post('presenter', { action: 'requested', speed })}/>}
    </div>
    {item.plan.output === 'voice_presenter' && has('PRESENTER_REQUESTED') && !has('PRESENTER_READY') && <p><label>Where is the finished video <input type="text" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="file or link (at least 5 characters)" style={{ minWidth: 260 }}/></label>{' '}
      <button type="button" disabled={busy || note.trim().length < 5} onClick={() => post('presenter', { action: 'ready', note: note.trim() })}>Mark presenter ready</button></p>}
    <small>Review comes first. {voiceMode === 'google-tts' ? 'The voice is made by Google Cloud Text-to-Speech from the approved script and the audio is kept with the bulletin.' : 'The voice is a stub: your browser reads the approved script and no audio file is kept (Google Cloud Text-to-Speech is planned).'} The presenter render is a gated cloud request: this panel only records it (see the Render card).</small>
    {item.steps.length > 0 && <details><summary>Production steps ({item.steps.length})</summary><ul className="admin-list">{item.steps.map((s) => <li key={s.seq}>{STEP_TEXT[s.step] ?? s.step} · {clock(s.at)} · {s.by} · {s.mode}{s.note ? ` · ${s.note}` : ''}</li>)}</ul></details>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
