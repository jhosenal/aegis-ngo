import { appendEvent } from '../audit/chainStore.js';
import type { Db } from '../data/db.js';
import { findLatestEvidence, insertEvidence, getSourceStatus, upsertSourceStatus } from '../data/repos/evidence.js';
import { hashWithDomain } from '../engine/canonical.js';
import { AegisError } from '../engine/errors.js';
import type { IdGen } from '../engine/ids.js';
import type { EvidenceRecord, SourceState } from '../types/domain.js';
import { normalizeIncident, type RawIncidentRecord } from './normalize.js';

export interface SourceDef {
  sourceId: string;
  title: string;
  licenceRef: string;
  validHours: number;
  adapterVersion: string;
  /** Defaults to true. Live feeds set false. */
  synthetic?: boolean;
}

export interface FixturePoll {
  pollId: string;
  sourceId: string;
  fetchedAt: string;
  outcome: SourceState;
  records: RawIncidentRecord[];
  detail?: string;
  rawText?: string;
}

export interface ApplyResult {
  pollId: string;
  outcome: SourceState;
  inserted: string[];
  duplicates: string[];
  superseded: { old: string; new: string }[];
}

function auditEvent(
  db: Db,
  ids: IdGen,
  values: {
    eventType: string;
    occurredAt: string;
    payloadHash: string | null;
    correlationKey: string;
    versions?: Record<string, string>;
  },
): void {
  appendEvent(db, {
    productId: 'AEG',
    tenantId: 'SYSTEM',
    eventType: values.eventType,
    actorIdentity: 'SYSTEM',
    actorRole: 'system',
    occurredAt: values.occurredAt,
    workflowId: null,
    workflowVersion: null,
    inputSnapshotHash: null,
    resultHash: null,
    versions: values.versions ?? {},
    payloadHash: values.payloadHash,
    correlationKey: values.correlationKey,
  }, ids);
}

export function applyPoll(db: Db, poll: FixturePoll, sources: SourceDef[], ids: IdGen): ApplyResult {
  const source = sources.find((candidate) => candidate.sourceId === poll.sourceId);
  if (!source) throw new AegisError('E_INTERNAL', `Unknown fixture source: ${poll.sourceId}`);
  const apply = db.transaction((): ApplyResult => {
    const previousStatus = getSourceStatus(db, source.sourceId);
    const detail = poll.outcome === 'OK' ? null : poll.detail ?? null;
    upsertSourceStatus(db, {
      sourceId: source.sourceId,
      state: poll.outcome,
      lastOkAt: poll.outcome === 'OK' ? poll.fetchedAt : previousStatus?.lastOkAt ?? null,
      lastAttemptAt: poll.fetchedAt,
      detail,
    });

    if (poll.outcome !== 'OK') {
      if (previousStatus?.state !== poll.outcome) {
        auditEvent(db, ids, {
          eventType: 'source.status_changed',
          occurredAt: poll.fetchedAt,
          payloadHash: hashWithDomain('AEG-PAYLOAD-v1', { sourceId: source.sourceId, state: poll.outcome, detail }),
          correlationKey: poll.pollId,
          versions: { adapter: source.adapterVersion },
        });
      }
      return { pollId: poll.pollId, outcome: poll.outcome, inserted: [], duplicates: [], superseded: [] };
    }

    const inserted: string[] = [];
    const duplicates: string[] = [];
    const superseded: { old: string; new: string }[] = [];
    for (const raw of poll.records) {
      const rawArtifactHash = hashWithDomain('AEG-EVIDENCE-v1', raw);
      const latest = findLatestEvidence(db, source.sourceId, raw.sourceRecordId);
      if (latest?.rawArtifactHash === rawArtifactHash) {
        duplicates.push(raw.sourceRecordId);
        continue;
      }

      const normalized = normalizeIncident(raw, source, poll.fetchedAt);
      const revision = (latest?.revision ?? 0) + 1;
      const evidenceId = `EV-${raw.sourceRecordId}-r${revision}`;
      const record: EvidenceRecord = {
        evidenceId,
        tenantScope: null,
        sourceId: source.sourceId,
        sourceRecordId: raw.sourceRecordId,
        revision,
        supersedesEvidenceId: latest?.evidenceId ?? null,
        sourceUrl: raw.sourceUrl || null,
        licenceRef: source.licenceRef,
        eventTime: raw.eventTime || null,
        publishedAt: raw.publishedAt || null,
        fetchedAt: poll.fetchedAt,
        validUntil: normalized.validUntil,
        regionId: raw.regionId || null,
        rawArtifactHash,
        normalizedPayloadHash: hashWithDomain('AEG-EVIDENCE-v1', normalized.payload),
        adapterVersion: source.adapterVersion,
        intakeFlags: normalized.intakeFlags,
        payload: normalized.payload,
        synthetic: source.synthetic !== false,
      };
      insertEvidence(db, record);
      inserted.push(evidenceId);
      if (latest) superseded.push({ old: latest.evidenceId, new: evidenceId });
      auditEvent(db, ids, {
        eventType: 'evidence.ingested',
        occurredAt: poll.fetchedAt,
        payloadHash: record.normalizedPayloadHash,
        correlationKey: poll.pollId,
        versions: { adapter: source.adapterVersion },
      });
    }
    return { pollId: poll.pollId, outcome: poll.outcome, inserted, duplicates, superseded };
  });
  return apply.immediate();
}
