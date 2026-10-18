// Public per-domain summary for the landing page (AEG-HOME-001): for each of the seven hazard domains, how many incidents are active now and the
// biggest few, in the same field format as an incident card, plus a short reference list of notable past incidents.
// Active = the latest revision of a report that has not gone stale; reports of one incidentKey (several feeds) count once.
// Only public evidence (tenant_scope IS NULL) is used, so this is safe for an unauthenticated page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseCatalogue, type Catalogue } from '../domains/catalogue.js';
import type { CardField, EvidenceView } from '../types/domain.js';

const HAZARD_TO_DOMAIN: Record<string, number> = {
  EARTHQUAKE: 1, QUAKE: 1, SEISMIC: 1,
  FLOOD: 2, FLASH_FLOOD: 2,
  STORM: 3, CYCLONE: 3, TYPHOON: 3, HURRICANE: 3,
  WILDFIRE: 4, FIRE: 4, HAZE: 4, SMOKE: 4, PEAT_FIRE: 4,
  OUTBREAK: 5, DISEASE: 5, EPIDEMIC: 5, BIOLOGICAL: 5,
  DISPLACEMENT: 6, REFUGEE: 6,
  VOLCANO: 7, VOLCANIC: 7, ERUPTION: 7,
};
const ALERT_RANK: Record<string, number> = { RED: 3, ORANGE: 2, YELLOW: 1, GREEN: 0 };

export function domainOfHazard(hazardType: string): number | null {
  return HAZARD_TO_DOMAIN[hazardType.trim().toUpperCase().replace(/[\s-]+/g, '_')] ?? null;
}

const NullableString = z.string().nullable();
const ProvenanceSchema = z.object({
  sourceId: NullableString, sourceName: NullableString, publisher: NullableString,
  licence: z.object({ status: z.string(), text: z.string(), attribution: NullableString }).strict(),
  sourcePage: NullableString, apiUrl: NullableString, sourceRecordId: NullableString,
  publishedAt: NullableString, sourceUpdatedAt: NullableString, retrievedAt: NullableString,
  rawFile: NullableString, rawSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  adapterVersion: z.string(), method: z.string(), notes: z.string().optional(),
}).strict();

const FeaturedIncidentSchema = z.object({
  id: z.string().regex(/^BF-[1-7]-\d{2}$/),
  domain: z.number().int().min(1).max(7),
  status: z.enum(['SOURCED', 'UNSOURCED']),
  hazardType: z.string().min(2),
  title: z.string().min(3).max(160),
  eventStart: z.string().regex(/^\d{4}(-\d{2}(-\d{2}(T[0-9:.]+Z)?)?)?$/),
  eventEnd: NullableString,
  place: NullableString,
  countries: z.array(z.string()),
  alertLevel: z.object({ value: NullableString, scale: NullableString, note: z.string() }).strict(),
  location: z.object({ latE6: z.number().int().nullable(), lonE6: z.number().int().nullable(), basis: z.string(), depthKm: z.number().nullable() }).strict(),
  affectedPeopleEstimate: z.number().int().nullable(),
  measurements: z.array(z.object({ key: z.string(), label: z.string(), value: z.number(), unit: NullableString }).strict()),
  provenance: ProvenanceSchema,
  tags: z.array(z.string().regex(/^[a-z]+:[A-Za-z0-9.\-]+$/)).min(3),
}).strict().superRefine((v, ctx) => {
  // A SOURCED card must carry every provenance tag; an UNSOURCED card must carry none of the source facts.
  const p = v.provenance;
  if (v.status === 'SOURCED') {
    for (const key of ['sourceId', 'sourceName', 'sourcePage', 'apiUrl', 'retrievedAt', 'rawFile', 'rawSha256'] as const) {
      if (p[key] === null) ctx.addIssue({ code: 'custom', message: `SOURCED card ${v.id} lacks provenance.${key}` });
    }
    if (p.licence.attribution === null) ctx.addIssue({ code: 'custom', message: `SOURCED card ${v.id} lacks an attribution` });
  } else if (p.sourceId !== null || p.rawSha256 !== null || v.measurements.length > 0 || v.affectedPeopleEstimate !== null) {
    ctx.addIssue({ code: 'custom', message: `UNSOURCED card ${v.id} must not carry source facts or figures` });
  }
});
export type FeaturedIncident = z.infer<typeof FeaturedIncidentSchema>;

