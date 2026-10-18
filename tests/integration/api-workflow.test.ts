import { grantOperationalFixtures } from '../helpers/pro-fixtures.js';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { verifyChain, type AuditEvent } from '../../src/audit/chain-core.js';
import { loadChain } from '../../src/audit/chainStore.js';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { getCardRevision, listCards } from '../../src/data/repos/cards.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { generateLatestBulletin } from '../../src/services/broadcast/generate.js';
import { loadSchedule } from '../../src/services/broadcast/schedule.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';

type Db = import('better-sqlite3').Database;
type LoginResponse = { token: string };
type ErrorResponse = { error: { code: string; details: Record<string, unknown> } };
type Harness = { db: Db; app: FastifyInstance };

const seedNow = '2026-10-13T00:00:00Z';
const testNow = '2026-10-13T01:00:00Z';
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const databases: Db[] = [];
const apps: FastifyInstance[] = [];

function makeHarness(options: { modelsEnabled?: boolean; afterCommit?: () => void } = {}): Harness {
  const db = openDb(':memory:');
  databases.push(db);
  const clock = new FixedClock(testNow);
  const ids = new SeqIdGen();
  migrate(db, migrationDirectory, seedNow);
  seedAll(db, fixturesDirectory, new FixedClock(seedNow), ids);
  grantOperationalFixtures(db);
  const config = loadConfig({
    AEGIS_ENV: 'test',
    AEGIS_DB_PATH: ':memory:',
    ...(options.modelsEnabled === undefined ? {} : { AEGIS_MODELS_ENABLED: String(options.modelsEnabled) }),
  });
  const app = createApp({ db, clock, ids, config, hooks: { afterCommit: options.afterCommit } });
  apps.push(app);
  return { db, app };
}

async function login(app: FastifyInstance, userId = 'USER-A-COORD'): Promise<LoginResponse> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
  expect(response.statusCode).toBe(200);
  return response.json() as LoginResponse;
}

function withToken(token: string, options: Omit<InjectOptions, 'headers'> & { headers?: Record<string, string> }): InjectOptions {
  return { ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } };
}

function body(demandUnits: number | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    incidentCardId: 'INC-TENANT-A-SYN-FLOOD-0001',
    incidentRevision: 2,
    regionId: 'REGION.DEMO_A',
    unitId: 'UNIT.WATER_KIT',
    demandUnits,
    ...extra,
  };
}

async function assess(app: FastifyInstance, token: string, payload: Record<string, unknown>) {
  return app.inject(withToken(token, { method: 'POST', url: '/api/workflows/resource-assessment', payload }));
}

function errorCode(response: { json(): unknown }): string {
  return (response.json() as ErrorResponse).error.code;
}

