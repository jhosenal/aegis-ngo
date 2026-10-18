import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { insertBulletin } from '../../src/data/repos/broadcast.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { buildEmergencyBulletin } from '../../src/services/broadcast/emergency.js';
import { loadSchedule } from '../../src/services/broadcast/schedule.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';
import type { Synthesizer } from '../../src/services/voice.js';
import type { VertexClient } from '../../src/services/vertexGemini.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

const reviewer = (): VertexClient => ({ model: 'gemini-4-argon', project: 'p', location: 'global', generate: async () => ({ text: 'placeholder', usage: { promptTokens: 400, outputTokens: 70, thoughtsTokens: 130, totalTokens: 600 }, model: 'gemini-4-argon', latencyMs: 1 }) }) as unknown as VertexClient;
const tts: Synthesizer = { voice: 'en-GB-Standard-B', synthesize: async () => Buffer.from('MP3') };
const quake = { evidenceId: 'EV-Q1', incidentKey: 'q', hazardType: 'EARTHQUAKE', alertLevel: 'ORANGE', title: 'M 6.1 - 20 km NE of Kota Kinabalu, Malaysia', eventTime: '2026-10-17T01:30:00Z', lat: 6.1, lon: 116.2, sourceId: 'SRC.USGS.LIVE' };

function setup(opts: { reviewer?: VertexClient; tts?: Synthesizer } = {}) {
  const db = openDb(':memory:'); const clock = new FixedClock('2026-10-17T03:00:00Z'); const ids = new SeqIdGen();
  migrate(db, dir, '2026-10-13T00:00:00Z'); seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }), ...(opts.reviewer ? { reviewer: opts.reviewer } : {}), ...(opts.tts ? { tts: opts.tts } : {}) });
  apps.push(app);
  const login = async (userId = 'DEV-ADMIN') => ((await app.inject({ method: 'POST', url: '/api/session', payload: { userId } })).json() as { token: string }).token;
  const call = async (token: string | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => { const o: InjectOptions = { method, url, headers: token ? { authorization: `Bearer ${token}` } : {} }; if (payload !== undefined) o.payload = payload as object; return app.inject(o); };
  return { db, login, call, clock };
}
type Row = { id: string; state: string; detail: string; switchable: boolean; switchedOff: boolean; switchedBy: string | null; lastCalledAt: string | null };
const rowOf = async (call: ReturnType<typeof setup>['call'], token: string, id: string): Promise<Row> => ((await call(token, 'GET', '/api/admin/api-status')).json() as { groups: { rows: Row[] }[] }).groups.flatMap((g) => g.rows).find((r) => r.id === id)!;

describe('an administrator can switch a service that is set up off and on, from the API status tab', () => {
  it('a switched-off service is absent for every route (the script review refuses), shows Off with who switched it, and works again when switched on', async () => {
    const { db, login, call, clock } = setup({ reviewer: reviewer() });
    const admin = await login();
    const { bulletin } = buildEmergencyBulletin({ schedule: loadSchedule(), incident: quake, now: clock.now(), bulletinId: 'BULL-SW1', detail: 'full' });
    insertBulletin(db, bulletin);
    const segmentId = bulletin.segments[0]!.id;
    expect(await rowOf(call, admin, 'vertex-argon')).toMatchObject({ switchable: true, switchedOff: false });
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-SW1/script-review', { segmentId })).statusCode).toBe(200);
    const off = await call(admin, 'PUT', '/api/admin/api-switch', { id: 'vertex-argon', on: false });
    expect(off.statusCode).toBe(200); expect(off.json()).toMatchObject({ ok: true, id: 'vertex-argon', on: false, changedBy: 'DEV-ADMIN' });
    const row = await rowOf(call, admin, 'vertex-argon');
    expect(row).toMatchObject({ state: 'off', switchable: true, switchedOff: true, switchedBy: 'DEV-ADMIN' }); expect(row.detail).toMatch(/Switched off by DEV-ADMIN/);
    const refused = await call(admin, 'POST', '/api/admin/screening/BULL-SW1/script-review', { segmentId });
    expect(refused.statusCode).toBe(400); expect(refused.body).toMatch(/not switched on/);
    expect((await call(admin, 'PUT', '/api/admin/api-switch', { id: 'vertex-argon', on: true })).statusCode).toBe(200);
    expect(await rowOf(call, admin, 'vertex-argon')).toMatchObject({ switchedOff: false });
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-SW1/script-review', { segmentId })).statusCode).toBe(200);
  });
  it('switching the voice off turns the voice step back into the browser stand-in for the whole app', async () => {
    const { login, call } = setup({ tts });
    const admin = await login();
    const room = async () => (await call(admin, 'GET', '/api/admin/screening')).json() as { voiceMode: string };
    expect((await room()).voiceMode).toBe('google-tts');
    await call(admin, 'PUT', '/api/admin/api-switch', { id: 'tts', on: false });
    expect((await room()).voiceMode).toBe('browser-stub');
    await call(admin, 'PUT', '/api/admin/api-switch', { id: 'tts', on: true });
    expect((await room()).voiceMode).toBe('google-tts');
  });
  it('cannot switch on a service that is not set up, an unknown service, or without a true or false; and only an administrator may switch', async () => {
    const { login, call } = setup();                                           // nothing is set up here
    const admin = await login();
    const none = await call(admin, 'PUT', '/api/admin/api-switch', { id: 'tts', on: true });
    expect(none.statusCode).toBe(400); expect(none.body).toMatch(/not set up on this server/);
    expect((await call(admin, 'PUT', '/api/admin/api-switch', { id: 'gemini-chat', on: false })).statusCode).toBe(400);   // no switch for it
    expect((await call(admin, 'PUT', '/api/admin/api-switch', { id: 'tts' })).statusCode).toBe(400);
    expect(await rowOf(call, admin, 'tts')).toMatchObject({ switchable: false, switchedOff: false });   // nothing to switch, so no switch is offered
    const standard = await login('USER-A-COORD');
    expect((await call(standard, 'PUT', '/api/admin/api-switch', { id: 'tts', on: false })).statusCode).toBe(403);
    expect((await call(standard, 'GET', '/api/admin/api-status')).statusCode).toBe(403);
  });
});
