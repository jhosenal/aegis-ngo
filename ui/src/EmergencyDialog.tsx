import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from './api/client.js';

interface Candidate { evidenceId: string; title: string; hazardType: string; alertLevel: string; eventTime: string | null }
type Mode = 'real' | 'drill';
type Output = 'voice' | 'voice_presenter';
type Detail = 'brief' | 'full';

const HAZARDS = [{ id: 'FLOOD', label: 'Flood' }, { id: 'EARTHQUAKE', label: 'Earthquake' }, { id: 'STORM', label: 'Storm' }, { id: 'WILDFIRE', label: 'Wildfire' }, { id: 'VOLCANO', label: 'Volcano' }] as const;
const LEVELS = ['ORANGE', 'RED', 'GREEN'] as const;
const PLACES = [
  { id: 'jb', label: 'Johor Bahru, Malaysia', lat: 1.4927, lon: 103.7414 },
  { id: 'kk', label: 'Kota Kinabalu, Malaysia', lat: 5.9804, lon: 116.0735 },
  { id: 'sg', label: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { id: 'bsb', label: 'Bandar Seri Begawan, Brunei', lat: 4.9031, lon: 114.9398 },
] as const;

/**
 * New emergency bulletin, in a dialog. Two kinds: a REAL incident picked from the current ones, or an EXERCISE (drill) that the text says is an exercise and that can never be public.
 * Either way code writes the script, it is checked, and nothing is published until an administrator approves it.
 */
export function EmergencyDialog({ token, onCreated }: { token: string; onCreated: (bulletinId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('real');
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [pick, setPick] = useState('');
  const [output, setOutput] = useState<Output>('voice');
  const [detail, setDetail] = useState<Detail>('brief');
  const [hazard, setHazard] = useState<typeof HAZARDS[number]['id']>('FLOOD');
  const [level, setLevel] = useState<typeof LEVELS[number]>('ORANGE');
  const [place, setPlace] = useState<typeof PLACES[number]['id']>('jb');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback((): void => {
    apiRequest<{ candidates: Candidate[] }>('/api/admin/screening/emergency/candidates', { token }).then((r) => { setCands(r.candidates); setPick((p) => (r.candidates.some((c) => c.evidenceId === p) ? p : r.candidates[0]?.evidenceId ?? '')); })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The incident list could not be loaded.'));
  }, [token]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { if (!open) return; const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [open]);

  const placeInfo = PLACES.find((p) => p.id === place)!;
  const hazardLabel = HAZARDS.find((h) => h.id === hazard)!.label;
  const drillTitle = title.trim() || `Exercise: ${hazardLabel.toLowerCase()} near ${placeInfo.label}`;
  const canCreate = !busy && (mode === 'real' ? pick !== '' : drillTitle.length >= 5);

  const create = (): void => {
    setBusy(true); setError(''); setMsg('');
    const body = mode === 'real'
      ? { evidenceId: pick, output, ...(detail === 'full' ? { detail } : {}) }
      : { drill: { hazardType: hazard, alertLevel: level, title: drillTitle, lat: placeInfo.lat, lon: placeInfo.lon, sourceId: 'SRC.GDACS.LIVE' }, output, ...(detail === 'full' ? { detail } : {}) };
    apiRequest<{ bulletinId: string; note: string }>('/api/admin/screening/emergency', { token, method: 'POST', body })
      .then((r) => { setMsg(r.note); setOpen(false); onCreated(r.bulletinId); })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The draft could not be made.'))
      .finally(() => setBusy(false));
  };

  return <div className="news-emergency-bar" data-testid="news-emergency">
    <button type="button" className="news-emergency-open" aria-haspopup="dialog" onClick={() => { setOpen(true); setError(''); }}>New emergency bulletin</button>
    <small>Written by code, checked, and held for your approval. Nothing is published until you approve it.</small>
    {msg && <p role="status" className="news-emergency-msg">{msg}</p>}
    {open && <div className="review-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="review-dialog news-emergency-dialog" role="dialog" aria-modal="true" aria-label="New emergency bulletin">
        <header><strong>New emergency bulletin</strong></header>

        <div className="ne-seg" role="radiogroup" aria-label="Kind of bulletin">
          <label className={mode === 'real' ? 'is-on' : ''}><input type="radio" name="emergency-kind" checked={mode === 'real'} onChange={() => setMode('real')}/> Real incident</label>
          <label className={mode === 'drill' ? 'is-on' : ''}><input type="radio" name="emergency-kind" checked={mode === 'drill'} onChange={() => setMode('drill')}/> Exercise (never public)</label>
        </div>

        {mode === 'real'
          ? <section className="ne-section" aria-label="Incident">
            <p className="ne-note">An AEGIS summary of an official source, never an official warning. Target: voice on air within 5 minutes of this trigger.</p>
            {cands === null ? <p role="status">Loading incidents…</p> : cands.length === 0 ? <p>No current incident an emergency bulletin may be made from.</p>
              : <label className="ne-field">Incident <select value={pick} onChange={(e) => setPick(e.target.value)}>{cands.map((c) => <option key={c.evidenceId} value={c.evidenceId}>{c.alertLevel} · {c.title}</option>)}</select></label>}
          </section>
          : <section className="ne-section" aria-label="Exercise">
            <p className="ne-note">An exercise to test the pipeline. The text says it is an exercise and it can never be shown to the public.</p>
            <div className="ne-grid">
              <label className="ne-field">Hazard <select value={hazard} onChange={(e) => setHazard(e.target.value as typeof hazard)}>{HAZARDS.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}</select></label>
              <label className="ne-field">Alert level <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>{LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
              <label className="ne-field">Place <select value={place} onChange={(e) => setPlace(e.target.value as typeof place)}>{PLACES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
            </div>
            <label className="ne-field">Title <input type="text" value={title} placeholder={drillTitle} maxLength={200} onChange={(e) => setTitle(e.target.value)}/></label>
          </section>}

        <div className="ne-grid">
          <fieldset className="ne-choice"><legend>Length</legend>
            <label><input type="radio" name="emergency-detail" checked={detail === 'brief'} onChange={() => setDetail('brief')}/> Short alert (about 15 seconds)</label>
            <label><input type="radio" name="emergency-detail" checked={detail === 'full'} onChange={() => setDetail('full')}/> Full (longer text)</label>
          </fieldset>
          <fieldset className="ne-choice"><legend>Output</legend>
            <label><input type="radio" name="emergency-output" checked={output === 'voice'} onChange={() => setOutput('voice')}/> Voice only</label>
            <label><input type="radio" name="emergency-output" checked={output === 'voice_presenter'} onChange={() => setOutput('voice_presenter')}/> Voice, then presenter</label>
          </fieldset>
        </div>

        {error && <p role="alert" className="ne-error">{error}</p>}
        <div className="review-dialog-actions">
          <button type="button" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="ne-primary" disabled={!canCreate} onClick={create}>{mode === 'real' ? 'Create emergency draft' : 'Create exercise draft'}</button>
        </div>
      </div>
    </div>}
  </div>;
}
