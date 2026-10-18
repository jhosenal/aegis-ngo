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
import { coverageOf } from '../../src/domains/coverage.js';
import { customPin } from '../../src/api/routes/credits.js';
import { seedAll } from '../../src/services/seed.js';
import { EnvStore } from '../../src/services/envStore.js';
import type { EnvOnDemand } from '../../src/services/envOnDemand.js';
import type { EnvPin } from '../../src/sources/pinRegistry.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const NOW = '2026-10-17T02:00:00Z';
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

function setup(live: 'off' | 'ok' | 'down') {
  const db = openDb(':memory:');
  const clock = new FixedClock(NOW); const ids = new SeqIdGen();
  migrate(db, dir, '2026-10-13T00:00:00Z'); seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
  grantOperationalFixtures(db);
  const store = new EnvStore();
  const calls: string[] = [];
  const fake = {
    lookup: async (pin: EnvPin) => {
      calls.push(pin.pinId);
      if (live === 'down') return { status: 'unavailable' as const, detail: 'no reading' };
      const base = { pinId: pin.pinId, sku: 'AIR_QUALITY' as const, fetchedAt: NOW, validUntil: '2026-10-17T03:00:00Z', attribution: 'Source: Includes air quality data from Google', freshness: { text: 'x' } as never };
      store.put({ ...base, kind: 'AIR_CURRENT', data: { indexes: [{ code: 'uaqi', displayName: 'Universal AQI', aqi: 61 }] } } as never);
      return { status: 'fetched' as const, detail: null };
    },
    usage: () => ({ day: '', lookupsToday: 0, dailyMax: 300 }),
  } as unknown as EnvOnDemand;
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }), envStore: store, ...(live === 'off' ? {} : { envOnDemand: fake }) });
  apps.push(app);
  return { app, db, calls };
}
const login = async (app: FastifyInstance, userId: string) => (await app.inject({ method: 'POST', url: '/api/session', payload: { userId } })).json() as { token: string };
const authed = (token: string) => ({ authorization: `Bearer ${token}` });

