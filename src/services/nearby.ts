// Incidents near a monitored place (AEG-NEARBY-001), for the Disaster tile of the place card. Current public incidents only (not stale, not superseded, not synthetic) with
// valid coordinates, counted by hazard within a stated radius. A count of zero means "none recorded by our live feeds", never "none"; the feeds cover only some hazards.
import type { Db } from '../data/db.js';
import { listEvidence } from '../data/repos/evidence.js';
import { toEvidenceViews } from '../sources/evidenceView.js';
import { domainOfHazard } from './hazardSummary.js';

export const NEARBY_RADIUS_KM = 100;
export type NearbyHazard = 'earthquake' | 'flood' | 'storm' | 'wildfire' | 'volcano' | 'other';
const BY_DOMAIN: Record<number, NearbyHazard> = { 1: 'earthquake', 2: 'flood', 3: 'storm', 4: 'wildfire', 7: 'volcano' };

export interface IncidentPoint { incidentKey: string; title: string; hazard: NearbyHazard; alertLevel: string; lat: number; lon: number; sourceId: string; eventTime: string | null }
export interface Nearby {
  radiusKm: number;
  total: number;
  counts: Record<NearbyHazard, number>;
  /** The nearest few, closest first. */
  items: { title: string; hazard: NearbyHazard; alertLevel: string; distanceKm: number; sourceId: string; eventTime: string | null }[];
  note: string;
}

const haversineKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const r = (d: number): number => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** One point per incident (the latest report), current only. */
export function currentIncidentPoints(db: Db, nowIso: string): IncidentPoint[] {
  const views = toEvidenceViews(listEvidence(db).filter((r) => r.tenantScope === null && !r.synthetic), null, nowIso)
    .filter((v) => !v.flags.includes('STALE') && !v.flags.includes('SUPERSEDED'));
  const latest = new Map<string, (typeof views)[number]>();
  for (const v of views) {
    const cur = latest.get(v.payload.incidentKey);
    if (!cur || (v.publishedAt ?? '') > (cur.publishedAt ?? '')) latest.set(v.payload.incidentKey, v);
  }
  const out: IncidentPoint[] = [];
  for (const v of latest.values()) {
    if (v.payload.latE6 === null || v.payload.lonE6 === null) continue;
    const domain = domainOfHazard(v.payload.hazardType);
    out.push({
      incidentKey: v.payload.incidentKey, title: v.payload.title, hazard: (domain !== null ? BY_DOMAIN[domain] : undefined) ?? 'other', alertLevel: v.payload.alertLevel,
      lat: v.payload.latE6 / 1_000_000, lon: v.payload.lonE6 / 1_000_000, sourceId: v.sourceId, eventTime: v.eventTime,
    });
  }
  return out;
}

export function nearbyFor(points: IncidentPoint[], place: { lat: number; lng: number }, radiusKm = NEARBY_RADIUS_KM): Nearby {
  const counts: Record<NearbyHazard, number> = { earthquake: 0, flood: 0, storm: 0, wildfire: 0, volcano: 0, other: 0 };
  const within = points.map((p) => ({ p, d: haversineKm({ lat: place.lat, lon: place.lng }, p) })).filter((x) => x.d <= radiusKm).sort((a, b) => a.d - b.d);
  for (const { p } of within) counts[p.hazard] += 1;
  return {
    radiusKm, total: within.length, counts,
    items: within.slice(0, 5).map(({ p, d }) => ({ title: p.title, hazard: p.hazard, alertLevel: p.alertLevel, distanceKm: Math.round(d), sourceId: p.sourceId, eventTime: p.eventTime })),
    note: `Current incidents within ${radiusKm} km recorded by our live feeds (USGS earthquakes, GDACS storms, floods, volcanoes and wildfire events). Zero means none recorded by those feeds, not that nothing is happening. A storm's point is its position, not an impact area.`,
  };
}
