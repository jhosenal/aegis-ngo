// Live public hazard feeds (AEG-LIVE-001): maps the USGS earthquake feed and the GDACS event list to the incident record the evidence intake takes.
// Pure mapping, no network. Everything here is read from the feed; nothing is inferred: an unknown location stays unknown (empty coordinates) and
// the affected estimate is null because neither feed states one.
//   USGS: earthquake.usgs.gov, M4.5+ past 7 days, "updated every minute"; public domain, credit USGS.
//   GDACS: www.gdacs.org event list; CC BY 4.0 as stated on its feed; indicative only, not for decision making without alternate sources.
import type { SourceDef } from './fixtureAdapter.js';
import type { RawIncidentRecord } from './normalize.js';

export const USGS_SOURCE_ID = 'SRC.USGS.LIVE';
export const GDACS_SOURCE_ID = 'SRC.GDACS.LIVE';

export const LIVE_SOURCES: SourceDef[] = [
  { sourceId: USGS_SOURCE_ID, title: 'USGS earthquake feed, M4.5 and above, past 7 days', licenceRef: 'LIC.USGS-PUBLIC-DOMAIN-CREDIT-USGS', validHours: 72, adapterVersion: 'live-1.0.0', synthetic: false },
  { sourceId: GDACS_SOURCE_ID, title: 'GDACS event list, past 14 days (indicative only)', licenceRef: 'LIC.GDACS-CC-BY-4.0-INDICATIVE-ONLY', validHours: 168, adapterVersion: 'live-1.0.0', synthetic: false },
];

export const USGS_FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';
export const GDACS_TYPES = ['EQ', 'TC', 'FL', 'VO', 'WF'] as const;
export const GDACS_PAGE_SIZE = 100;

export function gdacsUrl(type: string, fromDate: string, toDate: string, page: number): string {
  return `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=${type}&fromdate=${fromDate}&todate=${toDate}&alertlevel=Green;Orange;Red&pageNumber=${page}&pageSize=${GDACS_PAGE_SIZE}`;
}

const ASEAN_NAMES = new Set(['Indonesia', 'Philippines', 'Malaysia', 'Thailand', 'Myanmar', 'Burma', 'Burma (Myanmar)', 'Viet Nam', 'Vietnam', 'Cambodia', 'Laos',
  "Lao People's Democratic Republic", 'Lao PDR', 'Singapore', 'Brunei', 'Brunei Darussalam', 'Timor-Leste', 'Timor Leste', 'East Timor']);
const ASEAN_ISO3 = ['IDN', 'PHL', 'MYS', 'THA', 'MMR', 'VNM', 'KHM', 'LAO', 'SGP', 'BRN', 'TLS'];
const SEA_RE = /\b(Sea|Strait|Gulf|Bay|Trench|Passage)\b/i;
const NOT_ASEAN_SEA = /(Indian|Atlantic|Pacific|Arabian|Caribbean|Caspian|Mediterranean|Baltic|Black|Red|Tasman|Coral|Fiji|Bering|Okhotsk|Japan|Scotia|Weddell|Ross|Labrador|Greenland|Norwegian|Barents|Kara|Laptev|Beaufort|Chukchi)/i;
const IN_BOX = (lat: number, lon: number): boolean => lat >= -11.5 && lat <= 21.5 && lon >= 92 && lon <= 141.5;

// A tropical cyclone at sea has no country in GDACS, so a storm is also included by position: the sea approaches to ASEAN.
const TC_APPROACH = (lat: number, lon: number): boolean => lat >= -5 && lat <= 30 && lon >= 95 && lon <= 160;
export function cycloneWhere(lat: number, lon: number): string {
  if (lon < 99) return 'Bay of Bengal / Andaman Sea';
  if (lon <= 121 && lat <= 23) return 'South China Sea';
  if (lon <= 140) return 'Philippine Sea, near the Philippines';
  return 'Western North Pacific, east of the Philippines';
}

