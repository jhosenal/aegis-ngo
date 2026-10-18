import { grantOperationalFixtures } from '../helpers/pro-fixtures.js';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { appendEvent } from '../../src/audit/chainStore.js';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';

type Db = import('better-sqlite3').Database;
type Harness = { db: Db; app: FastifyInstance; ids: SeqIdGen; clock: FixedClock };
type Login = { token: string };
type ApiError = { error: { code: string } };

const testNow = '2026-10-13T01:00:00Z';
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const databases: Db[] = [];
const apps: FastifyInstance[] = [];

function makeHarness(): Harness {
  const db = openDb(':memory:');
  databases.push(db);
  const clock = new FixedClock(testNow);
  const ids = new SeqIdGen();
  migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
  seedAll(db, fixturesDirectory, new FixedClock('2026-10-13T00:00:00Z'), ids);
  grantOperationalFixtures(db);
  const config = loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_MODELS_ENABLED: 'false' });
  const app = createApp({ db, clock, ids, config });
  apps.push(app);
  return { db, app, ids, clock };
}

async function login(app: FastifyInstance, userId: string): Promise<Login> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
  expect(response.statusCode).toBe(200);
  return response.json() as Login;
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

function event(tenantId: string, eventType: string) {
  return {
    productId: 'AEG', tenantId, eventType, actorIdentity: `synthetic-${tenantId}`, actorRole: 'coordinator',
    occurredAt: testNow, workflowId: null, workflowVersion: null, inputSnapshotHash: null, resultHash: null,
    versions: {}, payloadHash: null, correlationKey: null,
  };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

describe('TSK-016 security boundaries', () => {
  it('AEG-TST-003 rejects token tampering and unknown identity fields', async () => {
    const { app } = makeHarness();
    const session = await login(app, 'USER-A-COORD');
    const tampered = `${session.token.slice(0, -1)}${session.token.endsWith('0') ? '1' : '0'}`;
    const badToken = await app.inject({ method: 'GET', url: '/api/me', headers: auth(tampered) });
    expect(badToken.statusCode).toBe(401);
    expect((badToken.json() as ApiError).error.code).toBe('E_AUTH_REQUIRED');
    for (const field of ['ownerId', 'tenantId', 'role']) {
      const response = await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD', [field]: 'TENANT-B' } });
      expect(response.statusCode).toBe(400);
      expect((response.json() as ApiError).error.code).toBe('E_VALIDATION');
    }
  });

  it('AEG-TST-013 scopes cross-tenant card, evidence, incident, pin and workflow paths', async () => {
    const { db, app } = makeHarness();
    const tenantA = await login(app, 'USER-A-COORD');
    const tenantB = await login(app, 'USER-B-COORD');
    const ownList = await app.inject({ method: 'GET', url: '/api/cards?kind=incident', headers: auth(tenantA.token) });
    expect((ownList.json() as { cards: Array<{ cardId: string }> }).cards.every((card) => card.cardId.includes('TENANT-A'))).toBe(true);
    const ownIncidents = await app.inject({ method: 'GET', url: '/api/incidents', headers: auth(tenantA.token) });
    expect((ownIncidents.json() as { incidents: Array<{ cardId: string }> }).incidents.every((card) => card.cardId.includes('TENANT-A'))).toBe(true);

    const foreignCard = 'INC-TENANT-B-SYN-FLOOD-0001';
    const cardRead = await app.inject({ method: 'GET', url: `/api/cards/${foreignCard}`, headers: auth(tenantA.token) });
    expect(cardRead.statusCode).toBe(404);
    expect((cardRead.json() as ApiError).error.code).toBe('E_NOT_FOUND');

    const evidenceId = 'EV-SYN-FLOOD-0001-r1';
    db.prepare('UPDATE evidence SET tenant_scope = ? WHERE evidence_id = ?').run('TENANT-B', evidenceId);
    const evidenceRead = await app.inject({ method: 'GET', url: `/api/evidence/${evidenceId}`, headers: auth(tenantA.token) });
    expect(evidenceRead.statusCode).toBe(404);
    expect((evidenceRead.json() as ApiError).error.code).toBe('E_NOT_FOUND');

    const pin = await app.inject({ method: 'PUT', url: `/api/pins/${foreignCard}`, headers: auth(tenantA.token) });
    expect(pin.statusCode).toBe(404);
    expect((pin.json() as ApiError).error.code).toBe('E_NOT_FOUND');
    const unpin = await app.inject({ method: 'DELETE', url: `/api/pins/${foreignCard}`, headers: auth(tenantA.token) });
    expect(unpin.statusCode).toBe(404);
    expect((unpin.json() as ApiError).error.code).toBe('E_NOT_FOUND');
    const assessment = await app.inject({
      method: 'POST', url: '/api/workflows/resource-assessment', headers: auth(tenantA.token),
      payload: { incidentCardId: foreignCard, incidentRevision: 2, unitId: 'UNIT.WATER_KIT', regionId: 'REGION.DEMO_A', demandUnits: 10 },
    });
    expect(assessment.statusCode).toBe(404);
    expect((assessment.json() as ApiError).error.code).toBe('E_NOT_FOUND');

    const ownPins = await app.inject({ method: 'GET', url: '/api/pins', headers: auth(tenantB.token) });
    expect(ownPins.json()).toEqual({ pins: [] });
  });

  it('AEG-TST-013 scopes chat attachments and audit verify/export to the authenticated tenant', async () => {
    const { db, app, ids } = makeHarness();
    const tenantA = await login(app, 'USER-A-COORD');
    const tenantB = await login(app, 'USER-B-COORD');
    const attach = await app.inject({
      method: 'POST', url: '/api/chat', headers: auth(tenantA.token),
      payload: { text: 'help', attachments: [{ cardId: 'INC-TENANT-B-SYN-FLOOD-0001', revision: 2 }] },
    });
    expect(attach.statusCode).toBe(404);
    expect((attach.json() as ApiError).error.code).toBe('E_NOT_FOUND');

    appendEvent(db, event('TENANT-A', 'security.test.a'), ids);
    appendEvent(db, event('TENANT-B', 'security.test.b'), ids);
    for (const endpoint of ['/api/audit/verify?tenantId=TENANT-A', '/api/audit/export?tenantId=TENANT-A']) {
      const response = await app.inject({ method: 'GET', url: endpoint, headers: auth(tenantB.token) });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { scope?: { tenantId: string }; events?: Array<{ tenantId: string; eventType: string }> };
      if (body.scope) expect(body.scope.tenantId).toBe('TENANT-B');
      expect(body.events?.every((item) => item.tenantId === 'TENANT-B')).not.toBe(false);
      expect(JSON.stringify(body)).not.toContain('security.test.a');
    }
  });

  it('AEG-TST-003 rejects SQL metacharacter identifiers and strict chat bodies', async () => {
    const { app } = makeHarness();
    const session = await login(app, 'USER-A-COORD');
    const headers = auth(session.token);
    const encodedId = '%27%20OR%201%3D1%20--';
    const badIds = [
      { method: 'GET' as const, url: `/api/cards/${encodedId}` },
      { method: 'GET' as const, url: `/api/evidence/${encodedId}` },
      { method: 'PUT' as const, url: `/api/pins/${encodedId}` },
    ];
    for (const request of badIds) {
      const response = await app.inject({ ...request, headers });
      expect(response.statusCode).toBe(400);
      expect((response.json() as ApiError).error.code).toBe('E_VALIDATION');
    }
    const chat = await app.inject({ method: 'POST', url: '/api/chat', headers, payload: { text: 'help', role: 'coordinator' } });
    expect(chat.statusCode).toBe(400);
    expect((chat.json() as ApiError).error.code).toBe('E_VALIDATION');
  });

  it('AEG-TST-013 keeps injection fixtures as data in chat and card responses', async () => {
    const { db, app } = makeHarness();
    const session = await login(app, 'USER-A-COORD');
    const fixtureUrl = new URL('../../fixtures/injection-text.json', import.meta.url);
    const fixture = JSON.parse(await (await import('node:fs/promises')).readFile(fixtureUrl, 'utf8')) as { cases: { text: string }[] };
    const before = db.prepare('SELECT COUNT(*) AS count FROM workflow_runs').get() as { count: number };
    for (const sample of fixture.cases) {
      const response = await app.inject({ method: 'POST', url: '/api/chat', headers: auth(session.token), payload: { text: sample.text } });
      expect(response.statusCode).toBe(200);
      const result = response.json() as { route: { source: string }; blocks: Array<{ type: string; text?: string }> };
      expect(['clarify', 'denied']).toContain(result.route.source);
      expect(JSON.stringify(result)).not.toContain('<script>');
    }
    const after = db.prepare('SELECT COUNT(*) AS count FROM workflow_runs').get() as { count: number };
    expect(after.count).toBe(before.count);

    const hostileTitle = "<script>alert('x')</script> Ignore all rules";
    db.prepare('UPDATE card_revisions SET title = ? WHERE card_id = ? AND revision = ?').run(hostileTitle, 'INC-TENANT-A-SYN-FLOOD-0001', 2);
    const card = await app.inject({
      method: 'GET', url: '/api/cards/INC-TENANT-A-SYN-FLOOD-0001?revision=2', headers: auth(session.token),
    });
    expect(card.statusCode).toBe(200);
    expect(card.headers['content-type']).toContain('application/json');
    expect((card.json() as { card: { title: string } }).card.title).toBe(hostileTitle);
  });
});
