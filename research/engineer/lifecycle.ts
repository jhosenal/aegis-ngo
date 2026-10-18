// Isolated proof of concept (not wired into the application, no project database touched).
// Proposed additive lifecycle store beside the unchanged formulation_registry (frozen definitions, four states, active-immutability trigger).
//  - an append-only, hash-chained event table, verified on every authorization and checked against a trusted head;
//  - an allowlist of legacy rows adopted ONCE, from a reviewed constant, then sealed;
//  - server-side trust: current hashes, the clock and the approver's authority come from trusted code, never from the caller;
//  - one guard that checks lifecycle, hashes, expiry, use and the FULL scope, and a revision fence against check-then-act races;
//  - an adapter that reads the real registry row without editing the frozen definition.
import { z } from 'zod';
import { canonicalize, hashWithDomain, sha256Hex } from '../../src/engine/canonical.js';
import { getActiveFormulation } from '../../src/registry/formulations.js';

type Db = import('better-sqlite3').Database;

export const STAGES = ['candidate', 'evidence-reviewed', 'implementation-tested', 'approved-for-specific-use', 'active'] as const;
export type ForwardStage = typeof STAGES[number];
export type Stage = ForwardStage | 'suspended' | 'revoked' | 'deprecated';
export type Use = 'DEMO' | 'PLANNING' | 'OPERATIONAL';
const USE_RANK: Record<Use, number> = { DEMO: 1, PLANNING: 2, OPERATIONAL: 3 };
export type Action = 'advance' | 'suspend' | 'revoke' | 'deprecate' | 'reinstate';
/** Terminal stages: a new version is needed. Revocation is terminal so it can never be erased by a later suspend and reinstate. */
const TERMINAL: readonly Stage[] = ['deprecated', 'revoked'];

export type LifecycleCode =
  | 'STAGE_SKIP' | 'MISSING_APPROVAL' | 'STALE_APPROVAL' | 'APPROVAL_EXPIRED' | 'TERMINAL' | 'BAD_TRANSITION' | 'UNKNOWN_FORMULATION'
  | 'MISSING_FIELD' | 'CHAIN_BROKEN' | 'CHAIN_TRUNCATED' | 'BAD_INPUT' | 'NOT_AUTHORIZED' | 'REVISION_CHANGED' | 'ADOPTION_CLOSED' | 'NOT_ON_ALLOWLIST';
export class LifecycleError extends Error {
  constructor(public readonly code: LifecycleCode, message?: string) { super(message ?? code); this.name = 'LifecycleError'; }
}

// ---------- runtime validation: TypeScript annotations alone validate nothing ----------
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_.@-]{1,128}$/;
const idList = z.array(z.string().regex(/^(\*|[A-Za-z0-9_.@-]{1,128})$/)).max(32);
export const ScopeSchema = z.object({ tenants: idList, purposes: idList, jurisdictions: idList, resources: idList, validity: idList, actions: idList }).strict();
export type Scope = z.infer<typeof ScopeSchema>;
const UseSchema = z.enum(['DEMO', 'PLANNING', 'OPERATIONAL']);
const ActionSchema = z.enum(['advance', 'suspend', 'revoke', 'deprecate', 'reinstate']);
const Hash = z.string().regex(HASH);
const Ident = z.string().regex(ID);
const Reference = z.string().min(1).max(256).regex(/^[\x20-\x7e]+$/);

/** Canonical UTC instants only (YYYY-MM-DDTHH:MM:SSZ), compared as numbers, never as strings. */
export function parseInstant(text: unknown): number {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text)) throw new LifecycleError('BAD_INPUT', 'instant must be YYYY-MM-DDTHH:MM:SSZ');
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace('.000Z', 'Z') !== text) throw new LifecycleError('BAD_INPUT', 'not a real UTC instant');
  return ms;
}
export const toInstant = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');

