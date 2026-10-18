import { describe, expect, it } from 'vitest';
import { buildDataConfidence } from '../../src/services/dataConfidence.js';
import { toEvidenceViews } from '../../src/sources/evidenceView.js';
import type { EvidenceRecord, SourceStatus } from '../../src/types/domain.js';

const NOW = '2026-10-16T12:00:00Z';
function rec(key: string, source: string, over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: `EV-${key}`, tenantScope: null, sourceId: source, sourceRecordId: key, revision: 1, supersedesEvidenceId: null,
    sourceUrl: 'https://example.org/x', licenceRef: 'LIC.T', eventTime: '2026-10-16T10:00:00Z', publishedAt: '2026-10-16T10:00:00Z',
    fetchedAt: '2026-10-16T11:45:00Z', validUntil: '2026-10-20T00:00:00Z', regionId: 'REGION.INDONESIA', rawArtifactHash: 'a', normalizedPayloadHash: 'b',
    adapterVersion: 't', intakeFlags: [],
    payload: { incidentKey: `INC.${key}`, title: key, hazardType: 'EARTHQUAKE', alertLevel: 'GREEN', regionId: 'REGION.INDONESIA', latE6: 1, lonE6: 1, affectedPeopleEstimate: null },
    synthetic: false, ...over,
  } as EvidenceRecord;
}
const ok = (id: string, lastOkAt: string | null) => ({ sourceId: id, state: 'OK', lastOkAt, lastAttemptAt: NOW, detail: null }) as SourceStatus;
const LIVE_OK = [ok('SRC.USGS.LIVE', '2026-10-16T11:50:00Z'), ok('SRC.GDACS.LIVE', '2026-10-16T11:50:00Z')];
const score = (records: EvidenceRecord[], statuses: SourceStatus[] = LIVE_OK) => buildDataConfidence(toEvidenceViews(records, null, NOW), statuses, NOW);

describe('data confidence (AEG-HOME-003, provisional)', () => {
  it('is not assessed (null, not zero) when no real incident is held, and ignores synthetic evidence', () => {
    expect(score([]).score).toBeNull();
    const s = score([rec('d', 'SRC.DEMO', { synthetic: true })]);
    expect(s.score).toBeNull();
    expect(s.band).toBeNull();
    expect(s.provisional).toBe(true);
  });

  it('averages feed liveness, validity and provenance, reports each component and says it is provisional', () => {
    const s = score([rec('a', 'SRC.USGS.LIVE'), rec('b', 'SRC.GDACS.LIVE')]);
    expect(s.components.map((c) => c.value)).toEqual([100, 100, 100]);
    expect(s).toMatchObject({ score: 100, band: 'HIGH' });
    expect(s.note).toContain('PROVISIONAL');
  });

  it('drops when a feed goes quiet and when incidents pass their validity window or lack a source', () => {
    const s = score([
      rec('a', 'SRC.USGS.LIVE', { fetchedAt: '2026-10-16T08:00:00Z' }),
      rec('b', 'SRC.GDACS.LIVE', { fetchedAt: '2026-10-16T08:00:00Z', validUntil: '2026-10-16T09:00:00Z' }),   // stale
      rec('c', 'SRC.GDACS.LIVE', { fetchedAt: '2026-10-16T08:00:00Z', sourceUrl: null }),
      rec('d', 'SRC.GDACS.LIVE', { fetchedAt: '2026-10-16T08:00:00Z' }),
    ], [ok('SRC.USGS.LIVE', '2026-10-16T08:00:00Z'), ok('SRC.GDACS.LIVE', null)]);
    expect(s.components.find((c) => c.key === 'sourceLiveness')!.value).toBe(0);
    expect(s.components.find((c) => c.key === 'withinValidity')!.value).toBe(75);
    expect(s.components.find((c) => c.key === 'provenance')!.value).toBe(75);
    expect(s.score).toBe(50);
    expect(s.band).toBe('MEDIUM');
  });
});
