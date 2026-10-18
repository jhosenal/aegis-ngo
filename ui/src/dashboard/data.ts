import type { CardRevision } from '../../../src/types/domain.js';
import type { CardViewData } from '../state/store.js';
import { apiRequest } from '../api/client.js';
import type { HistoryCard } from './history.js';

export const DEMO_AS_OF = '2026-10-15T02:00:00Z';
export const ASEAN_VIEW_BOUNDS = { north: 26, south: -11, west: 96, east: 132 };
const examples = [
  ['Forest fire monitoring', 'Kalimantan, Indonesia', 'wildfire', 'High', -1.2, 114.1],
  ['Flooding risk', 'Kelantan, Malaysia', 'flood', 'Medium', 5.9, 102.2],
  ['Heavy rainfall advisory', 'Northern Philippines', 'storm', 'High', 16.5, 122.0],
  ['Biological outbreak scenario', 'Central Vietnam', 'biological', 'Medium', 14.0, 109.0],
  ['Volcanic activity watch', 'East Java, Indonesia', 'volcano', 'Watch', -8.1, 112.9],
  ['Earthquake response scenario', 'Northern Laos', 'earthquake', 'High', 20.0, 103.0],
  ['Population displacement scenario', 'Northeastern Thailand', 'displacement', 'Medium', 16.0, 103.0],
] as const;

/** UI fixtures use the existing card contract. Never persisted or sent as chat attachments. */
export const demoCards: CardViewData[] = examples.map(([title, region, hazard, level, lat, lon], index) => {
  const country = ['Indonesia', 'Malaysia', 'Philippines', 'Viet Nam', 'Indonesia', 'Laos', 'Thailand'][index]!;
  const card: CardRevision = {
    cardId: `DEMO-REGIONAL-${index + 1}`, tenantId: 'DEMO', kind: 'incident', revision: 1,
    state: 'draft', title, evidenceIds: [], formulationRef: null, workflowRunId: null,
    createdAt: DEMO_AS_OF, createdBy: 'dashboard-fixture',
    body: { kind: 'incident', status: 'ok', synthetic: true,
      syntheticLabel: 'Synthetic demonstration. Not an operational alert.',
      summary: `Illustrative ${hazard} incident in ${region}. Open this card to inspect its fields; connect an approved source before operational use.`,
      fields: [
        { key: 'country', label: 'ASEAN country', value: country, unit: null, epistemic: 'proposal' },
        { key: 'regionId', label: 'Region', value: region, unit: null, epistemic: 'proposal' },
        { key: 'hazardType', label: 'Hazard type', value: hazard, unit: null, epistemic: 'proposal' },
        { key: 'incidentPeriod', label: 'Incident period', value: 'current', unit: null, epistemic: 'proposal' },
        { key: 'alertLevel', label: 'Alert level', value: level, unit: null, epistemic: 'proposal' },
        { key: 'location', label: 'Location', value: `${lat * 1e6},${lon * 1e6}`, unit: null, epistemic: 'proposal' },
      ], sections: [], assumptions: ['Illustrative marker location and severity.'], warnings: [], missing: ['Verified source', 'Affected population'], result: null },
  };
  return { card, revisions: [card], latestRevision: 1, evidence: [] };
});

// ---- Real incidents for the signed-out landing page (replaces the synthetic fixtures above whenever the live feed has records) ----
interface SummaryIncident {
  evidenceId: string; incidentKey: string; title: string; alertLevel: string | null; eventTime: string | null; regionId: string | null;
  latE6: number | null; lonE6: number | null; sourceId: string | null; synthetic: boolean; fields: CardRevision['body']['fields'];
}
const ASEAN_COUNTRIES = ['Brunei', 'Cambodia', 'Indonesia', 'Laos', 'Malaysia', 'Myanmar', 'Philippines', 'Singapore', 'Thailand', 'Timor-Leste', 'Viet Nam'];
/** REGION.VIETNAM -> "Viet Nam"; anything that is not one of the eleven states (Guam, a sea region) -> null, so it counts as offshore. */
export function countryOfRegion(regionId: string | null): string | null {
  const key = (regionId ?? '').replace(/^REGION\./, '').replace(/_/g, '').toLowerCase();
  return ASEAN_COUNTRIES.find((name) => name.replace(/[^A-Za-z]/g, '').toLowerCase() === key || (key === 'vietnam' && name === 'Viet Nam')) ?? null;
}
const SOURCE_NAMES: Record<string, string> = { 'SRC.GDACS.LIVE': 'GDACS (live feed)', 'SRC.USGS.LIVE': 'USGS (live feed)' };

