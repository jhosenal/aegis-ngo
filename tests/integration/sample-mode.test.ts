import { grantOperationalFixtures } from '../helpers/pro-fixtures.js';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { createApp } from '../../src/api/server.js';
import { seedAll } from '../../src/services/seed.js';
import { EnvStore } from '../../src/services/envStore.js';
import { demoReadings } from '../../src/services/sampleReadings.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const NOW = '2026-10-17T02:00:00Z';
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

function setup() {
  const db = openDb(':memory:'); const clock = new FixedClock(NOW); const ids = new SeqIdGen();
  migrate(db, dir, '2026-10-13T00:00:00Z'); seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
  grantOperationalFixtures(db);
  const store = new EnvStore();
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }), envStore: store });
  apps.push(app);
  return { app, store };
}
type Pin = { pinId: string; air: { data: Record<string, unknown> } | null; weather: { current: { data: Record<string, unknown> } | null } };

describe('sample mode (per viewer) and the sample dropped pin', () => {
  it('?sample=1 fills every pin with sample readings for that request only; the normal route stays empty and nothing is held', async () => {
    const { app, store } = setup();
    const sample = (await app.inject({ method: 'GET', url: '/public/environment?sample=1' })).json() as { sample: boolean; demoActive: boolean; pins: Pin[] };
    expect(sample.sample).toBe(true); expect(sample.demoActive).toBe(true);
    const withAir = sample.pins.filter((p) => p.air !== null);
    expect(withAir.length).toBeGreaterThan(50);
    for (const p of sample.pins) if (p.air) expect(p.air.data['demo']).toBe(true);
    expect(sample.pins.every((p) => p.weather.current?.data['demo'] === true)).toBe(true);
    const normal = (await app.inject({ method: 'GET', url: '/public/environment' })).json() as { sample: boolean; demoActive: boolean; pins: Pin[] };
    expect(normal.sample).toBe(false); expect(normal.demoActive).toBe(false);
    expect(normal.pins.every((p) => p.air === null && p.weather.current === null)).toBe(true);   // the sample was not kept
    expect(store.demoActive(NOW)).toBe(false);
  });
  it('demoActive turns on for everyone while an administrator\'s sample readings are loaded, and off after they are cleared', async () => {
    const { app, store } = setup();
    const pins = (await app.inject({ method: 'GET', url: '/public/environment' })).json() as { pins: { pinId: string; country: 'SG' | 'MY' | 'BN'; name: string; lat: number; lng: number }[] };
    const p = pins.pins[0]!;
    for (const r of demoReadings({ pinId: p.pinId, country: p.country, name: p.name, lat: p.lat, lng: p.lng, needs: ['air', 'weather'] } as never, NOW)) store.putDemo(r);
    expect(((await app.inject({ method: 'GET', url: '/public/environment' })).json() as { demoActive: boolean }).demoActive).toBe(true);
    store.clearDemo();
    expect(((await app.inject({ method: 'GET', url: '/public/environment' })).json() as { demoActive: boolean }).demoActive).toBe(false);
  });
  it('sample-pin requires Pro sign-in and returns a sample inside coverage, refusing a point outside', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/public/environment/sample-pin?lat=3.139&lng=101.687' })).statusCode).toBe(401);
    const session = (await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD' } })).json();
    const headers = { authorization: `Bearer ${session.token}` };
    const ok = await app.inject({ method: 'GET', url: '/public/environment/sample-pin?lat=3.139&lng=101.687', headers });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { sample: boolean; pin: Pin & { name: string }; attribution: { air: string } };
    expect(body.sample).toBe(true); expect(body.pin.name).toContain('Dropped pin'); expect(body.pin.air?.data['demo']).toBe(true); expect(body.attribution.air).toContain('DEMO');
    expect((await app.inject({ method: 'GET', url: '/public/environment/sample-pin?lat=51.5&lng=-0.12', headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/public/environment/sample-pin?lat=x&lng=1', headers })).statusCode).toBe(400);
  });
});
