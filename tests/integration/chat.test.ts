import { grantOperationalFixtures } from '../helpers/pro-fixtures.js';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadChain } from '../../src/audit/chainStore.js';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { BudgetLedger } from '../../src/providers/budget-ledger.js';
import { ModelGateway } from '../../src/providers/gateway.js';
import { StubProvider, type StubStep } from '../../src/providers/stubs.js';
import type { ChatReply } from '../../src/types/domain.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';
import { bindingForRole } from '../../src/roles/manager.js';

type Db = import('better-sqlite3').Database;
type Harness = { db: Db; app: FastifyInstance; provider: StubProvider; backup: StubProvider | null; config: ReturnType<typeof loadConfig> };
type Login = { token: string };
type ApiError = { error: { code: string } };

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const seedNow = '2026-10-13T00:00:00Z';
const testNow = '2026-10-13T01:00:00Z';
const price = { id: 'PRICE-TEST', capturedAt: seedNow, inputMicroPerMTok: 1_000_000, outputMicroPerMTok: 2_000_000, source: 'synthetic-test-vector' };
const databases: Db[] = [];
const apps: FastifyInstance[] = [];

const chatReplySchema = z.object({
  messageId: z.string(),
  route: z.object({ routeId: z.string().nullable(), source: z.enum(['local', 'model', 'clarify', 'denied']) }).strict(),
  blocks: z.array(z.union([
    z.object({ type: z.literal('text'), text: z.string() }).strict(),
    z.object({ type: z.literal('cardRef'), cardId: z.string(), revision: z.number().int() }).strict(),
    z.object({ type: z.literal('table'), columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).strict(),
    z.object({ type: z.literal('notice'), level: z.enum(['info', 'warning', 'error']), code: z.string(), text: z.string() }).strict(),
  ])),
  providerNotice: z.enum(['GOOGLE_UNAVAILABLE_BACKUP_USED', 'MODELS_UNAVAILABLE', 'MODELS_DISABLED', 'BUDGET_EXHAUSTED', 'REFUSED']).nullable(),
  attachedRevisions: z.array(z.object({ cardId: z.string(), revision: z.number().int() }).strict()),
  mode: z.enum(['auto', 'normal', 'pro', 'expert']),
  escalatedTo: z.enum(['Pro', 'Expert']).nullable(),
}).strict();

function makeHarness(options: { modelsEnabled?: boolean; script?: StubStep[]; backupScript?: StubStep[] } = {}): Harness {
  const db = openDb(':memory:');
  databases.push(db);
  const clock = new FixedClock(testNow);
  const ids = new SeqIdGen();
  migrate(db, migrationDirectory, seedNow);
  seedAll(db, fixturesDirectory, new FixedClock(seedNow), ids);
  grantOperationalFixtures(db);
  const config = loadConfig({
    AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:',
    AEGIS_MODELS_ENABLED: String(options.modelsEnabled ?? false),
    AEGIS_GOOGLE_MODEL: 'TEST-MODEL', AEGIS_PRICE_SNAPSHOT_ID: price.id,
    AEGIS_BUDGET_ACCOUNT_MICRO: '10000', AEGIS_BUDGET_DAY_MICRO: '10000', AEGIS_BUDGET_TASK_MICRO: '5000',
    ...(options.backupScript ? { AEGIS_REAPI_MODEL: 'TEST-BACKUP-MODEL', AEGIS_REAPI_ALLOWED_DATA_CLASSES: 'tenant_private' } : {}),
  });
  const provider = new StubProvider('stub-google', options.script ?? [{ type: 'error', kind: 'BAD_REQUEST' }]);
  const backup = options.backupScript ? new StubProvider('stub-reapi', options.backupScript) : null;
  const ledger = new BudgetLedger(db, { accountMicro: 10000, dayMicro: 10000, taskMicro: 5000 });
  const gateway = new ModelGateway({
    db, clock, ids, config, ledger, primary: provider, backup,
    binding: (role) => bindingForRole(role, config), price,
    sleep: async () => undefined, rng: () => 0.5, monotonicMs: () => 0,
  });
  const app = createApp({ db, clock, ids, config, gateway });
  apps.push(app);
  return { db, app, provider, backup, config };
}

async function login(app: FastifyInstance, userId = 'USER-A-COORD'): Promise<Login> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
  expect(response.statusCode).toBe(200);
  return response.json() as Login;
}

async function chat(app: FastifyInstance, token: string, text: string, attachments?: { cardId: string; revision: number }[]): Promise<ChatReply> {
  const response = await app.inject({
    method: 'POST', url: '/api/chat',
    headers: { authorization: `Bearer ${token}` },
    payload: { text, ...(attachments ? { attachments } : {}) },
  });
  expect(response.statusCode).toBe(200);
  return chatReplySchema.parse(response.json()) as ChatReply;
}

