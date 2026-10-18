// "Where is the nearest hospital?" (AEG-NEARBY-001): finds essential services around a point. Code owns the search; the model only words the result.
// Source: OpenStreetMap via Overpass (free, ODbL). Polite by design: a result cache per place and category, one request at a time with a gap, a daily cap, and a clear
// "not available" instead of a guess when the service cannot answer. Names and coordinates may be kept (ODbL, with credit); phone and web are shown as OSM states them.
import type { Clock } from '../engine/clock.js';
import type { Db } from '../data/db.js';
import { countByCategory, locateByName, searchNear } from '../data/repos/essentialPlaces.js';
import { CATEGORIES, CATEGORY_LABEL, OSM_CREDIT, OVERPASS_HOSTS, overpassUrl, distanceMetres, overpassQuery, parseOverpass, type NearbyCategory, type NearbyPlace } from '../sources/overpass.js';
import { safeFetch, type FetchPolicy, type Resolver } from '../sources/safeFetch.js';
import { dnsResolver } from './liveIngest.js';

const POLICY: FetchPolicy = { allowlist: [...OVERPASS_HOSTS], maxBytes: 1_500_000, timeoutMs: 14_000, maxRedirects: 1 };
export interface NearbyArgs { category?: string; near?: string; radiusKm?: number }
export interface NearbyContext { view: { lat: number; lng: number } | null; named: { name: string; lat: number; lng: number }[] }
export interface NearbyResult {
  found: boolean; available: boolean; reason: string | null;
  category?: NearbyCategory; label?: string; centre?: { lat: number; lng: number }; centreName?: string; radiusM?: number; places?: NearbyPlace[]; credit?: string; advice?: string;
}
export type NearbyFinder = (args: NearbyArgs, ctx: NearbyContext) => Promise<NearbyResult>;

const ADVICE = 'Opening hours and phone numbers come from OpenStreetMap volunteers and may be out of date: call first if you can. In an emergency call your local emergency number before travelling.';
const SYNONYMS: Record<string, NearbyCategory> = {
  hospital: 'hospital', hospitals: 'hospital', 'emergency room': 'hospital', er: 'hospital', clinic: 'clinic', clinics: 'clinic', doctor: 'clinic', doctors: 'clinic', 'medical centre': 'clinic', pharmacy: 'pharmacy', pharmacies: 'pharmacy', chemist: 'pharmacy', drugstore: 'pharmacy',
  police: 'police', 'police station': 'police', fire_station: 'fire_station', 'fire station': 'fire_station', firefighters: 'fire_station', 'disaster centre': 'disaster_centre', 'disaster center': 'disaster_centre', disaster_centre: 'disaster_centre', 'disaster office': 'disaster_centre', nadma: 'disaster_centre', 'civil defence': 'disaster_centre',
  shelter: 'shelter', shelters: 'shelter', 'evacuation centre': 'shelter', 'evacuation center': 'shelter', 'assembly point': 'shelter',
};
export const normalizeCategory = (word: string | undefined): NearbyCategory | null => {
  if (!word) return null;
  const w = word.trim().toLowerCase().replaceAll('-', ' ');
  return SYNONYMS[w] ?? ((CATEGORIES as readonly string[]).includes(w) ? (w as NearbyCategory) : null);
};

/** The centre of the search: a named pin or place the person gave, else the map view, else nothing (the caller then asks where). */
export function resolveCentre(near: string | undefined, ctx: NearbyContext): { lat: number; lng: number; name: string } | null {
  const text = (near ?? '').trim().toLowerCase();
  if (text && !['here', 'me', 'my location', 'current', 'this area', 'the map'].includes(text)) {
    const words = text.split(/\s+/);
    const hit = ctx.named.filter((p) => { const n = p.name.toLowerCase(); return n.includes(text) || text.includes(n) || words.every((w) => n.includes(w)); }).sort((a, b) => a.name.length - b.name.length)[0];
    if (hit) return { lat: hit.lat, lng: hit.lng, name: hit.name };
  }
  return ctx.view ? { lat: ctx.view.lat, lng: ctx.view.lng, name: text && !['here', 'me', 'my location', 'current'].includes(text) ? 'the centre of the map (that place was not found)' : 'the centre of the map' } : null;
}

