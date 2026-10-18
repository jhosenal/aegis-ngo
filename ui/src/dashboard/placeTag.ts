import type { GoogleDetails, LookupResult } from './googlePlace.js';

/** The small info tag on a nearby-place pin (AEG-NEARBY-001, AEG-PLACES-001). Built from the engine's own record of the place (the stored OpenStreetMap copy, or the live fallback). When the person presses
 * the pin, Google's details (phone, address, hours, website) are fetched in the page and the tag is built again with them, credited to Google Maps. */
export interface TagPlace { id: string; name: string; lat: number; lng: number; distanceM?: number; phone?: string | null; address?: string | null; website?: string | null; operator?: string | null; osmUrl?: string | null }
/** What the tag knows about Google: nothing yet, a lookup in progress, or its outcome. */
export type GoogleState = { kind: 'idle' } | { kind: 'loading' } | LookupResult;

const phoneDigits = (p: string): string => p.replace(/[^+\d]/g, '');
const km = (m: number): string => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

export function buildPlaceTag(p: TagPlace, google: GoogleState = { kind: 'idle' }): HTMLElement {
  const g: GoogleDetails | null = google.kind === 'ok' ? google.details : null;
  const card = document.createElement('div'); card.className = 'nearby-tip';
  const add = (tag: string, text: string, cls?: string): HTMLElement => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; card.appendChild(e); return e; };
  add('strong', p.name);
  const meta = [p.distanceM === undefined ? '' : km(p.distanceM), p.operator ?? ''].filter(Boolean).join(' · ');
  if (meta) add('span', meta);
  const address = g?.address ?? p.address; const phone = g?.phone ?? p.phone; const website = g?.website ?? p.website;
  if (address) add('span', address);
  add('span', phone ? `Phone ${phone}` : 'No phone recorded');
  if (g?.hoursToday) add('span', g.hoursToday);
  if (g?.status) add('span', `Status: ${g.status.toLowerCase().replaceAll('_', ' ')}`, 'nearby-tip-warn');
  if (google.kind === 'loading') add('span', 'Checking Google Maps for details…', 'nearby-tip-note');
  if (google.kind === 'limit') add('span', google.note, 'nearby-tip-note');
  const row = document.createElement('div'); row.className = 'nearby-tip-actions';
  const stop = (e: Event): void => e.stopPropagation();
  const link = (href: string, label: string, aria: string): void => { const a = document.createElement('a'); a.href = href; a.textContent = label; a.setAttribute('aria-label', aria); a.target = href.startsWith('tel:') ? '_self' : '_blank'; a.rel = 'noreferrer noopener'; a.addEventListener('click', stop); row.appendChild(a); };
  const button = (label: string, aria: string, run: () => void): void => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', aria); b.addEventListener('click', (e) => { e.stopPropagation(); run(); }); row.appendChild(b); };
  const tel = g?.tel ?? (p.phone ? phoneDigits(p.phone) : null);
  if (tel) link(`tel:${tel}`, '☎ Call', `Call ${p.name}`);
  button('360°', `360 degree view outside ${p.name}`, () => window.dispatchEvent(new CustomEvent('aegis-streetview', { detail: { id: p.id, name: p.name, lat: p.lat, lng: p.lng } })));
  link(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`, '➔ Directions', `Directions to ${p.name}`);
  button('☆ Save', `Save ${p.name}`, () => window.dispatchEvent(new CustomEvent('aegis-place-action', { detail: { action: 'save', id: p.id } })));
  if (p.phone) button('＋ Contact', `Add ${p.name} to contacts`, () => window.dispatchEvent(new CustomEvent('aegis-place-action', { detail: { action: 'contact', id: p.id } })));   // from OpenStreetMap data only; Google's details are never exported
  if (website && /^https?:\/\//.test(website)) link(website, 'Website', `Website of ${p.name}`);
  card.appendChild(row);
  if (g?.mapsUri) { const src = document.createElement('a'); src.href = g.mapsUri; src.textContent = 'Details: Google Maps'; src.className = 'nearby-tip-src'; src.target = '_blank'; src.rel = 'noreferrer noopener'; src.addEventListener('click', stop); card.appendChild(src); }
  else if (g) add('span', 'Details: Google Maps', 'nearby-tip-src');
  if (p.osmUrl) { const src = document.createElement('a'); src.href = p.osmUrl; src.textContent = 'Location: OpenStreetMap'; src.className = 'nearby-tip-src'; src.target = '_blank'; src.rel = 'noreferrer noopener'; src.addEventListener('click', stop); card.appendChild(src); }
  return card;
}
