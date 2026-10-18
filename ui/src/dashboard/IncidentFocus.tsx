import { useEffect, useState } from 'react';

export interface FocusBlock { cardId: string; revision: number; lat: number; lng: number; hazard: string; title: string; alertLevel?: string | null; country?: string | null; eventTime?: string | null; why?: string }
const when = (iso?: string | null): string => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' MYT' : 'not recorded');

/**
 * "Show me the worst flood" (AEG-CHAT-002): when the chat asks to show an incident (window event 'aegis-map-focus'), the map zooms there smoothly
 * (the camera events of AEG-NEWS-006) and this small panel opens NEXT TO it with the facts; "Open full card" opens the whole card, Close zooms back out.
 */
export function IncidentFocus() {
  const [focus, setFocus] = useState<FocusBlock | null>(null);
  const root = (): Element | null => document.querySelector('.regional-map');
  useEffect(() => {
    const onFocus = (event: Event): void => {
      const d = (event as CustomEvent<FocusBlock>).detail;
      if (!d || !Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return;
      setFocus(d);
      root()?.dispatchEvent(new CustomEvent('aegis-camera', { detail: { bounds: { south: d.lat - 0.9, west: d.lng - 1.2, north: d.lat + 0.9, east: d.lng + 1.2 }, travelSec: 1.4 } }));
    };
    window.addEventListener('aegis-map-focus', onFocus);
    return () => window.removeEventListener('aegis-map-focus', onFocus);
  }, []);
  if (!focus) return null;
  const close = (): void => { setFocus(null); root()?.dispatchEvent(new CustomEvent('aegis-camera-reset', { detail: { travelSec: 1.4 } })); };
  return <section className="incident-focus" aria-label="Incident shown on the map" data-testid="incident-focus">
    <header><strong>{focus.title}</strong><button type="button" onClick={close} aria-label="Close and zoom out">{'×'}</button></header>
    <dl>
      <div><dt>Hazard</dt><dd>{focus.hazard.charAt(0) + focus.hazard.slice(1).toLowerCase()}</dd></div>
      <div><dt>Alert level</dt><dd>{focus.alertLevel ?? 'not recorded'}</dd></div>
      <div><dt>Country</dt><dd>{focus.country ?? 'not recorded'}</dd></div>
      <div><dt>When</dt><dd>{when(focus.eventTime)}</dd></div>
    </dl>
    {focus.why && <small>Chosen by: {focus.why}.</small>}
    <p><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('aegis-open-card', { detail: { cardId: focus.cardId, revision: focus.revision } }))}>Open full card</button></p>
  </section>;
}