const FeaturedSchema = z.object({
  version: z.string(),
  builtAt: z.string(),
  adapterVersion: z.string(),
  remark: z.string().min(20),
  incidents: z.array(FeaturedIncidentSchema).min(1),
}).strict().superRefine((v, ctx) => {
  const ids = new Set<string>();
  for (const i of v.incidents) { if (ids.has(i.id)) ctx.addIssue({ code: 'custom', message: `duplicate ${i.id}` }); ids.add(i.id); }
});
export type Featured = z.infer<typeof FeaturedSchema>;

const catalogueFile = fileURLToPath(new URL('../../content/domains/catalogue.json', import.meta.url));
const featuredFile = fileURLToPath(new URL('../../content/domains/featured-incidents.json', import.meta.url));
export const loadCatalogue = (file = catalogueFile): Catalogue => parseCatalogue(JSON.parse(readFileSync(file, 'utf8')));
export const loadFeatured = (file = featuredFile): Featured => FeaturedSchema.parse(JSON.parse(readFileSync(file, 'utf8')));

export interface IncidentLite {
  evidenceId: string;
  incidentKey: string;
  title: string;
  alertLevel: string;
  eventTime: string | null;
  regionId: string | null;
  affectedPeopleEstimate: number | null;
  /** Micro-degrees, null when the source gave none or they failed validation. Never invented. */
  latE6: number | null;
  lonE6: number | null;
  sourceId: string;
  flags: string[];
  ageSeconds: number;
  synthetic: boolean;
  syntheticLabel: string | null;
  /** Same field list an incident card carries, so the UI can reuse card rendering. */
  fields: CardField[];
}

export interface ReferenceCard extends Omit<FeaturedIncident, 'domain'> {
  /** The same field list an incident card carries (hazardType, alertLevel, eventTime, affected people, region, location) plus measurements. */
  fields: CardField[];
}

function referenceCard(i: FeaturedIncident): ReferenceCard {
  const hasLocation = i.location.latE6 !== null && i.location.lonE6 !== null;
  const { domain: _domain, ...rest } = i;
  const fields: CardField[] = [
    { key: 'hazardType', label: 'Hazard type', value: i.hazardType, unit: null, epistemic: 'fact' },
    { key: 'alertLevel', label: `Alert level (${i.alertLevel.scale ?? 'none'})`, value: i.alertLevel.value, unit: null, epistemic: i.alertLevel.value === null ? 'unknown' : 'fact' },
    { key: 'eventTime', label: 'Event start', value: i.eventStart, unit: null, epistemic: i.status === 'SOURCED' ? 'fact' : 'unknown' },
    { key: 'eventEnd', label: 'Event end', value: i.eventEnd, unit: null, epistemic: i.eventEnd === null ? 'unknown' : 'fact' },
    { key: 'affectedPeopleEstimate', label: 'Affected people estimate', value: i.affectedPeopleEstimate, unit: 'people', epistemic: 'unknown' },
    { key: 'regionId', label: 'Place', value: i.place, unit: null, epistemic: i.place === null ? 'unknown' : 'fact' },
    { key: 'location', label: `Location (${i.location.basis})`, value: hasLocation ? `${i.location.latE6},${i.location.lonE6}` : null, unit: hasLocation ? 'micro-degrees (latitude, longitude)' : null, epistemic: hasLocation ? 'fact' : 'unknown' },
    ...i.measurements.map((m) => ({ key: m.key, label: m.label, value: m.value, unit: m.unit, epistemic: 'fact' as const })),
  ];
  return { ...rest, fields };
}

export interface DomainSummary {
  number: number;
  refId: string;
  name: string;
  /** Distinct active incidents. The badge shows this number. */
  activeCount: number;
  /** True when every counted incident is synthetic demo data; the UI must say so next to the number. */
  activeIsSynthetic: boolean;
  incidents: IncidentLite[];
  /** Notable past incidents for context, each with its full provenance and tags. Not counted as current. */
  reference: ReferenceCard[];
}

export interface HazardSummary {
  asOf: string;
  domains: DomainSummary[];
  /** Active reports whose hazard type is not mapped to one of the seven domains; they are not counted anywhere. */
  unmappedActive: number;
  remarks: string[];
}

