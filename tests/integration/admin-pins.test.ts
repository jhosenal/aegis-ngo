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

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const NOW = '2026-10-17T03:00:00Z';
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

function setup() {
  const db = openDb(':memory:'); const clock = new FixedClock(NOW); const ids = new SeqIdGen();
  migrate(db, dir, '2026-10-13T00:00:00Z'); seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }), envStore: new EnvStore() });
  apps.push(app);
  return { app, db };
}
const login = async (app: FastifyInstance, userId: string) => ({ authorization: `Bearer ${((await app.inject({ method: 'POST', url: '/api/session', payload: { userId } })).json() as { token: string }).token}` });
type Row = { pinId: string; country: string; region: string; origin: string; removed: boolean; readingState: string; lastUpdatedAt: string | null };
type List = { total: number; pins: Row[]; summary: { active: number; removed: number; added: number; byCountry: Record<string, number>; withDemo: number }; filters: { regions: { country: string; region: string; count: number }[] }; capabilities: { google: boolean } };

describe('Admin Desk > Data control: pin list, add, delete, restore, demo data, refresh (AEG-DATA-001)', () => {
  it('administrators only', async () => {
    const { app } = setup();
    const viewer = await login(app, 'USER-A-VIEW');
    for (const [method, url] of [['GET', '/api/admin/pins'], ['POST', '/api/admin/pins'], ['POST', '/api/admin/data/dummy'], ['POST', '/api/admin/data/refresh'], ['GET', '/api/admin/pins/export.csv'], ['GET', '/api/admin/pins/history']] as const) {
      expect((await app.inject({ method, url, headers: viewer, payload: {} })).statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/api/admin/pins' })).statusCode).toBe(401);
  });

  it('lists the fixture pins with a summary and filters by country, state, role, status, origin and text', async () => {
    const { app } = setup(); const admin = await login(app, 'DEV-ADMIN');
    const get = async (qs = '') => (await app.inject({ method: 'GET', url: `/api/admin/pins${qs}`, headers: admin })).json() as List;
    const all = await get();
    expect(all.summary.active).toBe(125);
    expect(all.summary.byCountry).toEqual({ SG: 23, MY: 81, BN: 21 });
    expect(all.capabilities.google).toBe(false);
    expect(all.filters.regions.reduce((n, r) => n + r.count, 0)).toBe(125);
    expect((await get('?country=BN')).total).toBe(21);
    const region = all.filters.regions.find((r) => r.country === 'MY')!;
    expect((await get(`?country=MY&region=${encodeURIComponent(region.region)}`)).total).toBe(region.count);
    expect((await get('?status=never')).total).toBe(125);
    expect((await get('?origin=admin')).total).toBe(0);
    expect((await get('?q=orchard')).pins.length).toBeGreaterThan(0);
    expect((await get('?limit=5')).pins).toHaveLength(5);
  });

  it('adds a pin (checks the country box and the 500 m rule), shows it on the public map at once, then deletes it for good', async () => {
    const { app } = setup(); const admin = await login(app, 'DEV-ADMIN');
    const add = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/admin/pins', headers: admin, payload });
    expect((await add({ name: 'Bangkok test', country: 'MY', region: 'X', lat: 13.75, lng: 100.5 })).statusCode).toBe(400);   // outside the box
    expect((await add({ name: 'Wrong country', country: 'SG', region: 'X', lat: 3.139, lng: 101.687 })).statusCode).toBe(400);   // Kuala Lumpur is not Singapore
    expect((await add({ name: '', country: 'MY', region: 'Selangor', lat: 3.139, lng: 101.687 })).statusCode).toBe(400);
    const ok = await add({ name: 'Test Station Shah Alam', country: 'MY', region: 'Selangor', lat: 3.0733, lng: 101.5185, roles: ['general'] });
    expect(ok.statusCode).toBe(200);
    const pin = (ok.json() as { pin: { pinId: string; review: string } }).pin;
    expect(pin.pinId).toBe('ap-001');
    expect(pin.review).toMatch(/Added by an administrator/);
    expect((await add({ name: 'Same place', country: 'MY', region: 'Selangor', lat: 3.0733, lng: 101.5185 })).statusCode).toBe(400);   // within 500 m of the new pin
    const pub = (await app.inject({ method: 'GET', url: '/public/environment' })).json() as { registry: { pins: number }; pins: { pinId: string }[] };
    expect(pub.registry.pins).toBe(126);
    expect(pub.pins.some((p) => p.pinId === 'ap-001')).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/pins/ap-001', headers: admin })).statusCode).toBe(200);
    expect(((await app.inject({ method: 'GET', url: '/public/environment' })).json() as { registry: { pins: number } }).registry.pins).toBe(125);
    expect((await app.inject({ method: 'GET', url: '/api/admin/pins?removed=1', headers: admin })).json()).toMatchObject({ total: 0 });   // an added pin is gone, not tombstoned
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/pins/ap-001', headers: admin })).statusCode).toBe(404);
  });

  it('deleting a fixture pin hides it everywhere and can be restored; the history keeps every step', async () => {
    const { app } = setup(); const admin = await login(app, 'DEV-ADMIN');
    const first = ((await app.inject({ method: 'GET', url: '/api/admin/pins?limit=1', headers: admin })).json() as List).pins[0]!;
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/pins/${first.pinId}`, headers: admin })).statusCode).toBe(200);
    expect(((await app.inject({ method: 'GET', url: '/public/environment' })).json() as { pins: { pinId: string }[] }).pins.some((p) => p.pinId === first.pinId)).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/public/environment/pin/${first.pinId}` })).statusCode).toBe(404);
    const removed = (await app.inject({ method: 'GET', url: '/api/admin/pins?removed=1', headers: admin })).json() as List;
    expect(removed.pins.map((p) => p.pinId)).toEqual([first.pinId]);
    expect((await app.inject({ method: 'POST', url: `/api/admin/pins/${first.pinId}/restore`, headers: admin })).statusCode).toBe(200);
    expect(((await app.inject({ method: 'GET', url: '/public/environment' })).json() as { registry: { pins: number } }).registry.pins).toBe(125);
    const history = ((await app.inject({ method: 'GET', url: '/api/admin/pins/history', headers: admin })).json() as { history: { action: string; pinId: string | null }[] }).history;
    expect(history.map((h) => h.action)).toEqual(['RESTORE', 'DELETE']);
  });

  it('dummy data: loads labelled synthetic readings (never Google data), shows them as demo, and clears them with the last-updated time they made', async () => {
    const { app, db } = setup(); const admin = await login(app, 'DEV-ADMIN');
    const load = (await app.inject({ method: 'POST', url: '/api/admin/data/dummy', headers: admin, payload: { action: 'load' } })).json() as { loaded: number; pins: number; note: string };
    expect(load.pins).toBe(125); expect(load.loaded).toBeGreaterThan(125); expect(load.note).toMatch(/not Google data/);
    const list = (await app.inject({ method: 'GET', url: '/api/admin/pins', headers: admin })).json() as List;
    expect(list.summary.withDemo).toBe(125);
    const pub = (await app.inject({ method: 'GET', url: '/public/environment' })).json() as { pins: { air: { attribution: string; data: { demo?: boolean } } | null; lastUpdatedAt: string | null }[] };
    expect(pub.pins[0]!.air?.attribution).toMatch(/^DEMO DATA/);
    expect(pub.pins[0]!.air?.data.demo).toBe(true);
    // a one-pin load
    expect((await app.inject({ method: 'POST', url: '/api/admin/data/dummy', headers: admin, payload: { action: 'load', pinIds: [list.pins[0]!.pinId] } })).statusCode).toBe(200);
    const cleared = (await app.inject({ method: 'POST', url: '/api/admin/data/dummy', headers: admin, payload: { action: 'clear' } })).json() as { cleared: number };
    expect(cleared.cleared).toBeGreaterThan(125);
    const after = (await app.inject({ method: 'GET', url: '/api/admin/pins', headers: admin })).json() as List;
    expect(after.summary.withDemo).toBe(0);
    expect(after.pins.every((p) => p.readingState === 'never' && p.lastUpdatedAt === null)).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/admin/data/dummy', headers: admin, payload: { action: 'fly' } })).statusCode).toBe(400);
    // nothing demo or Google-like is written to the database
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    for (const t of tables) expect(JSON.stringify(db.prepare(`SELECT * FROM ${t.name}`).all())).not.toContain('Demo index');
  });

  it('refresh: needs a ticked source; Google needs confirmation and keys; the pin export has coordinates only', async () => {
    const { app } = setup(); const admin = await login(app, 'DEV-ADMIN');
    const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: admin, payload });
    expect((await post('/api/admin/data/refresh', { sources: [] })).statusCode).toBe(400);
    expect((await post('/api/admin/data/refresh', { sources: ['bogus'] })).statusCode).toBe(400);
    const g = (await post('/api/admin/data/refresh', { sources: ['google'] })).json() as { results: { source: string; outcome: string; detail: string }[] };
    expect(g.results[0]).toMatchObject({ source: 'google', outcome: 'UNAVAILABLE' });   // no keys in the test server
    expect((await post('/api/admin/pins/no-such-pin/refresh', { sources: ['openmeteo'] })).statusCode).toBe(404);
    const csv = await app.inject({ method: 'GET', url: '/api/admin/pins/export.csv', headers: admin });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body.split('\n')[0]).toBe('pinId,name,country,region,lat,lng,roles,origin,removed');
    expect(csv.body.split('\n').length).toBe(127);
    expect(csv.body).not.toMatch(/aqi|temperature|Universal/i);
  });
});
