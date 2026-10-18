import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { canonicalize, sha256Hex } from '../../src/engine/canonical.js';
import { getActiveFormulation, seedFormulations } from '../../src/registry/formulations.js';
import {
  adoptLegacy, authorizeExecution, chainState, definitionHash, effectiveLifecycle, guardedRun, installLifecycle, parseInstant, resyncRegistryStates, rollbackLifecycle, SCHEMA, transition,
  type Bindings, type ExecutionRequest, type Scope, type Trust,
} from './lifecycle.js';

type Db = import('better-sqlite3').Database;
const migrations = fileURLToPath(new URL('../../migrations/', import.meta.url));
const T0 = '2026-10-13T00:00:00Z';
const ID = 'AEG.F.DEMAND-FLOW';
const bindings: Bindings = { dependencyHash: 'd'.repeat(64), implementationHash: 'b'.repeat(64) };
const scope: Scope = { tenants: ['TENANT-A'], purposes: ['planning-demo'], jurisdictions: ['XX'], resources: ['water'], validity: ['region-1'], actions: [] };
const trust: Trust = { clock: () => parseInstant(T0), resolveBindings: () => bindings, authority: () => true };
const request: ExecutionRequest = { formulationId: ID, version: '1.0.0', use: 'PLANNING', tenant: 'TENANT-A', purpose: 'planning-demo', resource: 'water', jurisdiction: 'XX', validity: 'region-1' };

/** The CURRENT production schema: the real migrations and the real seeded, frozen shortfall row, with no lifecycle tables. */
function currentSchemaDb(): Db {
  const db = openDb(':memory:');
  migrate(db, migrations, T0);
  seedFormulations(db, T0);
  return db;
}
const registryFingerprint = (db: Db): string => sha256Hex(JSON.stringify(db.prepare('SELECT * FROM formulation_registry ORDER BY formulation_id, version').all()));
const tableNames = (db: Db): string[] => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const lifecycleTables = ['formulation_lifecycle_adoption_seal', 'formulation_lifecycle_events', 'formulation_lifecycle_legacy', 'formulation_runs'];

function addManaged(db: Db): void {
  const definition = { formulationId: ID, semanticVersion: '1.0.0', title: 'Demand flow', inputSchema: {}, outputSchema: {}, units: [], assumptions: [], preconditions: [], deterministicAlgorithmRef: 'ref', algorithmHash: 'a'.repeat(64), roundingPolicy: 'exact', examples: [], invalidCases: [], owner: 'Claude', status: 'candidate', effectiveFrom: T0 };
  db.prepare('INSERT INTO formulation_registry (formulation_id, version, state, algorithm_hash, spec_json, effective_from) VALUES (?, ?, ?, ?, ?, ?)').run(ID, '1.0.0', 'candidate', definition.algorithmHash, canonicalize(definition), T0);
}
function promote(db: Db): void {
  const t = (extra: object) => transition(db, { formulationId: ID, version: '1.0.0', action: 'advance', approver: 'astra', evidenceRef: 'review', ...extra } as never, trust);
  t({}); t({}); t({ approvedUse: 'PLANNING', scope, expiresAt: '2027-01-01T00:00:00Z' }); t({});
}