describe('credits (stub) and the custom pin dropper (AEG-CREDIT-001)', () => {
  it('coverage: Singapore, Brunei and Malaysia only, Singapore and Brunei before the larger Malaysian boxes', () => {
    expect(coverageOf(1.3521, 103.8198)).toBe('SG');
    expect(coverageOf(4.8903, 114.9422)).toBe('BN');
    expect(coverageOf(3.139, 101.6869)).toBe('MY');     // Kuala Lumpur
    expect(coverageOf(5.98, 116.07)).toBe('MY');        // Kota Kinabalu
    expect(coverageOf(13.75, 100.5)).toBeNull();        // Bangkok
    expect(coverageOf(Number.NaN, 100)).toBeNull();
    expect(customPin(3.13912, 101.68691, 'MY').pinId).toBe('cust-3.139_101.687');
  });

  it('a new account gets 5 starter credits once; a stub purchase adds demo credits, says so, and is capped; signed-out is refused', async () => {
    const { app } = setup('off');
    expect((await app.inject({ method: 'GET', url: '/api/credits' })).statusCode).toBe(401);
    const { token } = await login(app, 'USER-A-COORD');
    const first = (await app.inject({ method: 'GET', url: '/api/credits', headers: authed(token) })).json() as { balance: number; stub: boolean; note: string; pinLookupCost: number };
    const again = (await app.inject({ method: 'GET', url: '/api/credits', headers: authed(token) })).json() as { balance: number };
    expect([first.balance, again.balance, first.pinLookupCost, first.stub]).toEqual([5, 5, 1, true]);
    expect(first.note).toMatch(/nothing is charged/);
    const bought = (await app.inject({ method: 'POST', url: '/api/credits/buy-stub', headers: authed(token), payload: { packId: 'medium' } })).json() as { balance: number; bought: number };
    expect([bought.bought, bought.balance]).toEqual([50, 55]);
    expect((await app.inject({ method: 'POST', url: '/api/credits/buy-stub', headers: authed(token), payload: { packId: 'gold' } })).statusCode).toBe(400);
    for (let i = 0; i < 7; i += 1) await app.inject({ method: 'POST', url: '/api/credits/buy-stub', headers: authed(token), payload: { packId: 'large' } });   // 50 + 7 x 200 would pass the cap of 400
    const after = (await app.inject({ method: 'GET', url: '/api/credits', headers: authed(token) })).json() as { balance: number };
    expect(after.balance).toBeLessThanOrEqual(5 + 400);
  });

  it('a place check costs 1 credit, shows the reading with Google attribution for one hour, never stores it, and refuses what it cannot serve', async () => {
    const { app, db, calls } = setup('ok');
    const { token } = await login(app, 'USER-A-COORD');
    const drop = (lat: number, lng: number) => app.inject({ method: 'POST', url: '/api/pins/lookup', headers: authed(token), payload: { lat, lng } });
    const ok = await drop(3.13912, 101.68691);
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { status: string; balance: number; cost: number; validMinutes: number; attribution: { air: string }; pin: { pinId: string; air: { data: { indexes: unknown[] } } | null } };
    expect([body.status, body.balance, body.cost, body.validMinutes]).toEqual(['fetched', 4, 1, 60]);
    expect(body.pin.pinId).toBe('cust-3.139_101.687');
    expect(body.pin.air?.data.indexes).toHaveLength(1);
    expect(body.attribution.air).toBe('Source: Includes air quality data from Google');
    expect(calls).toEqual(['cust-3.139_101.687']);
    // outside coverage: refused, no credit used
    expect((await drop(13.75, 100.5)).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/credits', headers: authed(token) })).json()).toMatchObject({ balance: 4 });
    // no Google value is ever written to the database
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    for (const t of tables) expect(JSON.stringify(db.prepare(`SELECT * FROM ${t.name}`).all())).not.toContain('Universal AQI');
    // credits run out: the sixth place check is refused with 402
    for (let i = 0; i < 4; i += 1) expect((await drop(3.2 + i * 0.01, 101.7)).statusCode).toBe(200);
    const broke = await drop(3.5, 101.7);
    expect(broke.statusCode).toBe(402);
    expect((broke.json() as { error: { code: string } }).error.code).toBe('E_INSUFFICIENT_CREDITS');
  });

  it('with live lookups off or Google unavailable nothing is charged', async () => {
    const off = setup('off');
    const t1 = (await login(off.app, 'USER-A-COORD')).token;
    const r1 = await off.app.inject({ method: 'POST', url: '/api/pins/lookup', headers: authed(t1), payload: { lat: 3.14, lng: 101.69 } });
    expect(r1.statusCode).toBe(503);
    expect((r1.json() as { status: string; balance: number })).toMatchObject({ status: 'disabled', balance: 5 });
    const down = setup('down');
    const t2 = (await login(down.app, 'USER-A-COORD')).token;
    const r2 = await down.app.inject({ method: 'POST', url: '/api/pins/lookup', headers: authed(t2), payload: { lat: 3.14, lng: 101.69 } });
    expect(r2.statusCode).toBe(503);
    expect((await down.app.inject({ method: 'GET', url: '/api/credits', headers: authed(t2) })).json()).toMatchObject({ balance: 5 });
  });

  it('saved places keep a name and coordinates only, per user, inside coverage, up to 20', async () => {
    const { app } = setup('off');
    const a = (await login(app, 'USER-A-COORD')).token; const b = (await login(app, 'USER-A-VIEW')).token;
    const save = (token: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/bookmarks', headers: authed(token), payload });
    const saved = (await save(a, { name: 'Office KL', lat: 3.13912, lng: 101.68691 })).json() as { bookmark: { bookmarkId: string; lat: number; name: string } };
    expect(saved.bookmark).toMatchObject({ name: 'Office KL', lat: 3.13912 });
    expect((await save(a, { name: '', lat: 3.1, lng: 101.6 })).statusCode).toBe(400);
    expect((await save(a, { name: 'Bangkok', lat: 13.75, lng: 100.5 })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/bookmarks', headers: authed(a) })).json()).toMatchObject({ bookmarks: [{ name: 'Office KL' }] });
    expect((await app.inject({ method: 'GET', url: '/api/bookmarks', headers: authed(b) })).json()).toMatchObject({ bookmarks: [] });
    expect((await app.inject({ method: 'DELETE', url: `/api/bookmarks/${saved.bookmark.bookmarkId}`, headers: authed(b) })).statusCode).toBe(404);   // not yours
    expect((await app.inject({ method: 'DELETE', url: `/api/bookmarks/${saved.bookmark.bookmarkId}`, headers: authed(a) })).statusCode).toBe(200);
    for (let i = 0; i < 20; i += 1) expect((await save(a, { name: `P${i}`, lat: 3.1 + i * 0.01, lng: 101.6 })).statusCode).toBe(200);
    expect((await save(a, { name: 'one too many', lat: 3.5, lng: 101.6 })).statusCode).toBe(400);
  });
});
