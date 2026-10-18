import { useState, type ReactNode } from 'react';
import type { ChatBlock } from '../../../src/types/domain.js';
import { apiRequest, ApiError } from '../api/client.js';

type PlacesBlock = Extract<ChatBlock, { type: 'places' }>;
type Place = PlacesBlock['places'][number];
const PAGE = 5;
const distText = (m: number): string => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
const phoneDigits = (p: string): string => p.replace(/[^+\d]/g, '');
const emit = (name: string, detail: unknown): void => { window.dispatchEvent(new CustomEvent(name, { detail })); };

/** A small person in a ring: the "see it at street level" mark (our own drawing; the 360 view itself is Google's). */
function StreetIcon(): ReactNode {
  return <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4"/><circle cx="8" cy="5" r="1.7" fill="currentColor"/><path d="M5.2 11.6 8 7.4l2.8 4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

const vcardText = (v: string): string => v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
/** Downloads a contact card (.vcf) made in the browser from what OpenStreetMap states; nothing is sent or stored. */
export function downloadContact(p: { name: string; phone: string | null; website: string | null; address: string | null; lat: number; lng: number }): void {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vcardText(p.name)}`, ...(p.phone ? [`TEL;TYPE=WORK:${phoneDigits(p.phone)}`] : []), ...(p.website && /^https?:\/\//.test(p.website) ? [`URL:${p.website}`] : []), ...(p.address ? [`NOTE:${vcardText(p.address)}`] : []), `GEO:${p.lat};${p.lng}`, 'END:VCARD'];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/vcard' }));
  const a = document.createElement('a'); a.href = url; a.download = `${p.name.replace(/[^\w-]+/g, '-').slice(0, 40) || 'contact'}.vcf`; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The places a reply found (AEG-NEARBY-001): five at first, "More" adds five. Each card: press to find it on the map (a small tag on the pin, no big window),
 * then Call, 360° view, Directions, Save and Add to contacts. Directions is a plain link to Google Maps (no API call); Save keeps only name and place.
 */
export function PlacesGroup({ block, token }: { block: PlacesBlock; token: string | null }): ReactNode {
  const [shown, setShown] = useState(PAGE);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const open = (p: Place): void => { emit('aegis-places', block); window.setTimeout(() => emit('aegis-places-select', { id: p.id }), 50); };
  const save = (p: Place): void => {
    if (!token) { setNote('Sign in to save a place.'); return; }
    apiRequest('/api/bookmarks', { token, method: 'POST', body: { name: p.name, lat: p.lat, lng: p.lng } })
      .then(() => { setSaved((s) => new Set(s).add(p.id)); setNote('Saved. Only the name and place are kept.'); })
      .catch((e: unknown) => setNote(e instanceof ApiError ? e.message : 'The place could not be saved.'));
  };
  const list = block.places.slice(0, shown);
  return <div className="chat-mini-group">
    <p className="chat-mini-note">{block.label} near {block.centreName}. Press one to find it on the map.</p>
    {list.map((p) => <div key={p.id} className="chat-place" data-testid="chat-place" onMouseEnter={() => emit('aegis-places-hover', { id: p.id })} onMouseLeave={() => emit('aegis-places-hover', { id: null })}>
      <button type="button" className="chat-place-main" aria-label={`Show ${p.name} on the map`} onClick={() => open(p)}>
        <strong>{p.name}</strong>
        <small>{[distText(p.distanceM), p.address].filter(Boolean).join(' · ')}</small>
        <small>{p.phone ?? 'no phone recorded'}</small>
      </button>
      <div className="chat-place-actions">
        {p.phone && <a className="chat-act" href={`tel:${phoneDigits(p.phone)}`} aria-label={`Call ${p.name}`} title="Call">{'\u260E'} Call</a>}
        <button type="button" className="chat-act" aria-label={`360 degree view outside ${p.name}`} title="360° view outside" onClick={() => emit('aegis-streetview', { id: p.id, name: p.name, lat: p.lat, lng: p.lng })}><StreetIcon/> 360°</button>
        <a className="chat-act" href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noreferrer noopener" aria-label={`Directions to ${p.name}`} title="Directions in Google Maps">{'\u2794'} Directions</a>
        <button type="button" className="chat-act" aria-pressed={saved.has(p.id)} aria-label={`Save ${p.name}`} title="Save this place" onClick={() => save(p)}>{saved.has(p.id) ? '\u2605 Saved' : '\u2606 Save'}</button>
        {p.phone && <button type="button" className="chat-act" aria-label={`Add ${p.name} to contacts`} title="Download a contact card" onClick={() => downloadContact(p)}>{'\uFF0B'} Contact</button>}
      </div>
    </div>)}
    {block.places.length > shown && <button type="button" className="chat-more" onClick={() => setShown((n) => n + PAGE)}>More ({Math.min(PAGE, block.places.length - shown)} more)</button>}
    {note && <small role="status">{note}</small>}
    <small>{block.credit}</small>
  </div>;
}
