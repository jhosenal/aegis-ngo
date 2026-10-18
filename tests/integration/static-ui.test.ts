import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';

type Db = import('better-sqlite3').Database;
type Harness = { db: Db; app: FastifyInstance };
type LoginResponse = { token: string };
const now = '2026-10-13T00:00:00Z';
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const dbs: Db[] = [];
const apps: FastifyInstance[] = [];

function makeHarness(): Harness {
  const db = openDb(':memory:');
  dbs.push(db);
  const clock = new FixedClock('2026-10-13T01:00:00Z');
  const ids = new SeqIdGen();
  migrate(db, migrationDirectory, now);
  seedAll(db, fixturesDirectory, new FixedClock(now), ids);
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) });
  apps.push(app);
  return { db, app };
}

async function login(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD' } });
  expect(response.statusCode).toBe(200);
  return (response.json() as LoginResponse).token;
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});

describe('TSK-013 static UI and API boundary', () => {
  it('serves new build assets added after startup and never substitutes HTML for missing assets', async () => {
    const { app } = makeHarness();
    await app.ready();
    const asset = `runtime-regression-${randomUUID()}.js`;
    const path = fileURLToPath(new URL(`../../ui/dist/assets/${asset}`, import.meta.url));
    const code = 'export const rebuilt = true;\n';
    writeFileSync(path, code);
    try {
      const response = await app.inject({ method: 'GET', url: `/assets/${asset}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/javascript/);
      expect(response.body).toBe(code);
    } finally {
      unlinkSync(path);
    }
    for (const url of [`/assets/${asset}`, '/assets/missing.css?rebuild=1', '/brand/missing.png']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
      expect(response.headers['content-type'], url).not.toContain('text/html');
    }
  });

  it('AEG-TST-007 serves the built app shell and preserves API responses', async () => {
    const { app } = makeHarness();
    const shell = await app.inject({ method: 'GET', url: '/' });
    expect(shell.statusCode).toBe(200);
    expect(shell.headers['content-type']).toContain('text/html');
    expect(shell.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com blob:");
    expect(shell.headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(shell.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(shell.body).toContain('<div id="root"></div>');

    const cards = await app.inject({ method: 'GET', url: '/api/cards' });
    expect(cards.statusCode).toBe(401);
    expect(cards.json()).toMatchObject({ error: { code: 'E_AUTH_REQUIRED' } });

    const token = await login(app);
    const missingApi = await app.inject({ method: 'GET', url: '/api/nonexistent', headers: { authorization: `Bearer ${token}` } });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toMatchObject({ error: { code: 'E_NOT_FOUND' } });

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['content-type']).toContain('application/json');
    expect(health.json()).toMatchObject({ status: 'ok' });

    const spaFallback = await app.inject({ method: 'GET', url: '/nonexistent-route' });
    expect(spaFallback.statusCode).toBe(200);
    expect(spaFallback.headers['content-type']).toContain('text/html');
  });

  it('AEG-TST-007 requires a token on protected API route families', async () => {
    const { app } = makeHarness();
    const requests = [
      { method: 'GET', url: '/api/cards' },
      { method: 'GET', url: '/api/me' },
      { method: 'GET', url: '/api/audit/verify' },
      { method: 'POST', url: '/api/chat', payload: { message: 'help' } },
    ] as const;
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, request.url).toBe(401);
      expect(response.json(), request.url).toMatchObject({ error: { code: 'E_AUTH_REQUIRED' } });
    }
  });
});