export interface Bindings { dependencyHash: string; implementationHash: string }
export interface Checkpoint { seq: number; hash: string }
/** What only trusted server code may supply. */
export interface Trust {
  /** The authoritative clock, in epoch milliseconds. Callers never pass "now". */
  clock: () => number;
  /** Current dependency and implementation hashes, resolved from trusted registries for this exact formulation version. */
  resolveBindings: (formulationId: string, version: string) => Bindings;
  /** Authenticated-writer check: may this principal perform this action? A free-text approver name proves nothing by itself. */
  authority: (approver: string, action: Action, toStage: Stage) => boolean;
  /** A trusted external head of the event chain (for example stored outside the database). Detects truncation and a rewritten tail. */
  checkpoint?: () => Checkpoint | null;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS formulation_lifecycle_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  formulation_id TEXT NOT NULL, version TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('advance','suspend','revoke','deprecate','reinstate')),
  from_stage TEXT NOT NULL, to_stage TEXT NOT NULL, prior_stage TEXT,
  approved_use TEXT CHECK (approved_use IN ('DEMO','PLANNING','OPERATIONAL')),
  scope_json TEXT NOT NULL,
  approver TEXT NOT NULL, occurred_at TEXT NOT NULL, expires_at TEXT,
  definition_hash TEXT NOT NULL, dependency_hash TEXT NOT NULL, implementation_hash TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  prev_hash TEXT NOT NULL, event_hash TEXT NOT NULL UNIQUE
);
CREATE TRIGGER IF NOT EXISTS lifecycle_events_no_update BEFORE UPDATE ON formulation_lifecycle_events BEGIN SELECT RAISE(ABORT, 'lifecycle events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS lifecycle_events_no_delete BEFORE DELETE ON formulation_lifecycle_events BEGIN SELECT RAISE(ABORT, 'lifecycle events are append-only'); END;
-- Legacy rows adopted ONCE from a reviewed allowlist: exact ids, versions, hashes, use and scope. Immutable, and sealed after adoption.
CREATE TABLE IF NOT EXISTS formulation_lifecycle_legacy (
  formulation_id TEXT NOT NULL, version TEXT NOT NULL, definition_hash TEXT NOT NULL, implementation_hash TEXT NOT NULL, dependency_hash TEXT NOT NULL,
  approved_use TEXT NOT NULL CHECK (approved_use IN ('DEMO','PLANNING','OPERATIONAL')), scope_json TEXT NOT NULL, reviewed_by TEXT NOT NULL, evidence_ref TEXT NOT NULL,
  adopted_at TEXT NOT NULL, PRIMARY KEY (formulation_id, version)
);
CREATE TRIGGER IF NOT EXISTS lifecycle_legacy_no_update BEFORE UPDATE ON formulation_lifecycle_legacy BEGIN SELECT RAISE(ABORT, 'legacy adoption is immutable'); END;
CREATE TRIGGER IF NOT EXISTS lifecycle_legacy_no_delete BEFORE DELETE ON formulation_lifecycle_legacy BEGIN SELECT RAISE(ABORT, 'legacy adoption is immutable'); END;
CREATE TABLE IF NOT EXISTS formulation_lifecycle_adoption_seal (id INTEGER PRIMARY KEY CHECK (id = 1), allowlist_hash TEXT NOT NULL, sealed_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS lifecycle_seal_no_update BEFORE UPDATE ON formulation_lifecycle_adoption_seal BEGIN SELECT RAISE(ABORT, 'adoption seal is immutable'); END;
CREATE TRIGGER IF NOT EXISTS lifecycle_seal_no_delete BEFORE DELETE ON formulation_lifecycle_adoption_seal BEGIN SELECT RAISE(ABORT, 'adoption seal is immutable'); END;
-- Which lifecycle revision authorized each consequential run.
CREATE TABLE IF NOT EXISTS formulation_runs (
  run_seq INTEGER PRIMARY KEY AUTOINCREMENT, formulation_id TEXT NOT NULL, version TEXT NOT NULL, use TEXT NOT NULL,
  formulation_seq INTEGER NOT NULL, head_seq INTEGER NOT NULL, head_hash TEXT NOT NULL, ran_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS formulation_runs_no_update BEFORE UPDATE ON formulation_runs BEGIN SELECT RAISE(ABORT, 'run records are append-only'); END;
CREATE TRIGGER IF NOT EXISTS formulation_runs_no_delete BEFORE DELETE ON formulation_runs BEGIN SELECT RAISE(ABORT, 'run records are append-only'); END;
`;

const GENESIS = '0'.repeat(64);
/** Registry state implied by each stage. The existing four states are unchanged. A revoked version is shown as deprecated to the registry. */
export const REGISTRY_STATE: Record<Stage, 'candidate' | 'tested' | 'active' | 'deprecated'> = {
  candidate: 'candidate', 'evidence-reviewed': 'candidate', 'implementation-tested': 'tested', 'approved-for-specific-use': 'tested',
  active: 'active', suspended: 'tested', revoked: 'deprecated', deprecated: 'deprecated',
};

interface RegistryRow { formulation_id: string; version: string; state: string; algorithm_hash: string; spec_json: string }
interface EventRow {
  seq: number; formulation_id: string; version: string; action: Action; from_stage: Stage; to_stage: Stage; prior_stage: Stage | null; approved_use: Use | null;
  scope_json: string; approver: string; occurred_at: string; expires_at: string | null; definition_hash: string; dependency_hash: string;
  implementation_hash: string; evidence_ref: string; prev_hash: string; event_hash: string;
}

export const installLifecycle = (db: Db): void => { db.exec(SCHEMA); };

function registryRow(db: Db, id: string, version: string): RegistryRow {
  const row = db.prepare('SELECT formulation_id, version, state, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = ? AND version = ?')
    .get(id, version) as RegistryRow | undefined;
  if (!row) throw new LifecycleError('UNKNOWN_FORMULATION');
  return row;
}
/** The definition the approvals are bound to: the stored algorithm hash and the stored spec, exactly as the registry holds them. */
export const definitionHash = (row: Pick<RegistryRow, 'formulation_id' | 'version' | 'algorithm_hash' | 'spec_json'>): string =>
  sha256Hex(canonicalize({ algorithmHash: row.algorithm_hash, formulationId: row.formulation_id, specHash: sha256Hex(row.spec_json), version: row.version }));
const events = (db: Db, id: string, version: string): EventRow[] =>
  db.prepare('SELECT * FROM formulation_lifecycle_events WHERE formulation_id = ? AND version = ? ORDER BY seq').all(id, version) as EventRow[];
const allEvents = (db: Db): EventRow[] => db.prepare('SELECT * FROM formulation_lifecycle_events ORDER BY seq').all() as EventRow[];

function eventBody(row: Omit<EventRow, 'seq' | 'event_hash'>): Record<string, unknown> {
  return {
    action: row.action, approvedUse: row.approved_use, approver: row.approver, definitionHash: row.definition_hash, dependencyHash: row.dependency_hash,
    evidenceRef: row.evidence_ref, expiresAt: row.expires_at, formulationId: row.formulation_id, fromStage: row.from_stage,
    implementationHash: row.implementation_hash, occurredAt: row.occurred_at, priorStage: row.prior_stage, prevHash: row.prev_hash, scopeJson: row.scope_json,
    toStage: row.to_stage, version: row.version,
  };
}

// ---------- chain verification: mandatory, fail closed ----------
export interface ChainState { ok: boolean; code: 'CHAIN_BROKEN' | 'CHAIN_TRUNCATED' | null; head: Checkpoint | null }

/** Walks the whole chain (cost grows with the number of events; a measured caching policy belongs to the implementation card) and compares the head with a trusted checkpoint. */
export function chainState(db: Db, trust?: Pick<Trust, 'checkpoint'>): ChainState {
  let previous = GENESIS;
  let head: Checkpoint | null = null;
  const rows = allEvents(db);
  for (const row of rows) {
    const { seq: _seq, event_hash: stored, ...body } = row;
    if (row.prev_hash !== previous || hashWithDomain('AEG-LIFE-v1', eventBody(body)) !== stored) return { ok: false, code: 'CHAIN_BROKEN', head };
    previous = stored;
    head = { seq: row.seq, hash: stored };
  }
  const trusted = trust?.checkpoint?.() ?? null;
  if (trusted) {
    const atCheckpoint = rows.find((row) => row.seq === trusted.seq);
    if (!head || head.seq < trusted.seq || !atCheckpoint || atCheckpoint.event_hash !== trusted.hash) return { ok: false, code: 'CHAIN_TRUNCATED', head };
  }
  return { ok: true, code: null, head };
}
export const verifyChain = (db: Db, trust?: Pick<Trust, 'checkpoint'>): LifecycleCode | null => chainState(db, trust).code;

// ---------- effective lifecycle ----------
export interface Effective {
  stage: Stage; priorStage: Stage | null; legacy: boolean; approvedUse: Use | null; expiresAtMs: number | null; scope: Scope | null; latest: EventRow | null; formulationSeq: number;
  legacyEntry: { definition_hash: string; implementation_hash: string; dependency_hash: string } | null;
}

export function effectiveLifecycle(db: Db, id: string, version: string): Effective {
  registryRow(db, id, version);
  const list = events(db, id, version);
  const latest = list[list.length - 1] ?? null;
  if (latest) {
    const approval = [...list].reverse().find((item) => item.approved_use !== null) ?? null;
    return {
      stage: latest.to_stage, priorStage: latest.to_stage === 'suspended' ? latest.prior_stage : null, legacy: false, approvedUse: approval?.approved_use ?? null,
      expiresAtMs: approval?.expires_at ? parseInstant(approval.expires_at) : null, scope: approval ? ScopeSchema.parse(JSON.parse(approval.scope_json)) : null, latest,
      formulationSeq: latest.seq, legacyEntry: null,
    };
  }
  const legacy = db.prepare('SELECT definition_hash, implementation_hash, dependency_hash, approved_use, scope_json FROM formulation_lifecycle_legacy WHERE formulation_id = ? AND version = ?')
    .get(id, version) as { definition_hash: string; implementation_hash: string; dependency_hash: string; approved_use: Use; scope_json: string } | undefined;
  if (legacy) {
    return { stage: 'active', priorStage: null, legacy: true, approvedUse: legacy.approved_use, expiresAtMs: null, scope: ScopeSchema.parse(JSON.parse(legacy.scope_json)), latest: null, formulationSeq: 0, legacyEntry: legacy };
  }
  // No events and not adopted: the registry row's state is only a claim, whatever it says. Anything past candidate is unapproved.
  return { stage: 'candidate', priorStage: null, legacy: false, approvedUse: null, expiresAtMs: null, scope: null, latest: null, formulationSeq: 0, legacyEntry: null };
}

// ---------- transitions ----------
const TransitionSchema = z.object({
  formulationId: Ident, version: Ident, action: ActionSchema, approver: Ident, evidenceRef: Reference,
  approvedUse: UseSchema.optional(), scope: ScopeSchema.optional(), expiresAt: z.string().optional(), to: z.string().optional(),
}).strict();
export type Transition = z.input<typeof TransitionSchema>;

const nextForward = (stage: Stage): ForwardStage | null => {
  const index = STAGES.indexOf(stage as ForwardStage);
  return index >= 0 && index < STAGES.length - 1 ? STAGES[index + 1] as ForwardStage : null;
};

function readBindings(trust: Trust, id: string, version: string): Bindings {
  const b = trust.resolveBindings(id, version);
  if (!HASH.test(b.dependencyHash) || !HASH.test(b.implementationHash)) throw new LifecycleError('BAD_INPUT', 'trusted bindings must be sha256 hex');
  return b;
}
function requireChain(db: Db, trust: Trust): void {
  const state = chainState(db, trust);
  if (!state.ok) throw new LifecycleError(state.code as LifecycleCode, 'the lifecycle record cannot be trusted; no transition is accepted');
}

/** Validates and records one transition, and keeps the registry row's state in step, in one transaction. */
export function transition(db: Db, input: Transition, trust: Trust): Effective {
  const t = (() => { try { return TransitionSchema.parse(input); } catch { throw new LifecycleError('BAD_INPUT', 'transition input failed validation'); } })();
  const run = db.transaction(() => {
    requireChain(db, trust);
    const nowMs = trust.clock();
    const row = registryRow(db, t.formulationId, t.version);
    const current = effectiveLifecycle(db, t.formulationId, t.version);
    if (TERMINAL.includes(current.stage)) throw new LifecycleError('TERMINAL', 'a deprecated or revoked formulation cannot change stage; register a new version');
    const defHash = definitionHash(row);
    const bindings = readBindings(trust, t.formulationId, t.version);
    let toStage: Stage;
    let prior: Stage | null = null;
    if (t.action === 'advance') {
      toStage = nextForward(current.stage) ?? (() => { throw new LifecycleError('BAD_TRANSITION', `cannot advance from ${current.stage}`); })();
      if (t.to !== undefined && t.to !== toStage) throw new LifecycleError('STAGE_SKIP', `${current.stage} advances only to ${toStage}`);
      if (current.latest && (current.latest.definition_hash !== defHash || current.latest.dependency_hash !== bindings.dependencyHash
        || current.latest.implementation_hash !== bindings.implementationHash)) throw new LifecycleError('STALE_APPROVAL', 'earlier evidence is bound to different hashes');
      if (toStage === 'approved-for-specific-use') {
        if (!t.approvedUse || !t.scope || !t.expiresAt) throw new LifecycleError('MISSING_FIELD', 'use, scope and expiry are required');
        if (parseInstant(t.expiresAt) <= nowMs) throw new LifecycleError('APPROVAL_EXPIRED');
      }
      if (toStage === 'active') {
        const approval = current.latest;
        if (!approval || approval.to_stage !== 'approved-for-specific-use') throw new LifecycleError('MISSING_APPROVAL', 'activation needs a recorded approval for a named use');
        if (approval.expires_at && parseInstant(approval.expires_at) <= nowMs) throw new LifecycleError('APPROVAL_EXPIRED');
      }
    } else if (t.action === 'reinstate') {
      // Only a SUSPENDED version returns, and only to the stage it was suspended from. It never manufactures an active state.
      if (current.stage !== 'suspended' || !current.priorStage) throw new LifecycleError('BAD_TRANSITION', 'only a suspended formulation can be reinstated');
      toStage = current.priorStage;
      const approval = [...events(db, t.formulationId, t.version)].reverse().find((item) => item.approved_use !== null);
      if (toStage === 'active' || toStage === 'approved-for-specific-use') {
        if (!approval) throw new LifecycleError('MISSING_APPROVAL');
        if (approval.definition_hash !== defHash || approval.dependency_hash !== bindings.dependencyHash || approval.implementation_hash !== bindings.implementationHash) {
          throw new LifecycleError('STALE_APPROVAL', 'the definition or its dependencies changed since approval');
        }
        if (approval.expires_at && parseInstant(approval.expires_at) <= nowMs) throw new LifecycleError('APPROVAL_EXPIRED');
      }
    } else if (t.action === 'suspend') {
      if (current.stage === 'suspended') throw new LifecycleError('BAD_TRANSITION', 'already suspended');
      toStage = 'suspended';
      prior = current.stage;                              // suspension keeps the stage it came from
    } else {
      // Revocation and deprecation are immediate from any non-terminal stage and terminal: stopping an unsafe capability never waits and never undoes.
      toStage = t.action === 'revoke' ? 'revoked' : 'deprecated';
    }
    if (!trust.authority(t.approver, t.action, toStage)) throw new LifecycleError('NOT_AUTHORIZED', 'the approver is not authorized for this action');
    const previous = (db.prepare('SELECT event_hash FROM formulation_lifecycle_events ORDER BY seq DESC LIMIT 1').get() as { event_hash: string } | undefined)?.event_hash ?? GENESIS;
    const keepApproval = t.action === 'advance' && toStage === 'approved-for-specific-use';
    const body: Omit<EventRow, 'seq' | 'event_hash'> = {
      formulation_id: t.formulationId, version: t.version, action: t.action, from_stage: current.stage, to_stage: toStage, prior_stage: prior,
      approved_use: keepApproval ? (t.approvedUse ?? null) : null, scope_json: canonicalize(keepApproval ? t.scope : {}), approver: t.approver, occurred_at: toInstant(nowMs),
      expires_at: keepApproval && t.expiresAt ? toInstant(parseInstant(t.expiresAt)) : null, definition_hash: defHash, dependency_hash: bindings.dependencyHash,
      implementation_hash: bindings.implementationHash, evidence_ref: t.evidenceRef, prev_hash: previous,
    };
    db.prepare(`INSERT INTO formulation_lifecycle_events (formulation_id, version, action, from_stage, to_stage, prior_stage, approved_use, scope_json, approver, occurred_at, expires_at,
      definition_hash, dependency_hash, implementation_hash, evidence_ref, prev_hash, event_hash) VALUES (@formulation_id, @version, @action, @from_stage, @to_stage, @prior_stage, @approved_use,
      @scope_json, @approver, @occurred_at, @expires_at, @definition_hash, @dependency_hash, @implementation_hash, @evidence_ref, @prev_hash, @event_hash)`)
      .run({ ...body, event_hash: hashWithDomain('AEG-LIFE-v1', eventBody(body)) });
    // State-only update: allowed by the existing trigger, which blocks only definition changes on an active row.
    db.prepare('UPDATE formulation_registry SET state = ? WHERE formulation_id = ? AND version = ?').run(REGISTRY_STATE[toStage], t.formulationId, t.version);
    return effectiveLifecycle(db, t.formulationId, t.version);
  });
  return run.immediate();
}

// ---------- execution guard ----------
const wide = (list: string[], value: string): boolean => list.includes('*') || list.includes(value);
const RequestSchema = z.object({
  formulationId: Ident, version: Ident, use: UseSchema, tenant: Ident, purpose: Ident, resource: Ident, jurisdiction: Ident, validity: Ident, action: Ident.optional(),
}).strict();
export type ExecutionRequest = z.input<typeof RequestSchema>;
export interface Revision { formulationSeq: number; headSeq: number; headHash: string }
export interface Authorization { authorized: boolean; reasons: string[]; revision: Revision | null }

/** The mandatory guard: lifecycle stage, registry state, hashes, expiry, use ceiling and the FULL scope, with the chain verified first. Checked on EVERY execution. */
export function authorizeExecution(db: Db, input: ExecutionRequest, trust: Trust): Authorization {
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) return { authorized: false, reasons: ['BAD_INPUT'], revision: null };
  const r = parsed.data;
  const chain = chainState(db, trust);
  if (!chain.ok) return { authorized: false, reasons: [chain.code as string], revision: null };       // fail closed on corruption or truncation
  const reasons: string[] = [];
  let row: RegistryRow;
  try { row = registryRow(db, r.formulationId, r.version); } catch { return { authorized: false, reasons: ['UNKNOWN_FORMULATION'], revision: null }; }
  const effective = effectiveLifecycle(db, r.formulationId, r.version);
  const nowMs = trust.clock();
  let bindings: Bindings;
  try { bindings = readBindings(trust, r.formulationId, r.version); } catch { return { authorized: false, reasons: ['BINDINGS_UNRESOLVED'], revision: null }; }
  if (effective.stage !== 'active') reasons.push(`STAGE_${effective.stage.toUpperCase().replace(/-/g, '_')}`);
  if (row.state !== 'active') reasons.push('REGISTRY_STATE_NOT_ACTIVE');
  const defHash = definitionHash(row);
  const bound = effective.legacyEntry ?? effective.latest;
  if (bound) {
    const bDef = 'definition_hash' in bound ? bound.definition_hash : '';
    if (bDef !== defHash) reasons.push('DEFINITION_CHANGED');
    if (bound.dependency_hash !== bindings.dependencyHash) reasons.push('DEPENDENCY_CHANGED');
    if (bound.implementation_hash !== bindings.implementationHash) reasons.push('IMPLEMENTATION_CHANGED');
  }
  if (effective.expiresAtMs !== null && effective.expiresAtMs <= nowMs) reasons.push('APPROVAL_EXPIRED');
  if (!effective.approvedUse) reasons.push('NO_APPROVED_USE');
  else if (USE_RANK[r.use] > USE_RANK[effective.approvedUse]) reasons.push(`USE_ABOVE_APPROVAL_${effective.approvedUse}`);
  if (!effective.scope) reasons.push('NO_SCOPE');
  else {
    if (!wide(effective.scope.tenants, r.tenant)) reasons.push('TENANT_OUT_OF_SCOPE');
    if (!wide(effective.scope.purposes, r.purpose)) reasons.push('PURPOSE_OUT_OF_SCOPE');
    if (!wide(effective.scope.resources, r.resource)) reasons.push('RESOURCE_OUT_OF_SCOPE');
    if (!wide(effective.scope.jurisdictions, r.jurisdiction)) reasons.push('JURISDICTION_OUT_OF_SCOPE');
    if (!wide(effective.scope.validity, r.validity)) reasons.push('VALIDITY_DOMAIN_OUT_OF_SCOPE');
    if (r.action !== undefined && !effective.scope.actions.includes(r.action)) reasons.push('ACTION_NOT_PERMITTED');   // a use label grants no action
  }
  const head = chain.head ?? { seq: 0, hash: GENESIS };
  return { authorized: reasons.length === 0, reasons, revision: { formulationSeq: effective.formulationSeq, headSeq: head.seq, headHash: head.hash } };
}

/**
 * Authorization and the consequential work share one immediate transaction, so a stop recorded before the work commits blocks it. With a fence, the
 * lifecycle revision seen at planning time must still be current. The revision that authorized the run is recorded with it.
 */
export function guardedRun<T>(db: Db, input: ExecutionRequest, trust: Trust, work: () => T, fence?: Revision): { result: T; revision: Revision } {
  const run = db.transaction(() => {
    const auth = authorizeExecution(db, input, trust);
    if (!auth.authorized || !auth.revision) throw new LifecycleError('NOT_AUTHORIZED', auth.reasons.join(','));
    if (fence && (fence.formulationSeq !== auth.revision.formulationSeq || fence.headSeq !== auth.revision.headSeq || fence.headHash !== auth.revision.headHash)) {
      throw new LifecycleError('REVISION_CHANGED', 'the lifecycle changed after this run was planned');
    }
    const result = work();
    const r = RequestSchema.parse(input);
    db.prepare('INSERT INTO formulation_runs (formulation_id, version, use, formulation_seq, head_seq, head_hash, ran_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.formulationId, r.version, r.use, auth.revision.formulationSeq, auth.revision.headSeq, auth.revision.headHash, toInstant(trust.clock()));
    return { result, revision: auth.revision };
  });
  return run.immediate();
}

// ---------- reconciliation ----------
export function reconcile(db: Db, trust?: Pick<Trust, 'checkpoint'>): string[] {
  const issues: string[] = [];
  const chain = chainState(db, trust);
  if (!chain.ok) issues.push(chain.code as string);
  const rows = db.prepare('SELECT formulation_id, version, state, algorithm_hash, spec_json FROM formulation_registry').all() as RegistryRow[];
  for (const row of rows) {
    const effective = effectiveLifecycle(db, row.formulation_id, row.version);
    const key = `${row.formulation_id}@${row.version}`;
    if (effective.latest && REGISTRY_STATE[effective.stage] !== row.state) issues.push(`STATE_MISMATCH ${key}: registry ${row.state}, lifecycle ${effective.stage}`);
    if (!effective.latest && !effective.legacy && row.state !== 'candidate') issues.push(`UNAPPROVED_STATE ${key}: registry ${row.state} has no lifecycle record`);
    if (effective.latest && effective.latest.definition_hash !== definitionHash(row)) issues.push(`DEFINITION_CHANGED ${key}`);
    if (effective.legacyEntry && effective.legacyEntry.definition_hash !== definitionHash(row)) issues.push(`DEFINITION_CHANGED ${key}`);
  }
  return issues;
}

// ---------- legacy adoption: an explicit, reviewed, immutable allowlist, applied once ----------
export const LegacyEntrySchema = z.object({
  formulationId: Ident, version: Ident, definitionHash: Hash, implementationHash: Hash, dependencyHash: Hash, use: UseSchema, scope: ScopeSchema, reviewedBy: Ident, evidenceRef: Reference,
}).strict();
export type LegacyEntry = z.input<typeof LegacyEntrySchema>;

/** Adopts exactly the listed rows, once. A row that is not listed, whose definition differs from the reviewed hash, or that is not active, is refused. Later rows can never be adopted. */
export function adoptLegacy(db: Db, allowlist: LegacyEntry[], trust: Pick<Trust, 'clock'>): number {
  const entries = z.array(LegacyEntrySchema).min(1).max(64).parse(allowlist);
  const run = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM formulation_lifecycle_adoption_seal').get()) throw new LifecycleError('ADOPTION_CLOSED', 'legacy adoption was already performed and sealed');
    const insert = db.prepare(`INSERT INTO formulation_lifecycle_legacy (formulation_id, version, definition_hash, implementation_hash, dependency_hash, approved_use, scope_json, reviewed_by, evidence_ref, adopted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const entry of entries) {
      const row = registryRow(db, entry.formulationId, entry.version);
      if (row.state !== 'active') throw new LifecycleError('NOT_ON_ALLOWLIST', `${entry.formulationId}@${entry.version} is not an active row`);
      if (definitionHash(row) !== entry.definitionHash) throw new LifecycleError('NOT_ON_ALLOWLIST', `${entry.formulationId}@${entry.version} differs from the reviewed definition`);
      if (events(db, entry.formulationId, entry.version).length > 0) throw new LifecycleError('NOT_ON_ALLOWLIST', 'a row with lifecycle events is not legacy');
      insert.run(entry.formulationId, entry.version, entry.definitionHash, entry.implementationHash, entry.dependencyHash, entry.use, canonicalize(entry.scope), entry.reviewedBy, entry.evidenceRef, toInstant(trust.clock()));
    }
    db.prepare('INSERT INTO formulation_lifecycle_adoption_seal (id, allowlist_hash, sealed_at) VALUES (1, ?, ?)')
      .run(hashWithDomain('AEG-LIFE-v1', { entries: entries.map((e) => ({ f: e.formulationId, v: e.version, d: e.definitionHash, i: e.implementationHash, p: e.dependencyHash, u: e.use, s: canonicalize(e.scope) })) }), toInstant(trust.clock()));
    return entries.length;
  });
  return run.immediate();
}

