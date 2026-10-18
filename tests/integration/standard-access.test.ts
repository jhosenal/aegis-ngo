import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { seedAll } from '../../src/services/seed.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { loadConfig } from '../../src/config/config.js';
import { createApp } from '../../src/api/server.js';
import { changeUserFlags } from '../../src/data/repos/apiAuth.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });
async function setup() {
  const db = openDb(':memory:'), clock = new FixedClock(new Date().toISOString()), ids = new SeqIdGen();
  migrate(db, fileURLToPath(new URL('../../migrations/', import.meta.url)), clock.now());
  seedAll(db, fileURLToPath(new URL('../../fixtures/', import.meta.url)), new FixedClock('2026-10-13T00:00:00Z'), ids);
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) });
  apps.push(app);
  const session = (await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD' } })).json();
  const headers = { authorization: `Bearer ${session.token}` };
  const set = (flags: { plan?: 'standard'|'pro'; isAdmin?: boolean }) => changeUserFlags(db, { actor: 'test-owner', userId: 'USER-A-COORD', flags, lock: true, now: clock.now() });
  return { app, db, headers, set };
}

it('Standard can chat/read and manage its own conversation, while operational APIs deny before writes or provider calls', async () => {
  const { app, db, headers } = await setup();
  expect((await app.inject({ method: 'GET', url: '/api/me', headers })).json()).toMatchObject({ plan: 'standard', isAdmin: false });
  expect((await app.inject({ method: 'GET', url: '/api/cards', headers })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: '/api/chat', headers, payload: { text: 'show incidents', mode: 'auto' } })).statusCode).toBe(200);
  const thread = (await app.inject({ method: 'POST', url: '/api/conversations', headers })).json();
  expect((await app.inject({ method: 'DELETE', url: '/api/conversations/'+thread.conversationId, headers })).statusCode).toBe(200);
  const attempts = [
    ['GET','/api/credits'], ['POST','/api/credits/buy-stub'], ['GET','/api/bookmarks'], ['POST','/api/bookmarks'],
    ['DELETE','/api/bookmarks/not-owned'], ['POST','/api/pins/lookup'], ['POST','/api/workflows/resource-assessment'],
    ['GET','/public/environment/sample-pin?lat=3.139&lng=101.687'], ['PUT','/api/pins/INC-TENANT-A-SYN-FLOOD-0001'],
  ] as const;
  for (const [method,url] of attempts) expect((await app.inject({ method,url,headers,payload: method==='POST'?{}:undefined })).statusCode, method+' '+url).toBe(403);
  expect((db.prepare('SELECT COUNT(*) AS n FROM workflow_runs').get() as {n:number}).n).toBe(0);
});

it('stored Pro or Admin access unlocks pin tools, while Pro cannot enter Admin controls; revocation applies to the same session', async () => {
  const { app, headers, set } = await setup();
  for (const flags of [{ plan: 'pro' as const }, { plan:'standard' as const, isAdmin:true }]) {
    set(flags);
    expect((await app.inject({ method:'POST',url:'/api/bookmarks',headers,payload:{name:'Test',lat:3.139,lng:101.687} })).statusCode).toBe(200);
    expect((await app.inject({ method:'GET',url:'/public/environment/sample-pin?lat=3.139&lng=101.687',headers })).statusCode).toBe(200);
    if (!flags.isAdmin) expect((await app.inject({method:'GET',url:'/api/admin/users',headers})).statusCode).toBe(403);
  }
  set({plan:'standard',isAdmin:false});
  expect((await app.inject({method:'POST',url:'/api/bookmarks',headers,payload:{name:'Blocked',lat:3.139,lng:101.687,plan:'pro',isAdmin:true}})).statusCode).toBe(403);
});

it('Standard cannot bypass the operational restriction by asking chat to run an assessment', async () => {
  const { app,db,headers } = await setup();
  const r = await app.inject({method:'POST',url:'/api/chat',headers,payload:{text:'assess INC-TENANT-A-SYN-FLOOD-0001 unit UNIT.WATER_KIT region REGION.DEMO_A demand 120 available 85 reserve 5',mode:'auto'}});
  expect(r.statusCode).toBe(200);
  expect(JSON.stringify(r.json())).toContain('E_FORBIDDEN_ROLE');
  expect((db.prepare('SELECT COUNT(*) AS n FROM workflow_runs').get() as {n:number}).n).toBe(0);
});
