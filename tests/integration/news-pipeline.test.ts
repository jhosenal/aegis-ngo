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

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

type Room = { stored: { bulletinId: string; plan: { scenario: string; output: string; explicit: boolean }; steps: { step: string; mode: string }[]; kpi: { id: string; status: string }[] }[] };

describe('news pipeline: plan, voice, presenter and timing (AEG-NEWS-007)', () => {
  it('review comes first; voice then presenter follow in order; the timeline and the KPI rows show it; every route is administrators only', async () => {
    const db = openDb(':memory:'); const clock = new FixedClock('2026-10-13T01:00:00Z'); const ids = new SeqIdGen();
    migrate(db, dir, '2026-10-13T00:00:00Z'); seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
    const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) }); apps.push(app);
    const login = async (userId: string) => ((await app.inject({ method: 'POST', url: '/api/session', payload: { userId } })).json() as { token: string }).token;
    const admin = await login('DEV-ADMIN'); const viewer = await login('USER-A-VIEW');
    const call = async (token: string, method: 'GET' | 'POST', url: string, payload?: unknown) => { const opts: InjectOptions = { method, url, headers: { authorization: `Bearer ${token}` } }; if (payload !== undefined) opts.payload = payload as object; return app.inject(opts); };
    const made = generateLatestBulletin({ db, clock, ids, schedule: loadSchedule() });
    if (made.ok) db.prepare('UPDATE broadcast_bulletins SET air_at = ? WHERE bulletin_id = ?').run(clock.now(), made.bulletin.bulletinId);   // aired now: a bulletin is approvable for an hour after its air time
    const id = made.ok ? made.bulletin.bulletinId : '';
    expect(id).not.toBe('');

    for (const [m, u] of [['GET', '/api/admin/screening/emergency/candidates'], ['POST', '/api/admin/screening/emergency'], ['POST', `/api/admin/screening/${id}/plan`], ['POST', `/api/admin/screening/${id}/voice`], ['POST', `/api/admin/screening/${id}/presenter`]] as const)
      expect((await call(viewer, m, u, {})).statusCode).toBe(403);

    const room = async () => (await call(admin, 'GET', '/api/admin/screening')).json() as Room;
    const first = (await room()).stored[0]!;
    expect(first.plan).toMatchObject({ scenario: 'daily', output: 'voice_presenter', explicit: false });
    expect(first.kpi.map((r) => r.id)).toEqual(['draft', 'approval', 'voice', 'presenter']);

    // review before voice, voice before presenter
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {})).statusCode).toBe(400);
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/presenter`, { action: 'requested' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', `/api/admin/screening/${id}`, { action: 'approve' })).statusCode).toBe(200);
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/presenter`, { action: 'requested' })).statusCode).toBe(400);   // the voice comes first
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {})).statusCode).toBe(200);
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {})).json()).toMatchObject({ already: true });
    expect((await room()).stored[0]!.steps.map((s) => s.step)).toEqual(['VOICE_REQUESTED', 'VOICE_READY']);
    expect((await room()).stored[0]!.kpi.find((r) => r.id === 'voice')!.status).toMatch(/ok|late/);

    // the presenter: requested (recorded only), then ready with a note on where the video is
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/presenter`, { action: 'ready', note: 'E:/video.webm' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/presenter`, { action: 'requested' })).statusCode).toBe(200);
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/plan`, { output: 'voice' })).statusCode).toBe(400);   // too late to change the output
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/presenter`, { action: 'ready', note: 'no' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/presenter`, { action: 'ready', note: 'render/out/news-gcp/presenter.webm' })).statusCode).toBe(200);
    const done = (await room()).stored[0]!;
    expect(done.steps.map((s) => s.step)).toEqual(['VOICE_REQUESTED', 'VOICE_READY', 'PRESENTER_REQUESTED', 'PRESENTER_READY']);
    expect(done.kpi.find((r) => r.id === 'presenter')!.status).toMatch(/ok|late/);
    // steps are append-only
    expect(() => db.prepare("UPDATE bulletin_step SET note = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM bulletin_step').run()).toThrow(/append-only/);

    // voice only: a plan change before the presenter is requested, and a presenter request is then refused
    const made2 = generateLatestBulletin({ db, clock: new FixedClock('2026-10-13T08:00:00Z'), ids, schedule: loadSchedule() });
    const id2 = made2.ok ? made2.bulletin.bulletinId : '';
    expect(id2).not.toBe(id);
    expect((await call(admin, 'POST', `/api/admin/screening/${id2}/plan`, { output: 'voice' })).statusCode).toBe(200);
    await call(admin, 'POST', `/api/admin/screening/${id2}`, { action: 'approve' });
    await call(admin, 'POST', `/api/admin/screening/${id2}/voice`, {});
    expect((await call(admin, 'POST', `/api/admin/screening/${id2}/presenter`, { action: 'requested' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', `/api/admin/screening/${id2}/plan`, { output: 'nope' })).statusCode).toBe(400);

    // languages: English always, known codes only, the rest are locked stubs that only record the request
    const langs = async () => ((await room()).stored.find((b) => b.bulletinId === id2) as unknown as { plan: { languages: string[] } }).plan.languages;
    expect(await langs()).toEqual(['en']);
    expect((await call(admin, 'POST', `/api/admin/screening/${id2}/plan`, { languages: ['ms', 'xx'] })).statusCode).toBe(400);
    expect((await call(admin, 'POST', `/api/admin/screening/${id2}/plan`, { languages: ['th', 'ms', 'th', 'zh'] })).statusCode).toBe(200);
    expect(await langs()).toEqual(['en', 'th', 'ms', 'zh']);
    expect((await call(admin, 'POST', `/api/admin/screening/${id2}/plan`, { languages: [] })).statusCode).toBe(200);
    expect(await langs()).toEqual(['en']);
    expect((await call(admin, 'POST', `/api/admin/screening/${id2}/plan`, {})).statusCode).toBe(400);
    expect(((await room()) as unknown as { languageCatalog: { languages: { code: string; state: string }[] } }).languageCatalog.languages.filter((l) => l.state === 'active').map((l) => l.code)).toEqual(['en']);

    // emergency: unknown incident is refused, and the candidates route answers
    expect((await call(admin, 'POST', '/api/admin/screening/emergency', { evidenceId: 'EV-NOPE' })).statusCode).toBe(404);
    expect((await call(admin, 'POST', '/api/admin/screening/emergency', {})).statusCode).toBe(400);
    const cands = (await call(admin, 'GET', '/api/admin/screening/emergency/candidates')).json() as { candidates: unknown[] };
    expect(Array.isArray(cands.candidates)).toBe(true);
  });
});
