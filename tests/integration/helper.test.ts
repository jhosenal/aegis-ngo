import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { seedAll } from '../../src/services/seed.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { loadConfig } from '../../src/config/config.js';
import { createApp } from '../../src/api/server.js';
import { StubProvider, type StubStep } from '../../src/providers/stubs.js';
import { ModelGateway } from '../../src/providers/gateway.js';
import { BudgetLedger } from '../../src/providers/budget-ledger.js';
import { bindingForRole } from '../../src/roles/manager.js';
import { internalMcp } from '../../src/mcp/internal.js';
import type { ChatReply, Principal } from '../../src/types/domain.js';

const active: { app: FastifyInstance; db: ReturnType<typeof openDb> }[] = [];
const principal: Principal = { productId: 'AEG', tenantId: 'TENANT-A', userId: 'USER-A-COORD', role: 'coordinator' };
const conversationId = 'b4c9e266-3c84-4621-9f2f-3680f13ef218';
const incidentId = 'INC-TENANT-A-SYN-FLOOD-0001';
const answer = (message: string, toolCall: { name: string; arguments: Record<string, unknown> } | null = null): StubStep => ({ type: 'ok', text: JSON.stringify({ message, toolCall }), usage: { inputTokens: 20, outputTokens: 20 } });
function harness(script: StubStep[], enabled = true) {
  const db = openDb(':memory:');
  const clock = new FixedClock('2026-10-13T01:00:00Z'); const ids = new SeqIdGen();
  migrate(db, fileURLToPath(new URL('../../migrations/', import.meta.url)), clock.now());
  seedAll(db, fileURLToPath(new URL('../../fixtures/', import.meta.url)), new FixedClock('2026-10-13T00:00:00Z'), ids);
  const config = loadConfig({ AEGIS_ENV: 'test', AEGIS_MODELS_ENABLED: String(enabled), AEGIS_GOOGLE_MODEL: 'TEST', AEGIS_PRICE_SNAPSHOT_ID: 'TEST', AEGIS_BUDGET_ACCOUNT_MICRO: '1000000', AEGIS_BUDGET_DAY_MICRO: '1000000', AEGIS_BUDGET_TASK_MICRO: '10000' });
  const provider = new StubProvider('stub-google', script);
  const gateway = new ModelGateway({ db, clock, ids, config, primary: provider, backup: null,
    ledger: new BudgetLedger(db, { accountMicro: 1000000, dayMicro: 1000000, taskMicro: 10000 }),
    binding: (role) => bindingForRole(role, config),
    price: { id: 'TEST', capturedAt: clock.now(), inputMicroPerMTok: 80000, outputMicroPerMTok: 400000, source: 'test-vector' },
    sleep: async () => {}, rng: () => 0, monotonicMs: () => 0 });
  const app = createApp({ db, clock, ids, config, gateway }); active.push({ app, db });
  return { app, db, provider };
}
async function login(app: FastifyInstance, userId = principal.userId) {
  const result = await app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
  return (result.json() as { token: string }).token;
}
async function chat(app: FastifyInstance, token: string, text: string, extra: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/api/helper', headers: { authorization: `Bearer ${token}` }, payload: { text, mode: 'normal', conversationId, attachments: [], ...extra } });
}
afterEach(async () => { for (const item of active.splice(0)) { await item.app.close(); item.db.close(); } });