function count(db: Db, table: 'workflow_runs' | 'chat_messages' | 'model_calls' | 'audit_events'): number {
  if (table === 'audit_events') {
    return loadChain(db, { productId: 'AEG', tenantId: 'TENANT-A' }).filter((event) => event.eventType === 'chat.routed').length;
  }
  const sql = {
    workflow_runs: 'SELECT COUNT(*) AS count FROM workflow_runs',
    chat_messages: 'SELECT COUNT(*) AS count FROM chat_messages',
    model_calls: 'SELECT COUNT(*) AS count FROM model_calls',
  }[table];
  return (db.prepare(sql).get() as { count: number }).count;
}

function textBlocks(reply: ChatReply): string[] {
  return reply.blocks.filter((block) => block.type === 'text').map((block) => block.text);
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

describe('TSK-012 chat service and route', () => {
  it('AEG-TST-013 C1 help is local and does not call a provider', async () => {
    const h = makeHarness({ modelsEnabled: true });
    const session = await login(h.app);
    const result = await chat(h.app, session.token, 'help');
    expect(result.route).toEqual({ routeId: 'I_aegis_help_show', source: 'local' });
    expect(h.provider.calls).toHaveLength(0);
    expect(textBlocks(result)[0]).toContain('list incidents');
  });

  it('AEG-TST-013 C2 lists four tenant A incidents in a table', async () => {
    const h = makeHarness();
    const session = await login(h.app);
    const result = await chat(h.app, session.token, 'list incidents');
    const table = result.blocks.find((block) => block.type === 'table');
    expect(result.route.source).toBe('local');
    expect(table?.type === 'table' ? table.rows : []).toHaveLength(4);
    expect(result.blocks.some((block) => block.type === 'table' && block.rows.some((row) => row[0] === 'INC-TENANT-A-SYN-FLOOD-0001'))).toBe(true);
    expect(h.provider.calls).toHaveLength(0);
  });

  it('AEG-TST-013 C3 assesses local demand and matches the API decision hash', async () => {
    const h = makeHarness();
    const session = await login(h.app);
    const api = await h.app.inject({
      method: 'POST', url: '/api/workflows/resource-assessment',
      headers: { authorization: `Bearer ${session.token}` },
      payload: { incidentCardId: 'INC-TENANT-A-SYN-FLOOD-0001', incidentRevision: 2, regionId: 'REGION.DEMO_A', unitId: 'UNIT.WATER_KIT', demandUnits: 120, availableUnits: 85, reserveUnits: 5 },
    });
    const apiResult = api.json() as { decisionHash: string };
    const result = await chat(h.app, session.token, 'assess INC-TENANT-A-SYN-FLOOD-0001 unit UNIT.WATER_KIT region REGION.DEMO_A demand 120 available 85 reserve 5');
    expect(result.route).toMatchObject({ routeId: 'I_aegis_resource_assess', source: 'local' });
    expect(textBlocks(result).join('\n')).toContain('Shortfall 40');
    expect(textBlocks(result).join('\n')).toContain(apiResult.decisionHash);
    expect(h.provider.calls).toHaveLength(0);
  });

  it('AEG-TST-013 C4 preserves card id case and returns E_NOT_FOUND without a workflow', async () => {
    const h = makeHarness();
    const session = await login(h.app);
    const before = count(h.db, 'workflow_runs');
    const result = await chat(h.app, session.token, 'open inc-tenant-a-syn-flood-0001');
    expect(result.route.source).toBe('denied');
    expect(result.blocks).toContainEqual(expect.objectContaining({ type: 'notice', code: 'E_NOT_FOUND' }));
    expect(count(h.db, 'workflow_runs')).toBe(before);
  });

  it('AEG-TST-013 C5 clarifies when models are disabled', async () => {
    const h = makeHarness({ modelsEnabled: false });
    const session = await login(h.app);
    const result = await chat(h.app, session.token, 'what should we do about the flood?');
    expect(result.route).toEqual({ routeId: null, source: 'clarify' });
    expect(result.providerNotice).toBe('MODELS_DISABLED');
    expect(textBlocks(result)[0]).toContain('Known commands');
    expect(h.provider.calls).toHaveLength(0);
  });

  it('AEG-TST-013 C6 denies an unknown model route and audits the denial', async () => {
    const h = makeHarness({ modelsEnabled: true, script: [{ type: 'ok', text: '{"routeId":"I_aegis_admin_export_all","args":{},"clarification":null}', usage: { inputTokens: 20, outputTokens: 20 } }] });
    const session = await login(h.app);
    const result = await chat(h.app, session.token, 'what should we do about the flood?');
    expect(result.route).toMatchObject({ routeId: 'I_aegis_admin_export_all', source: 'denied' });
    expect(result.blocks).toContainEqual(expect.objectContaining({ type: 'notice', code: 'E_ROUTE_DENIED' }));
    expect(loadChain(h.db, { productId: 'AEG', tenantId: 'TENANT-A' }).at(-1)?.eventType).toBe('chat.routed');
    expect(h.provider.calls).toHaveLength(1);
  });

  it('AEG-TST-013 C7 denies a model proposal for a tenant B card', async () => {
    const h = makeHarness({ modelsEnabled: true, script: [{ type: 'ok', text: JSON.stringify({
      routeId: 'I_aegis_resource_assess',
      args: { incidentCardId: 'INC-TENANT-B-SYN-FLOOD-0001', incidentRevision: 2, regionId: 'REGION.DEMO_B', unitId: 'UNIT.WATER_KIT', demandUnits: 120 },
      clarification: null,
    }), usage: { inputTokens: 20, outputTokens: 20 } }] });
    const session = await login(h.app);
    const before = count(h.db, 'workflow_runs');
    const result = await chat(h.app, session.token, 'assess the tenant B incident');
    expect(result.route.source).toBe('denied');
    expect(result.blocks).toContainEqual(expect.objectContaining({ type: 'notice', code: 'E_NOT_FOUND' }));
    expect(count(h.db, 'workflow_runs')).toBe(before);
  });

  it('AEG-TST-013 C8 treats every injection fixture as data', async () => {
    const fixturePath = fileURLToPath(new URL('../../fixtures/injection-text.json', import.meta.url));
    const fixture = JSON.parse(await (await import('node:fs/promises')).readFile(fixturePath, 'utf8')) as { cases: { text: string }[] };
    const script: StubStep[] = fixture.cases.map((_, index) => ({
      type: 'ok',
      text: JSON.stringify(index === 2
        ? { routeId: 'I_aegis_resource_assess', args: { incidentCardId: 'INC-TENANT-A-SYN-FLOOD-0001', incidentRevision: 2, regionId: 'REGION.DEMO_A', unitId: 'UNIT.WATER_KIT', demandUnits: 999999999999 }, clarification: null }
        : { routeId: 'I_aegis_admin_export_all', args: {}, clarification: null }),
      usage: { inputTokens: 10, outputTokens: 10 },
    }));
    const h = makeHarness({ modelsEnabled: true, script });
    const session = await login(h.app);
    const beforeRuns = count(h.db, 'workflow_runs');
    for (const sample of fixture.cases) {
      const result = await chat(h.app, session.token, sample.text);
      expect(result.route.source).toBe('denied');
      expect(result.blocks.filter((block) => block.type === 'text').every((block) => !/[<>]/.test(block.text))).toBe(true);
    }
    expect(count(h.db, 'workflow_runs')).toBe(beforeRuns);
    expect(h.config.budget.accountMicro).toBe(10000);
    expect(h.config.budget.dayMicro).toBe(10000);
    expect(h.provider.calls).toHaveLength(fixture.cases.length);
  });

  it('AEG-TST-013 C9 assesses the exact attached incident revision', async () => {
    const h = makeHarness();
    const session = await login(h.app);
    const result = await chat(h.app, session.token, 'assess INC-TENANT-A-SYN-FLOOD-0001 unit UNIT.WATER_KIT region REGION.DEMO_A demand 120 available 85 reserve 5', [
      { cardId: 'INC-TENANT-A-SYN-FLOOD-0001', revision: 1 },
    ]);
    const ref = result.blocks.find((block) => block.type === 'cardRef');
    expect(result.attachedRevisions).toEqual([{ cardId: 'INC-TENANT-A-SYN-FLOOD-0001', revision: 1 }]);
    expect(ref?.type).toBe('cardRef');
    if (ref?.type === 'cardRef') {
      const link = h.db.prepare('SELECT child_revision FROM card_links WHERE parent_card_id = ? ORDER BY rowid DESC LIMIT 1').get(ref.cardId) as { child_revision: number };
      expect(link.child_revision).toBe(1);
    }
  });

  it('AEG-TST-013 C10 clarifies on invalid model JSON without echoing it', async () => {
    const h = makeHarness({ modelsEnabled: true, script: [{ type: 'ok', text: '<script>invalid', usage: { inputTokens: 10, outputTokens: 10 } }] });
    const session = await login(h.app);
    const result = await chat(h.app, session.token, 'something ambiguous');
    expect(result.route.source).toBe('clarify');
    expect(textBlocks(result).join('')).not.toContain('<script>');
    expect(h.provider.calls).toHaveLength(1);
  });

  it('AEG-TST-013 FU-1 retries malformed manager JSON with backup and executes a valid proposal', async () => {
    const h = makeHarness({
      modelsEnabled: true,
      script: [{ type: 'ok', text: 'not json', usage: { inputTokens: 10, outputTokens: 5 } }],
      backupScript: [{
        type: 'ok', text: JSON.stringify({ routeId: 'I_aegis_help_show', args: {}, clarification: null }),
        usage: { inputTokens: 10, outputTokens: 5 },
      }],
    });
    const session = await login(h.app);
    const result = await chat(h.app, session.token, 'please show the available help');
    expect(result.route).toEqual({ routeId: 'I_aegis_help_show', source: 'model' });
    expect(result.providerNotice).toBe('GOOGLE_UNAVAILABLE_BACKUP_USED');
    expect(textBlocks(result)[0]).toContain('Known commands');
    expect(h.provider.calls).toHaveLength(1);
    expect(h.backup?.calls).toHaveLength(1);
  });

  it('AEG-TST-013 FU-2 replays identical assessments and revises when demand changes', async () => {
    const h = makeHarness();
    const session = await login(h.app);
    const command = 'assess INC-TENANT-A-SYN-FLOOD-0001 unit UNIT.WATER_KIT region REGION.DEMO_A demand 120 available 85 reserve 5';
    const first = await chat(h.app, session.token, command);
    const replay = await chat(h.app, session.token, command);
    const firstRef = first.blocks.find((block) => block.type === 'cardRef');
    const replayRef = replay.blocks.find((block) => block.type === 'cardRef');
    expect(firstRef?.type).toBe('cardRef');
    expect(replayRef?.type).toBe('cardRef');
    if (firstRef?.type !== 'cardRef' || replayRef?.type !== 'cardRef') throw new Error('Expected assessment references');
    expect(replayRef).toEqual({ type: 'cardRef', cardId: firstRef.cardId, revision: firstRef.revision });
    expect((h.db.prepare('SELECT COUNT(*) AS count FROM card_revisions WHERE card_id = ?').get(firstRef.cardId) as { count: number }).count).toBe(1);

    const changed = await chat(h.app, session.token, command.replace('demand 120', 'demand 130'));
    const changedRef = changed.blocks.find((block) => block.type === 'cardRef');
    expect(changedRef).toEqual({ type: 'cardRef', cardId: firstRef.cardId, revision: 2 });
    expect((h.db.prepare('SELECT state FROM card_revisions WHERE card_id = ? AND revision = 1').get(firstRef.cardId) as { state: string }).state).toBe('superseded');
  });

  it('AEG-TST-013 C11 rejects a specialist summary with an unsupported number', async () => {
    const h = makeHarness({ modelsEnabled: true, script: [{ type: 'ok', text: 'There are 999 people affected.', usage: { inputTokens: 10, outputTokens: 10 } }] });
    const session = await login(h.app);
    const assessment = await chat(h.app, session.token, 'assess INC-TENANT-A-SYN-FLOOD-0001 unit UNIT.WATER_KIT region REGION.DEMO_A demand 120 available 85 reserve 5');
    const ref = assessment.blocks.find((block) => block.type === 'cardRef');
    if (!ref || ref.type !== 'cardRef') throw new Error('Expected an assessment card reference');
    const explained = await chat(h.app, session.token, `explain ${ref.cardId}`, [{ cardId: ref.cardId, revision: ref.revision }]);
    expect(textBlocks(explained).join('\n')).not.toContain('There are 999 people affected.');
    expect(explained.blocks.some((block) => block.type === 'notice')).toBe(true);
    expect(explained.attachedRevisions).toEqual([{ cardId: ref.cardId, revision: ref.revision }]);
  });

  it('AEG-TST-013 C12 rejects six attachments with E_VALIDATION', async () => {
    const h = makeHarness();
    const session = await login(h.app);
    const attachments = Array.from({ length: 6 }, (_, index) => ({ cardId: `INC-TENANT-A-SYN-FLOOD-000${index + 1}`, revision: 1 }));
    const response = await h.app.inject({
      method: 'POST', url: '/api/chat', headers: { authorization: `Bearer ${session.token}` },
      payload: { text: 'help', attachments },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as ApiError).error.code).toBe('E_VALIDATION');
  });

  it('AEG-TST-013 stores the message and one chat.routed event without putting text in audit', async () => {
    const h = makeHarness();
    const session = await login(h.app);
    await chat(h.app, session.token, 'help');
    expect(count(h.db, 'chat_messages')).toBe(1);
    expect(count(h.db, 'audit_events')).toBe(1);
    const body = loadChain(h.db, { productId: 'AEG', tenantId: 'TENANT-A' }).at(-1);
    expect(body?.payloadHash).not.toContain('help');
  });
});