export function liveGuestCards(incidents: SummaryIncident[]): CardViewData[] {
  return incidents.filter((item) => !item.synthetic).map((item) => {
    const country = countryOfRegion(item.regionId);
    const source = SOURCE_NAMES[item.sourceId ?? ''] ?? item.sourceId ?? 'unknown source';
    const created = String(item.fields.find((f) => f.key === 'publishedAt')?.value ?? item.eventTime ?? DEMO_AS_OF);
    const card: CardRevision = {
      cardId: `LIVE-${item.evidenceId}`, tenantId: 'PUBLIC', kind: 'incident', revision: 1, state: 'draft', title: item.title,
      evidenceIds: [item.evidenceId], formulationRef: null, workflowRunId: null, createdAt: created, createdBy: 'public-summary',
      body: { kind: 'incident', status: 'ok', synthetic: false, syntheticLabel: null,
        summary: `Reported by ${source}${item.eventTime ? `, event time ${item.eventTime.slice(0, 10)}` : ''}. Shown as published by the source; AEGIS has not verified it.`,
        fields: [
          { key: 'country', label: 'ASEAN country', value: country, unit: null, epistemic: country ? 'fact' : 'unknown' },
          ...item.fields.filter((f) => f.key !== 'country'),
          { key: 'incidentPeriod', label: 'Incident period', value: 'current', unit: null, epistemic: 'fact' },
          { key: 'source', label: 'Source', value: source, unit: null, epistemic: 'fact' },
        ], sections: [], assumptions: [], warnings: [], missing: item.fields.some((f) => f.key === 'affectedPeopleEstimate' && f.value === null) ? ['Affected population'] : [], result: null },
    };
    return { card, revisions: [card], latestRevision: 1, evidence: [] };
  });
}

interface AhaReport {
  reportId: string; hazardType: string; title: string; country: string; status: string; eventDate: string; updatedAt: string; lat: number; lng: number;
  affectedPeople: number | null; displaced: number | null; affectedHouses: number | null; injured: number | null; summary: string; source: string; sourcePage: string;
}
/** AHA Centre ADInet incident reports (transcribed in content/aha/weekly-update.json) as cards. Figures are the source's own; alert level stays unknown. */
export function ahaReportCards(reports: AhaReport[]): CardViewData[] {
  return reports.map((r) => {
    const num = (key: string, label: string, value: number | null): CardRevision['body']['fields'] =>
      value === null ? [] : [{ key, label, value, unit: null, epistemic: 'fact' }];
    const card: CardRevision = {
      cardId: `AHA-${r.reportId}`, tenantId: 'PUBLIC', kind: 'incident', revision: 1, state: 'draft', title: r.title,
      evidenceIds: [r.reportId], formulationRef: null, workflowRunId: null, createdAt: `${r.updatedAt}T00:00:00Z`, createdBy: 'aha-adinet',
      body: { kind: 'incident', status: 'ok', synthetic: false, syntheticLabel: null,
        summary: `${r.summary} Source: ${r.source}, report ${r.reportId} (${r.status}), updated ${r.updatedAt}. Shown as published; AEGIS has not verified it.`,
        fields: [
          { key: 'country', label: 'ASEAN country', value: r.country, unit: null, epistemic: 'fact' },
          { key: 'hazardType', label: 'Hazard type', value: r.hazardType, unit: null, epistemic: 'fact' },
          { key: 'incidentPeriod', label: 'Incident period', value: r.status === 'ACTIVE' ? 'current' : 'historical', unit: null, epistemic: 'fact' },
          { key: 'alertLevel', label: 'Alert level (not stated by source)', value: null, unit: null, epistemic: 'unknown' },
          { key: 'eventTime', label: 'Event date', value: r.eventDate, unit: null, epistemic: 'fact' },
          { key: 'publishedAt', label: 'Report updated', value: `${r.updatedAt}T00:00:00Z`, unit: null, epistemic: 'fact' },
          { key: 'location', label: 'Location', value: `${Math.round(r.lat * 1e6)},${Math.round(r.lng * 1e6)}`, unit: 'micro-degrees (latitude, longitude)', epistemic: 'fact' },
          ...num('affectedPeopleEstimate', 'Affected people (reported by source)', r.affectedPeople),
          ...num('displaced', 'Displaced (reported by source)', r.displaced),
          ...num('affectedHouses', 'Houses affected (reported by source)', r.affectedHouses),
          ...num('injured', 'Injured (reported by source)', r.injured),
          { key: 'source', label: 'Source', value: r.source, unit: null, epistemic: 'fact' },
          { key: 'sourcePage', label: 'Source page', value: r.sourcePage, unit: null, epistemic: 'fact' },
        ], sections: [], assumptions: [], warnings: [], missing: ['Alert level', 'Independent verification'], result: null },
    };
    return { card, revisions: [card], latestRevision: 1, evidence: [] };
  });
}