describe('LLM helper with read-only internal MCP', () => {
  it('answers ordinary conversation through the model without dispatching a workflow', async () => {
    const h = harness([answer('I can help you understand your cards.')]);
    const token = await login(h.app); const result = await chat(h.app, token, 'Hello, what can you do?');
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ route: { source: 'model', routeId: null }, blocks: [{ type: 'text', text: 'I can help you understand your cards.' }] });
    expect(h.provider.calls).toHaveLength(1); expect(h.provider.calls[0]?.roleId).toBe('helper');
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM workflow_runs').get()).toMatchObject({ n: 0 });
  });
  it('lets the helper discover and read tenant tools, using one task budget across both LLM steps', async () => {
    const h = harness([answer('', { name: 'aegis_list_incidents', arguments: {} }), answer('These are synthetic incident cards, not live alerts.')]);
    const token = await login(h.app); const result = await chat(h.app, token, 'Show my incidents');
    expect(result.statusCode).toBe(200);
    const body = result.json() as ChatReply;
    expect(body.blocks.some((block) => block.type === 'notice' && block.code === 'HELPER_TOOL_READ')).toBe(true);
    expect(h.provider.calls).toHaveLength(2);
    expect(h.provider.calls[1]?.user).toContain('INC-TENANT-A'); expect(h.provider.calls[1]?.user).not.toContain('INC-TENANT-B');
    expect(h.provider.calls[1]?.user).toContain('"synthetic":true');
    expect(h.db.prepare('SELECT COUNT(DISTINCT task_id) AS n FROM model_calls').get()).toMatchObject({ n: 1 });
  });
  it('rejects foreign attachments before any model call and protects direct MCP lookups', async () => {
    const h = harness([]); const token = await login(h.app, 'USER-B-COORD');
    const response = await chat(h.app, token, 'Explain this', { attachments: [{ cardId: incidentId, revision: 1 }] });
    expect(response.statusCode).toBe(404); expect(h.provider.calls).toHaveLength(0);
    expect(() => internalMcp(h.db, { ...principal, tenantId: 'TENANT-B', userId: 'USER-B-COORD' }, { jsonrpc: '2.0', id: 'x', method: 'tools/call', params: { name: 'aegis_get_card', arguments: { cardId: incidentId } } })).toThrow();
  });
  it('denies model-proposed write/unknown tools without executing a workflow', async () => {
    const h = harness([answer('', { name: 'I_aegis_resource_assess', arguments: {} })]);
    const response = await chat(h.app, await login(h.app), 'Dispatch a response');
    expect(response.json()).toMatchObject({ route: { source: 'denied' } });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM workflow_runs').get()).toMatchObject({ n: 0 });
    expect(h.provider.calls).toHaveLength(1);
  });
  it('uses explicitly attached revisions and retains bounded history only for the same user and conversation', async () => {
    const h = harness([answer('I understand the context.'), answer('I remember the question.'), answer('A new conversation.')]);
    const token = await login(h.app);
    await chat(h.app, token, 'Remember the phrase FIELD CONTEXT', { attachments: [{ cardId: incidentId, revision: 1 }] });
    await chat(h.app, token, 'What did I just ask?');
    expect(h.provider.calls[0]?.user).toContain('"revision":1');
    expect(h.provider.calls[1]?.user).toContain('FIELD CONTEXT');
    await chat(h.app, token, 'Hello', { conversationId: '63e7c6fe-b50f-4c3c-b497-692a1e16c9e5' });
    expect(h.provider.calls[2]?.user).not.toContain('FIELD CONTEXT');
  });
  it('clearly reports disabled/unavailable models instead of supplying canned model replies', async () => {
    const h = harness([], false); const response = await chat(h.app, await login(h.app), 'Hello');
    expect(response.json()).toMatchObject({ providerNotice: 'MODELS_DISABLED', route: { source: 'clarify' } });
    expect(h.provider.calls).toHaveLength(0);
    const denied = await h.app.inject({ method: 'POST', url: '/api/helper', payload: { text: 'Hello' } });
    expect(denied.statusCode).toBe(401);
  });
  it('records correlated model/tool diagnostics without copying prompt or reply content into metadata', async () => {
    const h = harness([answer('', { name: 'aegis_list_incidents', arguments: {} }), answer('DO-NOT-LOG-REPLY')]);
    const response = await chat(h.app, await login(h.app), 'DO-NOT-LOG-PROMPT');
    expect(response.statusCode).toBe(200);
    const traceId = response.headers['x-aegis-chat-trace']; expect(traceId).toMatch(/^TRACE-/);
    const events = h.db.prepare('SELECT phase,elapsed_ms,details_json FROM chat_debug_events WHERE tenant_id=? AND trace_id=? ORDER BY event_id').all('TENANT-A', traceId) as { phase: string; elapsed_ms: number; details_json: string }[];
    expect(events.map((event) => event.phase)).toEqual(['request', 'context', 'context', 'model.start', 'model.result', 'tool.start', 'tool.result', 'model.start', 'model.result', 'completed']);
    const encoded = JSON.stringify(events);
    expect(encoded).not.toContain('DO-NOT-LOG-PROMPT'); expect(encoded).not.toContain('DO-NOT-LOG-REPLY');
    expect(encoded).toContain('aegis_list_incidents'); expect(encoded).toContain('attemptId');
    expect(events.every((event) => event.elapsed_ms >= 0)).toBe(true);
    const end = JSON.parse(events.at(-1)!.details_json) as { messageId: string; assistantMessageId: string };
    expect(end.messageId).toBe((response.json() as ChatReply).messageId);
    expect(h.db.prepare('SELECT role,text FROM chat_messages WHERE message_id=?').get(end.assistantMessageId)).toEqual({ role: 'assistant', text: expect.stringContaining('DO-NOT-LOG-REPLY') });
  });
  it('logs validation failures before a model call and scopes them to the signed-in tenant', async () => {
    const h = harness([]); const token = await login(h.app, 'USER-B-COORD');
    const response = await chat(h.app, token, ''); expect(response.statusCode).toBe(400);
    const events = h.db.prepare('SELECT tenant_id,phase,details_json FROM chat_debug_events WHERE trace_id=? ORDER BY event_id').all(response.headers['x-aegis-chat-trace']) as { tenant_id: string; phase: string; details_json: string }[];
    expect(events.every((event) => event.tenant_id === 'TENANT-B')).toBe(true);
    expect(events.at(-1)).toMatchObject({ phase: 'error', details_json: expect.stringContaining('E_VALIDATION') });
    expect(h.provider.calls).toHaveLength(0);
  });
});
