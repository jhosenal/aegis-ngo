import { describe, expect, it } from 'vitest';
import { aseanCountryOfRegion, ASEAN_COUNTRIES } from '../../src/domains/asean.js';
import { buildHazardTrend } from '../../src/services/hazardTrend.js';
import { toEvidenceViews } from '../../src/sources/evidenceView.js';
import type { EvidenceRecord } from '../../src/types/domain.js';

const NOW = '2026-10-16T12:00:00Z';

function record(key: string, hazard: string, eventTime: string, regionId: string, over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: `EV-${key}`, tenantScope: null, sourceId: 'SRC.USGS.LIVE', sourceRecordId: key, revision: 1, supersedesEvidenceId: null,
    sourceUrl: null, licenceRef: 'LIC.T', eventTime, publishedAt: eventTime, fetchedAt: eventTime, validUntil: '2026-10-30T00:00:00Z',
    regionId, rawArtifactHash: 'a', normalizedPayloadHash: 'b', adapterVersion: 't', intakeFlags: [],
    payload: { incidentKey: `INC.${key}`, title: key, hazardType: hazard, alertLevel: 'GREEN', regionId, latE6: 1_000_000, lonE6: 100_000_000, affectedPeopleEstimate: null },
    synthetic: false, ...over,
  } as EvidenceRecord;
}
const trend = (records: EvidenceRecord[], days = 7) => buildHazardTrend(toEvidenceViews(records, null, NOW), NOW, days);

describe('ASEAN country mapping', () => {
  it('maps region labels to the eleven states and never guesses for seas', () => {
    expect(ASEAN_COUNTRIES).toHaveLength(11);
    expect(aseanCountryOfRegion('REGION.PHILIPPINES')?.iso3).toBe('PHL');
    expect(aseanCountryOfRegion('REGION.VIET_NAM')?.name).toBe('Viet Nam');
    expect(aseanCountryOfRegion('REGION.BURMA_MYANMAR')?.iso3).toBe('MMR');
    expect(aseanCountryOfRegion('REGION.SOUTH_CHINA_SEA')).toBeNull();
    expect(aseanCountryOfRegion(null)).toBeNull();
  });
});

describe('hazard trend for the landing page (AEG-HOME-002)', () => {
  it('counts real incidents on the UTC day of the event, per domain, and skips synthetic and superseded ones', () => {
    const t = trend([
      record('a', 'EARTHQUAKE', '2026-10-16T01:00:00Z', 'REGION.INDONESIA'),
      record('b', 'EARTHQUAKE', '2026-10-16T05:00:00Z', 'REGION.PHILIPPINES'),
      record('c', 'STORM', '2026-10-15T23:59:00Z', 'REGION.WESTERN_NORTH_PACIFIC_EAST_OF_THE_PHILIPPINES'),
      record('d', 'EARTHQUAKE', '2026-10-16T03:00:00Z', 'REGION.INDONESIA', { synthetic: true }),
      record('old', 'FLOOD', '2026-09-01T00:00:00Z', 'REGION.THAILAND'),
    ]);
    expect(t.series).toHaveLength(7);
    expect(t.series.at(-1)).toMatchObject({ date: '2026-10-16', total: 2, byDomain: { '1': 2 } });
    expect(t.series.at(-2)).toMatchObject({ date: '2026-10-15', total: 1, byDomain: { '3': 1 } });
    expect(t.olderThanWindow).toBe(1);
    expect(t.byCountry.find((c) => c.iso3 === 'IDN')!.active).toBe(1);
    expect(t.byCountry.find((c) => c.iso3 === 'PHL')!.active).toBe(1);
    expect(t.countryUnknown).toBe(1);   // the storm at sea is not assigned to a country
  });

  it('counts a re-reported incident once and bounds the window', () => {
    const t = trend([
      record('a', 'EARTHQUAKE', '2026-10-16T01:00:00Z', 'REGION.INDONESIA'),
      record('a2', 'EARTHQUAKE', '2026-10-16T01:00:00Z', 'REGION.INDONESIA', { payload: { incidentKey: 'INC.a', title: 'a', hazardType: 'EARTHQUAKE', alertLevel: 'GREEN', regionId: 'REGION.INDONESIA', latE6: 1, lonE6: 1, affectedPeopleEstimate: null } as EvidenceRecord['payload'], publishedAt: '2026-10-16T02:00:00Z' }),
    ], 500);
    expect(t.days).toBe(30);
    expect(t.series.at(-1)!.total).toBe(1);
    expect(t.remarks.join(' ')).toContain('not a forecast');
  });
});
