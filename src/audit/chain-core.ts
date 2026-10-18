// GOLDEN (frozen by ADR-004). Pure functions only (no DB). Chain scope = (productId, tenantId).
import { hashWithDomain } from '../engine/canonical.js';

export const GENESIS_HASH = '0'.repeat(64);
export const EVENT_HASH_DOMAIN = 'AEG-EVT-v1';

export interface AuditEventBody {
  eventId: string;
  productId: string;
  tenantId: string;
  sequence: number;            // starts at 1 per (productId, tenantId)
  previousHash: string;        // GENESIS_HASH for sequence 1
  eventType: string;
  actorIdentity: string;
  actorRole: string;
  occurredAt: string;          // ISO-8601 UTC with Z
  workflowId: string | null;
  workflowVersion: string | null;
  inputSnapshotHash: string | null;
  resultHash: string | null;
  versions: Record<string, string>; // e.g. { formulation: "AEG.F.RESOURCE-SHORTFALL/1.0.0" }
  payloadHash: string | null;
  correlationKey: string | null;    // idempotency key
}
export interface AuditEvent extends AuditEventBody { hash: string }
export interface Checkpoint { sequence: number; hash: string }

export const computeEventHash = (body: AuditEventBody): string => hashWithDomain(EVENT_HASH_DOMAIN, body);

export function sealEvent(body: AuditEventBody): AuditEvent {
  return { ...body, hash: computeEventHash(body) };
}

export type ChainErrorCode =
  | 'WRONG_SCOPE' | 'SEQ_GAP' | 'SEQ_DUPLICATE' | 'PREV_MISMATCH' | 'HASH_MISMATCH' | 'CHECKPOINT_MISMATCH' | 'CHECKPOINT_BEYOND_CHAIN';
export interface ChainError { code: ChainErrorCode; sequence: number | null; detail: string }

/** events must be given in stored order. Never throws for tamper; returns errors. */
export function verifyChain(events: AuditEvent[], scope: { productId: string; tenantId: string }, checkpoint?: Checkpoint): { ok: boolean; errors: ChainError[]; head: Checkpoint | null } {
  const errors: ChainError[] = [];
  let expectedSeq = 1;
  let prev = GENESIS_HASH;
  for (const e of events) {
    if (e.productId !== scope.productId || e.tenantId !== scope.tenantId) errors.push({ code: 'WRONG_SCOPE', sequence: e.sequence, detail: `${e.productId}/${e.tenantId}` });
    if (e.sequence < expectedSeq) errors.push({ code: 'SEQ_DUPLICATE', sequence: e.sequence, detail: `expected ${expectedSeq}` });
    else if (e.sequence > expectedSeq) errors.push({ code: 'SEQ_GAP', sequence: e.sequence, detail: `expected ${expectedSeq}` });
    if (e.previousHash !== prev) errors.push({ code: 'PREV_MISMATCH', sequence: e.sequence, detail: 'previousHash does not link to prior event' });
    const { hash, ...body } = e;
    if (computeEventHash(body as AuditEventBody) !== hash) errors.push({ code: 'HASH_MISMATCH', sequence: e.sequence, detail: 'stored hash differs from recomputed hash' });
    expectedSeq = e.sequence + 1;
    prev = e.hash;
  }
  const last = events.length ? events[events.length - 1] : null;
  const head = last ? { sequence: last.sequence, hash: last.hash } : null;
  if (checkpoint) {
    if (!head || head.sequence < checkpoint.sequence) errors.push({ code: 'CHECKPOINT_BEYOND_CHAIN', sequence: null, detail: 'chain is shorter than trusted checkpoint (truncation or deletion)' });
    else {
      const at = events.find((e) => e.sequence === checkpoint.sequence);
      if (!at || at.hash !== checkpoint.hash) errors.push({ code: 'CHECKPOINT_MISMATCH', sequence: checkpoint.sequence, detail: 'event at checkpoint sequence differs from trusted hash' });
    }
  }
  return { ok: errors.length === 0, errors, head };
}