function toLite(view: EvidenceView): IncidentLite {
  const p = view.payload;
  const hasLocation = p.latE6 !== null && p.lonE6 !== null;
  const fields: CardField[] = [
    { key: 'hazardType', label: 'Hazard type', value: p.hazardType, unit: null, epistemic: 'fact' },
    { key: 'alertLevel', label: 'Alert level', value: p.alertLevel, unit: null, epistemic: 'fact' },
    { key: 'eventTime', label: 'Event time', value: view.eventTime, unit: null, epistemic: view.eventTime === null ? 'unknown' : 'fact' },
    { key: 'publishedAt', label: 'Published at', value: view.publishedAt, unit: null, epistemic: view.publishedAt === null ? 'unknown' : 'fact' },
    { key: 'affectedPeopleEstimate', label: 'Affected people estimate', value: p.affectedPeopleEstimate, unit: 'people', epistemic: p.affectedPeopleEstimate === null ? 'unknown' : 'estimate' },
    { key: 'regionId', label: 'Region', value: p.regionId, unit: null, epistemic: 'fact' },
    { key: 'location', label: 'Location', value: hasLocation ? `${p.latE6},${p.lonE6}` : null, unit: hasLocation ? 'micro-degrees (latitude, longitude)' : null, epistemic: hasLocation ? 'fact' : 'unknown' },
  ];
  return {
    evidenceId: view.evidenceId, incidentKey: p.incidentKey, title: p.title, alertLevel: p.alertLevel, eventTime: view.eventTime,
    regionId: view.regionId, affectedPeopleEstimate: p.affectedPeopleEstimate, latE6: p.latE6, lonE6: p.lonE6, sourceId: view.sourceId,
    flags: view.flags, ageSeconds: view.ageSeconds, synthetic: view.synthetic,
    syntheticLabel: view.synthetic ? 'SYNTHETIC DEMO DATA - not a real event' : null,
    fields,
  };
}

const bigger = (a: IncidentLite, b: IncidentLite): number =>
  (ALERT_RANK[b.alertLevel.toUpperCase()] ?? -1) - (ALERT_RANK[a.alertLevel.toUpperCase()] ?? -1)
  || (b.affectedPeopleEstimate ?? -1) - (a.affectedPeopleEstimate ?? -1)
  || (b.eventTime ?? '').localeCompare(a.eventTime ?? '');

/**
 * `views` must come from toEvidenceViews over PUBLIC evidence only. `perDomain` bounds the incident list (the count is never bounded).
 */
export function buildHazardSummary(views: EvidenceView[], catalogue: Catalogue, featured: Featured, nowIso: string, perDomain = 3): HazardSummary {
  const active = views.filter((v) => !v.flags.includes('STALE') && !v.flags.includes('SUPERSEDED'));
  // One incident reported by several feeds counts once: keep the most recently published report of each incidentKey.
  const byIncident = new Map<string, EvidenceView>();
  for (const v of active) {
    const current = byIncident.get(v.payload.incidentKey);
    if (!current || (v.publishedAt ?? '') > (current.publishedAt ?? '')) byIncident.set(v.payload.incidentKey, v);
  }
  const perDomainMap = new Map<number, IncidentLite[]>();
  let unmapped = 0;
  for (const v of byIncident.values()) {
    const domain = domainOfHazard(v.payload.hazardType);
    if (domain === null) { unmapped += 1; continue; }
    perDomainMap.set(domain, [...(perDomainMap.get(domain) ?? []), toLite(v)]);
  }
  const domains: DomainSummary[] = [...catalogue.domains].sort((a, b) => a.number - b.number).map((d) => {
    const incidents = (perDomainMap.get(d.number) ?? []).sort(bigger);
    return {
      number: d.number, refId: d.refId, name: d.name,
      activeCount: incidents.length,
      activeIsSynthetic: incidents.length > 0 && incidents.every((i) => i.synthetic),
      incidents: incidents.slice(0, perDomain),
      reference: featured.incidents.filter((r) => r.domain === d.number).map(referenceCard),
    };
  });
  const remarks = [
    'Counts are incidents currently held in the Aegis evidence store that have not gone stale; they are not a complete list of events.',
    featured.remark,
  ];
  if (domains.some((d) => d.activeIsSynthetic)) remarks.push('Some counted incidents are synthetic demonstration data and are labelled as such.');
  return { asOf: nowIso, domains, unmappedActive: unmapped, remarks };
}
