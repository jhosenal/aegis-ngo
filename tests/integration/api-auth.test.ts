import { grantOperationalFixtures } from '../helpers/pro-fixtures.js';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { listCards } from '../../src/data/repos/cards.js';
import { listEvidence } from '../../src/data/repos/evidence.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';
import type { FastifyInstance, InjectOptions } from 'fastify';

type Db = import('better-sqlite3').Database;
type LoginResponse = {
  token: string;
  expiresAt: string;
  user: { userId: string; displayName: string; role: string; tenantId: string; tenantName: string };
};
type ErrorResponse = { error: { code: string; message: string; details: Record<string, unknown> } };
type Harness = { db: Db; clock: FixedClock; app: FastifyInstance };

const seedNow = '2026-10-13T00:00:00Z';
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
  migrate(db, migrationDirectory, seedNow);
  seedAll(db, fixturesDirectory, new FixedClock(seedNow), ids);
  grantOperationalFixtures(db);
  const config = loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' });
  const app = createApp({ db, clock, ids, config });
  apps.push(app);
  return { db, clock, app };
}

async function login(app: FastifyInstance, userId = 'USER-A-COORD'): Promise<LoginResponse> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
  expect(response.statusCode).toBe(200);
  return response.json() as LoginResponse;
}

function withToken(token: string, options: Omit<InjectOptions, 'headers'> & { headers?: Record<string, string> }): InjectOptions {
  return {
    ...options,
    headers: { ...options.headers, authorization: `Bearer ${token}` },
  };
}

function errorCode(response: { json(): unknown }): string {
  return (response.json() as ErrorResponse).error.code;
}

function firstItem<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('Expected a seeded row');
  return item;
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

