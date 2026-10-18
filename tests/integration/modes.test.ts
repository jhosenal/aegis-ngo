import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { BudgetLedger } from '../../src/providers/budget-ledger.js';
import { ModelGateway } from '../../src/providers/gateway.js';
import { StubProvider, type StubStep } from '../../src/providers/stubs.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';
import { bindingForRole } from '../../src/roles/manager.js';
import { changeUserFlags } from '../../src/data/repos/apiAuth.js';

type Db = import('better-sqlite3').Database;
interface Options { env?: Record<string, string>; script: StubStep[]; google?: StubStep[] }
interface Harness { db: Db; app: FastifyInstance; primary: StubProvider; backup: StubProvider | null }

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const seedNow = '2026-10-13T00:00:00Z';
const price = { id: 'PRICE-TEST', capturedAt: seedNow, inputMicroPerMTok: 1_000_000, outputMicroPerMTok: 2_000_000, source: 'synthetic-test-vector' };
const databases: Db[] = [];
const apps: FastifyInstance[] = [];

const GOOD = JSON.stringify({ routeId: 'I_aegis_incident_list', args: {}, clarification: null });
const ok = (text: string): StubStep => ({ type: 'ok', text, usage: { inputTokens: 20, outputTokens: 10 }, reportedModel: 'stub' });
const bad: StubStep = ok('this is not json');
const open = { AEGIS_PREMIUM_MODES_ENABLED: 'true', AEGIS_ESCALATION_ENABLED: 'true', AEGIS_REGISTERED_USERS: 'USER-A-COORD' };
const reapiFirst = {
  AEGIS_PRIMARY_PROVIDER: 'reapi', AEGIS_REAPI_API_KEY: 'k', AEGIS_REAPI_BASE_URL: 'https://reapi.ai/api/v1',
  AEGIS_REAPI_ALLOWED_DATA_CLASSES: 'public,tenant_private', AEGIS_GOOGLE_MODEL: 'TEST-GOOGLE',
};

function makeHarness(options: Options): Harness {
  const db = openDb(':memory:');
  databases.push(db);
  const clock = new FixedClock('2026-10-13T01:00:00Z');
  const ids = new SeqIdGen();
  migrate(db, migrationDirectory, seedNow);
  seedAll(db, fixturesDirectory, new FixedClock(seedNow), ids);
  const config = loadConfig({
    AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_MODELS_ENABLED: 'true', AEGIS_PRICE_SNAPSHOT_ID: price.id,
    AEGIS_BUDGET_ACCOUNT_MICRO: '1000000', AEGIS_BUDGET_DAY_MICRO: '1000000', AEGIS_BUDGET_TASK_MICRO: '500000',
    ...reapiFirst, ...options.env,
  });
  const reapiPrimary = config.primaryProvider === 'reapi';
  // These premium-mode scenarios explicitly provision Pro fixtures; a legacy model list alone grants no production privilege.
  for (const userId of config.modes.registeredUsers) changeUserFlags(db, { actor:'test-fixture', userId, flags:{plan:'pro'}, lock:false, now:clock.now() });
  const primary = new StubProvider(reapiPrimary ? 'stub-reapi' : 'stub-google', options.script);
  const backup = options.google ? new StubProvider(reapiPrimary ? 'stub-google' : 'stub-reapi', options.google) : null;
  const gateway = new ModelGateway({
    db, clock, ids, config, ledger: new BudgetLedger(db, { accountMicro: 1_000_000, dayMicro: 1_000_000, taskMicro: 500_000 }),
    primary, backup, binding: (role) => bindingForRole(role, config), price,
    sleep: async () => undefined, rng: () => 0.5, monotonicMs: () => 0,
  });
  const app = createApp({ db, clock, ids, config, gateway });
  apps.push(app);
  return { db, app, primary, backup };
}

async function login(app: FastifyInstance, userId = 'USER-A-COORD'): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
  return (response.json() as { token: string }).token;
}

async function chat(app: FastifyInstance, token: string, text: string, mode?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: 'POST', url: '/api/chat', headers: { authorization: `Bearer ${token}` },
    payload: { text, ...(mode ? { mode } : {}) },
  });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

const models = (provider: StubProvider): string[] => provider.calls.map((call) => call.model);
const messageCount = (db: Db): number => (db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number }).n;

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

