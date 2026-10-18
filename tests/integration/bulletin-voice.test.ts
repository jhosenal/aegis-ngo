import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { generateLatestBulletin } from '../../src/services/broadcast/generate.js';
import { loadSchedule } from '../../src/services/broadcast/schedule.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';
import type { Synthesizer } from '../../src/services/voice.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

function setup(tts?: Synthesizer) {
  const db = openDb(':memory:'); const clock = new FixedClock('2026-10-13T01:00:00Z'); const ids = new SeqIdGen();
  migrate(db, dir, '2026-10-13T00:00:00Z'); seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }), ...(tts ? { tts } : {}) }); apps.push(app);
  const made = generateLatestBulletin({ db, clock, ids, schedule: loadSchedule() });
  if (made.ok) db.prepare('UPDATE broadcast_bulletins SET air_at = ? WHERE bulletin_id = ?').run(clock.now(), made.bulletin.bulletinId);   // aired now: a bulletin is approvable for an hour after its air time
  const id = made.ok ? made.bulletin.bulletinId : '';
  const login = async () => ((await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'DEV-ADMIN' } })).json() as { token: string }).token;
  const call = async (token: string | null, method: 'GET' | 'POST', url: string, payload?: unknown) => { const o: InjectOptions = { method, url, headers: token ? { authorization: `Bearer ${token}` } : {} }; if (payload !== undefined) o.payload = payload as object; return app.inject(o); };
  return { db, app, id, login, call };
}

describe('the voice of an approved bulletin (AEG-NEWS-007)', () => {
  it('Google Text-to-Speech makes the audio after approval, it is kept with the bulletin and served publicly only while approved', async () => {
    const said: string[] = [];
    const tts: Synthesizer = { voice: 'en-GB-Standard-B', synthesize: async (text) => { said.push(text); return Buffer.from('ID3-FAKE-MP3'); } };
    const { id, login, call, db } = setup(tts);
    const admin = await login();
    expect(((await call(admin, 'GET', '/api/admin/screening')).json() as { voiceMode: string }).voiceMode).toBe('google-tts');
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {})).statusCode).toBe(400);   // review first
    expect((await call(null, 'GET', `/public/broadcast/voice/${id}`)).statusCode).toBe(404);
    expect((await call(admin, 'POST', `/api/admin/screening/${id}`, { action: 'approve' })).statusCode).toBe(200);
    expect((await call(null, 'GET', `/public/broadcast/voice/${id}`)).statusCode).toBe(404);             // approved but no voice made yet
    const made = await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {});
    expect(made.json()).toMatchObject({ ok: true, mode: 'google-tts' });
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('briefing for');                 // the validated script, read as written
    expect(said[0]).not.toMatch(/Google (air|weather)/i);
    const room = (await call(admin, 'GET', '/api/admin/screening')).json() as { stored: { bulletinId: string; steps: { step: string; mode: string; note: string | null }[] }[] };
    const steps = room.stored.find((b) => b.bulletinId === id)!.steps;
    expect(steps.map((s) => [s.step, s.mode])).toEqual([['VOICE_REQUESTED', 'google-tts'], ['VOICE_READY', 'google-tts']]);
    expect(steps[1]!.note).toContain('en-GB-Standard-B');
    const audio = await call(null, 'GET', `/public/broadcast/voice/${id}`);
    expect(audio.statusCode).toBe(200); expect(audio.headers['content-type']).toBe('audio/mpeg'); expect(audio.rawPayload.toString()).toBe('ID3-FAKE-MP3');
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {})).json()).toMatchObject({ already: true });   // not made twice
    expect(said).toHaveLength(1);
    // a withdrawn bulletin loses its public voice
    expect((await call(admin, 'POST', `/api/admin/screening/${id}`, { action: 'withdraw', note: 'wrong figure' })).statusCode).toBe(200);
    expect((await call(null, 'GET', `/public/broadcast/voice/${id}`)).statusCode).toBe(404);
    expect((db.prepare('SELECT characters FROM bulletin_voice WHERE bulletin_id = ?').get(id) as { characters: number }).characters).toBe(said[0]!.length);
  });

  it('when Google refuses, no voice is recorded as ready and the message is plain', async () => {
    const tts: Synthesizer = { voice: 'v', synthesize: async () => { throw new Error('Google Text-to-Speech refused the request (HTTP 403 PERMISSION_DENIED)'); } };
    const { id, login, call } = setup(tts);
    const admin = await login();
    await call(admin, 'POST', `/api/admin/screening/${id}`, { action: 'approve' });
    const r = await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {});
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).toContain('PERMISSION_DENIED');
    const steps = ((await call(admin, 'GET', '/api/admin/screening')).json() as { stored: { bulletinId: string; steps: { step: string }[] }[] }).stored.find((b) => b.bulletinId === id)!.steps;
    expect(steps.some((s) => s.step === 'VOICE_READY')).toBe(false);
    expect((await call(null, 'GET', `/public/broadcast/voice/${id}`)).statusCode).toBe(404);
  });

  it('without the synthesizer the voice step is the browser stub and no audio is served', async () => {
    const { id, login, call } = setup();
    const admin = await login();
    expect(((await call(admin, 'GET', '/api/admin/screening')).json() as { voiceMode: string }).voiceMode).toBe('browser-stub');
    await call(admin, 'POST', `/api/admin/screening/${id}`, { action: 'approve' });
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {})).json()).toMatchObject({ ok: true, mode: 'browser-stub' });
    expect((await call(null, 'GET', `/public/broadcast/voice/${id}`)).statusCode).toBe(404);
  });
});
