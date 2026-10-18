import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { seedAll } from '../../src/services/seed.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { AegisError } from '../../src/engine/errors.js';
import { getCardRevision } from '../../src/data/repos/cards.js';
import { registerResourceAssessment, decisionHashOf } from '../../src/services/workflows/resourceAssessment.js';
import { runWorkflow, type WorkflowContext } from '../../src/services/workflowEngine.js';
import type { Principal } from '../../src/types/domain.js';
import type { RunAssessmentBodyT } from '../../src/types/api-schemas.js';

type Db = import('better-sqlite3').Database;
const seedNow = '2026-10-13T00:00:00Z';
const assessmentNow = '2026-10-13T01:00:00Z';
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const workflowSourcePath = fileURLToPath(new URL('../../src/services/workflows/resourceAssessment.ts', import.meta.url));
const databases: Db[] = [];
let ids = new SeqIdGen();

registerResourceAssessment();

function makeDb(): Db {
  ids = new SeqIdGen();
  const db = openDb(':memory:');
  databases.push(db);
  migrate(db, migrationDirectory, seedNow);
  seedAll(db, fixturesDirectory, new FixedClock(seedNow), ids);
  return db;
}

function principal(tenantId: 'TENANT-A' | 'TENANT-B' = 'TENANT-A', role: Principal['role'] = 'coordinator'): Principal {
  return {
    userId: tenantId === 'TENANT-A' ? (role === 'viewer' ? 'USER-A-VIEW' : 'USER-A-COORD') : 'USER-B-COORD',
    tenantId,
    productId: 'AEG',
    role,
  };
}

function request(overrides: Partial<RunAssessmentBodyT> = {}, tenantId: 'TENANT-A' | 'TENANT-B' = 'TENANT-A'): RunAssessmentBodyT {
  return {
    incidentCardId: `INC-${tenantId}-SYN-FLOOD-0001`,
    incidentRevision: 2,
    regionId: 'REGION.DEMO_A',
    unitId: 'UNIT.WATER_KIT',
    demandUnits: 120,
    ...overrides,
  };
}

function context(db: Db, user: Principal): WorkflowContext {
  return { db, clock: new FixedClock(assessmentNow), ids, principal: user };
}

function run(db: Db, user: Principal, input: RunAssessmentBodyT) {
  return runWorkflow(context(db, user), 'AEG.W.RESOURCE-ASSESSMENT', input, {
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  });
}

function resultCard(db: Db, user: Principal, result: ReturnType<typeof run>) {
  if (result.resultCardId === null || result.resultRevision === null) throw new Error('Expected a result card');
  const card = getCardRevision(db, user.tenantId, result.resultCardId, result.resultRevision);
  if (card === null) throw new Error('Expected stored result revision');
  return card;
}

