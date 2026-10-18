import { useEffect, useRef, useState } from 'react';

interface Target { id: string; name: string; lat: number; lng: number }
type State = { kind: 'idle' } | { kind: 'loading'; target: Target } | { kind: 'ready'; target: Target } | { kind: 'none'; target: Target; text: string } | { kind: 'limit'; target: Target; text: string };

const SEARCH_RADIUS_M = 60;
const SESSION_CAP = 15;   // per browser tab; the site-wide daily allowance is enforced by the server
const bearing = (from: { lat: number; lng: number }, to: { lat: number; lng: number }): number => {
  const rad = Math.PI / 180; const dLng = (to.lng - from.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(to.lat * rad); const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
};
const used = (): number => { try { return Number(sessionStorage.getItem('aegis.streetview') ?? '0') || 0; } catch { return 0; } };
const countUse = (): void => { try { sessionStorage.setItem('aegis.streetview', String(used() + 1)); } catch { /* storage may be blocked */ } };
const emit = (name: string, detail?: unknown): void => { window.dispatchEvent(new CustomEvent(name, { detail })); };

/**
 * "See outside" (AEG-STREETVIEW-001): the 360 button on a place turns the map itself into Google's street-level view, facing the place, at ONE fixed spot.
 * Walking is switched off in the map (no click-to-go, no arrows, no keyboard steps) because every new spot is another charged panorama; looking around and zooming the picture are free to use.
 * Google charges for each panorama that loads, so it only loads on a press, after the site's daily allowance says yes and a coverage check finds imagery within 60 m.
 * No imagery is stored or copied; Google's own viewer carries its attribution. Without imagery the map zooms in on the place instead. This bar is only the title and the way back.
 */
export function StreetViewPanel() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const token = useRef(0);
  const root = (): Element | null => document.querySelector('.regional-map');
  const zoomIn = (t: Target): void => { root()?.dispatchEvent(new CustomEvent('aegis-camera', { detail: { point: { lat: t.lat, lng: t.lng }, zoom: 19, travelSec: 1 } })); };

  useEffect(() => {
    const open = async (event: Event): Promise<void> => {
      const target = (event as CustomEvent<Target>).detail;
      if (!target) return;
      const mine = ++token.current;
      emit('aegis-streetview-hide');
      const maps = (window as Window & { google?: typeof google }).google?.maps;
      if (!maps) { setState({ kind: 'none', target, text: 'The Google map is not loaded, so there is no 360° view.' }); return; }
      if (used() >= SESSION_CAP) { setState({ kind: 'limit', target, text: 'You have used the 360° views for this visit. The map still zooms to the place.' }); zoomIn(target); return; }
      setState({ kind: 'loading', target });
      try {
        const res = await fetch('/public/streetview/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const body = await res.json() as { allowed?: boolean; note?: string | null };
        if (mine !== token.current) return;
        if (!body.allowed) { setState({ kind: 'limit', target, text: body.note ?? 'The 360° view is not available right now.' }); zoomIn(target); return; }
        await maps.importLibrary('streetView');
        const found = await new maps.StreetViewService().getPanorama({ location: { lat: target.lat, lng: target.lng }, radius: SEARCH_RADIUS_M, preference: maps.StreetViewPreference.NEAREST, source: maps.StreetViewSource.OUTDOOR }).catch(() => null);
        if (mine !== token.current) return;
        const at = found?.data.location?.latLng; const pano = found?.data.location?.pano;
        if (!found || !at || !pano) { setState({ kind: 'none', target, text: `No street imagery within ${SEARCH_RADIUS_M} m of ${target.name}.` }); zoomIn(target); return; }
        countUse();
        setState({ kind: 'ready', target });
        emit('aegis-streetview-show', { pano, heading: bearing({ lat: at.lat(), lng: at.lng() }, target), name: target.name });
      } catch {
        if (mine === token.current) { setState({ kind: 'none', target, text: 'The 360° view could not be loaded.' }); zoomIn(target); }
      }
    };
    const handler = (event: Event): void => { void open(event); };
    const closed = (): void => { token.current++; setState({ kind: 'idle' }); };
    window.addEventListener('aegis-streetview', handler); window.addEventListener('aegis-streetview-closed', closed);
    return () => { window.removeEventListener('aegis-streetview', handler); window.removeEventListener('aegis-streetview-closed', closed); };
  }, []);

  if (state.kind === 'idle') return null;
  const close = (): void => { token.current++; emit('aegis-streetview-hide'); setState({ kind: 'idle' }); };
  return <div className="streetview-bar" data-testid="streetview-panel" role="status" aria-label={`360° view of ${state.target.name}`}>
    {state.kind === 'loading' && <span>Opening the 360° view of {state.target.name}…</span>}
    {state.kind === 'ready' && <span><strong>360° · {state.target.name}</strong> · drag to look around · one fixed spot · imagery: Google, may be out of date</span>}
    {(state.kind === 'none' || state.kind === 'limit') && <span>{state.text}</span>}
    <button type="button" onClick={close}>{state.kind === 'ready' ? 'Back to map' : '×'}</button>
  </div>;
}
