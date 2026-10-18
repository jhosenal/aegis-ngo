import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '../api/client.js';
import { downloadContact } from '../components/PlaceCards.js';

export interface PlacesBlock { category: string; label: string; centre: { lat: number; lng: number }; centreName: string; radiusM: number; credit: string; advice: string; places: { id: string; name: string; lat: number; lng: number; distanceM: number; phone: string | null; website: string | null; address: string | null; osmUrl: string }[] }
export const CATEGORY_COLOR: Record<string, string> = { hospital: '#d32f2f', clinic: '#e8801a', pharmacy: '#2e9e5b', police: '#3b82c4', fire_station: '#b91c1c', disaster_centre: '#7c3aed', shelter: '#0891b2' };

/**
 * "Where is the nearest hospital?" (AEG-NEARBY-001): the chat's answer is drawn on the map as pins (events 'aegis-places-markers', 'aegis-places-select').
 * The list and the actions live on the chat cards, so the map stays clean: only the pins, a small tag on the pressed pin and this one-line chip to clear them.
 * Data is OpenStreetMap (credit on the cards). Pressing a card zooms to its pin.
 */
export function NearbyPlaces() {
  const [block, setBlock] = useState<PlacesBlock | null>(null);
  const [said, setSaid] = useState('');
  const current = useRef<PlacesBlock | null>(null);   // the block the map shows, read by the event handlers
  const root = (): Element | null => document.querySelector('.regional-map');
  useEffect(() => {
    const onPlaces = (event: Event): void => {
      const d = (event as CustomEvent<PlacesBlock>).detail;
      if (!d?.places?.length) return;
      // Pressing a card of the list already on the map must only zoom to that pin, not redraw and re-fit the whole set first.
      const same = current.current && current.current.category === d.category && current.current.centre.lat === d.centre.lat && current.current.centre.lng === d.centre.lng && current.current.places.map((x) => x.id).join() === d.places.map((x) => x.id).join();
      if (same) return;
      setBlock(d); current.current = d;
      const lats = [d.centre.lat, ...d.places.map((p) => p.lat)]; const lngs = [d.centre.lng, ...d.places.map((p) => p.lng)];
      const pad = 0.004;
      root()?.dispatchEvent(new CustomEvent('aegis-places-markers', { detail: { color: CATEGORY_COLOR[d.category] ?? '#d32f2f', centre: d.centre, places: d.places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, distanceM: p.distanceM, phone: p.phone, address: p.address, website: p.website, osmUrl: p.osmUrl })) } }));
      root()?.dispatchEvent(new CustomEvent('aegis-camera', { detail: { bounds: { south: Math.min(...lats) - pad, west: Math.min(...lngs) - pad, north: Math.max(...lats) + pad, east: Math.max(...lngs) + pad }, travelSec: 1.4 } }));
    };
    const onSelect = (event: Event): void => {
      const id = (event as CustomEvent<{ id: string | null }>).detail?.id;
      if (!id) return;
      const p = current.current?.places.find((x) => x.id === id);
      if (p) root()?.dispatchEvent(new CustomEvent('aegis-camera', { detail: { point: { lat: p.lat, lng: p.lng }, zoom: 19, travelSec: 1.2 } }));   // the pressed place at the closest zoom the map allows
    };
    // Save and Contact, pressed on the pin's tag.
    const onAction = (event: Event): void => {
      const d = (event as CustomEvent<{ action: 'save' | 'contact'; id: string }>).detail;
      const p = current.current?.places.find((x) => x.id === d?.id);
      if (!p) return;
      if (d.action === 'contact') { downloadContact(p); setSaid(`Contact card for ${p.name} downloaded.`); return; }
      let token: string | null = null; try { token = sessionStorage.getItem('aegis.session'); } catch { token = null; }
      if (!token) { setSaid('Sign in to save a place.'); return; }
      apiRequest('/api/bookmarks', { token, method: 'POST', body: { name: p.name, lat: p.lat, lng: p.lng } }).then(() => setSaid(`Saved ${p.name}.`)).catch((e: unknown) => setSaid(e instanceof ApiError ? e.message : 'The place could not be saved.'));
    };
    window.addEventListener('aegis-places', onPlaces); window.addEventListener('aegis-places-select', onSelect); window.addEventListener('aegis-place-action', onAction);
    return () => { window.removeEventListener('aegis-places', onPlaces); window.removeEventListener('aegis-places-select', onSelect); window.removeEventListener('aegis-place-action', onAction); };
  }, []);
  if (!block) return null;
  const close = (): void => {
    window.dispatchEvent(new CustomEvent('aegis-places-hover', { detail: { id: null } })); window.dispatchEvent(new CustomEvent('aegis-places-select', { detail: { id: null } }));
    setBlock(null); current.current = null; setSaid(''); root()?.dispatchEvent(new CustomEvent('aegis-places-markers', { detail: null })); root()?.dispatchEvent(new CustomEvent('aegis-camera-reset', { detail: { travelSec: 1.4 } }));
  };
  return <div className="nearby-chip" data-testid="nearby-panel" role="status">
    <span>{block.label} · {block.places.length} on the map{said ? ` · ${said}` : ''}</span>
    <button type="button" onClick={close} aria-label="Clear nearby places and zoom out">{'×'}</button>
  </div>;
}
