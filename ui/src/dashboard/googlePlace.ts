/**
 * Google place details for a pressed nearby place (AEG-PLACES-001). Runs in the page with the Maps key (Maps JavaScript places library): nothing passes through our server except
 * the daily-allowance check, and nothing is stored (not even the Place ID). Details are kept in memory for at most one hour so a repeated press does not pay twice, then dropped.
 * Shown on the pin's info tag on the Google map with Google's attribution; never put into the chat or given to the assistant model.
 */
export interface GoogleDetails { id: string; name: string; address: string | null; phone: string | null; tel: string | null; website: string | null; hoursToday: string | null; status: string | null; mapsUri: string | null }
export type LookupResult = { kind: 'ok'; details: GoogleDetails } | { kind: 'none' } | { kind: 'limit'; note: string } | { kind: 'error' };

import { pickNearest, todayLine } from './placeMatch.js';
export { MATCH_RADIUS_M, distanceM, pickNearest, todayLine } from './placeMatch.js';
const TTL_MS = 60 * 60 * 1000;
const FIELDS = ['id', 'displayName', 'formattedAddress', 'nationalPhoneNumber', 'internationalPhoneNumber', 'regularOpeningHours', 'websiteURI', 'googleMapsURI', 'businessStatus', 'location'];

const cache = new Map<string, { at: number; result: LookupResult }>();
const key = (p: { lat: number; lng: number; name: string }): string => `${p.name.toLowerCase()}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
/** Drops everything held (the pins were cleared). */
export function clearGooglePlaceCache(): void { cache.clear(); }

export async function lookupGooglePlace(p: { name: string; lat: number; lng: number }): Promise<LookupResult> {
  const k = key(p); const held = cache.get(k);
  if (held && Date.now() - held.at < TTL_MS) return held.result;
  const maps = (window as Window & { google?: typeof google }).google?.maps;
  if (!maps) return { kind: 'error' };
  let result: LookupResult;
  try {
    const res = await fetch('/public/places/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await res.json() as { allowed?: boolean; note?: string | null };
    if (!body.allowed) return { kind: 'limit', note: body.note ?? 'Google place details are not available right now.' };   // not cached: the allowance may return
    const { Place } = await maps.importLibrary('places') as google.maps.PlacesLibrary;
    const { places } = await Place.searchByText({ textQuery: p.name, fields: FIELDS, locationBias: { center: { lat: p.lat, lng: p.lng }, radius: 1000 }, maxResultCount: 5 });
    const found = pickNearest(places.flatMap((pl) => (pl.location ? [{ pl, lat: pl.location.lat(), lng: pl.location.lng() }] : [])), p);
    if (!found) result = { kind: 'none' };
    else {
      const pl = found.pl;
      result = { kind: 'ok', details: { id: pl.id, name: pl.displayName ?? p.name, address: pl.formattedAddress ?? null, phone: pl.nationalPhoneNumber ?? pl.internationalPhoneNumber ?? null,
        tel: (pl.internationalPhoneNumber ?? pl.nationalPhoneNumber ?? '').replace(/[^+\d]/g, '') || null, website: pl.websiteURI ?? null, hoursToday: todayLine(pl.regularOpeningHours?.weekdayDescriptions),
        status: pl.businessStatus && pl.businessStatus !== 'OPERATIONAL' ? String(pl.businessStatus) : null, mapsUri: pl.googleMapsURI ?? null } };
    }
  } catch { return { kind: 'error' }; }
  cache.set(k, { at: Date.now(), result });
  return result;
}
