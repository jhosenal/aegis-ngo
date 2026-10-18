import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { AegisError } from '../../src/engine/errors.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import type { Principal, WorkflowDef } from '../../src/types/domain.js';
import { ROUTES, getRoute } from '../../src/registry/routes.js';
import { registerWorkflow, runWorkflow, type WorkflowContext, type WorkflowImpl } from '../../src/services/workflowEngine.js';

const workflowId = 'AEG.W.RESOURCE-ASSESSMENT';
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const directories: string[] = [];
type Db = import('better-sqlite3').Database;
const openDatabases: Db[] = [];
const definition: WorkflowDef = {
  workflowId,
  version: '1.0.0',
  allowedRoles: ['coordinator', 'analyst'],
  stepIds: ['resolve', 'validate', 'compute', 'commit'],
  retryClass: 'replayable',
  timeoutMs: 5000,
};

interface Input { value: number }

const testWorkflow: WorkflowImpl<Input> = {
  def: definition,
  parseInput(raw: unknown): Input {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
      || typeof (raw as Record<string, unknown>).value !== 'number'
      || !Number.isSafeInteger((raw as Record<string, unknown>).value)) {
      throw new AegisError('E_VALIDATION');
    }
    return { value: (raw as { value: number }).value };
  },
  resolve(_ctx, input) {
    return { snapshot: { value: input.value } };
  },
  execute(_ctx, resolved) {
    const value = resolved.snapshot.value;
    if (value === 13) throw new AegisError('E_FORMULATION_UNKNOWN');
    return {
      status: 'succeeded',
      errorCode: null,
      resultHashPayload: { value },
      write(tx, runId) {
        const cardId = `CARD-${runId}`;
        tx.prepare('INSERT INTO cards (card_id, tenant_id, kind, created_at) VALUES (?, ?, ?, ?)')
          .run(cardId, 'TENANT-A', 'assessment', '2026-10-13T01:00:00Z');
        if (value === 99) throw new Error('commit write failed');
        return { cardId, revision: 1 };
      },
    };
  },
};

registerWorkflow(testWorkflow);

function makeDb(path = ':memory:'): Db {
  const db = openDb(path);
  openDatabases.push(db);
  migrate(db, migrationDirectory, '2026-10-13T01:00:00Z');
  db.prepare('INSERT INTO tenants (tenant_id, product_id, name) VALUES (?, ?, ?)')
    .run('TENANT-A', 'AEG', 'Synthetic tenant');
  return db;
}

function makeContext(db: Db, role: Principal['role'] = 'coordinator', hooks?: WorkflowContext['hooks']): WorkflowContext {
  return {
    db,
    clock: new FixedClock('2026-10-13T01:00:00Z'),
    ids: new SeqIdGen(),
    principal: { userId: 'USER-A', tenantId: 'TENANT-A', productId: 'AEG', role },
    ...(hooks ? { hooks } : {}),
  };
}

