import { AegisError } from '../engine/errors.js';
import { canonicalize } from '../engine/canonical.js';
import type { IdGen } from '../engine/ids.js';
import type { Db } from '../data/db.js';
import {
  GENESIS_HASH,
  sealEvent,
  verifyChain,
  type AuditEvent,
  type AuditEventBody,
  type Checkpoint,
} from './chain-core.js';

export interface NewAuditEvent {
  productId: string;
  tenantId: string;
  eventType: string;
  actorIdentity: string;
  actorRole: string;
  occurredAt: string;
  workflowId: string | null;
  workflowVersion: string | null;
  inputSnapshotHash: string | null;
  resultHash: string | null;
  versions: Record<string, string>;
  payloadHash: string | null;
  correlationKey: string | null;
}

export interface AuditExport {
  format: 'aegis-audit-export/1';
  scope: { productId: string; tenantId: string };
  canonicalization: 'canonical-json-v1';
  hashDomain: 'AEG-EVT-v1';
  genesis: string;
  events: AuditEvent[];
  head: Checkpoint | null;
}

interface StoredAuditEvent {
  body_json: string;
  hash: string;
}

export function appendEvent(db: Db, ev: NewAuditEvent, ids: IdGen): AuditEvent {
  if (!db.inTransaction) {
    return db.transaction(() => appendEvent(db, ev, ids)).immediate();
  }

  const previous = db.prepare(
    'SELECT sequence, hash FROM audit_events WHERE product_id = ? AND tenant_id = ? ORDER BY sequence DESC LIMIT 1',
  ).get(ev.productId, ev.tenantId) as { sequence: number; hash: string } | undefined;
  const body: AuditEventBody = {
    eventId: ids.next('EVT'),
    productId: ev.productId,
    tenantId: ev.tenantId,
    sequence: previous ? previous.sequence + 1 : 1,
    previousHash: previous?.hash ?? GENESIS_HASH,
    eventType: ev.eventType,
    actorIdentity: ev.actorIdentity,
    actorRole: ev.actorRole,
    occurredAt: ev.occurredAt,
    workflowId: ev.workflowId,
    workflowVersion: ev.workflowVersion,
    inputSnapshotHash: ev.inputSnapshotHash,
    resultHash: ev.resultHash,
    versions: ev.versions,
    payloadHash: ev.payloadHash,
    correlationKey: ev.correlationKey,
  };
  const event = sealEvent(body);
  db.prepare(
    'INSERT INTO audit_events (event_id, product_id, tenant_id, sequence, previous_hash, hash, body_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(event.eventId, event.productId, event.tenantId, event.sequence, event.previousHash, event.hash, canonicalize(body));
  return event;
}

export function loadChain(db: Db, scope: { productId: string; tenantId: string }): AuditEvent[] {
  const rows = db.prepare(
    'SELECT body_json, hash FROM audit_events WHERE product_id = ? AND tenant_id = ? ORDER BY sequence',
  ).all(scope.productId, scope.tenantId) as StoredAuditEvent[];
  return rows.map((row) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.body_json) as unknown;
    } catch {
      throw new AegisError('E_INTERNAL', 'Stored audit event body is invalid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AegisError('E_INTERNAL', 'Stored audit event body is not an object');
    }
    return { ...parsed, hash: row.hash } as AuditEvent;
  });
}

export function exportChain(db: Db, scope: { productId: string; tenantId: string }): AuditExport {
  const events = loadChain(db, scope);
  const tail = events.at(-1);
  return {
    format: 'aegis-audit-export/1',
    scope,
    canonicalization: 'canonical-json-v1',
    hashDomain: 'AEG-EVT-v1',
    genesis: GENESIS_HASH,
    events,
    head: tail ? { sequence: tail.sequence, hash: tail.hash } : null,
  };
}

export function verifyStored(
  db: Db,
  scope: { productId: string; tenantId: string },
  checkpoint?: Checkpoint,
): ReturnType<typeof verifyChain> {
  return verifyChain(loadChain(db, scope), scope, checkpoint);
}