export interface NearbyOptions { /** The database that holds the stored copy of essential places; a category with stored rows is answered from it, instantly and offline. */ db?: Db; clock: Clock; fetchImpl?: typeof fetch; resolver?: Resolver; dailyMax?: number; minGapMs?: number; cacheMinutes?: number }
export function createNearbyFinder(o: NearbyOptions): NearbyFinder {
  const cache = new Map<string, { at: number; places: NearbyPlace[]; radiusM: number }>();
  let day = ''; let today = 0; let last = 0; let chain: Promise<unknown> = Promise.resolve();
  const dailyMax = o.dailyMax ?? 300; const gap = o.minGapMs ?? 1500; const ttl = (o.cacheMinutes ?? 10) * 60_000;
  let preferred = 0;   // index of the mirror that answered last
  const call = async (query: string): Promise<unknown> => {
    let lastError = 'no server answered';
    for (let n = 0; n < OVERPASS_HOSTS.length; n += 1) {
      const index = (preferred + n) % OVERPASS_HOSTS.length;
      try {
        const res = await safeFetch(overpassUrl(OVERPASS_HOSTS[index]!), POLICY, { resolver: o.resolver ?? dnsResolver, fetchImpl: ((url: URL | string, init?: RequestInit) => (o.fetchImpl ?? fetch)(url, { ...init, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'AEGIS-pilot/0.1 (disaster information; contact via the notice page)' }, body: `data=${encodeURIComponent(query)}` })) as typeof fetch });
        if (res.status !== 200) { lastError = `HTTP ${res.status}`; continue; }
        const json = JSON.parse(res.text) as unknown;
        if (!Array.isArray((json as { elements?: unknown })?.elements)) { lastError = 'unexpected reply'; continue; }
        preferred = index;
        return json;
      } catch (error) { lastError = error instanceof Error ? error.message : 'error'; }
    }
    throw new Error(lastError);
  };
  const localCounts = (): Record<string, number> => (o.db ? countByCategory(o.db) : {});
  return async (args, rawCtx) => {
    // A named area that is not a pin ('Jinjang') is located from the stored places that mention it.
    const asked = (args.near ?? '').trim();
    const area = o.db && asked && !['here', 'me', 'my location', 'current', 'this area', 'the map'].includes(asked.toLowerCase()) ? locateByName(o.db, asked) : null;
    const ctx: NearbyContext = area && !rawCtx.named.some((p) => p.name.toLowerCase().includes(asked.toLowerCase())) ? { ...rawCtx, named: [{ name: asked, lat: area.lat, lng: area.lng }, ...rawCtx.named] } : rawCtx;
    const category = normalizeCategory(args.category);
    if (!category) return { found: false, available: true, reason: `Choose one of: ${CATEGORIES.map((c) => CATEGORY_LABEL[c].toLowerCase()).join(', ')}.` };
    const centre = resolveCentre(args.near, ctx);
    if (!centre) return { found: false, available: true, reason: 'I need a place to search around: name a place on the map or move the map to the area first.' };
    const radiusKm = Math.min(20, Math.max(1, Number.isFinite(args.radiusKm) ? Number(args.radiusKm) : 5));
    const radii = [radiusKm * 1000, ...(radiusKm < 15 ? [15000] : [])];
    const key = `${category}|${centre.lat.toFixed(2)}|${centre.lng.toFixed(2)}`;
    const now = Date.parse(o.clock.now());
    const hit = cache.get(key);
    const baseEarly = { category, label: CATEGORY_LABEL[category], centre: { lat: centre.lat, lng: centre.lng }, centreName: centre.name, credit: OSM_CREDIT, advice: ADVICE };
    // The stored copy answers first: it does not depend on the busy public servers. The search widens like the live one (the radius asked, then 15 km, then 40 km).
    if (o.db && (localCounts()[category] ?? 0) > 0) {
      for (const km of [radiusKm, 15, 40].filter((v, i, a) => v >= radiusKm && a.indexOf(v) === i)) {
        const places = searchNear(o.db, category, centre.lat, centre.lng, km * 1000, 10);
        if (places.length > 0) return { found: true, available: true, reason: null, ...baseEarly, radiusM: km * 1000, places };   // nothing stored near here? the copy may be incomplete: fall through to the live search before saying none
      }
    }
    const base = { category, label: CATEGORY_LABEL[category], centre: { lat: centre.lat, lng: centre.lng }, centreName: centre.name, credit: OSM_CREDIT, advice: ADVICE };
    if (hit && now - hit.at < ttl) return { found: hit.places.length > 0, available: true, reason: hit.places.length ? null : `No ${CATEGORY_LABEL[category].toLowerCase()} are recorded within ${Math.round(hit.radiusM / 1000)} km in OpenStreetMap.`, ...base, radiusM: hit.radiusM, places: hit.places.map((p) => ({ ...p, distanceM: Math.round(distanceMetres(centre.lat, centre.lng, p.lat, p.lng)) })) };
    const d = o.clock.now().slice(0, 10);
    if (d !== day) { day = d; today = 0; }
    if (today >= dailyMax) return { found: false, available: false, reason: 'The nearby search has reached its daily limit; it works again tomorrow. In an emergency call your local emergency number.' };
    const run = chain.then(async (): Promise<NearbyResult> => {
      const wait = gap - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      today += 1;
      for (const radiusM of radii) {
        last = Date.now();
        const places = parseOverpass(await call(overpassQuery(category, centre.lat, centre.lng, radiusM)), centre, 10);
        if (places.length > 0 || radiusM === radii[radii.length - 1]) {
          cache.set(key, { at: now, places, radiusM });
          return { found: places.length > 0, available: true, reason: places.length ? null : `No ${CATEGORY_LABEL[category].toLowerCase()} are recorded within ${Math.round(radiusM / 1000)} km in OpenStreetMap.`, ...base, radiusM, places };
        }
      }
      return { found: false, available: true, reason: 'No result.', ...base };
    });
    chain = run.catch(() => undefined);
    try { return await run; } catch (error) {
      return { found: false, available: false, reason: `The nearby search service is not answering right now (${(error instanceof Error ? error.message : 'error').slice(0, 60)}). In an emergency call your local emergency number.` };
    }
  };
}