function count(db: Db, table: 'workflow_runs' | 'cards' | 'audit_events'): number {
  const queries = {
    workflow_runs: 'SELECT COUNT(*) AS count FROM workflow_runs WHERE tenant_id = ?',
    cards: 'SELECT COUNT(*) AS count FROM cards WHERE tenant_id = ?',
    audit_events: 'SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id = ?',
  };
  const row = db.prepare(queries[table]).get('TENANT-A') as { count: number };
  return row.count;
}

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('workflow engine and route allowlist', () => {
  it('AEG-TST-003 rejects an unknown workflow', () => {
    const db = makeDb();
    expect(() => runWorkflow(makeContext(db), 'AEG.W.UNKNOWN', { value: 1 }, {}))
      .toThrowError(expect.objectContaining({ code: 'E_NOT_FOUND' }));
  });

  it('AEG-TST-003 denies a role before workflow execution', () => {
    const db = makeDb();
    expect(() => runWorkflow(makeContext(db, 'viewer'), workflowId, { value: 1 }, {}))
      .toThrowError(expect.objectContaining({ code: 'E_FORBIDDEN_ROLE' }));
    expect(count(db, 'workflow_runs')).toBe(0);
  });

  it('AEG-TST-003 rejects an unknown route with E_ROUTE_DENIED', () => {
    expect(() => getRoute('I_aegis_unknown_route')).toThrowError(expect.objectContaining({ code: 'E_ROUTE_DENIED' }));
  });

  it('AEG-TST-003 exposes exactly the route allowlist and properties', () => {
    expect(ROUTES.map(({ routeId, allowedRoles, modelProposable, sideEffects }) => ({ routeId, allowedRoles, modelProposable, sideEffects })))
      .toEqual([
        { routeId: 'I_aegis_help_show', allowedRoles: ['coordinator', 'analyst', 'viewer'], modelProposable: true, sideEffects: 'none' },
        { routeId: 'I_aegis_incident_list', allowedRoles: ['coordinator', 'analyst', 'viewer'], modelProposable: true, sideEffects: 'none' },
        { routeId: 'I_aegis_card_open', allowedRoles: ['coordinator', 'analyst', 'viewer'], modelProposable: true, sideEffects: 'none' },
        { routeId: 'I_aegis_resource_assess', allowedRoles: ['coordinator', 'analyst'], modelProposable: true, sideEffects: 'writes-card' },
        { routeId: 'I_aegis_audit_verify', allowedRoles: ['coordinator'], modelProposable: false, sideEffects: 'none' },
        { routeId: 'I_aegis_card_explain', allowedRoles: ['coordinator', 'analyst', 'viewer'], modelProposable: true, sideEffects: 'none' },
      ]);
  });

  it('AEG-TST-011 replays the same key and input with one run and one audit event', () => {
    const db = makeDb();
    const ctx = makeContext(db);
    const first = runWorkflow(ctx, workflowId, { value: 2 }, { idempotencyKey: 'same-key' });
    const second = runWorkflow(ctx, workflowId, { value: 2 }, { idempotencyKey: 'same-key' });
    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ runId: first.runId, replayed: true });
    expect(count(db, 'workflow_runs')).toBe(1);
    expect(count(db, 'audit_events')).toBe(1);
  });

  it('AEG-TST-011 rejects a different input under the same key with 409 code', () => {
    const db = makeDb();
    const ctx = makeContext(db);
    runWorkflow(ctx, workflowId, { value: 2 }, { idempotencyKey: 'same-key' });
    expect(() => runWorkflow(ctx, workflowId, { value: 3 }, { idempotencyKey: 'same-key' }))
      .toThrowError(expect.objectContaining({ code: 'E_IDEMPOTENCY_CONFLICT' }));
  });

  it('AEG-TST-011 derives the default key from the snapshot and replays identical input', () => {
    const db = makeDb();
    const ctx = makeContext(db);
    const first = runWorkflow(ctx, workflowId, { value: 4 }, {});
    const second = runWorkflow(ctx, workflowId, { value: 4 }, {});
    expect(second).toMatchObject({ runId: first.runId, replayed: true });
    expect(count(db, 'workflow_runs')).toBe(1);
  });

  it('AEG-TST-011 replays after an after-commit crash without duplicating run or audit event', () => {
    const db = makeDb();
    const crashingContext = makeContext(db, 'coordinator', { afterCommit: () => { throw new Error('simulated client crash'); } });
    expect(() => runWorkflow(crashingContext, workflowId, { value: 5 }, { idempotencyKey: 'crash-key' }))
      .toThrow('simulated client crash');
    const retry = runWorkflow(makeContext(db), workflowId, { value: 5 }, { idempotencyKey: 'crash-key' });
    expect(retry.replayed).toBe(true);
    expect(count(db, 'workflow_runs')).toBe(1);
    expect(count(db, 'audit_events')).toBe(1);
  });

  it('AEG-TST-011 serializes two connections to one run row for concurrent identical requests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aegis-tsk006-'));
    directories.push(directory);
    const path = join(directory, 'workflow.db');
    const setup = makeDb(path);
    setup.close();
    openDatabases.splice(openDatabases.indexOf(setup), 1);
    const firstDb = openDb(path);
    const secondDb = openDb(path);
    openDatabases.push(firstDb, secondDb);
    const results = await Promise.all([
      Promise.resolve().then(() => runWorkflow(makeContext(firstDb), workflowId, { value: 6 }, { idempotencyKey: 'concurrent-key' })),
      Promise.resolve().then(() => runWorkflow(makeContext(secondDb), workflowId, { value: 6 }, { idempotencyKey: 'concurrent-key' })),
    ]);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(count(firstDb, 'workflow_runs')).toBe(1);
  });

  it('AEG-TST-011 stores a failed domain error without a card and appends workflow.failed', () => {
    const db = makeDb();
    const result = runWorkflow(makeContext(db), workflowId, { value: 13 }, {});
    expect(result).toMatchObject({ state: 'failed', errorCode: 'E_FORMULATION_UNKNOWN', resultCardId: null, resultRevision: null });
    expect(count(db, 'workflow_runs')).toBe(1);
    expect(count(db, 'cards')).toBe(0);
    const event = db.prepare('SELECT body_json FROM audit_events').get() as { body_json: string };
    expect((JSON.parse(event.body_json) as { eventType: string }).eventType).toBe('workflow.failed');
  });

  it('AEG-TST-011 rolls back the run, card and audit event when commit write throws', () => {
    const db = makeDb();
    expect(() => runWorkflow(makeContext(db), workflowId, { value: 99 }, {})).toThrow('commit write failed');
    expect(count(db, 'workflow_runs')).toBe(0);
    expect(count(db, 'cards')).toBe(0);
    expect(count(db, 'audit_events')).toBe(0);
  });
});
