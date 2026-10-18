import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from './api/client.js';

interface Option { speed: 'normal' | 'fast' | 'max'; parallel: number; instanceSecondsEach: number; etaSeconds: number; estimate: { status: 'ESTIMATE' | 'UNKNOWN'; micro: number | null }; available: boolean; note: string }
interface Reply { speechSeconds: number; maxParallel: number; options: Option[]; assumption: string }
const NAME: Record<Option['speed'], string> = { normal: 'Normal', fast: 'Fast', max: 'Max' };
const eta = (s: number): string => (s < 90 ? `${s} s` : `about ${Math.round(s / 60)} min`);

/**
 * Choose how fast the presenter renders: Normal (1 GPU job), Fast (2), Max (3, the project's current quota). Each shows its ETA and estimated cost before anything is requested.
 * The request is recorded as a job card; the render itself is started by the operations agent (AEG-SOP-002), never by this button.
 */
export function RenderSpeed({ token, bulletinId, language = 'en', disabled, requested, onRequest }: { token: string; bulletinId: string; language?: string; disabled: boolean; requested: boolean; onRequest: (speed: Option['speed']) => void }) {
  const [data, setData] = useState<Reply | null>(null);
  const [speed, setSpeed] = useState<Option['speed']>('normal');
  const [error, setError] = useState('');
  useEffect(() => {
    apiRequest<Reply>(`/api/admin/screening/${bulletinId}/render-options?lang=${language}`, { token }).then((r) => { setData(r); setError(''); }).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The render options could not be loaded.'));
  }, [token, bulletinId, language, disabled]);
  if (!data) return error ? <p role="alert">{error}</p> : null;
  return <fieldset className="render-speed" disabled={disabled || requested} aria-label="Presenter render speed"><legend>Presenter render speed</legend>
    <div role="radiogroup" aria-label="Render speed">{data.options.map((o) => <label key={o.speed} className={`render-option${speed === o.speed ? ' is-on' : ''}${o.available ? '' : ' is-off'}`}>
      <input type="radio" name={`render-${bulletinId}`} value={o.speed} checked={speed === o.speed} disabled={!o.available} onChange={() => setSpeed(o.speed)}/>
      <strong>{NAME[o.speed]}</strong><span>{o.parallel} GPU{o.parallel > 1 ? 's' : ''}</span><span>ETA {eta(o.etaSeconds)}</span><span>{o.estimate.micro === null ? 'cost UNKNOWN' : `about ${(o.estimate.micro / 1_000_000).toFixed(2)} USD`}</span>{!o.available && <small>{o.note}</small>}</label>)}</div>
    <button type="button" onClick={() => onRequest(speed)}>{requested ? 'Presenter requested' : `Request presenter render (${NAME[speed]})`}</button>
    <small>For {Math.round(data.speechSeconds)} s of speech. {data.assumption} The credit gates a render: if the estimate is above the balance it waits for the owner.</small>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