/** Signed-out cards: the AHA ADInet reports first (detailed, sourced), then the live USGS and GDACS records. Either source failing leaves the other. */
export async function loadLiveGuestCards(): Promise<CardViewData[]> {
  const [summary, aha] = await Promise.allSettled([
    apiRequest<{ domains: { incidents: SummaryIncident[] }[] }>('/public/hazards/summary?limit=50'),
    apiRequest<{ adinetReports?: AhaReport[] }>('/public/aha-weekly'),
  ]);
  // Only ACTIVE reports are live cards; CLOSED ones go to the Historical Archive (loadClosedAhaHistory), so no card sits in neither list.
  const ahaCards = aha.status === 'fulfilled' ? ahaReportCards((aha.value.adinetReports ?? []).filter((r) => r.status === 'ACTIVE')) : [];
  const feed = summary.status === 'fulfilled' ? liveGuestCards(summary.value.domains.flatMap((domain) => domain.incidents)) : [];
  return [...ahaCards, ...feed];
}

const AHA_DOMAIN: Record<string, number> = { EARTHQUAKE: 1, FLOOD: 2, STORM: 3, CYCLONE: 3, FIRE: 4, WILDFIRE: 4, VOLCANO: 7, VOLCANIC: 7 };
/** CLOSED AHA ADInet reports as Historical Archive cards. Coordinates and figures are the source's own; there is no stored copy of the page, so the hash says so. */
export async function loadClosedAhaHistory(): Promise<HistoryCard[]> {
  const { adinetReports = [] } = await apiRequest<{ adinetReports?: AhaReport[] }>('/public/aha-weekly');
  return adinetReports.filter((r) => r.status !== 'ACTIVE' && AHA_DOMAIN[r.hazardType] !== undefined).map((r): HistoryCard => ({
    id: `HX-AHA-${r.reportId}`, domain: AHA_DOMAIN[r.hazardType]!, hazardType: r.hazardType, title: r.title,
    eventStart: `${r.eventDate}T00:00:00Z`, eventEnd: `${r.updatedAt}T00:00:00Z`, place: r.country, countries: [r.country],
    alertLevel: { value: null, scale: 'none', note: 'not stated by the source' }, rating: { scale: 'none', value: null, rank: null },
    location: { latE6: Math.round(r.lat * 1e6), lonE6: Math.round(r.lng * 1e6), basis: 'report location (AHA Centre ADInet)', depthKm: null },
    measurements: [],
    provenance: {
      sourceId: 'SRC.AHA.ADINET', sourceName: r.source, publisher: 'AHA Centre (ADInet)', sourcePage: r.sourcePage, apiUrl: r.sourcePage, sourceRecordId: r.reportId,
      retrievedAt: `${r.updatedAt}T00:00:00Z`, sourceUpdatedAt: `${r.updatedAt}T00:00:00Z`, rawSha256: 'No stored copy',
      licence: { status: 'UNVERIFIED', text: 'Licence not checked.', attribution: `Source: ${r.source}.` },
    },
    corroboration: [], impact: null, region: 'asean', tags: ['source:AHA', `domain:${AHA_DOMAIN[r.hazardType]}`],
  }));
}

export async function loadDashboardCards(token: string): Promise<CardViewData[]> {
  const { cards } = await apiRequest<{ cards: { cardId: string; latestRevision: number }[] }>('/api/cards', { token });
  return Promise.all(cards.map(async ({ cardId, latestRevision }) => {
    const detail = await apiRequest<Omit<CardViewData, 'latestRevision'>>(`/api/cards/${encodeURIComponent(cardId)}?revision=${latestRevision}`, { token });
    return { ...detail, latestRevision };
  }));
}

export function field(card: CardRevision, key: string): string | number | null {
  return card.body.fields.find((item) => item.key === key)?.value ?? null;
}

export function coordinates(card: CardRevision): { lat: number; lng: number } | null {
  const location = field(card, 'location');
  if (typeof location !== 'string') return null;
  const parts = location.split(',');
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return null;
  const [lat, lon] = parts.map((part) => Number(part) / 1e6);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -13 || lat > 30 || lon < 90 || lon > 160) return null;
  return { lat, lng: lon };
}

export function position(card: CardRevision): { x: number; y: number } | null {
  const point = coordinates(card);
  return point ? { x: (point.lng - 90) / 51 * 1000, y: (28 - point.lat) / 41 * 650 } : null;
}
