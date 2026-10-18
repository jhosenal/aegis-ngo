import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.js';
import { ApiError, apiRequest } from '../api/client.js';
import type { EnvPinView } from './environment.js';
import { EnvironmentPopup } from './EnvironmentPopup.js';
import type { DropTagSpec } from './dropTag.js';
import { coverageOf } from '../../../src/domains/coverage.js';

interface Credits { balance: number; pinLookupCost: number; packs: { id: string; credits: number; label: string }[]; stub: boolean; note: string; liveLookup: boolean }
interface Bookmark { bookmarkId: string; name: string; lat: number; lng: number }
interface Lookup { status?: string; balance?: number; cost?: number; validMinutes?: number; attribution: { air: string; weather: string }; pin: EnvPinView; remarks?: string[] }
type Stage = 'ask' | 'busy' | 'done';

const token = (): string | null => { try { return sessionStorage.getItem('aegis.session'); } catch { return null; } };
const fail = (e: unknown): string => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

/**
 * Drop a pin (AEG-CREDIT-001, AEG-SAMPLE-001), the flow owners asked for:
 *  1. Press Drop: drop mode starts, the cursor over the map becomes a crosshair and a hint says how to cancel (press Drop again, or Esc).
 *  2. One click places the pin and ends drop mode. The pin can be dragged. Its tag asks "Check this spot?" with Check (the credit cost is stated) and Cancel.
 *  3. Check opens the standard air and weather card for the spot (with the freshness countdown and a Refresh), and the tag offers Open card, Save place and Remove pin.
 * Pin tools require Pro or Admin access. Sample checks use no credits and show made-up values. Credits are a STUB (nothing is charged). A Google reading is shown for one hour and never saved;
 * a saved place keeps only its name and coordinates. The map sends 'aegis-drop' {lat,lng} on the .regional-map element for a click or a drag; this component asks the map for the marker and its tag.
 */
