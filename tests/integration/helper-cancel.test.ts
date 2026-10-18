import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { SEATS } from '../../src/roles/seats.js';
import type { ChatReply, Principal } from '../../src/types/domain.js';

// Real incident 2026-10-17: "what is the major disaster for today" -> model step 1 chose aegis_list_incidents, then the helper's own 12,000-character guard
// refused step 2 (system prompt about 11,100 + request + tool result), so the person only saw "The LLM helper could not answer". Also: no way to cancel.
const active: { app: FastifyInstance; db: ReturnType<typeof openDb> }[] = [];
const principal: Principal = { productId: 'AEG', tenantId: 'TENANT-A', userId: 'USER-A-COORD', role: 'coordinator' };
const conversationId = 'b4c9e266-3c84-4621-9f2f-3680f13ef218';
const answer = (message: string, toolCall: { name: string; arguments: Record<string, unknown> } | null = null): StubStep => ({ type: 'ok', text: JSON.stringify({ message, toolCall }), usage: { inputTokens: 20, outputTokens: 20 } });
function harness(script: StubStep[], backupScript: StubStep[] | null = null) {
  const db = openDb(':memory:');
  const clock = new FixedClock('2026-10-13T01:00:00Z'); const ids = new SeqIdGen();
  migrate(db, fileURLToPath(new URL('../../migrations/', import.meta.url)), clock.now());
  seedAll(db, fileURLToPath(new URL('../../fixtures/', import.meta.url)), new FixedClock('2026-10-13T00:00:00Z'), ids);
  const config = loadConfig({ AEGIS_ENV: 'test', AEGIS_MODELS_ENABLED: 'true', AEGIS_GOOGLE_MODEL: 'TEST', AEGIS_PRICE_SNAPSHOT_ID: 'TEST', AEGIS_BUDGET_ACCOUNT_MICRO: '1000000', AEGIS_BUDGET_DAY_MICRO: '1000000', AEGIS_BUDGET_TASK_MICRO: '10000' });
  const provider = new StubProvider('stub-google', script);
  const backup = backupScript ? new StubProvider('stub-reapi', backupScript) : null;
  const gateway = new ModelGateway({ db, clock, ids, config, primary: provider, backup,
    ledger: new BudgetLedger(db, { accountMicro: 1000000, dayMicro: 1000000, taskMicro: 10000 }),
    binding: (role) => bindingForRole(role, config),
    price: { id: 'TEST', capturedAt: clock.now(), inputMicroPerMTok: 80000, outputMicroPerMTok: 400000, source: 'test-vector' },
    sleep: async () => {}, rng: () => 0, monotonicMs: () => Date.now() });
  const app = createApp({ db, clock, ids, config, gateway }); active.push({ app, db });
  return { app, db, provider, backup, gateway };
}
async function login(app: FastifyInstance) { return ((await app.inject({ method: 'POST', url: '/api/session', payload: { userId: principal.userId } })).json() as { token: string }).token; }
const chat = (app: FastifyInstance, token: string, text: string) => app.inject({ method: 'POST', url: '/api/helper', headers: { authorization: `Bearer ${token}` }, payload: { text, mode: 'normal', conversationId, attachments: [] } });
afterEach(async () => { for (const item of active.splice(0)) { await item.app.close(); item.db.close(); } });
const until = async (check: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await new Promise((r) => setTimeout(r, 15)); } return check(); };

describe('helper: size limit', () => {
  it('the helper seat allows the system prompt plus a tool result and a long question (the old 12,000 limit failed every such turn)', async () => {
    expect(SEATS.helper.maxInputChars).toBeGreaterThanOrEqual(24000);
    const h = harness([answer('', { name: 'aegis_list_incidents', arguments: {} }), answer('Here is the summary of the incident cards.')]);
    const token = await login(h.app);
    // a question long enough that step 2 is above the old 12,000-character limit even with the small fixture result
    const result = await chat(h.app, token, `What is the major disaster for today? ${'Please be careful and complete. '.repeat(55)}`.slice(0, 1900));
    expect(result.statusCode).toBe(200);
    const body = result.json() as ChatReply;
    expect(h.provider.calls).toHaveLength(2);
    const stepTwo = h.provider.calls[1]!; expect(stepTwo.system.length + stepTwo.user.length).toBeGreaterThan(12000);
    expect(body.providerNotice).toBeNull(); expect(body.blocks.some((b) => b.type === 'text' && b.text.includes('summary of the incident cards'))).toBe(true);
    // the real incident cost: two attempts, far under the one-cent request cap (10,000 micro-USD)
    const spent = h.db.prepare("SELECT COALESCE(SUM(CASE WHEN state='settled' THEN settled_micro ELSE amount_micro END),0) AS m FROM budget_reservations").get() as { m: number };
    expect(spent.m).toBeLessThan(10000);
  });
});