function count(db: Db, table: string): number {
  const statements = {
    workflow_runs: 'SELECT COUNT(*) AS count FROM workflow_runs',
    audit_events: 'SELECT COUNT(*) AS count FROM audit_events',
    cards: 'SELECT COUNT(*) AS count FROM cards',
    model_calls: 'SELECT COUNT(*) AS count FROM model_calls',
  };
  const statement = statements[table as keyof typeof statements];
  if (!statement) throw new Error('Unsupported test table');
  return (db.prepare(statement).get() as { count: number }).count;
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

describe('TSK-010 API workflow, audit and budget routes', () => {
  it('AEG-TST-004 matrix 1: computes usable 80 and shortfall 40 with conflict warning', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(120));
    const result = response.json() as { run: { state: string }; card: { state: string; body: { result: { usableUnits: number; shortfallUnits: number; surplusUnits: number } | null; warnings: { code: string }[] } } | null; decisionHash: string };
    expect(response.statusCode).toBe(200);
    expect(result.run.state).toBe('succeeded');
    expect(result.card?.state).toBe('validated');
    expect(result.card?.body.result).toMatchObject({ usableUnits: 80, shortfallUnits: 40, surplusUnits: 0 });
    expect(result.card?.body.warnings.map((warning) => warning.code)).toContain('EVIDENCE_CONFLICTING');
    expect(result.decisionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('AEG-TST-004 records formulation version on the audit event and preserves chain validity', async () => {
    const { app, db } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(120));
    expect(response.statusCode).toBe(200);
    const scope = { productId: 'AEG', tenantId: 'TENANT-A' };
    const events = loadChain(db, scope);
    expect(events.at(-1)?.versions.formulation).toBe('AEG.F.RESOURCE-SHORTFALL/1.0.0');
    expect(verifyChain(events, scope).ok).toBe(true);
  });

  it('AEG-TST-004 matrix 2: demand 50 has surplus 30', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(50));
    expect(response.statusCode).toBe(200);
    expect((response.json() as { card: { body: { result: unknown } } }).card.body.result).toMatchObject({ usableUnits: 80, shortfallUnits: 0, surplusUnits: 30 });
  });

  it('AEG-TST-004 matrix 3: demand 80 has no shortfall or surplus', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(80));
    expect(response.statusCode).toBe(200);
    expect((response.json() as { card: { body: { result: unknown } } }).card.body.result).toMatchObject({ shortfallUnits: 0, surplusUnits: 0 });
  });

  it('AEG-TST-004 matrix 4: demand zero leaves usable surplus 80', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(0));
    expect(response.statusCode).toBe(200);
    expect((response.json() as { card: { body: { result: unknown } } }).card.body.result).toMatchObject({ shortfallUnits: 0, surplusUnits: 80 });
  });

  it('AEG-TST-004 matrix 5: null demand awaits input and writes a draft card', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(null));
    const result = response.json() as { run: { state: string }; card: { state: string; body: { missing: string[]; result: unknown } } };
    expect(response.statusCode).toBe(200);
    expect(result.run.state).toBe('awaiting-input');
    expect(result.card.state).toBe('draft');
    expect(result.card.body.missing).toEqual(['demandUnits']);
    expect(result.card.body.result).toBeNull();
  });

  it('AEG-TST-004 matrix 6: null available units awaits input', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(120, { availableUnits: null }));
    expect(response.statusCode).toBe(200);
    expect((response.json() as { card: { body: { missing: string[] } } }).card.body.missing).toEqual(['availableUnits']);
  });

  it('AEG-TST-004 matrix 7: reserve over available returns 422 with run id and no card', async () => {
    const { db, app } = makeHarness();
    const session = await login(app);
    const before = count(db, 'cards');
    const response = await assess(app, session.token, body(120, { reserveUnits: 90 }));
    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe('E_RESERVE_EXCEEDS_AVAILABLE');
    expect((response.json() as ErrorResponse).error.details.runId).toEqual(expect.any(String));
    expect(count(db, 'cards')).toBe(before);
  });

  it('AEG-TST-004 matrix 8: explicit available override computes shortfall 55', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(120, { availableUnits: 70, reserveUnits: 5 }));
    expect(response.statusCode).toBe(200);
    expect((response.json() as { card: { body: { result: unknown } } }).card.body.result).toMatchObject({ usableUnits: 65, shortfallUnits: 55 });
  });

  it('AEG-TST-004 matrix 9: region C computes shortfall 7 and old-resource warning', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(20, { regionId: 'REGION.DEMO_C' }));
    const result = response.json() as { card: { body: { result: unknown; warnings: { code: string }[] } } };
    expect(response.statusCode).toBe(200);
    expect(result.card.body.result).toMatchObject({ usableUnits: 13, shortfallUnits: 7 });
    expect(result.card.body.warnings.map((warning) => warning.code)).toContain('RESOURCE_AS_OF_OLD');
  });

  it('AEG-TST-004 matrix 10: mismatched as-of returns 422', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(20, { regionId: 'REGION.DEMO_C', asOf: '2026-10-13T00:00:00Z' }));
    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe('E_ASOF_MISMATCH');
  });

  it('AEG-TST-004 matrix 11: missing region B resource inputs and warning', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await assess(app, session.token, body(10, { regionId: 'REGION.DEMO_B' }));
    const result = response.json() as { card: { body: { missing: string[]; warnings: { code: string }[] } } };
    expect(response.statusCode).toBe(200);
    expect(result.card.body.missing).toEqual(['availableUnits', 'reserveUnits']);
    expect(result.card.body.warnings.map((warning) => warning.code)).toContain('NO_RESOURCE_RECORD');
  });

  it('AEG-TST-004 matrix 12: tenant B uses its own resource row', async () => {
    const { app } = makeHarness();
    const session = await login(app, 'USER-B-COORD');
    const response = await assess(app, session.token, {
      ...body(120),
      incidentCardId: 'INC-TENANT-B-SYN-FLOOD-0001',
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { card: { body: { result: unknown } } }).card.body.result).toMatchObject({ usableUnits: 280, shortfallUnits: 0, surplusUnits: 160 });
  });

  it('AEG-TST-004 matrix 13: tenant B incident reference is hidden from tenant A', async () => {
    const { db, app } = makeHarness();
    const session = await login(app);
    const beforeRuns = count(db, 'workflow_runs');
    const response = await assess(app, session.token, body(120, { incidentCardId: 'INC-TENANT-B-SYN-FLOOD-0001' }));
    expect(response.statusCode).toBe(404);
    expect(errorCode(response)).toBe('E_NOT_FOUND');
    expect(count(db, 'workflow_runs')).toBe(beforeRuns);
  });

  it('AEG-TST-004 matrix 14: viewer cannot run a workflow', async () => {
    const { app } = makeHarness();
    const session = await login(app, 'USER-A-VIEW');
    const response = await assess(app, session.token, body(120));
    expect(response.statusCode).toBe(403);
    expect(errorCode(response)).toBe('E_FORBIDDEN_ROLE');
  });

  it('AEG-TST-004 matrix 15: idempotent retry replays without adding audit event or card', async () => {
    const { db, app } = makeHarness();
    const session = await login(app);
    const payload = body(120, { idempotencyKey: 'assessment-replay-1' });
    const beforeEvents = count(db, 'audit_events');
    const beforeCards = count(db, 'cards');
    const first = await assess(app, session.token, payload);
    const second = await assess(app, session.token, payload);
    const firstRun = (first.json() as { run: { runId: string; resultRevision: number } }).run;
    const replay = (second.json() as { run: { runId: string; resultRevision: number; replayed: boolean } }).run;
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(replay).toMatchObject({ runId: firstRun.runId, resultRevision: firstRun.resultRevision, replayed: true });
    expect(count(db, 'audit_events')).toBe(beforeEvents + 1);
    expect(count(db, 'cards')).toBe(beforeCards + 1);
  });

  it('AEG-TST-004 matrix 16: reused idempotency key with different input conflicts', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    await assess(app, session.token, body(120, { idempotencyKey: 'assessment-conflict-1' }));
    const response = await assess(app, session.token, body(130, { idempotencyKey: 'assessment-conflict-1' }));
    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe('E_IDEMPOTENCY_CONFLICT');
  });

  it('AEG-TST-004 matrix 17: subsequent result revises and supersedes the previous card', async () => {
    const { db, app } = makeHarness();
    const session = await login(app);
    const first = await assess(app, session.token, body(120));
    const second = await assess(app, session.token, body(130));
    const firstCard = (first.json() as { card: { cardId: string } }).card;
    const secondCard = (second.json() as { card: { cardId: string; revision: number } }).card;
    expect(second.statusCode).toBe(200);
    expect(secondCard.cardId).toBe(firstCard.cardId);
    expect(secondCard.revision).toBe(2);
    expect(getCardRevision(db, 'TENANT-A', firstCard.cardId, 1)?.state).toBe('superseded');
    expect(getCardRevision(db, 'TENANT-A', firstCard.cardId, 1)?.evidenceIds).toEqual(expect.any(Array));
  });

  it('AEG-TST-004 matrix 18: models-enabled setting does not change decisions or call providers', async () => {
    const disabled = makeHarness({ modelsEnabled: false });
    const disabledSession = await login(disabled.app);
    const disabledResponse = await assess(disabled.app, disabledSession.token, body(120));
    const enabled = makeHarness({ modelsEnabled: true });
    const enabledSession = await login(enabled.app);
    const enabledResponse = await assess(enabled.app, enabledSession.token, body(120));
    expect(disabledResponse.statusCode).toBe(200);
    expect(enabledResponse.statusCode).toBe(200);
    expect((enabledResponse.json() as { decisionHash: string }).decisionHash)
      .toBe((disabledResponse.json() as { decisionHash: string }).decisionHash);
    expect(count(disabled.db, 'model_calls')).toBe(0);
    expect(count(enabled.db, 'model_calls')).toBe(0);
  });

  it('AEG-TST-004 retries after a post-commit crash with one run, card revision and audit event', async () => {
    let throwOnce = true;
    const { db, app } = makeHarness({ afterCommit: () => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('simulated post-commit crash');
      }
    } });
    const session = await login(app);
    const payload = body(120, { idempotencyKey: 'crash-retry-1' });
    const beforeRuns = count(db, 'workflow_runs');
    const beforeCards = count(db, 'cards');
    const beforeEvents = count(db, 'audit_events');
    const first = await assess(app, session.token, payload);
    const retried = await assess(app, session.token, payload);
    expect(first.statusCode).toBe(500);
    expect(retried.statusCode).toBe(200);
    expect((retried.json() as { run: { replayed: boolean } }).run.replayed).toBe(true);
    expect(count(db, 'workflow_runs')).toBe(beforeRuns + 1);
    expect(count(db, 'cards')).toBe(beforeCards + 1);
    expect(count(db, 'audit_events')).toBe(beforeEvents + 1);
  });

  it('AEG-TST-011 verifies the tenant audit chain after several runs', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    await assess(app, session.token, body(120));
    await assess(app, session.token, body(50));
    await assess(app, session.token, body(80));
    const response = await app.inject(withToken(session.token, { method: 'GET', url: '/api/audit/verify' }));
    expect(response.statusCode).toBe(200);
    expect((response.json() as { ok: boolean }).ok).toBe(true);
  });

  it('AEG-TST-011 exports the pre-export chain and appends an export event afterward', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    await assess(app, session.token, body(120));
    const response = await app.inject(withToken(session.token, { method: 'GET', url: '/api/audit/export' }));
    const exported = response.json() as { scope: { tenantId: string }; events: AuditEvent[]; head: { sequence: number } };
    expect(response.statusCode).toBe(200);
    expect(exported.scope.tenantId).toBe('TENANT-A');
    expect(exported.events.every((event) => event.tenantId === 'TENANT-A')).toBe(true);
    expect(verifyChain(exported.events, { productId: 'AEG', tenantId: 'TENANT-A' }).ok).toBe(true);
    const after = await app.inject(withToken(session.token, { method: 'GET', url: '/api/audit/verify' }));
    expect((after.json() as { head: { sequence: number } }).head.sequence).toBe(exported.head.sequence + 1);
  });

  it('AEG-TST-011 limits audit export to tenant B and excludes tenant A events', async () => {
    const { app } = makeHarness();
    const tenantA = await login(app);
    const tenantB = await login(app, 'USER-B-COORD');
    await assess(app, tenantA.token, body(120));
    await assess(app, tenantB.token, { ...body(120), incidentCardId: 'INC-TENANT-B-SYN-FLOOD-0001' });
    const response = await app.inject(withToken(tenantB.token, { method: 'GET', url: '/api/audit/export' }));
    const exported = response.json() as { scope: { tenantId: string }; events: AuditEvent[] };
    expect(response.statusCode).toBe(200);
    expect(exported.scope.tenantId).toBe('TENANT-B');
    expect(exported.events.every((event) => event.tenantId === 'TENANT-B')).toBe(true);
  });

  it('AEG-TST-011 forbids viewer access to workflow, audit and budget routes', async () => {
    const { app } = makeHarness();
    const session = await login(app, 'USER-A-VIEW');
    const workflow = await assess(app, session.token, body(120));
    const audit = await app.inject(withToken(session.token, { method: 'GET', url: '/api/audit/verify' }));
    const budget = await app.inject(withToken(session.token, { method: 'GET', url: '/api/budget' }));
    for (const response of [workflow, audit, budget]) {
      expect(response.statusCode).toBe(403);
      expect(errorCode(response)).toBe('E_FORBIDDEN_ROLE');
    }
  });

  it('AEG-MEDIA-001 the page security policy allows Google map scripts and Wikimedia place photos, and nothing else off-site for images', async () => {
    const { app } = makeHarness();
    const policy = String((await app.inject({ method: 'GET', url: '/' })).headers['content-security-policy']);
    expect(policy).toContain('img-src');
    expect(policy).toMatch(/img-src[^;]*https:\/\/upload\.wikimedia\.org/);
    expect(policy).toMatch(/img-src[^;]*https:\/\/thumb\.wikimedia\.org/);
    expect(policy).toMatch(/script-src[^;]*https:\/\/maps\.googleapis\.com/);
    expect(policy).not.toMatch(/img-src[^;]*\*(?!\.)/);   // no bare wildcard source
  });

  it('AEG-ADMIN-001 admin desk: administrators only, read-only, with locked language stubs and no approved GPU render', async () => {
    const { app } = makeHarness();
    const viewer = await login(app, 'USER-A-VIEW');
    const denied = await app.inject(withToken(viewer.token, { method: 'GET', url: '/api/admin/desk' }));
    expect(denied.statusCode).toBe(403);
    const admin = await login(app, 'DEV-ADMIN');
    const response = await app.inject(withToken(admin.token, { method: 'GET', url: '/api/admin/desk' }));
    expect(response.statusCode).toBe(200);
    const desk = response.json() as { spend: { period: string; funding: unknown[] }; broadcast: { slots: { airLocal: string; captureLocal: string; captureUtc: string }[]; languages: { code: string; state: string }[]; render: { state: string; gpuPriced: boolean } }; feeds: { dataConfidence: { provisional: boolean } } };
    expect(desk.spend.period).toMatch(/^\d{4}-\d{2}$/);
    expect(desk.spend.funding.length).toBeGreaterThan(0);
    expect(desk.broadcast.slots.map((slot) => `${slot.airLocal} air, ${slot.captureLocal} capture, ${slot.captureUtc} UTC`)).toEqual(['07:00 air, 06:00 capture, 22:00 UTC', '12:00 air, 11:00 capture, 03:00 UTC', '17:00 air, 16:00 capture, 08:00 UTC', '22:00 air, 21:00 capture, 13:00 UTC']);
    expect(desk.broadcast.languages.map((l) => `${l.code}:${l.state}`)).toEqual(['en:active', 'ms:locked', 'zh:locked', 'ta:locked']);
    expect(desk.broadcast.render.gpuPriced).toBe(true);
    expect(['PRICED_NOT_GATED', 'GATED_GO_NOT_RUN', 'WAITING_FOR_OWNER', 'STOPPED', 'RUN_RECORDED']).toContain(desk.broadcast.render.state);
    expect(desk.feeds.dataConfidence.provisional).toBe(true);
  });

  it('the server refuses to approve a bulletin nobody decided within an hour of its air time (the page already hides the button)', async () => {
    const { app, db } = makeHarness();
    const admin = await login(app, 'DEV-ADMIN');
    const made = generateLatestBulletin({ db, clock: new FixedClock(testNow), ids: new SeqIdGen(), schedule: loadSchedule() });
    expect(made.ok).toBe(true);
    const id = made.ok ? made.bulletin.bulletinId : '';
    db.prepare('UPDATE broadcast_bulletins SET air_at = ? WHERE bulletin_id = ?').run(new Date(Date.parse(testNow) - 2 * 60 * 60_000).toISOString(), id);
    const res = await app.inject(withToken(admin.token, { method: 'POST', url: `/api/admin/screening/${id}`, payload: { action: 'approve' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('expired');
    expect(((await app.inject({ method: 'GET', url: '/public/broadcast/latest' })).json() as { bulletin: unknown }).bulletin).toBeNull();
  });

  it('AEG-NEWS-005 screening room: administrators only; the public page shows a bulletin only after it is approved', async () => {
    const { app, db } = makeHarness();
    const viewer = await login(app, 'USER-A-VIEW');
    expect((await app.inject(withToken(viewer.token, { method: 'GET', url: '/api/admin/screening' }))).statusCode).toBe(403);
    const admin = await login(app, 'DEV-ADMIN');
    const made = generateLatestBulletin({ db, clock: new FixedClock(testNow), ids: new SeqIdGen(), schedule: loadSchedule() });
    if (made.ok) db.prepare('UPDATE broadcast_bulletins SET air_at = ? WHERE bulletin_id = ?').run(testNow, made.bulletin.bulletinId);   // aired now: a bulletin is approvable for an hour after its air time
    expect(made.ok).toBe(true);
    const id = made.ok ? made.bulletin.bulletinId : '';
    const room = (await app.inject(withToken(admin.token, { method: 'GET', url: '/api/admin/screening' }))).json() as { approvalRequired: boolean; draft: { bulletin: { bulletinId: string }; problems: string[] }; stored: { bulletinId: string; review: unknown }[] };
    expect(room.approvalRequired).toBe(true);
    expect(room.draft.bulletin.bulletinId).toBe('DRAFT');
    expect(room.stored.map((b) => b.bulletinId)).toEqual([id]);
    expect(room.stored[0]!.review).toBeNull();
    const before = (await app.inject({ method: 'GET', url: '/public/broadcast/latest' })).json() as { bulletin: unknown };
    expect(before.bulletin).toBeNull();
    expect((await app.inject(withToken(admin.token, { method: 'POST', url: `/api/admin/screening/${id}`, payload: { action: 'maybe' } }))).statusCode).toBe(400);
    expect((await app.inject(withToken(viewer.token, { method: 'POST', url: `/api/admin/screening/${id}`, payload: { action: 'approve' } }))).statusCode).toBe(403);
    expect((await app.inject(withToken(admin.token, { method: 'POST', url: `/api/admin/screening/${id}`, payload: { action: 'approve' } }))).statusCode).toBe(200);
    const shown = (await app.inject({ method: 'GET', url: '/public/broadcast/latest' })).json() as { bulletin: { bulletinId: string } };
    expect(shown.bulletin.bulletinId).toBe(id);
    // Approved means locked: no second approve, no hold; a withdraw needs a written reason, then the bulletin leaves the public page and can be approved again.
    const post = (payload: Record<string, unknown>) => app.inject(withToken(admin.token, { method: 'POST', url: `/api/admin/screening/${id}`, payload }));
    const latest = async () => ((await app.inject({ method: 'GET', url: '/public/broadcast/latest' })).json() as { bulletin: unknown }).bulletin;
    expect((await post({ action: 'approve' })).statusCode).toBe(400);
    expect((await post({ action: 'hold' })).statusCode).toBe(400);
    expect((await post({ action: 'withdraw' })).statusCode).toBe(400);
    expect((await post({ action: 'withdraw', note: 'oops' })).statusCode).toBe(400);
    expect((await post({ action: 'withdraw', note: 'PSI figure looks wrong' })).statusCode).toBe(200);
    expect(await latest()).toBeNull();
    expect((await post({ action: 'withdraw', note: 'again please' })).statusCode).toBe(400);
    expect((await post({ action: 'approve' })).statusCode).toBe(200);
    const stored = ((await app.inject(withToken(admin.token, { method: 'GET', url: '/api/admin/screening' }))).json() as { stored: { log: { action: string }[]; review: { decision: string } }[] }).stored[0]!;
    expect(stored.log.map((e) => e.action)).toEqual(['APPROVE', 'WITHDRAW', 'APPROVE']);
    expect(stored.review.decision).toBe('APPROVED');
    const one = (await app.inject(withToken(admin.token, { method: 'GET', url: `/api/admin/screening/bulletin/${id}` }))).json() as { bulletin: { bulletinId: string } };
    expect(one.bulletin.bulletinId).toBe(id);
    expect(((await app.inject(withToken(admin.token, { method: 'GET', url: '/api/admin/screening/bulletin/DRAFT' }))).json() as { bulletin: { bulletinId: string } }).bulletin.bulletinId).toBe('DRAFT');
    expect((await app.inject(withToken(viewer.token, { method: 'GET', url: `/api/admin/screening/bulletin/${id}` }))).statusCode).toBe(403);
  });

  it('AEG-TST-012 reports budget limits, zero committed and disabled models by default', async () => {
    const { app } = makeHarness();
    const session = await login(app, 'DEV-ADMIN');
    const response = await app.inject(withToken(session.token, { method: 'GET', url: '/api/budget' }));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      limits: { accountMicro: 0, dayMicro: 0, taskMicro: 0 },
      committedMicro: 0,
      modelsEnabled: false,
      providerMode: 'stub',
    });
  });

  it('AEG-TST-013 confirms pin routes make no provider calls', async () => {
    const { db, app } = makeHarness();
    const session = await login(app);
    const card = listCards(db, 'TENANT-A', 'incident')[0];
    if (!card) throw new Error('Expected a seeded incident card');
    const response = await app.inject(withToken(session.token, { method: 'PUT', url: `/api/pins/${card.cardId}` }));
    expect(response.statusCode).toBe(200);
    expect(count(db, 'model_calls')).toBe(0);
  });
});