const toUtc = (text: string | null | undefined): string | null => {
  if (!text) return null;
  const t = /Z$|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const regionOf = (label: string): string => `REGION.${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'UNKNOWN'}`;
const coord = (value: number): string => value.toFixed(6);

function hav(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

interface UsgsFeature { id?: string; geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }

export function mapUsgs(feed: unknown): RawIncidentRecord[] {
  const features = (feed as { features?: UsgsFeature[] } | null)?.features;
  if (!Array.isArray(features)) throw new Error('USGS feed has no features array');
  const out: RawIncidentRecord[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (typeof f.id !== 'string' || p['type'] !== 'earthquake' || typeof p['mag'] !== 'number' || !Array.isArray(c) || c.length < 2) continue;
    const lon = Number(c[0]); const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const place = String(p['place'] ?? '');
    const tail = place.includes(',') ? place.split(',').pop()!.trim() : place.trim();
    const country = ASEAN_NAMES.has(tail);
    const sea = !country && SEA_RE.test(tail) && !NOT_ASEAN_SEA.test(tail) && IN_BOX(lat, lon);
    if (!country && !sea) continue;
    const eventTime = typeof p['time'] === 'number' ? new Date(p['time']).toISOString() : null;
    const publishedAt = typeof p['updated'] === 'number' ? new Date(p['updated']).toISOString() : eventTime;
    if (!eventTime || !publishedAt) continue;
    const alert = typeof p['alert'] === 'string' ? p['alert'].toUpperCase() : 'UNRATED';
    out.push({
      sourceRecordId: f.id, incidentKey: `USGS.${f.id}`, title: `M ${p['mag']} - ${place}`, hazardType: 'EARTHQUAKE', alertLevel: alert,
      eventTime, publishedAt, regionId: regionOf(tail), lat: coord(lat), lon: coord(lon), affectedPeopleEstimate: null,
      sourceUrl: typeof p['url'] === 'string' ? p['url'] : `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`,
    });
  }
  return out;
}

interface GdacsFeature { geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }
const GDACS_HAZARD: Record<string, string> = { EQ: 'EARTHQUAKE', TC: 'STORM', FL: 'FLOOD', VO: 'VOLCANO', WF: 'WILDFIRE' };

/**
 * `usgs` is the USGS records of the same run: a GDACS earthquake that matches one (within 20 minutes and 200 km) is the same event and is dropped,
 * so one earthquake is never counted twice.
 */
export function mapGdacs(features: unknown[], usgs: RawIncidentRecord[]): RawIncidentRecord[] {
  const out: RawIncidentRecord[] = [];
  const seen = new Set<string>();
  for (const raw of features) {
    const f = raw as GdacsFeature;
    const p = f.properties ?? {};
    const type = String(p['eventtype'] ?? '');
    const hazard = GDACS_HAZARD[type];
    const id = p['eventid'];
    if (!hazard || (typeof id !== 'number' && typeof id !== 'string')) continue;
    const countries = String(p['country'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const iso3 = String(p['iso3'] ?? '');
    const named = countries.some((c) => ASEAN_NAMES.has(c)) || ASEAN_ISO3.some((c) => iso3.includes(c));
    const gc = f.geometry?.coordinates;
    const gLon = Array.isArray(gc) ? Number(gc[0]) : NaN; const gLat = Array.isArray(gc) ? Number(gc[1]) : NaN;
    const tcAtSea = type === 'TC' && Number.isFinite(gLat) && Number.isFinite(gLon) && TC_APPROACH(gLat, gLon);
    if (!named && !tcAtSea) continue;
    const key = `${type}-${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const eventTime = toUtc(String(p['fromdate'] ?? ''));
    const publishedAt = toUtc(String(p['datemodified'] ?? '')) ?? eventTime;
    if (!eventTime || !publishedAt) continue;
    const c = f.geometry?.coordinates;
    let lat = ''; let lon = '';
    if (Array.isArray(c) && c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]))) { lon = coord(Number(c[0])); lat = coord(Number(c[1])); }
    if (type === 'EQ' && lat !== '') {
      const t0 = Date.parse(eventTime);
      const dup = usgs.some((u) => Math.abs(Date.parse(u.eventTime) - t0) <= 20 * 60_000 && hav(Number(lat), Number(lon), Number(u.lat), Number(u.lon)) <= 200);
      if (dup) continue;
    }
    const url = (p['url'] as { report?: string } | undefined)?.report ?? '';
    const name = String(p['name'] ?? p['eventname'] ?? hazard);
    // Cyclone card = name + where. The pin is GDACS's cyclone point (its latest track position), not an impact location.
    const where = type === 'TC' && lat !== '' ? cycloneWhere(Number(lat), Number(lon)) : '';
    out.push({
      sourceRecordId: key, incidentKey: `GDACS.${key}`, title: where ? `${name} - ${where} (GDACS TC ${id})` : `${name} (GDACS ${type} ${id})`, hazardType: hazard, alertLevel: String(p['alertlevel'] ?? 'UNRATED').toUpperCase(),
      eventTime, publishedAt, regionId: regionOf(countries[0] ?? (where || 'UNKNOWN')), lat, lon, affectedPeopleEstimate: null, sourceUrl: url || 'https://www.gdacs.org/',
    });
  }
  return out;
}
