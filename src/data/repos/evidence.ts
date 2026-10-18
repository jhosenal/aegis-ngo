import { AegisError } from '../../engine/errors.js';
import { canonicalize } from '../../engine/canonical.js';
import type { Db } from '../db.js';
import type { EvidenceRecord, IntakeFlag, SourceState, SourceStatus } from '../../types/domain.js';

interface EvidenceRow {
  evidence_id: string;
  tenant_scope: string | null;
  source_id: string;
  source_record_id: string;
  revision: number;
  supersedes_evidence_id: string | null;
  source_url: string | null;
  licence_ref: string;
  event_time: string | null;
  published_at: string | null;
  fetched_at: string;
  valid_until: string | null;
  region_id: string | null;
  raw_artifact_hash: string;
  normalized_payload_hash: string;
  adapter_version: string;
  quality_flags_json: string;
  payload_json: string;
  synthetic: number;
}

interface SourceStatusRow {
  source_id: string;
  state: SourceState;
  last_ok_at: string | null;
  last_attempt_at: string;
  detail: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsePayload(json: string): EvidenceRecord['payload'] {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new AegisError('E_INTERNAL', 'Stored evidence payload is invalid JSON');
  }
  if (!isRecord(value)
    || typeof value.incidentKey !== 'string'
    || typeof value.title !== 'string'
    || typeof value.hazardType !== 'string'
    || typeof value.alertLevel !== 'string'
    || typeof value.regionId !== 'string'
    || !(typeof value.latE6 === 'number' || value.latE6 === null)
    || !(typeof value.lonE6 === 'number' || value.lonE6 === null)
    || !(typeof value.affectedPeopleEstimate === 'number' || value.affectedPeopleEstimate === null)) {
    throw new AegisError('E_INTERNAL', 'Stored evidence payload is missing required fields');
  }
  return value as unknown as EvidenceRecord['payload'];
}

function parseFlags(json: string): IntakeFlag[] {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new AegisError('E_INTERNAL', 'Stored evidence flags are invalid JSON');
  }
  if (!Array.isArray(value) || !value.every((flag) => flag === 'SYNTHETIC' || flag === 'COORD_INVALID' || flag === 'INCOMPLETE')) {
    throw new AegisError('E_INTERNAL', 'Stored evidence flags are invalid');
  }
  return value as IntakeFlag[];
}

function fromRow(row: EvidenceRow): EvidenceRecord {
  return {
    evidenceId: row.evidence_id,
    tenantScope: row.tenant_scope,
    sourceId: row.source_id,
    sourceRecordId: row.source_record_id,
    revision: row.revision,
    supersedesEvidenceId: row.supersedes_evidence_id,
    sourceUrl: row.source_url,
    licenceRef: row.licence_ref,
    eventTime: row.event_time,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    validUntil: row.valid_until,
    regionId: row.region_id,
    rawArtifactHash: row.raw_artifact_hash,
    normalizedPayloadHash: row.normalized_payload_hash,
    adapterVersion: row.adapter_version,
    intakeFlags: parseFlags(row.quality_flags_json),
    payload: parsePayload(row.payload_json),
    synthetic: row.synthetic === 1,
  };
}

export function findLatestEvidence(db: Db, sourceId: string, sourceRecordId: string): EvidenceRecord | null {
  const row = db.prepare(
    'SELECT * FROM evidence WHERE source_id = ? AND source_record_id = ? ORDER BY revision DESC LIMIT 1',
  ).get(sourceId, sourceRecordId) as EvidenceRow | undefined;
  return row ? fromRow(row) : null;
}

export function listEvidence(db: Db): EvidenceRecord[] {
  const rows = db.prepare('SELECT * FROM evidence ORDER BY source_id, source_record_id, revision').all() as EvidenceRow[];
  return rows.map(fromRow);
}

export function listVisibleEvidence(db: Db, tenantId: string): EvidenceRecord[] {
  const rows = db.prepare(
    'SELECT * FROM evidence WHERE tenant_scope IS NULL OR tenant_scope = ? ORDER BY source_id, source_record_id, revision',
  ).all(tenantId) as EvidenceRow[];
  return rows.map(fromRow);
}

export function getVisibleEvidence(db: Db, tenantId: string, evidenceId: string): EvidenceRecord | null {
  const row = db.prepare(
    'SELECT * FROM evidence WHERE evidence_id = ? AND (tenant_scope IS NULL OR tenant_scope = ?)',
  ).get(evidenceId, tenantId) as EvidenceRow | undefined;
  return row ? fromRow(row) : null;
}

export function insertEvidence(db: Db, record: EvidenceRecord): void {
  db.prepare(
    'INSERT INTO evidence (evidence_id, tenant_scope, source_id, source_record_id, revision, supersedes_evidence_id, source_url, licence_ref, event_time, published_at, fetched_at, valid_until, region_id, raw_artifact_hash, normalized_payload_hash, adapter_version, quality_flags_json, payload_json, synthetic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    record.evidenceId,
    record.tenantScope,
    record.sourceId,
    record.sourceRecordId,
    record.revision,
    record.supersedesEvidenceId,
    record.sourceUrl,
    record.licenceRef,
    record.eventTime,
    record.publishedAt,
    record.fetchedAt,
    record.validUntil,
    record.regionId,
    record.rawArtifactHash,
    record.normalizedPayloadHash,
    record.adapterVersion,
    canonicalize(record.intakeFlags),
    canonicalize(record.payload),
    record.synthetic ? 1 : 0,
  );
}

export function getSourceStatus(db: Db, sourceId: string): SourceStatus | null {
  const row = db.prepare('SELECT * FROM source_status WHERE source_id = ?').get(sourceId) as SourceStatusRow | undefined;
  return row ? { sourceId: row.source_id, state: row.state, lastOkAt: row.last_ok_at, lastAttemptAt: row.last_attempt_at, detail: row.detail } : null;
}

export function listSourceStatuses(db: Db): SourceStatus[] {
  const rows = db.prepare('SELECT * FROM source_status ORDER BY source_id').all() as SourceStatusRow[];
  return rows.map((row) => ({
    sourceId: row.source_id,
    state: row.state,
    lastOkAt: row.last_ok_at,
    lastAttemptAt: row.last_attempt_at,
    detail: row.detail,
  }));
}

export function upsertSourceStatus(db: Db, status: SourceStatus): void {
  db.prepare(
    'INSERT INTO source_status (source_id, state, last_ok_at, last_attempt_at, detail) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET state = excluded.state, last_ok_at = excluded.last_ok_at, last_attempt_at = excluded.last_attempt_at, detail = excluded.detail',
  ).run(status.sourceId, status.state, status.lastOkAt, status.lastAttemptAt, status.detail);
}