// ---------- adapter over the REAL registry reader (the frozen definition is never edited) ----------
export interface AuthorizedFormulation { definition: Record<string, unknown>; effectiveState: string; revision: Revision; legacy: boolean }
const DEFINITION_TIME_STATUS = 'candidate';

/**
 * Policy: a lifecycle-managed formulation is registered with status "candidate" in its stored definition and that definition is NEVER edited, so approved
 * definitions stay immutable. The existing reader compares the stored status with the row state and fails closed (E_INTERNAL) for such a row once it is
 * promoted, which is safe but unusable; this adapter is therefore the only path to a lifecycle-managed definition. A legacy row (stored status equal to its
 * row state, adopted from the allowlist) is still read with the real reader.
 */
export function getAuthorizedFormulation(db: Db, input: ExecutionRequest, trust: Trust): AuthorizedFormulation {
  const auth = authorizeExecution(db, input, trust);
  if (!auth.authorized || !auth.revision) throw new LifecycleError('NOT_AUTHORIZED', auth.reasons.join(','));
  const r = RequestSchema.parse(input);
  const effective = effectiveLifecycle(db, r.formulationId, r.version);
  if (effective.legacy) {
    const definition = getActiveFormulation(db, r.formulationId, r.version);   // the real reader, untouched
    return { definition: definition as unknown as Record<string, unknown>, effectiveState: 'active', revision: auth.revision, legacy: true };
  }
  const row = registryRow(db, r.formulationId, r.version);
  const stored = JSON.parse(row.spec_json) as Record<string, unknown>;
  const complete = ['formulationId', 'semanticVersion', 'title', 'inputSchema', 'outputSchema', 'units', 'assumptions', 'preconditions', 'deterministicAlgorithmRef',
    'algorithmHash', 'roundingPolicy', 'examples', 'invalidCases', 'owner', 'status', 'effectiveFrom'].every((key) => key in stored);
  if (!complete || stored.formulationId !== row.formulation_id || stored.semanticVersion !== row.version || stored.algorithmHash !== row.algorithm_hash || stored.status !== DEFINITION_TIME_STATUS) {
    throw new LifecycleError('BAD_INPUT', 'the stored definition does not match its registry row or the definition-time status policy');
  }
  return { definition: { ...stored, status: REGISTRY_STATE[effective.stage] }, effectiveState: effective.stage, revision: auth.revision, legacy: false };
}

