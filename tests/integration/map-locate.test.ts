import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/api/server.js';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { upsertPlaces } from '../../src/data/repos/essentialPlaces.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { seedAll } from '../../src/services/seed.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

it('finds a named area from stored places without creating a pin or allowing anonymous lookup', async () => {
  const db = openDb(':memory:');
  const clock = new FixedClock('2026-10-18T10:00:00Z');
  const ids = new SeqIdGen();
  migrate(db, fileURLToPath(new URL('../../migrations/', import.meta.url)), clock.now());
  seedAll(db, fileURLToPath(new URL('../../fixtures/', import.meta.url)), new FixedClock('2026-10-13T00:00:00Z'), ids);
  upsertPlaces(db, [
    { osmId: 'node/1', category: 'hospital', name: 'Gombak Medical Centre', lat: 3.22, lng: 101.71, phone: null, website: null, address: null, operator: null },
    { osmId: 'node/2', category: 'clinic', name: 'Gombak Clinic', lat: 3.23, lng: 101.72, phone: null, website: null, address: null, operator: null },
  ], clock.now());
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) });
  apps.push(app);
  expect((await app.inject({ method: 'GET', url: '/api/map/locate?name=Gombak' })).statusCode).toBe(401);
  const token = (await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'DEV-ADMIN' } })).json().token as string;
  const headers = { authorization: `Bearer ${token}` };
  const found = await app.inject({ method: 'GET', url: '/api/map/locate?name=Gombak', headers });
  expect(found.statusCode).toBe(200);
  expect(found.json()).toMatchObject({ found: true, source: 'stored-openstreetmap-places', approximate: true, lat: 3.225, lng: 101.715 });
  const pin = await app.inject({ method: 'GET', url: '/api/map/locate?name=Orchard%20Road', headers });
  expect(pin.json()).toMatchObject({ found: true, source: 'monitoring-pins', approximate: false, lat: 1.3048, lng: 103.8318 });
  expect((await app.inject({ method: 'GET', url: '/api/map/locate?name=Unknownville', headers })).json()).toMatchObject({ found: false });
  expect((db.prepare('SELECT COUNT(*) AS n FROM pin_overrides').get() as { n: number }).n).toBe(0);
});