export function PinDropper({ mapReady, inline = false, sampleMode = false, operational = false }: { mapReady: boolean; externalTrigger?: boolean; inline?: boolean; sampleMode?: boolean; operational?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [stage, setStage] = useState<Stage>('ask');
  const [result, setResult] = useState<Lookup | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const signedIn = token() !== null;
  const root = (): Element | null => document.querySelector('.regional-map');
  const panelOpen = operational && (drop || savedOpen);

  const refresh = useCallback(() => {
    const t = token(); if (!t || !operational) return;
    apiRequest<Credits>('/api/credits', { token: t }).then(setCredits).catch(() => setCredits(null));
    apiRequest<{ bookmarks: Bookmark[] }>('/api/bookmarks', { token: t }).then((r) => setBookmarks(r.bookmarks)).catch(() => setBookmarks([]));
  }, [operational]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (panelOpen || point) refresh(); }, [panelOpen, point, refresh]);
  useEffect(() => { const show = (): void => { startDrop(); }; window.addEventListener('aegis-open-pin-dropper', show); return () => window.removeEventListener('aegis-open-pin-dropper', show); });

  const clearPin = (): void => { setPoint(null); setResult(null); setCardOpen(false); setStage('ask'); setMessage(''); setName(''); };
  const startDrop = (): void => { if (!operational) return; clearPin(); setSavedOpen(false); setDrop(true); };
  const cancelDrop = (): void => setDrop(false);

  // A click on the map (drop mode) or a drag of the pin: the point changes, a click ends drop mode.
  useEffect(() => {
    const el = root(); if (!el) return;
    const onDrop = (event: Event): void => {
      if (!operational) return;
      const d = (event as CustomEvent<{ lat: number; lng: number }>).detail;
      setPoint(d); setResult(null); setCardOpen(false); setStage('ask'); setMessage(''); setName(''); setDrop(false);
    };
    el.addEventListener('aegis-drop', onDrop);
    return () => el.removeEventListener('aegis-drop', onDrop);
  }, [operational]);
  useEffect(() => { if (!operational) { setDrop(false); setSavedOpen(false); clearPin(); setCredits(null); setBookmarks([]); } }, [operational]);
  // Drop mode: the map accepts a click, and the cursor becomes a crosshair.
  useEffect(() => {
    const el = root() as HTMLElement | null; if (!el) return;
    if (drop) el.dataset.dropMode = '1'; else delete el.dataset.dropMode;
    el.dispatchEvent(new CustomEvent('aegis-drop-cursor', { detail: { on: drop } }));
    return () => { delete el.dataset.dropMode; el.dispatchEvent(new CustomEvent('aegis-drop-cursor', { detail: { on: false } })); };
  }, [drop]);
  // Esc: ends drop mode; with a pin placed and not being checked, removes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (drop) { e.stopPropagation(); setDrop(false); return; }
      if (point && stage !== 'busy' && !cardOpen) { e.stopPropagation(); clearPin(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [drop, point, stage, cardOpen]);

  /** One check for the current point. Returns a message for the person when it did not work, else null. */
  const runCheck = async (): Promise<string | null> => {
    if (!operational) return 'Pro or Admin access is required to check a custom pin.';
    if (!point) return 'Place a pin first.';
    try {
      if (sampleMode) {
        const r = await fetch(`/public/environment/sample-pin?lat=${point.lat}&lng=${point.lng}`, { cache: 'no-store', headers: { authorization: `Bearer ${token() ?? ''}` } });
        const body = await r.json() as Lookup & { message?: string };
        if (!r.ok) return body.message ?? 'The sample could not be made for this spot.';
        setResult(body); return null;
      }
      const t = token(); if (!t) return 'Sign in to check live air and weather.';
      const r = await apiRequest<Lookup>('/api/pins/lookup', { token: t, method: 'POST', body: point });
      setResult(r); if (typeof r.balance === 'number') setCredits((c) => (c ? { ...c, balance: r.balance! } : c));
      return null;
    } catch (e) { refresh(); return fail(e); }
  };
  const check = (): void => {
    setStage('busy'); setMessage('');
    void runCheck().then((msg) => { if (msg) { setMessage(msg); setStage('ask'); } else { setStage('done'); setCardOpen(true); } });
  };
  const buy = (): void => {
    const t = token(); const pack = credits?.packs[0]; if (!t || !pack) return;
    apiRequest<Credits>('/api/credits/buy-stub', { token: t, method: 'POST', body: { packId: pack.id } }).then(setCredits).catch((e: unknown) => setMessage(fail(e)));
  };
  const save = (): void => {
    const t = token(); if (!t || !point) return;
    apiRequest('/api/bookmarks', { token: t, method: 'POST', body: { name, ...point } }).then(() => { setName(''); setMessage('Saved. Only the name and place are kept, never the reading.'); refresh(); }).catch((e: unknown) => setMessage(fail(e)));
  };
  const remove = (id: string): void => { const t = token(); if (t) apiRequest(`/api/bookmarks/${id}`, { token: t, method: 'DELETE' }).then(refresh).catch((e: unknown) => setMessage(fail(e))); };
  const goTo = (b: { lat: number; lng: number }): void => {
    setDrop(false); setPoint({ lat: b.lat, lng: b.lng }); setResult(null); setCardOpen(false); setStage('ask'); setMessage('');
    root()?.dispatchEvent(new CustomEvent('aegis-camera', { detail: { point: { lat: b.lat, lng: b.lng }, zoom: 14, travelSec: 1.2 } }));
  };

  // What the pin's tag says and offers.
  const cost = credits?.pinLookupCost ?? 1;
  const tag = (): DropTagSpec | null => {
    if (!point) return null;
    const line = `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
    if (stage === 'busy') return { title: 'Checking…', line, note: sampleMode ? 'Making a sample card.' : 'Asking Google Maps for air quality and weather.', actions: [] };
    if (stage === 'done') return { title: 'Checked', line, note: message || (sampleMode ? 'Sample values: made up, not real.' : 'Shown for one hour, never saved.'), actions: [{ id: 'card', label: 'Open card', primary: true }, ...(signedIn ? [{ id: 'save' as const, label: 'Save place' }] : []), { id: 'remove', label: 'Remove pin' }] };
    const cancel = { id: 'cancel' as const, label: 'Cancel' };
    if (!coverageOf(point.lat, point.lng)) return { title: 'Outside the pilot area', line, note: 'Dropped pins work inside Singapore, Malaysia and Brunei only. Drag the pin, or remove it.', actions: [{ id: 'remove', label: 'Remove pin', primary: true }] };
    if (sampleMode) return { title: 'Show a sample for this spot?', line, note: message || 'Sample data is on: no credits used. Values are made up.', actions: [{ id: 'check', label: 'Show sample', primary: true }, cancel] };
    if (!signedIn) return { title: 'Check this spot?', line, note: message || `Sign in to check live air and weather (${cost} credit), or turn on Sample data.`, actions: [{ id: 'signin', label: 'Sign in', primary: true }, cancel] };
    if (credits && !credits.liveLookup) return { title: 'Live checks are off', line, note: 'Live lookups are switched off on this server. Try Sample data.', actions: [cancel] };
    if (credits && credits.balance < cost) return { title: 'Not enough credits', line, note: message || `A check costs ${cost} credit; you have ${credits.balance}.`, actions: [{ id: 'credits', label: `Get ${credits.packs[0]?.credits ?? 10} demo credits`, primary: true }, cancel] };
    return { title: 'Check this spot?', line, note: message || `Costs ${cost} credit${credits ? ` · you have ${credits.balance}` : ''}. Shown for one hour, never saved.`, actions: [{ id: 'check', label: `Check · ${cost} credit`, primary: true }, cancel] };
  };
  const spec = operational ? tag() : null;
  useEffect(() => { root()?.dispatchEvent(new CustomEvent('aegis-drop-marker', { detail: point && spec ? { ...point, tag: spec } : null })); }, [point, JSON.stringify(spec)]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The tag's buttons (latest handlers through a ref, so the listener is added once).
  const act = useRef<(id: string) => void>(() => undefined);
  act.current = (id: string): void => {
    if (!operational) return;
    if (id === 'check') check();
    else if (id === 'cancel' || id === 'remove') clearPin();
    else if (id === 'card') setCardOpen(true);
    else if (id === 'save') setSavedOpen(true);
    else if (id === 'credits') buy();
    else if (id === 'signin') window.location.href = '/?login=true';
  };
  useEffect(() => { const on = (e: Event): void => act.current((e as CustomEvent<{ id: string }>).detail.id); window.addEventListener('aegis-drop-action', on); return () => window.removeEventListener('aegis-drop-action', on); }, []);

  useEffect(() => {
    if (!panelOpen || !inline) return;
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (container.current?.contains(target)) return;
      if (target instanceof Element && (target.closest('.google-map-canvas') || target.closest('.dropped-wrap') || target.closest('.environment-card-dialog'))) return;
      setSavedOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [panelOpen, inline]);

  const refreshLive = async (): Promise<string | null> => runCheck();
  const live = !sampleMode && signedIn && !!credits?.liveLookup;
  return <div ref={container} className={`pin-dropper${inline ? ' pin-dropper-inline' : ''}`} data-testid="pin-dropper">
    <button type="button" className={`map-news-button map-drop-button${drop ? ' is-active' : ''}`} aria-label="Drop a pin on the map" aria-pressed={drop} aria-expanded={panelOpen} aria-controls="pin-dropper-panel"
      disabled={!operational} title={operational ? 'Drop a pin' : 'Requires Pro or Admin access'}
      onClick={() => (drop ? cancelDrop() : startDrop())}>Drop {!operational && <span>· Pro</span>}<Icon name="pin" size={14}/></button>
    {panelOpen && <section id="pin-dropper-panel" className="pin-dropper-panel" aria-label="Drop a pin">
      {drop && <p className="pin-hint" role="status">{mapReady ? 'Click the map to place a pin. Press Esc or Drop again to cancel.' : 'The Google map is not connected, so a pin cannot be placed.'}</p>}
      {sampleMode ? <small>Sample data is on: no credits used; values are made up.</small>
        : !signedIn ? <small>Sign in to check live air and weather and to save places. <a href="/?login=true">Sign in</a></small>
        : <p className="pin-credits" role="status">{credits ? <>Credits: <strong>{credits.balance}</strong> · a place check costs {credits.pinLookupCost}</> : 'Loading credits…'}</p>}
      {signedIn && point && (stage === 'done' || savedOpen) && <div className="pin-save"><input type="text" value={name} maxLength={60} placeholder="Name this place to save it" onChange={(e) => setName(e.target.value)} aria-label="Place name"/><button type="button" disabled={!name.trim()} onClick={save}>Save place</button></div>}
      {message && <p role="alert" className="pin-message">{message}</p>}
      {signedIn && bookmarks.length > 0 && <div className="pin-saved"><strong>Saved places</strong><ul>{bookmarks.map((b) => <li key={b.bookmarkId}><button type="button" onClick={() => goTo(b)}>{b.name}</button><button type="button" onClick={() => remove(b.bookmarkId)} aria-label={`Remove ${b.name}`}>{'×'}</button></li>)}</ul></div>}
      {!drop && <button type="button" className="pin-save-close" onClick={() => setSavedOpen(false)}>Close</button>}
    </section>}
    {operational && !panelOpen && signedIn && bookmarks.length > 0 && <button type="button" className="map-news-button pin-saved-open" aria-label="Saved places" onClick={() => setSavedOpen(true)}>{'\u2605'} Saved ({bookmarks.length})</button>}
    {operational && cardOpen && result && <EnvironmentPopup pins={[result.pin]} attribution={result.attribution} onSelect={() => undefined} onClose={() => setCardOpen(false)} onDemand={live} onRefresh={refreshLive} refreshLabel={`Refresh telemetry (${cost} credit)`}/>}
  </div>;
}