describe('model modes: Auto, Normal, Pro, Expert', () => {
  it('AEG-TST-004 lists the modes, Auto as the default, with Pro and Expert switched off and a plain note, and the Gemini ids pending', async () => {
    const h = makeHarness({ script: [] });
    const token = await login(h.app);
    const response = await h.app.inject({ method: 'GET', url: '/api/modes', headers: { authorization: `Bearer ${token}` } });
    const body = response.json() as { default: string; modes: Array<{ id: string; available: boolean; note: string }> };
    expect(body.default).toBe('auto');
    expect(body.modes.map((mode) => [mode.id, mode.available])).toEqual([['auto', true], ['normal', true], ['pro', false], ['expert', false], ['gemini-3.5-flash-lite', false], ['gemini-3.8-flash', false], ['gemini-4-argon', false]]);   // Google is not the live primary in this harness: the Gemini ids are pending
    expect(body.modes[2]?.note).toContain('registered users');
    expect(JSON.stringify(body)).not.toMatch(/gpt-6|claude/i);   // the browser never learns the third-party model names (the Gemini ids are the public choices of the selector)
  });

  it('AEG-TST-004 Auto is the default and uses only the standard model while the premium modes are off, even when its answer fails', async () => {
    const h = makeHarness({ script: [bad, bad] });
    const token = await login(h.app);
    const reply = await chat(h.app, token, 'what is going on?');
    expect(reply.status).toBe(200);
    expect(reply.body.mode).toBe('auto');
    expect(reply.body.escalatedTo).toBeNull();
    expect(models(h.primary)).toEqual(['gpt-6-luna']);
  });

  it('AEG-TST-004 Normal answers on gpt-6-luna and routes a valid proposal', async () => {
    const h = makeHarness({ script: [ok(GOOD)] });
    const token = await login(h.app);
    const reply = await chat(h.app, token, 'what incidents are open?', 'normal');
    expect(reply.body).toMatchObject({ mode: 'normal', escalatedTo: null, route: { routeId: 'I_aegis_incident_list', source: 'model' } });
    expect(models(h.primary)).toEqual(['gpt-6-luna']);
  });

  it('AEG-TST-004 Pro and Expert are refused with 403 before anything is stored or sent while switched off', async () => {
    const h = makeHarness({ script: [ok(GOOD)] });
    const token = await login(h.app);
    for (const mode of ['pro', 'expert']) {
      const reply = await chat(h.app, token, 'what incidents are open?', mode);
      expect(reply.status).toBe(403);
      expect((reply.body.error as { code: string }).code).toBe('E_MODE_UNAVAILABLE');
    }
    expect(messageCount(h.db)).toBe(0);
    expect(h.primary.calls).toHaveLength(0);
  });

  it('AEG-TST-004 an unknown mode is a validation error', async () => {
    const h = makeHarness({ script: [] });
    const token = await login(h.app);
    expect((await chat(h.app, token, 'hello there', 'turbo')).status).toBe(400);
  });

  it('AEG-TST-004 registered user with the switches on: Auto steps up from luna to sol when luna fails, and says so', async () => {
    const h = makeHarness({ env: open, script: [bad, ok(GOOD)] });
    const token = await login(h.app);
    const reply = await chat(h.app, token, 'what incidents are open?');
    expect(models(h.primary)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    expect(reply.body).toMatchObject({ mode: 'auto', escalatedTo: 'Pro', route: { routeId: 'I_aegis_incident_list', source: 'model' } });
  });

  it('AEG-TST-004 Auto steps up to Expert only after Pro also fails, and stops there', async () => {
    const h = makeHarness({ env: open, script: [bad, bad, bad] });
    const token = await login(h.app);
    const reply = await chat(h.app, token, 'what incidents are open?');
    expect(models(h.primary)).toEqual(['gpt-6-luna', 'gpt-6-sol', 'claude-opus-5-5']);
    expect(reply.body.escalatedTo).toBe('Expert');
    expect(reply.body.route).toMatchObject({ source: 'clarify' });
  });

  it('AEG-TST-004 Auto does not step up when luna answers correctly', async () => {
    const h = makeHarness({ env: open, script: [ok(GOOD)] });
    const token = await login(h.app);
    const reply = await chat(h.app, token, 'what incidents are open?');
    expect(models(h.primary)).toEqual(['gpt-6-luna']);
    expect(reply.body.escalatedTo).toBeNull();
  });

  it('AEG-TST-004 refusals, permission denials and an empty budget never trigger a step up', async () => {
    const refused = makeHarness({ env: open, script: [{ type: 'error', kind: 'REFUSAL' }, ok(GOOD)] });
    await chat(refused.app, await login(refused.app), 'what incidents are open?');
    expect(models(refused.primary)).toEqual(['gpt-6-luna']);

    const broke = makeHarness({ env: { ...open, AEGIS_BUDGET_TASK_MICRO: '1' }, script: [ok(GOOD), ok(GOOD)] });
    await chat(broke.app, await login(broke.app), 'what incidents are open?');
    expect(broke.primary.calls.length).toBeLessThanOrEqual(1);

    const forbidden = JSON.stringify({ routeId: 'I_aegis_resource_assess', args: { incidentCardId: 'X', unitId: 'U', regionId: 'R', demandUnits: 1 }, clarification: null });
    const viewer = makeHarness({ env: { ...open, AEGIS_REGISTERED_USERS: 'USER-A-VIEW' }, script: [ok(forbidden), ok(GOOD)] });
    await chat(viewer.app, await login(viewer.app, 'USER-A-VIEW'), 'assess the flood', 'auto');
    expect(models(viewer.primary)).toEqual(['gpt-6-luna']);
  });

  it('AEG-TST-004 Pro and Expert go straight to their model for a registered user', async () => {
    const pro = makeHarness({ env: open, script: [ok(GOOD)] });
    await chat(pro.app, await login(pro.app), 'what incidents are open?', 'pro');
    expect(models(pro.primary)).toEqual(['gpt-6-sol']);
    const expert = makeHarness({ env: open, script: [ok(GOOD)] });
    const reply = await chat(expert.app, await login(expert.app), 'what incidents are open?', 'expert');
    expect(models(expert.primary)).toEqual(['claude-opus-5-5']);
    expect(reply.body).toMatchObject({ mode: 'expert', escalatedTo: 'Expert' });
  });

  it('AEG-TST-004 a user who is not registered gets Normal only, even with the switches on', async () => {
    const h = makeHarness({ env: open, script: [bad, ok(GOOD)] });
    const token = await login(h.app, 'USER-B-COORD');
    const modes = (await h.app.inject({ method: 'GET', url: '/api/modes', headers: { authorization: `Bearer ${token}` } })).json() as { modes: Array<{ id: string; available: boolean }> };
    expect(modes.modes.filter((mode) => mode.available).map((mode) => mode.id)).toEqual(['auto', 'normal']);
    expect((await chat(h.app, token, 'what incidents are open?', 'pro')).status).toBe(403);
    await chat(h.app, token, 'what incidents are open?', 'auto');
    expect(models(h.primary)).toEqual(['gpt-6-luna']);
  });

  it('AEG-TST-004 the premium switch without registration, or registration without the switch, opens nothing', async () => {
    const noSwitch = makeHarness({ env: { AEGIS_REGISTERED_USERS: 'USER-A-COORD' }, script: [] });
    expect((await chat(noSwitch.app, await login(noSwitch.app), 'hello there', 'pro')).status).toBe(403);
    const noUser = makeHarness({ env: { AEGIS_PREMIUM_MODES_ENABLED: 'true' }, script: [] });
    expect((await chat(noUser.app, await login(noUser.app), 'hello there', 'expert')).status).toBe(403);
  });

  it('AEG-TST-004 a model without a published price cannot be put in a mode', () => {
    expect(() => loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_MODEL_NORMAL: 'gemini-3.6-flash' })).toThrow('no published price');
    expect(() => loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_MODEL_PRO: 'made-up-model' })).toThrow('AEGIS_MODEL_PRO');
  });

  it('AEG-TST-004 with Google as the primary provider no model override is sent', async () => {
    const h = makeHarness({ env: { AEGIS_PRIMARY_PROVIDER: 'google', AEGIS_GOOGLE_MODEL: 'TEST-GOOGLE' }, script: [ok(GOOD)] });
    await chat(h.app, await login(h.app), 'what incidents are open?', 'normal');
    expect(models(h.primary)).toEqual(['TEST-GOOGLE']);
  });
});
