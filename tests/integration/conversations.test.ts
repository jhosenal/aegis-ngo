import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

function setup() {
  const db = openDb(':memory:'); const clock = new FixedClock('2026-10-17T02:00:00Z'); const ids = new SeqIdGen();
  migrate(db, dir, '2026-10-13T00:00:00Z'); seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_MODELS_ENABLED: 'false' }) }); apps.push(app);
  const login = async (userId: string) => ((await app.inject({ method: 'POST', url: '/api/session', payload: { userId } })).json() as { token: string }).token;
  const call = async (token: string | null, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const o: InjectOptions = { method, url, headers: token ? { authorization: `Bearer ${token}` } : {} }; if (payload !== undefined) o.payload = payload as object; return app.inject(o);
  };
  const say = async (token: string, text: string, conversationId?: string) => call(token, 'POST', '/api/helper', { text, mode: 'normal', attachments: [], ...(conversationId ? { conversationId } : {}) });
  return { db, app, clock, login, call, say };
}
type Item = { conversationId: string; title: string; excerpt: string };

describe('conversations of the helper chat (AEG-CHAT-003, contract C0021)', () => {
  it('create, send, list, search, paginate, rename and delete; every route is the owner\'s own', async () => {
    const { db, clock, login, call, say } = setup();
    const a = await login('USER-A-COORD'); const b = await login('USER-A-VIEW');
    expect((await call(null, 'GET', '/api/conversations')).statusCode).toBe(401);

    // an empty thread, then its first message gives it a title by code
    const made = (await call(a, 'POST', '/api/conversations')).json() as { conversationId: string; title: string };
    expect(made.title).toBe('New chat');
    const first = await say(a, 'Where is the zebra crossing near the haze station?', made.conversationId);
    expect(first.statusCode).toBe(200);
    expect((first.json() as { conversationId: string }).conversationId).toBe(made.conversationId);
    clock.advanceMs(60_000);   // the thread that was talked in last comes first
    // a message without a thread id creates its own thread and says which
    const second = (await say(a, 'What does PSI mean?')).json() as { conversationId: string };
    expect(second.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.conversationId).not.toBe(made.conversationId);

    const list = (await call(a, 'GET', '/api/conversations')).json() as { items: Item[]; nextCursor: string | null; complete: boolean };
    expect(list.items.map((i) => i.conversationId)).toEqual([second.conversationId, made.conversationId]);   // newest first
    expect(list.items.find((i) => i.conversationId === made.conversationId)!.title).toBe('Where is the zebra crossing near the haze station?');
    expect(list.complete).toBe(true);
    // pagination
    const p1 = (await call(a, 'GET', '/api/conversations?limit=1')).json() as { items: Item[]; nextCursor: string };
    expect(p1.items).toHaveLength(1); expect(p1.nextCursor).toBeTruthy();
    const p2 = (await call(a, 'GET', `/api/conversations?limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`)).json() as { items: Item[]; nextCursor: string | null };
    expect(p2.items.map((i) => i.conversationId)).toEqual([made.conversationId]); expect(p2.nextCursor).toBeNull();
    // search covers title and message text across all of the owner's threads; short or wildcard-only queries are handled
    const hit = (await call(a, 'GET', '/api/conversations?q=ZEBRA')).json() as { items: Item[]; complete: boolean };
    expect(hit.items.map((i) => i.conversationId)).toEqual([made.conversationId]); expect(hit.items[0]!.excerpt.toLowerCase()).toContain('zebra'); expect(hit.complete).toBe(true);
    expect(((await call(a, 'GET', '/api/conversations?q=PSI')).json() as { items: Item[] }).items.map((i) => i.conversationId)).toEqual([second.conversationId]);
    expect((await call(a, 'GET', '/api/conversations?q=z')).statusCode).toBe(400);
    expect(((await call(a, 'GET', '/api/conversations?q=%25%25')).json() as { items: Item[] }).items).toHaveLength(0);   // "%%" is text, not a wildcard

    // reopen: messages in order with their stored blocks
    const open = (await call(a, 'GET', `/api/conversations/${made.conversationId}`)).json() as { messages: { role: string; text: string; blocks: { type: string }[]; notices: unknown[] }[]; status: string; nextCursor: string | null };
    expect(open.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(open.messages[0]!.text).toContain('zebra');
    expect(open.messages[1]!.blocks.some((x) => x.type === 'notice')).toBe(true);   // models are off in this test: the notice was stored
    expect(open.status).toBe('complete'); expect(open.nextCursor).toBeNull();
    const paged = (await call(a, 'GET', `/api/conversations/${made.conversationId}?limit=1`)).json() as { messages: unknown[]; nextCursor: string };
    expect(paged.messages).toHaveLength(1); expect(paged.nextCursor).toBeTruthy();

    // another user in the same tenant sees nothing, finds nothing, and cannot read, rename, delete or write into it
    expect(((await call(b, 'GET', '/api/conversations')).json() as { items: Item[] }).items).toHaveLength(0);
    expect(((await call(b, 'GET', '/api/conversations?q=zebra')).json() as { items: Item[] }).items).toHaveLength(0);
    expect((await call(b, 'GET', `/api/conversations/${made.conversationId}`)).statusCode).toBe(404);
    expect((await call(b, 'PATCH', `/api/conversations/${made.conversationId}`, { title: 'mine now' })).statusCode).toBe(404);
    expect((await call(b, 'DELETE', `/api/conversations/${made.conversationId}`)).statusCode).toBe(404);
    expect((await say(b, 'hello', made.conversationId)).statusCode).toBe(400);
    expect((await call(a, 'GET', '/api/conversations/not-a-uuid')).statusCode).toBe(404);

    // rename
    expect((await call(a, 'PATCH', `/api/conversations/${made.conversationId}`, { title: '  Haze   questions ' })).json()).toMatchObject({ ok: true, title: 'Haze questions' });
    expect((await call(a, 'PATCH', `/api/conversations/${made.conversationId}`, { title: '' })).statusCode).toBe(400);
    expect((await call(a, 'PATCH', `/api/conversations/${made.conversationId}`, { title: 'x'.repeat(81) })).statusCode).toBe(400);
    expect(((await call(a, 'GET', '/api/conversations')).json() as { items: Item[] }).items.find((i) => i.conversationId === made.conversationId)!.title).toBe('Haze questions');

    // delete: gone from the owner's history at once, text and links removed, a hash-only audit event, twice is a no-op, and the id cannot be written to again
    const before = (db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ?').get(made.conversationId) as { n: number }).n;
    expect(before).toBe(2);
    const del = (await call(a, 'DELETE', `/api/conversations/${made.conversationId}`)).json() as { removedMessages: number; note: string };
    expect(del.removedMessages).toBe(2); expect(del.note).toContain('Deleted from your history');
    expect((db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ?').get(made.conversationId) as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE text LIKE '%zebra%'").get() as { n: number }).n).toBe(0);
    expect((await call(a, 'GET', `/api/conversations/${made.conversationId}`)).statusCode).toBe(404);
    expect(((await call(a, 'GET', '/api/conversations')).json() as { items: Item[] }).items.map((i) => i.conversationId)).toEqual([second.conversationId]);
    expect((await call(a, 'DELETE', `/api/conversations/${made.conversationId}`)).json()).toMatchObject({ alreadyDeleted: true });
    expect((await say(a, 'again', made.conversationId)).statusCode).toBe(400);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE body_json LIKE '%conversation.deleted%'").get() as { n: number }).n).toBe(1);
    expect(JSON.stringify(db.prepare("SELECT * FROM audit_events WHERE body_json LIKE '%conversation.deleted%'").all())).not.toContain('zebra');
    // the other thread is untouched
    expect(((await call(a, 'GET', `/api/conversations/${second.conversationId}`)).json() as { messages: unknown[] }).messages).toHaveLength(2);
  });

  it('migration 016 turns old helper threads into conversations (title from the first user message) without losing a message', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mig-'));
    try {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql') && x < '016')) copyFileSync(join(dir, f), join(tmp, f));
      const db = openDb(':memory:'); const ids = new SeqIdGen();
      migrate(db, tmp, '2026-10-13T00:00:00Z'); seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
      const u = db.prepare('SELECT tenant_id, user_id FROM users LIMIT 1').get() as { tenant_id: string; user_id: string };
      const ins = db.prepare('INSERT INTO chat_messages (message_id, tenant_id, user_id, role, text, route_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      ins.run('M1', u.tenant_id, u.user_id, 'user', 'Old question about floods\nsecond line', 'helper:11111111-1111-4111-8111-111111111111', '2026-10-10T01:00:00Z');
      ins.run('M2', u.tenant_id, u.user_id, 'assistant', 'Old answer', 'helper:11111111-1111-4111-8111-111111111111', '2026-10-10T01:00:05Z');
      ins.run('M3', u.tenant_id, u.user_id, 'user', 'Not a helper message', null, '2026-10-10T02:00:00Z');
      copyFileSync(join(dir, '016_conversations.sql'), join(tmp, '016_conversations.sql'));
      expect(migrate(db, tmp, '2026-10-17T00:00:00Z').applied).toEqual(['016_conversations.sql']);
      const c = db.prepare('SELECT * FROM conversations').all() as { conversation_id: string; title: string; created_at: string; updated_at: string; deleted_at: string | null }[];
      expect(c).toEqual([{ conversation_id: '11111111-1111-4111-8111-111111111111', tenant_id: u.tenant_id, user_id: u.user_id, title: 'Old question about floods second line', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:05Z', deleted_at: null }]);
      expect((db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = '11111111-1111-4111-8111-111111111111'").get() as { n: number }).n).toBe(2);
      expect((db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number }).n).toBe(3);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
