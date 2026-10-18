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
import type { ModelGateway } from '../../src/providers/gateway.js';
import type { Synthesizer } from '../../src/services/voice.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

/** A stand-in for the model gateway: the specialist "translates" by tagging the text with the language, the reviewer undoes the tag. `breakNumbers` makes the translation change a number. */
const fakeGateway = (breakNumbers = false): ModelGateway => ({
  call: async (role: string, task: { system: string; user: string }) => {
    const texts = (JSON.parse(task.user) as { texts: string[] }).texts;
    const tag = /into (\w+)/.exec(task.system)?.[1] ?? 'X';
    const out = role === 'specialist' ? texts.map((t) => `<${tag}> ${breakNumbers ? t.replace(/\d+/, '99') : t}`) : texts.map((t) => t.replace(/^<\w+> /, ''));
    return { status: 'OK', text: JSON.stringify({ texts: out }), notice: null, attempts: [] };
  },
}) as unknown as ModelGateway;

function setup(opts: { gateway?: ModelGateway; tts?: Synthesizer; reviewer?: import('../../src/services/vertexGemini.js').VertexClient } = {}) {
  const db = openDb(':memory:'); const clock = new FixedClock('2026-10-17T03:00:00Z'); const ids = new SeqIdGen();
  migrate(db, dir, '2026-10-13T00:00:00Z'); seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }), ...(opts.gateway ? { gateway: opts.gateway } : {}), ...(opts.tts ? { tts: opts.tts } : {}), ...(opts.reviewer ? { reviewer: opts.reviewer } : {}) }); apps.push(app);
  const login = async () => ((await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'DEV-ADMIN' } })).json() as { token: string }).token;
  const call = async (token: string | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => { const o: InjectOptions = { method, url, headers: token ? { authorization: `Bearer ${token}` } : {} }; if (payload !== undefined) o.payload = payload as object; return app.inject(o); };
  return { db, app, login, call, clock };
}
const quake = { evidenceId: 'EV-Q1', incidentKey: 'q', hazardType: 'EARTHQUAKE', alertLevel: 'ORANGE', title: 'M 6.1 - 20 km NE of Kota Kinabalu, Malaysia', eventTime: '2026-10-17T01:30:00Z', lat: 6.1, lon: 116.2, sourceId: 'SRC.USGS.LIVE' };
type Room = { stored: { bulletinId: string; slotId: string; translations: { language: string; status: string; problems: string[]; texts: string[]; back: string[] }[]; voiceLanguages: string[] }[] };

