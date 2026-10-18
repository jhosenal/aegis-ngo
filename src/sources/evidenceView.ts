import type { EvidenceRecord, EvidenceView, QualityFlag } from '../types/domain.js';

function recordKey(record: EvidenceRecord): string {
  return `${record.sourceId}\u0000${record.sourceRecordId}`;
}

export function toEvidenceViews(
  all: EvidenceRecord[],
  targetIds: string[] | null,
  nowIso: string,
): EvidenceView[] {
  const nowMs = Date.parse(nowIso);
  const latestByRecord = new Map<string, EvidenceRecord>();
  for (const record of all) {
    const key = recordKey(record);
    const current = latestByRecord.get(key);
    if (!current || record.revision > current.revision) latestByRecord.set(key, record);
  }

  const latestByIncident = new Map<string, EvidenceRecord[]>();
  for (const record of latestByRecord.values()) {
    const group = latestByIncident.get(record.payload.incidentKey) ?? [];
    group.push(record);
    latestByIncident.set(record.payload.incidentKey, group);
  }

  const conflictingIds = new Set<string>();
  for (const records of latestByIncident.values()) {
    const sourceIds = new Set(records.map((record) => record.sourceId));
    const estimates = new Set(records.map((record) => record.payload.affectedPeopleEstimate));
    if (sourceIds.size > 1 && estimates.size > 1) {
      for (const record of records) conflictingIds.add(record.evidenceId);
    }
  }

  const latestIds = new Set([...latestByRecord.values()].map((record) => record.evidenceId));
  return all
    .filter((record) => targetIds === null || targetIds.includes(record.evidenceId))
    .map((record) => {
      const flags: QualityFlag[] = [...record.intakeFlags];
      if (!latestIds.has(record.evidenceId)) flags.push('SUPERSEDED');
      if (latestIds.has(record.evidenceId) && conflictingIds.has(record.evidenceId)) flags.push('CONFLICTING');
      if (record.validUntil !== null && nowMs > Date.parse(record.validUntil)) flags.push('STALE');
      const fetchedMs = Date.parse(record.fetchedAt);
      const ageSeconds = Number.isFinite(nowMs) && Number.isFinite(fetchedMs)
        ? Math.max(0, Math.floor((nowMs - fetchedMs) / 1000))
        : 0;
      return { ...record, flags, ageSeconds };
    });
}