describe('TSK-009 API auth and read routes', () => {
  it('AEG-TST-001 returns the health shape and security headers', async () => {
    const { app } = makeHarness();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', env: 'test', storage: 'local', providerMode: 'stub', modelsEnabled: false, localAutoLogin: false });
    expect(response.headers['content-security-policy']).toBe("default-src 'self'; style-src 'self' 'unsafe-inline'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('AEG-TST-001 logs in each seeded user and returns the user view', async () => {
    const { app } = makeHarness();
    for (const [userId, role, tenantId] of [
      ['USER-A-COORD', 'coordinator', 'TENANT-A'],
      ['USER-A-VIEW', 'viewer', 'TENANT-A'],
      ['USER-B-COORD', 'coordinator', 'TENANT-B'],
    ]) {
      const session = await login(app, userId);
      expect(session.token).toMatch(/^[0-9a-f]{64}$/);
      expect(session.expiresAt).toBe('2026-10-13T09:00:00.000Z');
      expect(session.user).toMatchObject({ userId, role, tenantId });
    }
  });

  it('AEG-TST-001 rejects an unknown demo user with E_AUTH_REQUIRED', async () => {
    const { app } = makeHarness();
    const response = await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'UNKNOWN-USER' } });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe('E_AUTH_REQUIRED');
  });

  it('AEG-TST-001 requires a valid bearer token on protected routes', async () => {
    const { app } = makeHarness();
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe('E_AUTH_REQUIRED');
  });

  it('AEG-TST-001 rejects a tampered token and distinguishes an expired token', async () => {
    const { app, clock } = makeHarness();
    const session = await login(app);
    const tampered = `${session.token.slice(0, -1)}${session.token.endsWith('0') ? '1' : '0'}`;
    const badToken = await app.inject(withToken(tampered, { method: 'GET', url: '/api/me' }));
    expect(badToken.statusCode).toBe(401);
    expect(errorCode(badToken)).toBe('E_AUTH_REQUIRED');
    clock.advanceMs(9 * 60 * 60 * 1000);
    const expired = await app.inject(withToken(session.token, { method: 'GET', url: '/api/me' }));
    expect(expired.statusCode).toBe(401);
    expect(errorCode(expired)).toBe('E_AUTH_EXPIRED');
  });

  it('AEG-TST-001 rejects body-supplied tenant and role and uses the standard error envelope', async () => {
    const { app } = makeHarness();
    const response = await app.inject({
      method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD', tenantId: 'TENANT-B', role: 'coordinator' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'E_VALIDATION', message: 'Request validation failed', details: { issues: expect.any(Array) } } });
    expect(response.body).not.toContain('stack');
    const malformedJson = await app.inject({
      method: 'POST', url: '/api/session', payload: '{', headers: { 'content-type': 'application/json' },
    });
    expect(malformedJson.statusCode).toBe(400);
    expect(malformedJson.json()).toMatchObject({ error: { code: 'E_JSON_PARSE', details: {} } });
    expect(malformedJson.headers['content-security-policy']).toBe("default-src 'self'; style-src 'self' 'unsafe-inline'");
  });

  it('AEG-TST-013 serves the caller user view and tenant-scoped card list', async () => {
    const { db, app } = makeHarness();
    const session = await login(app);
    const me = await app.inject(withToken(session.token, { method: 'GET', url: '/api/me' }));
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ userId: 'USER-A-COORD', tenantId: 'TENANT-A', role: 'coordinator' });
    const response = await app.inject(withToken(session.token, { method: 'GET', url: '/api/cards?kind=incident' }));
    const body = response.json() as { cards: Array<{ cardId: string; latestRevision: number; synthetic: boolean }> };
    expect(response.statusCode).toBe(200);
    expect(body.cards).toHaveLength(4);
    expect(body.cards.every((card) => card.cardId.includes('TENANT-A') && card.synthetic)).toBe(true);
    expect(body.cards.some((card) => card.cardId.includes('TENANT-B'))).toBe(false);
    expect(listCards(db, 'TENANT-A', 'incident')).toHaveLength(4);
  });

  it('AEG-TST-013 returns card revision history, read-time evidence flags and children', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await app.inject(withToken(session.token, {
      method: 'GET', url: '/api/cards/INC-TENANT-A-SYN-FLOOD-0001?revision=2',
    }));
    const body = response.json() as {
      card: { cardId: string; revision: number };
      revisions: Array<{ revision: number; state: string }>;
      evidence: Array<{ evidenceId: string; flags: string[] }>;
      children: unknown[];
    };
    expect(response.statusCode).toBe(200);
    expect(body.card).toMatchObject({ cardId: 'INC-TENANT-A-SYN-FLOOD-0001', revision: 2 });
    expect(body.revisions).toHaveLength(2);
    expect(body.revisions[0]).toMatchObject({ revision: 1, state: 'superseded' });
    expect(body.evidence.some((item) => item.evidenceId === 'EV-SYN-FLOOD-0001-r2' && item.flags.includes('CONFLICTING'))).toBe(true);
    expect(Array.isArray(body.children)).toBe(true);
    const revisionOne = await app.inject(withToken(session.token, {
      method: 'GET', url: '/api/cards/INC-TENANT-A-SYN-FLOOD-0001?revision=1',
    }));
    const oldEvidence = (revisionOne.json() as { evidence: Array<{ evidenceId: string; flags: string[] }> }).evidence;
    expect(oldEvidence.some((item) => item.evidenceId === 'EV-SYN-FLOOD-0001-r1' && item.flags.includes('SUPERSEDED'))).toBe(true);
  });

  it('AEG-TST-013 returns evidence flags exactly at T-now', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const expected = new Map([
      ['EV-SYN-FLOOD-0001-r1', ['SYNTHETIC', 'SUPERSEDED']],
      ['EV-SYN-FLOOD-0001-r2', ['SYNTHETIC', 'CONFLICTING']],
      ['EV-SYN-STALE-0002-r1', ['SYNTHETIC', 'STALE']],
      ['EV-SYN-BADCOORD-0003-r1', ['SYNTHETIC', 'COORD_INVALID']],
      ['EV-SYN-B-7781-r1', ['SYNTHETIC', 'CONFLICTING']],
    ]);
    for (const [evidenceId, flags] of expected) {
      const response = await app.inject(withToken(session.token, { method: 'GET', url: `/api/evidence/${evidenceId}` }));
      expect(response.statusCode).toBe(200);
      expect((response.json() as { flags: string[] }).flags).toEqual(flags);
    }
  });

  it('AEG-TST-013 lists four incidents and both source status rows', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await app.inject(withToken(session.token, { method: 'GET', url: '/api/incidents' }));
    const body = response.json() as { incidents: unknown[]; sourceStatus: Array<{ sourceId: string; state: string }> };
    expect(response.statusCode).toBe(200);
    expect(body.incidents).toHaveLength(4);
    expect(body.sourceStatus).toHaveLength(2);
    expect(body.sourceStatus).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'SRC.SYNTH_FEED_A', state: 'OK' }),
      expect.objectContaining({ sourceId: 'SRC.SYNTH_FEED_B', state: 'MALFORMED' }),
    ]));
  });

  it('AEG-TST-013 hides another tenant card and private evidence as E_NOT_FOUND', async () => {
    const { db, app } = makeHarness();
    const evidenceId = firstItem(listEvidence(db)).evidenceId;
    db.prepare('UPDATE evidence SET tenant_scope = ? WHERE evidence_id = ?').run('TENANT-B', evidenceId);
    const session = await login(app);
    const cardId = firstItem(listCards(db, 'TENANT-B', 'incident')).cardId;
    const cardResponse = await app.inject(withToken(session.token, { method: 'GET', url: `/api/cards/${cardId}` }));
    const evidenceResponse = await app.inject(withToken(session.token, { method: 'GET', url: `/api/evidence/${evidenceId}` }));
    expect(cardResponse.statusCode).toBe(404);
    expect(errorCode(cardResponse)).toBe('E_NOT_FOUND');
    expect(evidenceResponse.statusCode).toBe(404);
    expect(errorCode(evidenceResponse)).toBe('E_NOT_FOUND');
  });

  it('AEG-TST-013 rejects invalid and SQL metacharacter ids with E_VALIDATION', async () => {
    const { app } = makeHarness();
    const session = await login(app);
    const response = await app.inject(withToken(session.token, {
      method: 'GET', url: '/api/cards/%27%20OR%201%3D1%20--',
    }));
    expect(response.statusCode).toBe(400);
    expect(errorCode(response)).toBe('E_VALIDATION');
  });

  it('AEG-TST-013 cannot pin another tenant card and repeat pinning is idempotent', async () => {
    const { db, app } = makeHarness();
    const session = await login(app);
    const ownCard = firstItem(listCards(db, 'TENANT-A', 'incident')).cardId;
    const foreignCard = firstItem(listCards(db, 'TENANT-B', 'incident')).cardId;
    const foreign = await app.inject(withToken(session.token, { method: 'PUT', url: `/api/pins/${foreignCard}` }));
    expect(foreign.statusCode).toBe(404);
    expect(errorCode(foreign)).toBe('E_NOT_FOUND');
    const first = await app.inject(withToken(session.token, { method: 'PUT', url: `/api/pins/${ownCard}` }));
    const second = await app.inject(withToken(session.token, { method: 'PUT', url: `/api/pins/${ownCard}` }));
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect((second.json() as { pins: unknown[] }).pins).toHaveLength(1);
    const removed = await app.inject(withToken(session.token, { method: 'DELETE', url: `/api/pins/${ownCard}` }));
    expect(removed.json()).toEqual({ pins: [] });
  });

  it('AEG-TST-001 keeps token hashes and stack text out of responses', async () => {
    const { db, app } = makeHarness();
    const session = await login(app);
    const tokenHash = createHash('sha256').update(session.token).digest('hex');
    const responses = [
      await app.inject(withToken(session.token, { method: 'GET', url: '/api/me' })),
      await app.inject(withToken(session.token, { method: 'GET', url: '/api/missing' })),
    ];
    for (const response of responses) {
      expect(response.body).not.toContain(tokenHash);
      expect(response.body).not.toContain('stack');
    }
    expect((db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string }).token_hash).toBe(tokenHash);
  });
});