// ---------- migration rehearsal helpers ----------
export const DOWN = `
DROP TRIGGER IF EXISTS formulation_runs_no_update; DROP TRIGGER IF EXISTS formulation_runs_no_delete; DROP TABLE IF EXISTS formulation_runs;
DROP TRIGGER IF EXISTS lifecycle_seal_no_update; DROP TRIGGER IF EXISTS lifecycle_seal_no_delete; DROP TABLE IF EXISTS formulation_lifecycle_adoption_seal;
DROP TRIGGER IF EXISTS lifecycle_legacy_no_update; DROP TRIGGER IF EXISTS lifecycle_legacy_no_delete; DROP TABLE IF EXISTS formulation_lifecycle_legacy;
DROP TRIGGER IF EXISTS lifecycle_events_no_update; DROP TRIGGER IF EXISTS lifecycle_events_no_delete; DROP TABLE IF EXISTS formulation_lifecycle_events;
`;

/** Rolling back is clean only while no lifecycle record exists. After use the registry's states were changed by the lifecycle, so the only safe path is to fix forward. */
export function rollbackLifecycle(db: Db): void {
  const used = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const run = db.transaction(() => {
    if (used('formulation_lifecycle_events') + used('formulation_lifecycle_legacy') + used('formulation_runs') > 0) {
      throw new LifecycleError('BAD_TRANSITION', 'rollback refused: lifecycle records exist and the registry states follow them; fix forward');
    }
    db.exec(DOWN);
  });
  run.immediate();
}

/** Replay: derive every managed row's registry state from the event record alone (state-only updates, which the existing trigger allows). Returns how many rows changed. */
export function resyncRegistryStates(db: Db): number {
  let changed = 0;
  const run = db.transaction(() => {
    const ids = db.prepare('SELECT DISTINCT formulation_id, version FROM formulation_lifecycle_events').all() as { formulation_id: string; version: string }[];
    for (const { formulation_id, version } of ids) {
      const want = REGISTRY_STATE[effectiveLifecycle(db, formulation_id, version).stage];
      const result = db.prepare('UPDATE formulation_registry SET state = ? WHERE formulation_id = ? AND version = ? AND state <> ?').run(want, formulation_id, version, want);
      changed += result.changes;
    }
  });
  run.immediate();
  return changed;
}