describe('migration rehearsal on disposable databases: upgrade, failure, replay, rollback', () => {
  it('upgrade from the current schema adds only the lifecycle tables and leaves every existing registry byte unchanged, and the real reader still works', () => {
    const db = currentSchemaDb();
    const before = registryFingerprint(db);
    const tablesBefore = tableNames(db);
    installLifecycle(db);
    assert.equal(registryFingerprint(db), before);
    assert.deepEqual(tableNames(db).filter((n) => !tablesBefore.includes(n)), lifecycleTables);
    assert.equal(getActiveFormulation(db, 'AEG.F.RESOURCE-SHORTFALL', '1.0.0').formulationId, 'AEG.F.RESOURCE-SHORTFALL');
    // the existing active-immutability trigger is still the registry's own guard
    assert.throws(() => db.prepare("UPDATE formulation_registry SET spec_json = 'x'").run(), /active formulation is immutable/);
  });

  it('applying the upgrade twice changes nothing (idempotent)', () => {
    const db = currentSchemaDb();
    installLifecycle(db);
    const snapshot = JSON.stringify(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all());
    installLifecycle(db);
    assert.equal(JSON.stringify(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all()), snapshot);
  });

  it('failure injection: an upgrade that fails part-way leaves the database exactly as it was', () => {
    const db = currentSchemaDb();
    const before = JSON.stringify(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all());
    const fingerprint = registryFingerprint(db);
    const run = db.transaction(() => { db.exec(SCHEMA); db.exec('CREATE TABLE this_is_not_valid ('); });   // the last statement fails
    assert.throws(() => run.immediate());
    assert.equal(JSON.stringify(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all()), before);
    assert.deepEqual(tableNames(db).filter((n) => lifecycleTables.includes(n)), []);
    assert.equal(registryFingerprint(db), fingerprint);
  });

  it('replay: rebuilding a disposable database from the registry definitions plus the ordered event record reproduces the same lifecycle, the same chain and the same authorization', () => {
    const source = currentSchemaDb();
    installLifecycle(source);
    addManaged(source);
    promote(source);
    transition(source, { formulationId: ID, version: '1.0.0', action: 'suspend', approver: 'astra', evidenceRef: 'incident' }, trust);
    transition(source, { formulationId: ID, version: '1.0.0', action: 'reinstate', approver: 'astra', evidenceRef: 'fixed' }, trust);
    const events = source.prepare('SELECT * FROM formulation_lifecycle_events ORDER BY seq').all() as Record<string, unknown>[];

    const replica = currentSchemaDb();                         // a fresh database with the same definitions, all rows still at their original state
    installLifecycle(replica);
    addManaged(replica);
    const insert = replica.prepare(`INSERT INTO formulation_lifecycle_events (seq, formulation_id, version, action, from_stage, to_stage, prior_stage, approved_use, scope_json, approver, occurred_at, expires_at,
      definition_hash, dependency_hash, implementation_hash, evidence_ref, prev_hash, event_hash) VALUES (@seq, @formulation_id, @version, @action, @from_stage, @to_stage, @prior_stage, @approved_use,
      @scope_json, @approver, @occurred_at, @expires_at, @definition_hash, @dependency_hash, @implementation_hash, @evidence_ref, @prev_hash, @event_hash)`);
    for (const row of events) insert.run(row);
    assert.equal(chainState(replica).ok, true);
    assert.equal(effectiveLifecycle(replica, ID, '1.0.0').stage, 'active');
    assert.equal(authorizeExecution(replica, request, trust).authorized, false);          // the row still says candidate: the replica is inconsistent until states are replayed
    assert.equal(resyncRegistryStates(replica), 1);                                       // replay: state-only update from the events
    assert.equal(authorizeExecution(replica, request, trust).authorized, true);
    assert.equal(resyncRegistryStates(replica), 0);                                       // idempotent
    assert.equal(definitionHash(replica.prepare('SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = ?').get(ID) as never),
      definitionHash(source.prepare('SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = ?').get(ID) as never));
  });

  it('rollback is clean while no lifecycle record exists, and refused afterwards (fix forward)', () => {
    const clean = currentSchemaDb();
    const before = registryFingerprint(clean);
    installLifecycle(clean);
    rollbackLifecycle(clean);
    assert.deepEqual(tableNames(clean).filter((n) => lifecycleTables.includes(n)), []);
    assert.equal(registryFingerprint(clean), before);
    assert.equal(getActiveFormulation(clean, 'AEG.F.RESOURCE-SHORTFALL', '1.0.0').formulationId, 'AEG.F.RESOURCE-SHORTFALL');

    const used = currentSchemaDb();
    installLifecycle(used);
    addManaged(used);
    promote(used);
    assert.throws(() => rollbackLifecycle(used), /rollback refused/);
    assert.deepEqual(tableNames(used).filter((n) => lifecycleTables.includes(n)).length, 4);
    // a legacy adoption alone also blocks rollback, because the adoption record is evidence
    const legacy = currentSchemaDb();
    installLifecycle(legacy);
    const row = legacy.prepare("SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = 'AEG.F.RESOURCE-SHORTFALL'").get() as Parameters<typeof definitionHash>[0];
    adoptLegacy(legacy, [{ formulationId: row.formulation_id, version: row.version, definitionHash: definitionHash(row), implementationHash: bindings.implementationHash, dependencyHash: bindings.dependencyHash,
      use: 'PLANNING', scope: { ...scope, tenants: ['*'], resources: ['*'], validity: ['*'], jurisdictions: ['*'] }, reviewedBy: 'astra', evidenceRef: 'A0005' }], trust);
    assert.throws(() => rollbackLifecycle(legacy), /rollback refused/);
  });

  it('a run recorded under the old registry only (before the upgrade) is unaffected: the real reader path is unchanged for the frozen row', () => {
    const db = currentSchemaDb();
    const read = (): string => getActiveFormulation(db, 'AEG.F.RESOURCE-SHORTFALL', '1.0.0').algorithmHash;
    const before = read();
    installLifecycle(db);
    assert.equal(read(), before);
    const frozen: ExecutionRequest = { ...request, formulationId: 'AEG.F.RESOURCE-SHORTFALL' };
    // The frozen row keeps its real-reader path, but the lifecycle guard will not authorize it until it is adopted from a reviewed allowlist.
    assert.throws(() => guardedRun(db, frozen, trust, () => 1), (error: unknown) => (error as { code?: string }).code === 'NOT_AUTHORIZED');
  });
});