describe('translations, their human review, per-language voice and the warning card (AEG-NEWS-007)', () => {
  it('a model translates, code checks, a person approves each language; only then does a language get a voice and a public card', async () => {
    const spoken: { text: string; voice: string }[] = [];
    const tts: Synthesizer = { voice: 'en-GB-Standard-B', synthesize: async (text, o) => { spoken.push({ text, voice: o?.voice ?? 'en' }); return Buffer.from('MP3'); } };
    const { db, login, call, clock } = setup({ gateway: fakeGateway(), tts });
    const admin = await login();
    const { bulletin } = buildEmergencyBulletin({ detail: 'full', schedule: loadSchedule(), incident: quake, now: clock.now(), bulletinId: 'BULL-EM1' });
    insertBulletin(db, bulletin);
    const room = async () => ((await call(admin, 'GET', '/api/admin/screening')).json() as Room).stored.find((b) => b.bulletinId === 'BULL-EM1')!;

    // locked stubs and unknown languages are refused; English needs no translation
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-EM1/translate', { languages: ['kar'] })).statusCode).toBe(400);
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-EM1/translate', {})).statusCode).toBe(400);   // nothing ticked yet
    await call(admin, 'POST', '/api/admin/screening/BULL-EM1/plan', { languages: ['ms', 'zh', 'ta'] });
    const t = (await call(admin, 'POST', '/api/admin/screening/BULL-EM1/translate', {})).json() as { ok: boolean; results: { language: string; ok: boolean; problems: number }[] };
    expect(t.ok).toBe(true); expect(t.results.map((r) => r.language).sort()).toEqual(['ms', 'ta', 'zh']); expect(t.results.every((r) => r.problems === 0)).toBe(true);
    const b1 = await room();
    expect(b1.translations.map((x) => [x.language, x.status])).toEqual([['ms', 'UNREVIEWED'], ['ta', 'UNREVIEWED'], ['zh', 'UNREVIEWED']]);
    expect(b1.translations[0]!.texts[0]).toContain('<Malay>'); expect(b1.translations[0]!.back[0]).toBe(bulletin.segments[0]!.text);

    // nothing is public yet: not approved
    for (const u of ['/public/broadcast/card/BULL-EM1', '/public/broadcast/card/BULL-EM1?lang=ms', '/public/broadcast/voice/BULL-EM1?lang=ms']) expect((await call(null, 'GET', u)).statusCode).toBe(404);
    // the reviewer's card preview works in any state and shows the language, the level and the illustration
    const prev = await call(admin, 'GET', '/api/admin/screening/BULL-EM1/card?lang=ms');
    expect(prev.statusCode).toBe(200); expect(prev.headers['content-type']).toContain('image/svg+xml');
    expect(prev.body).toContain('MAKLUMAN KECEMASAN'); expect(prev.body).toContain('AMARAN JINGGA'); expect(prev.body).toContain('&lt;Malay&gt;'); expect(prev.body).not.toContain('LATIHAN');
    expect((await call(admin, 'GET', '/api/admin/screening/BULL-EM1/card?lang=th')).statusCode).toBe(404);

    // the human gate: reading the language is confirmed, rejecting needs a reason, approval locks
    const pr = (lang: string, body: unknown) => call(admin, 'POST', `/api/admin/screening/BULL-EM1/translation/${lang}`, body);
    expect((await pr('ms', { action: 'approve' })).statusCode).toBe(400);
    expect((await pr('ms', { action: 'reject', note: 'no' })).statusCode).toBe(400);
    expect((await pr('ms', { action: 'approve', readsLanguage: true })).statusCode).toBe(200);
    expect((await pr('zh', { action: 'reject', note: 'wrong tone for a hazard notice' })).statusCode).toBe(200);
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-EM1/translate', { languages: ['ms'] })).statusCode).toBe(400);   // approved is locked
    expect((await room()).translations.map((x) => [x.language, x.status])).toEqual([['ms', 'APPROVED'], ['ta', 'UNREVIEWED'], ['zh', 'REJECTED']]);

    // the voice follows the approval of the bulletin and of the language
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-EM1/voice', { language: 'ms' })).statusCode).toBe(400);   // the bulletin is not approved yet
    await call(admin, 'POST', '/api/admin/screening/BULL-EM1', { action: 'approve' });
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-EM1/voice', { language: 'ta' })).statusCode).toBe(400);   // Tamil not approved
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-EM1/voice', { language: 'ms' })).json()).toMatchObject({ ok: true, language: 'ms' });
    expect(spoken).toHaveLength(1); expect(spoken[0]).toMatchObject({ voice: 'ms-MY-Standard-A' }); expect(spoken[0]!.text).toContain('<Malay>');
    expect((await room()).voiceLanguages).toEqual(['ms']);

    // public: the English card now, Malay (approved) with its voice, not Tamil or Chinese
    const en = await call(null, 'GET', '/public/broadcast/card/BULL-EM1');
    expect(en.statusCode).toBe(200); expect(en.body).toContain('EMERGENCY INFORMATION'); expect(en.body).not.toContain('EXERCISE');
    expect((await call(null, 'GET', '/public/broadcast/card/BULL-EM1?lang=ms')).statusCode).toBe(200);
    expect((await call(null, 'GET', '/public/broadcast/card/BULL-EM1?lang=ta')).statusCode).toBe(404);
    expect((await call(null, 'GET', '/public/broadcast/card/BULL-EM1?lang=zh')).statusCode).toBe(404);
    const ms = await call(null, 'GET', '/public/broadcast/voice/BULL-EM1?lang=ms');
    expect(ms.statusCode).toBe(200); expect(ms.headers['content-type']).toBe('audio/mpeg');
    // the player page and the subtitles: English now, Malay (approved) too, not Tamil
    const cues = (await call(null, 'GET', '/public/broadcast/cues/BULL-EM1?lang=ms')).json() as { cues: { text: string; start: number; end: number }[] };
    expect(cues.cues.length).toBeGreaterThan(5); expect(cues.cues[0]!.start).toBe(0); expect(cues.cues[cues.cues.length - 1]!.end).toBeCloseTo(1, 3); expect(cues.cues.map((c) => c.text).join(' ')).toContain('<Malay>');
    const page = await call(null, 'GET', '/public/emergency/BULL-EM1?lang=ms');
    expect(page.statusCode).toBe(200); expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('/public/broadcast/card/BULL-EM1?lang=ms'); expect(page.body).toContain('/public/broadcast/voice/BULL-EM1?lang=ms'); expect(page.body).toContain('src="/public/emergency-player.js"'); expect(page.body).not.toMatch(/<script>[^<]/);
    expect(page.body).toContain('Bahasa Melayu'); expect(page.body).toContain('Sources');
    expect((await call(null, 'GET', '/public/emergency/BULL-EM1?lang=ta')).statusCode).toBe(404);
    expect((await call(null, 'GET', '/public/broadcast/cues/BULL-EM1?lang=ta')).statusCode).toBe(404);
    const js = await call(null, 'GET', '/public/emergency-player.js'); expect(js.statusCode).toBe(200); expect(js.headers['content-type']).toContain('javascript');
    // withdrawn: the card and the voice leave the public with the bulletin
    await call(admin, 'POST', '/api/admin/screening/BULL-EM1', { action: 'withdraw', note: 'wrong event' });
    expect((await call(null, 'GET', '/public/broadcast/card/BULL-EM1')).statusCode).toBe(404);
    expect((await call(null, 'GET', '/public/broadcast/voice/BULL-EM1?lang=ms')).statusCode).toBe(404);
    // the log is append-only
    expect(() => db.prepare("UPDATE bulletin_translation_log SET note = 'x'").run()).toThrow(/append-only/);
    expect((db.prepare('SELECT COUNT(*) AS n FROM bulletin_translation_log').get() as { n: number }).n).toBe(5);   // three translations, one approval, one rejection (a refused attempt adds nothing)
  });

  it('a translation that changes a number is flagged and cannot be approved', async () => {
    const { db, login, call, clock } = setup({ gateway: fakeGateway(true) });
    const admin = await login();
    insertBulletin(db, buildEmergencyBulletin({ detail: 'full', schedule: loadSchedule(), incident: quake, now: clock.now(), bulletinId: 'BULL-EM2' }).bulletin);
    const r = (await call(admin, 'POST', '/api/admin/screening/BULL-EM2/translate', { languages: ['zh'] })).json() as { results: { problems: number }[] };
    expect(r.results[0]!.problems).toBeGreaterThan(0);
    const bad = await call(admin, 'POST', '/api/admin/screening/BULL-EM2/translation/zh', { action: 'approve', readsLanguage: true });
    expect(bad.statusCode).toBe(400); expect(JSON.stringify(bad.json())).toContain('flagged problem');
  });

  it('a drill is an exercise: labelled in the text and on the card, and never public, whatever its state', async () => {
    const tts: Synthesizer = { voice: 'v', synthesize: async () => Buffer.from('MP3') };
    const { login, call } = setup({ gateway: fakeGateway(), tts });
    const admin = await login();
    expect((await call(admin, 'POST', '/api/admin/screening/emergency', { drill: { hazardType: 'NOPE', alertLevel: 'RED', title: 'x', lat: 1, lon: 1 } })).statusCode).toBe(400);
    const made = (await call(admin, 'POST', '/api/admin/screening/emergency', { detail: 'full', drill: { hazardType: 'STORM', alertLevel: 'RED', title: 'Tropical Cyclone TEST-1 - South China Sea (GDACS TC 9001)', eventTime: '2026-10-17T01:00:00Z', lat: 10, lon: 112, sourceId: 'SRC.GDACS.LIVE' }, output: 'voice' })).json() as { ok: boolean; bulletinId: string };
    expect(made.ok).toBe(true);
    const id = made.bulletinId;
    const room = (await call(admin, 'GET', '/api/admin/screening')).json() as { stored: { bulletinId: string; slotId: string; bulletin: { segments: { text: string }[] }; plan: { scenario: string } }[] };
    const d = room.stored.find((b) => b.bulletinId === id)!;
    expect(d.slotId).toBe('drill'); expect(d.plan.scenario).toBe('emergency'); expect(d.bulletin.segments[0]!.text).toContain('This is an exercise, not a real event.');
    const card = await call(admin, 'GET', `/api/admin/screening/${id}/card`);
    expect(card.body).toContain('EXERCISE'); expect(card.body).toContain('RED ALERT');
    await call(admin, 'POST', `/api/admin/screening/${id}`, { action: 'approve' });
    await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {});
    expect((await call(null, 'GET', `/public/broadcast/card/${id}`)).statusCode).toBe(404);
    expect((await call(null, 'GET', `/public/broadcast/voice/${id}`)).statusCode).toBe(404);
    expect((await call(null, 'GET', `/public/emergency/${id}`)).statusCode).toBe(404);
    expect((await call(null, 'GET', `/public/broadcast/cues/${id}`)).statusCode).toBe(404);
    const latest = (await call(null, 'GET', '/public/broadcast/latest')).json() as { bulletin: { bulletinId: string } | null; recent: { bulletinId: string }[] };
    expect(latest.bulletin?.bulletinId).not.toBe(id); expect(latest.recent.some((b) => b.bulletinId === id)).toBe(false);
  });

  it('translation memory: the guidance lines are translated once; after a person approves them the next bulletin only translates the new event sentence', async () => {
    let calls = 0;
    const inner = fakeGateway();
    const counting = { call: (...a: Parameters<ModelGateway['call']>) => { calls += 1; return (inner as unknown as { call: (...x: unknown[]) => unknown }).call(...a); } } as unknown as ModelGateway;
    const { db, login, call, clock } = setup({ gateway: counting });
    const admin = await login();
    const make = (id: string, incident: typeof quake) => insertBulletin(db, buildEmergencyBulletin({ detail: 'full', schedule: loadSchedule(), incident, now: new Date(Date.parse(clock.now()) + Number(id.slice(-1)) * 60_000).toISOString(), bulletinId: id }).bulletin);
    make('BULL-M1', quake);
    const r1 = (await call(admin, 'POST', '/api/admin/screening/BULL-M1/translate', { languages: ['ms'] })).json() as { results: { pieces: { approved: number; machine: number; fresh: number } }[] };
    const firstCalls = calls;
    expect(r1.results[0]!.pieces.fresh).toBeGreaterThan(3); expect(r1.results[0]!.pieces.approved).toBe(0);
    // a second bulletin before any approval reuses the machine pieces (remembered) without asking the model for them again
    make('BULL-M2', { ...quake, evidenceId: 'EV-Q2', title: 'M 5.9 - 30 km W of Kota Kinabalu, Malaysia' });
    const r2 = (await call(admin, 'POST', '/api/admin/screening/BULL-M2/translate', { languages: ['ms'] })).json() as { results: { pieces: { approved: number; machine: number; fresh: number } }[] };
    expect(r2.results[0]!.pieces.machine).toBeGreaterThan(0); expect(r2.results[0]!.pieces.fresh).toBeLessThan(r1.results[0]!.pieces.fresh);
    expect(calls - firstCalls).toBeLessThan(firstCalls);
    // a person approves the first translation: its pieces become approved
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-M1/translation/ms', { action: 'approve', readsLanguage: true })).statusCode).toBe(200);
    expect((db.prepare("SELECT COUNT(*) AS n FROM translation_memory WHERE status = 'APPROVED'").get() as { n: number }).n).toBe(r1.results[0]!.pieces.fresh);
    make('BULL-M3', { ...quake, evidenceId: 'EV-Q3', title: 'M 6.3 - 10 km N of Ranau, Malaysia' });
    const r3 = (await call(admin, 'POST', '/api/admin/screening/BULL-M3/translate', { languages: ['ms'] })).json() as { results: { pieces: { approved: number; machine: number; fresh: number } }[] };
    expect(r3.results[0]!.pieces.approved).toBeGreaterThan(0);   // the guidance lines come back already human-approved
    // rejecting a translation keeps its machine pieces out of memory
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-M2/translation/ms', { action: 'reject', note: 'the headline reads wrongly' })).statusCode).toBe(200);
    expect((db.prepare("SELECT COUNT(*) AS n FROM translation_memory WHERE status = 'REJECTED'").get() as { n: number }).n).toBeGreaterThan(0);
  });

  it('approving an exercise never makes memory pieces human-approved', async () => {
    const { db, login, call } = setup({ gateway: fakeGateway() });
    const admin = await login();
    const made = (await call(admin, 'POST', '/api/admin/screening/emergency', { detail: 'full', drill: { hazardType: 'EARTHQUAKE', alertLevel: 'GREEN', title: 'M 6.5 - 121 km NNE of Teluknaga, Indonesia', eventTime: '2026-10-17T01:00:00Z', lat: -6, lon: 106, sourceId: 'SRC.USGS.LIVE' } })).json() as { bulletinId: string };
    await call(admin, 'POST', `/api/admin/screening/${made.bulletinId}/translate`, { languages: ['ms'] });
    expect((await call(admin, 'POST', `/api/admin/screening/${made.bulletinId}/translation/ms`, { action: 'approve', readsLanguage: true })).statusCode).toBe(200);
    expect((db.prepare("SELECT COUNT(*) AS n FROM translation_memory WHERE status = 'APPROVED'").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM translation_memory WHERE status = 'MACHINE'").get() as { n: number }).n).toBeGreaterThan(3);
  });
  it('the script can be reworded before approval: checked, logged, clears translations; locked once approved', async () => {
    const { db, login, call, clock } = setup({ gateway: fakeGateway() });
    const admin = await login();
    const { bulletin } = buildEmergencyBulletin({ detail: 'full', schedule: loadSchedule(), incident: quake, now: clock.now(), bulletinId: 'BULL-ED1' });
    insertBulletin(db, bulletin);
    await call(admin, 'POST', '/api/admin/screening/BULL-ED1/translate', { languages: ['ms'] });
    const head = bulletin.segments[0]!;
    const good = head.text.replace('This is an AEGIS emergency information bulletin', 'This is an AEGIS emergency bulletin');
    const bad = await call(admin, 'PUT', '/api/admin/screening/BULL-ED1/script', { edits: [{ id: head.id, text: `${head.text} Aftershock 8.8 expected.` }] });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    const ok = await call(admin, 'PUT', '/api/admin/screening/BULL-ED1/script', { edits: [{ id: head.id, text: good }], note: 'shorter wording' });
    expect(ok.statusCode).toBe(200);
    const room = (await call(admin, 'GET', '/api/admin/screening')).json() as Room;
    const item = room.stored.find((b) => b.bulletinId === 'BULL-ED1')! as Room['stored'][number] & { editLog: { segmentId: string; after: string; note: string }[] };
    expect(item.translations).toHaveLength(0);
    expect(item.editLog[0]).toMatchObject({ segmentId: head.id, after: good, note: 'shorter wording' });
    await call(admin, 'POST', '/api/admin/screening/BULL-ED1', { action: 'approve' });
    const locked = await call(admin, 'PUT', '/api/admin/screening/BULL-ED1/script', { edits: [{ id: head.id, text: head.text }] });
    expect(locked.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('job cards and the job credit through the API', () => {
  it('every translation, voice and draft makes a card with a UUID and a priced estimate; admin sees all, a Pro account its own; top-up needs a reason', async () => {
    const tts: Synthesizer = { voice: 'en-GB-Standard-B', synthesize: async () => Buffer.from('MP3') };
    const { db, login, call, clock, app } = setup({ gateway: fakeGateway(), tts });
    const admin = await login();
    const { bulletin } = buildEmergencyBulletin({ schedule: loadSchedule(), incident: quake, now: clock.now(), bulletinId: 'BULL-JB1', detail: 'full' });
    insertBulletin(db, bulletin);
    await call(admin, 'POST', '/api/admin/screening/BULL-JB1/translate', { languages: ['ms'] });
    await call(admin, 'POST', '/api/admin/screening/BULL-JB1/translation/ms', { action: 'approve', readsLanguage: true });
    await call(admin, 'POST', '/api/admin/screening/BULL-JB1', { action: 'approve' });
    await call(admin, 'POST', '/api/admin/screening/BULL-JB1/voice', { language: 'ms' });
    await call(admin, 'POST', '/api/admin/screening/BULL-JB1/voice', {});
    const list = (await call(admin, 'GET', '/api/jobs?bulletinId=BULL-JB1')).json() as { scope: string; wallet: { balanceUsd: string; openingUsd: string }; jobs: { jobId: string; kind: string; status: string; estimateUsd: string | null; settledUsd: string | null; language: string | null }[] };
    expect(list.scope).toBe('all');
    expect(list.wallet.openingUsd).toBe('4.000000');
    expect(list.jobs.map((j) => `${j.kind}:${j.language ?? '-'}`).sort()).toEqual(['translate:ms', 'voice:en', 'voice:ms']);
    for (const j of list.jobs) { expect(j.jobId).toMatch(/^[0-9a-f-]{36}$/); expect(j.status).toBe('DONE'); expect(Number(j.settledUsd)).toBeGreaterThan(0); }
    expect(Number(list.wallet.balanceUsd)).toBeLessThan(4);
    const one = (await call(admin, 'GET', `/api/jobs/${list.jobs[0]!.jobId}`)).json() as { job: { lines: unknown[] } };
    expect(one.job.lines.length).toBeGreaterThan(0);
    // a Pro account sees only its own cards (none here), a standard account sees nothing
    const pro = ((await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD' } })).json() as { token: string }).token;
    expect((await call(pro, 'GET', '/api/jobs')).statusCode).toBe(403);
    // top-up: admin only, with a reason
    expect((await call(admin, 'POST', '/api/admin/credit/topup', { amountUsd: 1 })).statusCode).toBe(400);
    const up = await call(admin, 'POST', '/api/admin/credit/topup', { amountUsd: 1, note: 'owner top-up for the render test' });
    expect(up.statusCode).toBe(200);
    expect((up.json() as { wallet: { topupUsd: string } }).wallet.topupUsd).toBe('1.000000');
  });
});

describe('presenter render speeds', () => {
  it('lists Normal, Fast and Max with ETA and cost; a request makes a render job card that reserves its estimate', async () => {
    const tts: Synthesizer = { voice: 'en-GB-Standard-B', synthesize: async () => Buffer.alloc(8000, 1) };
    const { login, call } = setup({ gateway: fakeGateway(), tts });
    const admin = await login();
    const made = (await call(admin, 'POST', '/api/admin/screening/emergency', { output: 'voice_presenter', detail: 'full', drill: { hazardType: 'STORM', alertLevel: 'RED', title: 'Tropical Cyclone TEST-1 - South China Sea (GDACS TC 9001)', eventTime: '2026-10-17T01:00:00Z', lat: 10, lon: 112, sourceId: 'SRC.GDACS.LIVE' } })).json() as { bulletinId: string };
    const id = made.bulletinId;
    const opts = (await call(admin, 'GET', `/api/admin/screening/${id}/render-options?lang=en`)).json() as { maxParallel: number; options: { speed: string; parallel: number; etaSeconds: number; estimate: { micro: number | null }; available: boolean }[] };
    expect(opts.options.map((o) => o.speed)).toEqual(['normal', 'fast', 'max']);
    expect(opts.options[0]!.etaSeconds).toBeGreaterThan(opts.options[2]!.etaSeconds);
    expect(opts.options.every((o) => o.available)).toBe(true);
    await call(admin, 'POST', `/api/admin/screening/${id}`, { action: 'approve' });
    await call(admin, 'POST', `/api/admin/screening/${id}/voice`, {});
    const r = (await call(admin, 'POST', `/api/admin/screening/${id}/presenter`, { action: 'requested', speed: 'fast', language: 'en' })).json() as { ok: boolean; jobId: string; speed: string; etaSeconds: number; estimateMicro: number | null; waitingForOwner: boolean };
    expect(r).toMatchObject({ ok: true, speed: 'fast', waitingForOwner: false });
    const card = ((await call(admin, 'GET', `/api/jobs/${r.jobId}`)).json() as { job: { kind: string; status: string; params: { parallel: number; speed: string } } }).job;
    expect(card).toMatchObject({ kind: 'render', status: 'ESTIMATED', params: { parallel: 2, speed: 'fast' } });
    expect((await call(admin, 'POST', `/api/admin/screening/${id}/presenter`, { action: 'ready', note: 'gs://aegis-render/out/test.webm', instanceSeconds: 900 })).statusCode).toBe(200);
    const done = ((await call(admin, 'GET', `/api/jobs/${r.jobId}`)).json() as { job: { status: string; settledUsd: string } }).job;
    expect(done.status).toBe('DONE'); expect(Number(done.settledUsd)).toBeGreaterThan(0);
  });
});

describe('script review with Gemini 4 Argon on Vertex AI', () => {
  const reviewer = (text: string) => ({ model: 'gemini-4-argon', project: 'p', location: 'global', generate: async () => ({ text, usage: { promptTokens: 400, outputTokens: 70, thoughtsTokens: 130, totalTokens: 600 }, model: 'gemini-4-argon', modelVersion: 'v', latencyMs: 800, finishReason: 'STOP' }) });
  it('proposes a wording, makes a review job card settled from the real tokens, refuses an approved bulletin and a standard account, and is off without Vertex', async () => {
    const { db, login, call, clock, app } = setup({ gateway: fakeGateway(), reviewer: reviewer('placeholder') });
    const admin = await login();
    const { bulletin } = buildEmergencyBulletin({ schedule: loadSchedule(), incident: quake, now: clock.now(), bulletinId: 'BULL-RV1', detail: 'full' });
    insertBulletin(db, bulletin);
    const head = bulletin.segments[0]!;
    const r1 = await call(admin, 'POST', '/api/admin/screening/BULL-RV1/script-review', { segmentId: head.id });
    expect(r1.statusCode).toBe(200);
    const body = r1.json() as { ok: boolean; problems: string[]; usage: { promptTokens: number }; costUsd: string; jobId: string };
    expect(body.ok).toBe(false);                      // both bounded proposals fail validation; only the final draft is returned
    expect(body.usage.promptTokens).toBe(800);        // both calls are included in the settled usage
    expect(body.costUsd).toBe('0.011200');            // 800 in at 4 and 400 out at 20 USD per million = 3,200 + 8,000 micro-USD
    const card = ((await call(admin, 'GET', `/api/jobs/${body.jobId}`)).json() as { job: { kind: string; status: string; settledUsd: string } }).job;
    expect(card).toMatchObject({ kind: 'review', status: 'DONE', settledUsd: '0.011200' });
    // the model picker: 'auto' is the configured reviewer; a model that is not connected to the script review is refused before any call or job is made, and a style wish is accepted
    const jobsBefore = (db.prepare('SELECT COUNT(*) AS n FROM job_sheet').get() as { n: number }).n;
    const other = await call(admin, 'POST', '/api/admin/screening/BULL-RV1/script-review', { segmentId: head.id, model: 'gemini-3.8-flash' });
    expect(other.statusCode).toBe(400); expect(other.body).toMatch(/only for now/);
    expect((db.prepare('SELECT COUNT(*) AS n FROM job_sheet').get() as { n: number }).n).toBe(jobsBefore);
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-RV1/script-review', { segmentId: head.id, model: 'auto', instruction: 'calmer, simpler words', text: head.text })).statusCode).toBe(200);
    const pro = ((await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD' } })).json() as { token: string }).token;
    expect((await call(pro, 'POST', '/api/admin/screening/BULL-RV1/script-review', { segmentId: head.id })).statusCode).toBe(403);
    await call(admin, 'POST', '/api/admin/screening/BULL-RV1', { action: 'approve' });
    expect((await call(admin, 'POST', '/api/admin/screening/BULL-RV1/script-review', { segmentId: head.id })).statusCode).toBe(400);
    const off = setup({ gateway: fakeGateway() });
    const a2 = await off.login(); insertBulletin(off.db, bulletin);
    expect((await off.call(a2, 'POST', '/api/admin/screening/BULL-RV1/script-review', { segmentId: head.id })).statusCode).toBe(400);
  });
});