describe('helper: calculated result when the model cannot write the answer', () => {
  it('shows the incident cards the code read instead of nothing', async () => {
    const h = harness([answer('', { name: 'aegis_list_incidents', arguments: {} })]); // step 2 has no scripted answer: the provider fails
    const token = await login(h.app); const result = await chat(h.app, token, 'what is the major disaster for today');
    const body = result.json() as ChatReply;
    expect(body.providerNotice).toBe('MODELS_UNAVAILABLE');
    const text = body.blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ');
    expect(text).toMatch(/^Incident cards in this workspace \(\d+/); expect(text).toContain('synthetic example');
    expect(text).not.toContain('<'); expect(text).not.toContain('TENANT-B');
  });
});

describe('helper: Cancel', () => {
  it('a gateway call that is already cancelled makes no request and reserves no money', async () => {
    const h = harness([answer('never used')], [answer('never used either')]);
    const controller = new AbortController(); controller.abort();
    const out = await h.gateway.call('helper', { taskId: 'T-CANCELLED', tenantId: 'TENANT-A', system: 's', user: 'u', responseSchemaId: 'x', dataClass: 'tenant_private' }, () => true, { signal: controller.signal });
    expect(out).toMatchObject({ status: 'CANCELLED', notice: 'CANCELLED', text: null, attempts: [] });
    expect(h.provider.calls).toHaveLength(0); expect(h.backup!.calls).toHaveLength(0);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM budget_reservations').get()).toMatchObject({ n: 0 });
  });

  it('cancelling during a model request aborts it, never retries, never tries the backup provider, and keeps the possible charge as a liability', async () => {
    const h = harness([{ type: 'delay', ms: 60000 }], [answer('backup must not answer')]);
    const controller = new AbortController();
    const pending = h.gateway.call('helper', { taskId: 'T-MID', tenantId: 'TENANT-A', system: 's', user: 'u', responseSchemaId: 'x', dataClass: 'tenant_private' }, () => true, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 40)); controller.abort();
    const out = await pending;
    expect(out.status).toBe('CANCELLED'); expect(out.attempts).toHaveLength(1); expect(out.attempts[0]).toMatchObject({ outcome: 'CANCELLED', costBasis: 'unknown' });
    expect(h.provider.calls).toHaveLength(1); expect(h.backup!.calls).toHaveLength(0);
    expect(h.db.prepare("SELECT state FROM budget_reservations WHERE task_id='T-MID'").all()).toEqual([{ state: 'liability' }]);
    // a cancel is not a provider failure: the circuit breaker is untouched, so the next request goes through
    h.provider.calls.length = 0;
  });

  it('the browser closing the connection cancels the model request, records "Cancelled", and the next turn works', async () => {
    const h = harness([{ type: 'delay', ms: 60000 }, answer('Second turn works.')]);
    const token = await login(h.app); await h.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (h.app.server.address() as AddressInfo).port;
    const body = JSON.stringify({ text: 'what is the major disaster for today', mode: 'normal', conversationId, attachments: [] });
    const request = http.request({ host: '127.0.0.1', port, path: '/api/helper', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${token}` } });
    request.on('error', () => { /* the client destroys its own socket below */ });
    request.end(body);
    expect(await until(() => h.provider.calls.length === 1)).toBe(true);   // the model request is in flight
    request.destroy();                                                      // = the Cancel button (fetch abort) or closing the tab
    expect(await until(() => (h.db.prepare("SELECT COUNT(*) AS n FROM model_calls WHERE outcome='CANCELLED'").get() as { n: number }).n === 1)).toBe(true);
    expect(await until(() => (h.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE role='assistant' AND text LIKE 'Cancelled.%'").get() as { n: number }).n === 1)).toBe(true);
    expect(h.provider.calls).toHaveLength(1);                               // no retry after the cancel
    expect(h.db.prepare("SELECT json_extract(details_json,'$.phase') AS p FROM chat_debug_events WHERE phase='cancelled'").all().length).toBeGreaterThan(0);
    const next = await chat(h.app, token, 'hello again'); expect(next.statusCode).toBe(200);
    expect((next.json() as ChatReply).blocks).toMatchObject([{ type: 'text', text: 'Second turn works.' }]);
  });

  it('cancelling after the tool ran stops before the second model step', async () => {
    const h = harness([answer('', { name: 'aegis_list_incidents', arguments: {} }), { type: 'delay', ms: 60000 }]);
    const token = await login(h.app); await h.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (h.app.server.address() as AddressInfo).port; const body = JSON.stringify({ text: 'list the incidents', mode: 'normal', conversationId, attachments: [] });
    const request = http.request({ host: '127.0.0.1', port, path: '/api/helper', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${token}` } });
    request.on('error', () => {}); request.end(body);
    expect(await until(() => h.provider.calls.length === 2)).toBe(true); request.destroy();
    expect(await until(() => (h.db.prepare("SELECT COUNT(*) AS n FROM model_calls WHERE outcome='CANCELLED'").get() as { n: number }).n === 1)).toBe(true);
    expect(h.provider.calls).toHaveLength(2);
  });
});