function count(db: Db, table: 'workflow_runs' | 'cards' | 'card_revisions' | 'audit_events', tenantId = 'TENANT-A'): number {
  const queries = {
    workflow_runs: 'SELECT COUNT(*) AS count FROM workflow_runs WHERE tenant_id = ?',
    cards: 'SELECT COUNT(*) AS count FROM cards WHERE tenant_id = ?',
    card_revisions: 'SELECT COUNT(*) AS count FROM card_revisions r JOIN cards c ON c.card_id = r.card_id WHERE c.tenant_id = ?',
    audit_events: 'SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id = ?',
  };
  return (db.prepare(queries[table]).get(tenantId) as { count: number }).count;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('resource assessment workflow', () => {
  it('AEG-TST-004 row 1 computes the Region A shortfall and conflict warning', () => {
    const db = makeDb();
    const response = run(db, principal(), request());
    const card = resultCard(db, principal(), response);
    expect(response.state).toBe('succeeded');
    expect(card.body.result).toMatchObject({ usableUnits: 80, shortfallUnits: 40, surplusUnits: 0 });
    expect(card.state).toBe('validated');
    expect(card.body.warnings.map((warning) => warning.code)).toContain('EVIDENCE_CONFLICTING');
  });

  it('AEG-TST-004 row 2 computes no shortfall for demand 50', () => {
    const db = makeDb();
    const card = resultCard(db, principal(), run(db, principal(), request({ demandUnits: 50 })));
    expect(card.body.result).toMatchObject({ usableUnits: 80, shortfallUnits: 0, surplusUnits: 30 });
  });

  it('AEG-TST-004 row 3 computes no surplus or shortfall for demand 80', () => {
    const db = makeDb();
    const card = resultCard(db, principal(), run(db, principal(), request({ demandUnits: 80 })));
    expect(card.body.result).toMatchObject({ shortfallUnits: 0, surplusUnits: 0 });
  });

  it('AEG-TST-004 row 4 computes full usable surplus for zero demand', () => {
    const db = makeDb();
    const card = resultCard(db, principal(), run(db, principal(), request({ demandUnits: 0 })));
    expect(card.body.result).toMatchObject({ shortfallUnits: 0, surplusUnits: 80 });
  });

  it('AEG-TST-004 row 5 writes an awaiting-input draft when demand is null', () => {
    const db = makeDb();
    const response = run(db, principal(), request({ demandUnits: null }));
    const card = resultCard(db, principal(), response);
    expect(response.state).toBe('awaiting-input');
    expect(card.body.missing).toEqual(['demandUnits']);
    expect(card.state).toBe('draft');
    expect(card.body.result).toBeNull();
  });

  it('AEG-TST-004 row 6 writes awaiting-input when available units are null', () => {
    const db = makeDb();
    const response = run(db, principal(), request({ availableUnits: null }));
    const card = resultCard(db, principal(), response);
    expect(response.state).toBe('awaiting-input');
    expect(card.body.missing).toEqual(['availableUnits']);
  });

  it('AEG-TST-004 row 7 records reserve validation failure without a card', () => {
    const db = makeDb();
    const cardsBefore = count(db, 'cards');
    const response = run(db, principal(), request({ reserveUnits: 90 }));
    expect(response).toMatchObject({ state: 'failed', errorCode: 'E_RESERVE_EXCEEDS_AVAILABLE', resultCardId: null });
    expect(count(db, 'cards')).toBe(cardsBefore);
    const event = db.prepare('SELECT body_json FROM audit_events WHERE tenant_id = ? ORDER BY sequence DESC LIMIT 1').get('TENANT-A') as { body_json: string };
    expect((JSON.parse(event.body_json) as { eventType: string }).eventType).toBe('workflow.failed');
  });

  it('AEG-TST-004 row 8 lets request quantities override the resource row', () => {
    const db = makeDb();
    const card = resultCard(db, principal(), run(db, principal(), request({ availableUnits: 70, reserveUnits: 5 })));
    expect(card.body.result).toMatchObject({ availableUnits: 70, reserveUnits: 5, usableUnits: 65, shortfallUnits: 55 });
  });

  it('AEG-TST-004 row 9 resolves Region C from its old row and warns', () => {
    const db = makeDb();
    const card = resultCard(db, principal(), run(db, principal(), request({ regionId: 'REGION.DEMO_C', demandUnits: 20 })));
    expect(card.body.result).toMatchObject({ usableUnits: 13, shortfallUnits: 7 });
    expect(card.body.warnings.map((warning) => warning.code)).toContain('RESOURCE_AS_OF_OLD');
  });

  it('AEG-TST-004 row 10 fails when request as-of differs from the resource row', () => {
    const db = makeDb();
    const response = run(db, principal(), request({ regionId: 'REGION.DEMO_C', demandUnits: 20, asOf: '2026-10-13T00:00:00Z' }));
    expect(response).toMatchObject({ state: 'failed', errorCode: 'E_ASOF_MISMATCH', resultCardId: null });
  });

  it('AEG-TST-004 row 11 awaits quantities for a region without a resource row', () => {
    const db = makeDb();
    const response = run(db, principal(), request({ regionId: 'REGION.DEMO_B', demandUnits: 10 }));
    const card = resultCard(db, principal(), response);
    expect(response.state).toBe('awaiting-input');
    expect(card.body.missing).toEqual(['availableUnits', 'reserveUnits']);
    expect(card.body.warnings.map((warning) => warning.code)).toContain('NO_RESOURCE_RECORD');
  });

  it('AEG-TST-004 row 12 resolves tenant B quantities from tenant B row', () => {
    const db = makeDb();
    const user = principal('TENANT-B');
    const card = resultCard(db, user, run(db, user, request({}, 'TENANT-B')));
    expect(card.body.result).toMatchObject({ usableUnits: 280, shortfallUnits: 0, surplusUnits: 160 });
  });

  it('AEG-TST-004 row 13 hides a foreign incident as E_NOT_FOUND and writes nothing', () => {
    const db = makeDb();
    const before = {
      runs: count(db, 'workflow_runs', 'TENANT-B'),
      cards: count(db, 'cards', 'TENANT-B'),
      revisions: count(db, 'card_revisions', 'TENANT-B'),
      audit: count(db, 'audit_events', 'TENANT-B'),
    };
    expect(() => run(db, principal('TENANT-B'), request({ incidentCardId: 'INC-TENANT-A-SYN-FLOOD-0001' }, 'TENANT-B')))
      .toThrowError(expect.objectContaining({ code: 'E_NOT_FOUND' }));
    expect({
      runs: count(db, 'workflow_runs', 'TENANT-B'),
      cards: count(db, 'cards', 'TENANT-B'),
      revisions: count(db, 'card_revisions', 'TENANT-B'),
      audit: count(db, 'audit_events', 'TENANT-B'),
    }).toEqual(before);
  });

  it('AEG-TST-004 row 14 denies viewer role with E_FORBIDDEN_ROLE', () => {
    const db = makeDb();
    expect(() => run(db, principal('TENANT-A', 'viewer'), request()))
      .toThrowError(expect.objectContaining({ code: 'E_FORBIDDEN_ROLE' }));
  });

  it('AEG-TST-004 row 15 replays the same key without adding runs, cards or audit events', () => {
    const db = makeDb();
    const input = request({ idempotencyKey: 'matrix-15' });
    const first = run(db, principal(), input);
    const before = { cards: count(db, 'cards'), revisions: count(db, 'card_revisions'), audit: count(db, 'audit_events') };
    const second = run(db, principal(), input);
    expect(second).toMatchObject({ replayed: true, runId: first.runId, resultCardId: first.resultCardId, resultRevision: first.resultRevision });
    expect({ cards: count(db, 'cards'), revisions: count(db, 'card_revisions'), audit: count(db, 'audit_events') }).toEqual(before);
  });

  it('AEG-TST-004 row 16 rejects a different demand under the same key', () => {
    const db = makeDb();
    run(db, principal(), request({ idempotencyKey: 'matrix-16', demandUnits: 120 }));
    expect(() => run(db, principal(), request({ idempotencyKey: 'matrix-16', demandUnits: 130 })))
      .toThrowError(expect.objectContaining({ code: 'E_IDEMPOTENCY_CONFLICT' }));
  });

  it('AEG-TST-004 row 17 revises the same assessment card and preserves revision evidence', () => {
    const db = makeDb();
    const first = run(db, principal(), request({ demandUnits: 120 }));
    const second = run(db, principal(), request({ demandUnits: 130 }));
    expect(second.resultCardId).toBe(first.resultCardId);
    expect(second.resultRevision).toBe(2);
    const revisionOne = getCardRevision(db, 'TENANT-A', first.resultCardId!, 1);
    const revisionTwo = getCardRevision(db, 'TENANT-A', second.resultCardId!, 2);
    expect(revisionOne?.state).toBe('superseded');
    expect(revisionOne?.evidenceIds).toEqual(revisionTwo?.evidenceIds);
    expect(revisionOne?.body.result).toMatchObject({ shortfallUnits: 40 });
    expect(revisionTwo?.body.result).toMatchObject({ shortfallUnits: 50 });
  });

  it('AEG-TST-004 row 18 keeps the decision hash stable and imports no provider module', () => {
    const db = makeDb();
    const spyProvider = { calls: 0, call: (): void => { spyProvider.calls += 1; } };
    const disabled = resultCard(db, principal(), run(db, principal(), request({ idempotencyKey: 'models-disabled' })));
    const enabled = resultCard(db, principal(), run(db, principal(), request({ idempotencyKey: 'models-enabled' })));
    const source = readFileSync(workflowSourcePath, 'utf8');
    expect(decisionHashOf(disabled.body)).toBe(decisionHashOf(enabled.body));
    expect(spyProvider.calls).toBe(0);
    expect(source).not.toMatch(/from\s+['"][^'"]*providers\//);
  });
});
