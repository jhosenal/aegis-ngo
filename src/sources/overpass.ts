// Nearby essential services from OpenStreetMap through the Overpass API (AEG-NEARBY-001): hospitals, clinics, pharmacies, police, fire stations, disaster centres, shelters.
// Free, no key. Data is OpenStreetMap, licence ODbL: credit "(c) OpenStreetMap contributors" wherever it is shown. The public Overpass server has a fair-use policy,
// so the service in front of this adapter caches, spaces and caps the calls. OSM can be wrong or out of date: the answer says to check before travelling.
// Public Overpass servers are often at capacity (HTTP 502/504), so the finder tries these in order and remembers the one that answered.
export const OVERPASS_HOSTS = ['overpass-api.de', 'overpass.private.coffee', 'overpass.kumi.systems'] as const;
export const overpassUrl = (host: string): string => `https://${host}/api/interpreter`;
export const OSM_CREDIT = '© OpenStreetMap contributors (ODbL)';

export const CATEGORIES = ['hospital', 'clinic', 'pharmacy', 'police', 'fire_station', 'disaster_centre', 'shelter'] as const;
export type NearbyCategory = typeof CATEGORIES[number];
export const CATEGORY_LABEL: Record<NearbyCategory, string> = { hospital: 'Hospitals', clinic: 'Clinics and doctors', pharmacy: 'Pharmacies', police: 'Police stations', fire_station: 'Fire stations', disaster_centre: 'Disaster management offices', shelter: 'Shelters and assembly points' };

// Overpass QL filters for one category. The disaster-centre filter matches government offices whose NAME says disaster, civil defence or emergency (English and Malay), since OSM has no single tag for them.
const FILTERS: Record<NearbyCategory, string[]> = {
  hospital: ['["amenity"="hospital"]'],
  clinic: ['["amenity"="clinic"]', '["amenity"="doctors"]', '["healthcare"="clinic"]'],
  pharmacy: ['["amenity"="pharmacy"]', '["healthcare"="pharmacy"]'],
  police: ['["amenity"="police"]'],
  fire_station: ['["amenity"="fire_station"]'],
  disaster_centre: ['["office"="government"]["name"~"disaster|bencana|NADMA|civil defence|pertahanan awam|emergency|APM|BNPB|BPBD",i]', '["emergency"="disaster_response"]', '["amenity"="civil_defence"]'],
  shelter: ['["emergency"="assembly_point"]', '["amenity"="shelter"]["shelter_type"~"public_transport|basic_hut|weather_shelter",i]', '["social_facility"="shelter"]', '["amenity"="community_centre"]'],
};

/** All places of one category in a bounding box (south, west, north, east), for the stored copy. */
export function overpassBoxQuery(category: NearbyCategory, south: number, west: number, north: number, east: number, timeoutS = 120): string {
  const box = `(${south},${west},${north},${east})`;
  const parts = FILTERS[category].flatMap((f) => [`node${f}${box};`, `way${f}${box};`]);
  return `[out:json][timeout:${timeoutS}];(${parts.join('')});out center tags;`;
}

export function overpassQuery(category: NearbyCategory, lat: number, lng: number, radiusM: number, limit = 40): string {
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(5)},${lng.toFixed(5)})`;
  const parts = FILTERS[category].flatMap((f) => [`node${f}${around};`, `way${f}${around};`]);
  return `[out:json][timeout:15];(${parts.join('')});out center tags ${limit};`;
}

export interface NearbyPlace { id: string; name: string; lat: number; lng: number; distanceM: number; phone: string | null; website: string | null; address: string | null; operator: string | null; osmUrl: string }
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function distanceMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000; const rad = Math.PI / 180;
  const dLa = (bLat - aLat) * rad; const dLo = (bLng - aLng) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type RawPlace = Omit<NearbyPlace, 'distanceM'>;
/** Named places of a reply, without distances (used for the stored copy). Throws on a reply without an elements array. */
export function parseAll(json: unknown): RawPlace[] {
  return parseOverpass(json, { lat: 0, lng: 0 }, Number.MAX_SAFE_INTEGER).map(({ distanceM: _d, ...rest }) => rest);
}

/** Parses an Overpass reply into places sorted by distance from the centre. Throws on a reply without an elements array. */
export function parseOverpass(json: unknown, centre: { lat: number; lng: number }, max = 8): NearbyPlace[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) throw new Error('overpass: no elements array');
  const seen = new Set<string>();
  const out: NearbyPlace[] = [];
  for (const el of elements as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }[]) {
    const tags = el.tags ?? {};
    const lat = num(el.lat) ?? num(el.center?.lat); const lng = num(el.lon) ?? num(el.center?.lon);
    if (lat === null || lng === null || typeof el.id !== 'number') continue;
    const name = (tags['name:en'] ?? tags['name'] ?? tags['operator'] ?? '').trim();
    if (!name) continue;   // an unnamed building is not useful to someone in an emergency
    const key = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue; seen.add(key);
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'] ?? tags['addr:suburb']].filter(Boolean).join(' ') || null;
    out.push({ id: `${el.type ?? 'node'}/${el.id}`, name, lat, lng, distanceM: Math.round(distanceMetres(centre.lat, centre.lng, lat, lng)), phone: tags['phone'] ?? tags['contact:phone'] ?? null, website: tags['website'] ?? tags['contact:website'] ?? null, address, operator: tags['operator'] ?? null, osmUrl: `https://www.openstreetmap.org/${el.type ?? 'node'}/${el.id}` });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, max);
}
