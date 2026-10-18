import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { canonicalize } from '../../src/engine/canonical.js';
import { getActiveFormulation, seedFormulations } from '../../src/registry/formulations.js';
import {
  adoptLegacy, authorizeExecution, chainState, definitionHash, effectiveLifecycle, getAuthorizedFormulation, guardedRun, installLifecycle, LifecycleError, parseInstant,
  reconcile, transition, verifyChain, type Bindings, type Checkpoint, type ExecutionRequest, type LifecycleCode, type Scope, type Transition, type Trust,
} from './lifecycle.js';

type Db = import('better-sqlite3').Database;
const migrations = fileURLToPath(new URL('../../migrations/', import.meta.url));
const T0 = '2026-10-13T00:00:00Z';
const ID = 'AEG.F.DEMAND-FLOW';
const V = '1.0.0';
const bindings: Bindings = { dependencyHash: 'd'.repeat(64), implementationHash: 'b'.repeat(64) };
const scope: Scope = { tenants: ['TENANT-A'], purposes: ['planning-demo'], jurisdictions: ['XX'], resources: ['water'], validity: ['region-1'], actions: [] };

/** A real-shaped definition: every field the real reader requires, stored exactly the way seedFormulations stores one. */
function realDefinition(id: string): Record<string, unknown> {
  return {
    formulationId: id, semanticVersion: V, title: 'Demand flow', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, units: ['L'], assumptions: ['exact rationals'],
    preconditions: ['cohorts are disjoint'], deterministicAlgorithmRef: 'research/engineer/rational.ts', algorithmHash: 'a'.repeat(64),
    roundingPolicy: 'exact through composition; ceiling only at a declared packing boundary', examples: [], invalidCases: [], owner: 'Claude', status: 'candidate', effectiveFrom: T0,
  };
}
function insertDefinition(db: Db, id: string): void {
  const definition = realDefinition(id);
  db.prepare('INSERT INTO formulation_registry (formulation_id, version, state, algorithm_hash, spec_json, effective_from) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, V, 'candidate', definition.algorithmHash, canonicalize(definition), T0);
}
function makeDb(): Db {
  const db = openDb(':memory:');
  migrate(db, migrations, T0);          // the real schema, including the real active-immutability trigger
  installLifecycle(db);
  insertDefinition(db, ID);
  return db;
}

let clockMs = parseInstant('2026-10-13T00:00:00Z');
let current: Bindings = bindings;
let checkpoint: Checkpoint | null = null;
const principals = new Set(['astra', 'owner']);
const trust = (): Trust => ({
  clock: () => clockMs,
  resolveBindings: () => current,
  authority: (approver) => principals.has(approver),
  checkpoint: () => checkpoint,
});
function reset(): void { clockMs = parseInstant('2026-10-13T00:00:00Z'); current = bindings; checkpoint = null; }

const step = (db: Db, over: Partial<Transition> = {}) =>
  transition(db, { formulationId: ID, version: V, action: 'advance', approver: 'astra', evidenceRef: 'review-1', ...over }, trust());
const code = (action: () => unknown): LifecycleCode | string | null => {
  try { action(); return null; } catch (error: unknown) { return error instanceof LifecycleError ? error.code : (error as Error).message; }
};
function toActive(db: Db): void {
  step(db); step(db);                                                                                   // evidence-reviewed, implementation-tested
  step(db, { approvedUse: 'PLANNING', scope, expiresAt: '2027-01-01T00:00:00Z' });                      // approved-for-specific-use
  step(db);                                                                                             // active
}
const request = (over: Partial<ExecutionRequest> = {}): ExecutionRequest =>
  ({ formulationId: ID, version: V, use: 'PLANNING', tenant: 'TENANT-A', purpose: 'planning-demo', resource: 'water', jurisdiction: 'XX', validity: 'region-1', ...over });

describe('D2: lifecycle storage and transitions beside the unchanged four-state registry', () => {
  it('reproduces Astra\'s finding on the real migrations: a state-and-spec update on an active row is rejected, a state-only update is allowed', () => {
    reset();
    const db = makeDb();
    toActive(db);
    assert.throws(() => db.prepare("UPDATE formulation_registry SET state = 'deprecated', spec_json = ? WHERE formulation_id = ?").run('{"lifecycle":"deprecated"}', ID), /active formulation is immutable/);
    db.prepare("UPDATE formulation_registry SET state = 'deprecated' WHERE formulation_id = ?").run(ID);
    assert.equal((JSON.parse((db.prepare('SELECT spec_json FROM formulation_registry').get() as { spec_json: string }).spec_json) as { status: string }).status, 'candidate');
  });

  it('walks candidate to active one stage at a time, keeps the registry in step, and authorizes the approved use and scope only', () => {
    reset();
    const db = makeDb();
    toActive(db);
    assert.equal(effectiveLifecycle(db, ID, V).stage, 'active');
    assert.equal((db.prepare('SELECT state FROM formulation_registry').get() as { state: string }).state, 'active');
    const ok = authorizeExecution(db, request(), trust());
    assert.deepEqual([ok.authorized, ok.reasons], [true, []]);
    assert.ok(authorizeExecution(db, request({ use: 'OPERATIONAL' }), trust()).reasons.includes('USE_ABOVE_APPROVAL_PLANNING'));
    assert.equal(verifyChain(db, trust()), null);
    assert.deepEqual(reconcile(db, trust()), []);
  });

  it('checks the FULL scope on every execution: tenant, purpose, resource, jurisdiction, validity domain and action', () => {
    reset();
    const db = makeDb();
    toActive(db);
    const denied = (over: Partial<ExecutionRequest>) => authorizeExecution(db, request(over), trust()).reasons;
    assert.ok(denied({ tenant: 'TENANT-B' }).includes('TENANT_OUT_OF_SCOPE'));
    assert.ok(denied({ purpose: 'dispatch' }).includes('PURPOSE_OUT_OF_SCOPE'));
    assert.ok(denied({ resource: 'medicine' }).includes('RESOURCE_OUT_OF_SCOPE'));
    assert.ok(denied({ jurisdiction: 'YY' }).includes('JURISDICTION_OUT_OF_SCOPE'));
    assert.ok(denied({ validity: 'region-9' }).includes('VALIDITY_DOMAIN_OUT_OF_SCOPE'));
    assert.ok(denied({ action: 'dispatch' }).includes('ACTION_NOT_PERMITTED'));
  });

  it('refuses a skipped stage', () => {
    reset();
    const db = makeDb();
    assert.equal(code(() => step(db, { to: 'active' })), 'STAGE_SKIP');
    assert.equal(code(() => step(db, { to: 'approved-for-specific-use' })), 'STAGE_SKIP');
  });

  it('refuses metadata-only activation: a spec that claims "active", or a bare state update, authorizes nothing', () => {
    reset();
    const db = makeDb();
    db.prepare("UPDATE formulation_registry SET spec_json = ? WHERE formulation_id = ?").run('{"lifecycle":{"stage":"active"}}', ID);   // allowed on a candidate row
    assert.equal(authorizeExecution(db, request(), trust()).authorized, false);
    db.prepare("UPDATE formulation_registry SET state = 'active' WHERE formulation_id = ?").run(ID);
    const result = authorizeExecution(db, request(), trust());
    assert.equal(result.authorized, false);
    assert.ok(result.reasons.includes('STAGE_CANDIDATE'));
    assert.ok(reconcile(db, trust()).some((issue) => issue.startsWith('UNAPPROVED_STATE')));
  });

  it('activation needs a recorded approval for a named use, with scope and an unexpired expiry', () => {
    reset();
    const db = makeDb();
    step(db); step(db);
    assert.equal(code(() => step(db)), 'MISSING_FIELD');
    assert.equal(code(() => step(db, { approvedUse: 'PLANNING', scope, expiresAt: '2026-10-12T00:00:00Z' })), 'APPROVAL_EXPIRED');
  });

  it('refuses a stale approval: a changed definition or a changed trusted binding invalidates earlier evidence', () => {
    reset();
    const db = makeDb();
    step(db); step(db);
    db.prepare("UPDATE formulation_registry SET spec_json = ? WHERE formulation_id = ?").run(canonicalize({ ...realDefinition(ID), title: 'edited' }), ID);   // candidate rows may still be edited
    assert.equal(code(() => step(db, { approvedUse: 'PLANNING', scope, expiresAt: '2027-01-01T00:00:00Z' })), 'STALE_APPROVAL');
    const other = makeDb();
    step(other); step(other);
    current = { ...bindings, dependencyHash: 'e'.repeat(64) };
    assert.equal(code(() => step(other, { approvedUse: 'PLANNING', scope, expiresAt: '2027-01-01T00:00:00Z' })), 'STALE_APPROVAL');
    reset();
  });

  it('re-checks hashes and expiry against TRUSTED values on every execution', () => {
    reset();
    const db = makeDb();
    toActive(db);
    current = { ...bindings, dependencyHash: 'e'.repeat(64) };
    assert.ok(authorizeExecution(db, request(), trust()).reasons.includes('DEPENDENCY_CHANGED'));
    current = { ...bindings, implementationHash: 'e'.repeat(64) };
    assert.ok(authorizeExecution(db, request(), trust()).reasons.includes('IMPLEMENTATION_CHANGED'));
    current = bindings;
    clockMs = parseInstant('2027-01-02T00:00:00Z');
    assert.ok(authorizeExecution(db, request(), trust()).reasons.includes('APPROVAL_EXPIRED'));
    reset();
  });

  it('allows immediate suspension from active, and reinstatement only to the stage it came from with unchanged hashes', () => {
    reset();
    const db = makeDb();
    toActive(db);
    step(db, { action: 'suspend', evidenceRef: 'incident-7' });
    assert.equal(effectiveLifecycle(db, ID, V).stage, 'suspended');
    assert.equal(authorizeExecution(db, request(), trust()).authorized, false);
    assert.equal((db.prepare('SELECT state FROM formulation_registry').get() as { state: string }).state, 'tested');
    step(db, { action: 'reinstate', evidenceRef: 'fixed-7' });
    assert.equal(effectiveLifecycle(db, ID, V).stage, 'active');
    assert.equal(authorizeExecution(db, request(), trust()).authorized, true);
    step(db, { action: 'suspend', evidenceRef: 'incident-8' });
    current = { ...bindings, dependencyHash: 'e'.repeat(64) };
    assert.equal(code(() => step(db, { action: 'reinstate' })), 'STALE_APPROVAL');
    reset();
  });
});

describe('R1: revocation cannot be bypassed, and suspension keeps the stage it came from', () => {
  it('Astra\'s sequence: active, revoke, suspend, reinstate is refused at the first step after the revoke', () => {
    reset();
    const db = makeDb();
    toActive(db);
    step(db, { action: 'revoke', evidenceRef: 'evidence-withdrawn' });
    assert.equal(effectiveLifecycle(db, ID, V).stage, 'revoked');
    assert.equal(code(() => step(db, { action: 'suspend' })), 'TERMINAL');
    assert.equal(code(() => step(db, { action: 'reinstate' })), 'TERMINAL');
    assert.equal(code(() => step(db)), 'TERMINAL');
    assert.equal(authorizeExecution(db, request(), trust()).authorized, false);
    assert.equal((db.prepare('SELECT state FROM formulation_registry').get() as { state: string }).state, 'deprecated');   // never executable again; a new version is required
  });

  it('suspension before first activation does not manufacture an active state: reinstate returns to the earlier stage', () => {
    reset();
    const db = makeDb();
    step(db); step(db);                                            // implementation-tested
    step(db, { action: 'suspend', evidenceRef: 'hold' });
    step(db, { action: 'reinstate', evidenceRef: 'release' });
    const back = effectiveLifecycle(db, ID, V);
    assert.equal(back.stage, 'implementation-tested');
    assert.equal(authorizeExecution(db, request(), trust()).authorized, false);
    assert.equal(code(() => step(db, { action: 'reinstate' })), 'BAD_TRANSITION');           // not suspended any more
    const early = makeDb();
    step(early, { action: 'suspend', evidenceRef: 'hold' });
    step(early, { action: 'reinstate', evidenceRef: 'release' });
    assert.equal(effectiveLifecycle(early, ID, V).stage, 'candidate');
  });

  it('a version that was suspended twice in a row, or deprecated, cannot be reinstated', () => {
    reset();
    const db = makeDb();
    toActive(db);
    step(db, { action: 'suspend', evidenceRef: 'a' });
    assert.equal(code(() => step(db, { action: 'suspend', evidenceRef: 'b' })), 'BAD_TRANSITION');
    step(db, { action: 'deprecate', evidenceRef: 'obsolete' });
    assert.equal(code(() => step(db, { action: 'reinstate' })), 'TERMINAL');
  });

  it('refuses the workaround: deprecate, edit the spec, reactivate', () => {
    reset();
    const db = makeDb();
    toActive(db);
    step(db, { action: 'deprecate', evidenceRef: 'obsolete' });
    db.prepare("UPDATE formulation_registry SET spec_json = ? WHERE formulation_id = ?").run(canonicalize({ ...realDefinition(ID), title: 'edited after deprecation' }), ID);
    assert.equal(code(() => step(db)), 'TERMINAL');
    db.prepare("UPDATE formulation_registry SET state = 'active' WHERE formulation_id = ?").run(ID);
    const result = authorizeExecution(db, request(), trust());
    assert.equal(result.authorized, false);
    assert.ok(result.reasons.includes('STAGE_DEPRECATED') && result.reasons.includes('DEFINITION_CHANGED'));
    assert.ok(reconcile(db, trust()).some((issue) => issue.startsWith('STATE_MISMATCH')));
  });
});

describe('R2: legacy adoption is an explicit, reviewed, immutable, one-time allowlist', () => {
  function seededDb(): { db: Db; entry: Parameters<typeof adoptLegacy>[1][number] } {
    const db = openDb(':memory:');
    migrate(db, migrations, T0);
    installLifecycle(db);
    seedFormulations(db, T0);                                                                  // the real frozen shortfall row, active, from the real seeder
    const row = db.prepare("SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = 'AEG.F.RESOURCE-SHORTFALL'").get() as Parameters<typeof definitionHash>[0];
    return { db, entry: {
      formulationId: row.formulation_id, version: row.version, definitionHash: definitionHash(row), implementationHash: bindings.implementationHash, dependencyHash: bindings.dependencyHash,
      use: 'PLANNING', scope: { ...scope, tenants: ['*'], resources: ['*'], validity: ['*'], jurisdictions: ['*'], purposes: ['planning-demo'] }, reviewedBy: 'astra', evidenceRef: 'A0005 R2',
    } };
  }
  const shortfall = (over: Partial<ExecutionRequest> = {}): ExecutionRequest => request({ formulationId: 'AEG.F.RESOURCE-SHORTFALL', ...over });

  it('adopts exactly the listed row, with its reviewed use and scope, and the real reader still reads it', () => {
    reset();
    const { db, entry } = seededDb();
    assert.equal(adoptLegacy(db, [entry], trust()), 1);
    assert.equal(authorizeExecution(db, shortfall(), trust()).authorized, true);
    assert.ok(authorizeExecution(db, shortfall({ use: 'OPERATIONAL' }), trust()).reasons.includes('USE_ABOVE_APPROVAL_PLANNING'));
    assert.ok(authorizeExecution(db, shortfall({ purpose: 'other' }), trust()).reasons.includes('PURPOSE_OUT_OF_SCOPE'));
    const read = getAuthorizedFormulation(db, shortfall(), trust());
    assert.equal(read.legacy, true);
    assert.equal(read.definition.formulationId, 'AEG.F.RESOURCE-SHORTFALL');
    assert.equal(getActiveFormulation(db, 'AEG.F.RESOURCE-SHORTFALL', '1.0.0').formulationId, 'AEG.F.RESOURCE-SHORTFALL');
  });

  it('Astra\'s probe: a candidate row flipped to active then "adopted" is refused, and so is any unlisted or changed row', () => {
    reset();
    const { db, entry } = seededDb();
    db.prepare("UPDATE formulation_registry SET state = 'active' WHERE formulation_id = ?").run(ID.replace('DEMAND-FLOW', 'RESOURCE-SHORTFALL') + 'X');   // no such row: harmless
    insertDefinition(db, ID);
    db.prepare("UPDATE formulation_registry SET state = 'active' WHERE formulation_id = ?").run(ID);
    const flipped = { ...entry, formulationId: ID, version: V, definitionHash: definitionHash(db.prepare('SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = ?').get(ID) as Parameters<typeof definitionHash>[0]) };
    assert.equal(adoptLegacy(db, [entry], trust()), 1);                          // the reviewed list is applied
    assert.equal(code(() => adoptLegacy(db, [flipped], trust())), 'ADOPTION_CLOSED');
    assert.equal(authorizeExecution(db, request({ formulationId: ID }), trust()).authorized, false);
  });

  it('a definition that differs from the reviewed hash, or a row that is not active, is refused, and nothing is adopted', () => {
    reset();
    const { db, entry } = seededDb();
    assert.equal(code(() => adoptLegacy(db, [{ ...entry, definitionHash: 'f'.repeat(64) }], trust())), 'NOT_ON_ALLOWLIST');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM formulation_lifecycle_legacy').get().n, 0);
    const second = makeDb();                                                      // a candidate row
    const candidate = { ...entry, formulationId: ID, version: V, definitionHash: definitionHash(second.prepare('SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry').get() as Parameters<typeof definitionHash>[0]) };
    assert.equal(code(() => adoptLegacy(second, [candidate], trust())), 'NOT_ON_ALLOWLIST');
  });

  it('the adoption record is immutable, sealed after one use, and changed bindings or tenants lose the authority', () => {
    reset();
    const { db, entry } = seededDb();
    adoptLegacy(db, [entry], trust());
    assert.throws(() => db.prepare("UPDATE formulation_lifecycle_legacy SET approved_use = 'OPERATIONAL'").run(), /immutable/);
    assert.throws(() => db.prepare('DELETE FROM formulation_lifecycle_legacy').run(), /immutable/);
    assert.throws(() => db.prepare('DELETE FROM formulation_lifecycle_adoption_seal').run(), /immutable/);
    assert.equal(code(() => adoptLegacy(db, [entry], trust())), 'ADOPTION_CLOSED');
    current = { ...bindings, implementationHash: 'e'.repeat(64) };
    assert.ok(authorizeExecution(db, shortfall(), trust()).reasons.includes('IMPLEMENTATION_CHANGED'));
    reset();
  });
});

describe('server-side trust and runtime validation', () => {
  it('a caller cannot pass the clock or the hashes, and malformed shapes are refused at runtime', () => {
    reset();
    const db = makeDb();
    const bad = (input: unknown) => code(() => transition(db, input as Transition, trust()));
    assert.equal(bad({ formulationId: ID, version: V, action: 'advance', approver: 'astra', evidenceRef: 'x', now: '2026-10-13T00:00:00Z' }), 'BAD_INPUT');
    assert.equal(bad({ formulationId: ID, version: V, action: 'advance', approver: 'astra', evidenceRef: 'x', bindings }), 'BAD_INPUT');
    assert.equal(bad({ formulationId: ID, version: V, action: 'teleport', approver: 'astra', evidenceRef: 'x' }), 'BAD_INPUT');
    assert.equal(bad({ formulationId: ID, version: V, action: 'advance', approver: 'as tra', evidenceRef: 'x' }), 'BAD_INPUT');
    assert.equal(bad({ formulationId: ID, version: V, action: 'advance', approver: 'astra', evidenceRef: '' }), 'BAD_INPUT');
    assert.equal(bad({ formulationId: ID, version: V, action: 'advance', approver: 'astra', evidenceRef: 'x', approvedUse: 'GOD_MODE' }), 'BAD_INPUT');
    assert.equal(bad({ formulationId: ID, version: V, action: 'advance', approver: 'astra', evidenceRef: 'x', scope: { tenants: [] } }), 'BAD_INPUT');
    assert.deepEqual(authorizeExecution(db, { ...request(), use: 'ROOT' as never }, trust()).reasons, ['BAD_INPUT']);
    assert.deepEqual(authorizeExecution(db, { ...request(), now: T0 } as never, trust()).reasons, ['BAD_INPUT']);
  });

  it('an approver without authority cannot record a transition, and nothing is written', () => {
    reset();
    const db = makeDb();
    assert.equal(code(() => step(db, { approver: 'mallory' })), 'NOT_AUTHORIZED');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM formulation_lifecycle_events').get().n, 0);
  });

  it('instants are canonical UTC and compared as numbers; impossible dates and other spellings are refused', () => {
    assert.equal(parseInstant('2026-10-13T00:00:00Z'), Date.UTC(2026, 9, 13));
    for (const bad of ['2026-10-13', '2026-10-13T00:00:00+00:00', '2026-02-30T00:00:00Z', '2026-10-13 00:00:00', '2026-10-13T00:00:00.000Z', 'tomorrow']) {
      assert.throws(() => parseInstant(bad), /instant|real UTC/, bad);
    }
    reset();
    const db = makeDb();
    step(db); step(db);
    assert.equal(code(() => step(db, { approvedUse: 'PLANNING', scope, expiresAt: '2027-02-30T00:00:00Z' })), 'BAD_INPUT');
  });
});

describe('the event chain is verified on every authorization, against a trusted head, and fails closed', () => {
  it('a tampered event stops every authorization and every transition', () => {
    reset();
    const db = makeDb();
    toActive(db);
    db.exec('DROP TRIGGER lifecycle_events_no_update');              // an attacker with schema rights removes the guard ...
    db.prepare("UPDATE formulation_lifecycle_events SET approver = 'mallory' WHERE seq = 3").run();
    assert.equal(chainState(db, trust()).code, 'CHAIN_BROKEN');      // ... and the chain still shows it
    assert.deepEqual(authorizeExecution(db, request(), trust()).reasons, ['CHAIN_BROKEN']);
    assert.equal(code(() => step(db, { action: 'suspend' })), 'CHAIN_BROKEN');
    assert.ok(reconcile(db, trust()).includes('CHAIN_BROKEN'));
  });

  it('truncation of the tail is detected against a trusted external checkpoint', () => {
    reset();
    const db = makeDb();
    toActive(db);
    const head = chainState(db, trust()).head as Checkpoint;
    checkpoint = head;                                                // stored outside the database
    step(db, { action: 'suspend', evidenceRef: 'incident' });
    checkpoint = chainState(db, trust()).head as Checkpoint;
    db.exec('DROP TRIGGER lifecycle_events_no_delete');
    db.prepare('DELETE FROM formulation_lifecycle_events WHERE seq = ?').run(checkpoint.seq);    // the stop is erased, the remaining chain is internally valid
    assert.equal(chainState(db, { checkpoint: () => null }).code, null);                           // without a checkpoint it looks fine ...
    assert.equal(chainState(db, trust()).code, 'CHAIN_TRUNCATED');                                 // ... with the trusted head it does not
    assert.deepEqual(authorizeExecution(db, request(), trust()).reasons, ['CHAIN_TRUNCATED']);
    reset();
  });
});

describe('check-then-act: a stop recorded before the action commits blocks it, and the authorizing revision is recorded', () => {
  it('a run records the lifecycle revision that authorized it', () => {
    reset();
    const db = makeDb();
    toActive(db);
    const out = guardedRun(db, request(), trust(), () => 21000);
    assert.equal(out.result, 21000);
    const run = db.prepare('SELECT formulation_seq, head_seq, head_hash FROM formulation_runs').get() as { formulation_seq: number; head_seq: number; head_hash: string };
    assert.deepEqual([run.formulation_seq, run.head_seq, run.head_hash], [out.revision.formulationSeq, out.revision.headSeq, out.revision.headHash]);
    assert.throws(() => db.prepare('DELETE FROM formulation_runs').run(), /append-only/);
  });

  it('a stop between planning and commit is refused by the fence; a stop before the run blocks it', () => {
    reset();
    const db = makeDb();
    toActive(db);
    const planned = authorizeExecution(db, request(), trust());
    assert.equal(planned.authorized, true);
    step(db, { action: 'suspend', evidenceRef: 'stop-before-commit' });
    let worked = false;
    assert.equal(code(() => guardedRun(db, request(), trust(), () => { worked = true; }, planned.revision as NonNullable<typeof planned.revision>)), 'NOT_AUTHORIZED');
    assert.equal(worked, false);
    step(db, { action: 'reinstate', evidenceRef: 'resume' });
    assert.equal(code(() => guardedRun(db, request(), trust(), () => { worked = true; }, planned.revision as NonNullable<typeof planned.revision>)), 'REVISION_CHANGED');   // authorized again, but not at the revision that was planned
    assert.equal(worked, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM formulation_runs').get().n, 0);
  });
});

describe('the adapter over the REAL registry reader and a real-shaped definition', () => {
  it('the real reader fails closed on a promoted lifecycle-managed row; the adapter is the path, and the frozen definition is never edited', () => {
    reset();
    const db = makeDb();
    toActive(db);
    const before = (db.prepare('SELECT spec_json FROM formulation_registry').get() as { spec_json: string }).spec_json;
    assert.throws(() => getActiveFormulation(db, ID, V), /does not match its registry row/);          // E_INTERNAL: safe, but unusable for lifecycle-managed rows
    const read = getAuthorizedFormulation(db, request(), trust());
    assert.equal(read.legacy, false);
    assert.equal(read.definition.status, 'active');                                                  // the returned copy carries the effective state
    assert.equal(read.definition.title, 'Demand flow');
    assert.equal((db.prepare('SELECT spec_json FROM formulation_registry').get() as { spec_json: string }).spec_json, before);   // stored definition untouched
  });

  it('suspension, reinstatement and the real reader\'s own refusal agree', () => {
    reset();
    const db = makeDb();
    toActive(db);
    step(db, { action: 'suspend', evidenceRef: 'incident' });
    assert.equal(code(() => getAuthorizedFormulation(db, request(), trust())), 'NOT_AUTHORIZED');
    assert.throws(() => getActiveFormulation(db, ID, V), (error: unknown) => (error as { code?: string }).code === 'E_FORMULATION_NOT_ACTIVE');
    step(db, { action: 'reinstate', evidenceRef: 'fixed' });
    assert.equal(getAuthorizedFormulation(db, request(), trust()).definition.status, 'active');
  });

  it('an unauthorized read never returns a definition, even when the row is active', () => {
    reset();
    const db = makeDb();
    toActive(db);
    assert.equal(code(() => getAuthorizedFormulation(db, request({ tenant: 'TENANT-B' }), trust())), 'NOT_AUTHORIZED');
    const bare = makeDb();
    bare.prepare("UPDATE formulation_registry SET state = 'active'").run();
    assert.equal(code(() => getAuthorizedFormulation(bare, request(), trust())), 'NOT_AUTHORIZED');
  });
});

describe('definition hash', () => {
  it('binds the stored algorithm hash and spec', () => {
    const db = makeDb();
    const row = db.prepare('SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry').get() as Parameters<typeof definitionHash>[0];
    const before = definitionHash(row);
    assert.notEqual(before, definitionHash({ ...row, spec_json: '{"title":"changed"}' }));
    assert.notEqual(before, definitionHash({ ...row, algorithm_hash: 'f'.repeat(64) }));
  });
});
