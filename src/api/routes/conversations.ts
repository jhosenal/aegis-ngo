import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendEvent } from '../../audit/chainStore.js';
import { createConversation, deleteConversation, getConversation, listConversations, renameConversation, TITLE_MAX } from '../../data/repos/conversations.js';
import { hashWithDomain } from '../../engine/canonical.js';
import { AegisError } from '../../engine/errors.js';
import { principalFrom } from '../auth.js';
import type { AppDeps } from '../server.js';

/**
 * Conversations of the helper chat (AEG-CHAT-003, contract C0021). Every route is the owner's own: another user's thread answers 404, a guest has no token and gets 401 from the shared auth.
 * Delete removes the messages and attachment links at once and keeps a tombstone; the audit log keeps only a hash and a count (no text). Incident cards and evidence are never touched.
 */
const ListQuery = z.object({ q: z.string().optional(), cursor: z.string().max(400).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
const ReadQuery = z.object({ cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

export function registerConversationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const idOf = (request: { params: unknown }): string => {
    const id = (request.params as { id?: string }).id;
    if (!id || !z.string().uuid().safeParse(id).success) throw new AegisError('E_NOT_FOUND');
    return id;
  };

  app.get('/api/conversations', async (request, reply) => {
    const p = principalFrom(request);
    const query = ListQuery.parse(request.query);
    const q = query.q === undefined ? null : clean(query.q);
    if (q !== null && q.length < 2) throw new AegisError('E_VALIDATION', 'Search needs at least 2 characters.');
    reply.header('Cache-Control', 'no-store');
    return listConversations(deps.db, { tenantId: p.tenantId, userId: p.userId, q, cursor: query.cursor, limit: query.limit });
  });

  app.post('/api/conversations', async (request, reply) => {
    const p = principalFrom(request);
    reply.header('Cache-Control', 'no-store');
    return createConversation(deps.db, { id: randomUUID(), tenantId: p.tenantId, userId: p.userId, now: deps.clock.now() });
  });

  app.get('/api/conversations/:id', async (request, reply) => {
    const p = principalFrom(request);
    const query = ReadQuery.parse(request.query);
    reply.header('Cache-Control', 'no-store');
    const c = getConversation(deps.db, { id: idOf(request), tenantId: p.tenantId, userId: p.userId, cursor: query.cursor, limit: query.limit });
    if (!c) throw new AegisError('E_NOT_FOUND');
    return c;
  });

  app.patch('/api/conversations/:id', async (request) => {
    const p = principalFrom(request);
    const title = clean(String((request.body as { title?: unknown } | null)?.title ?? ''));
    if (title.length < 1 || title.length > TITLE_MAX) throw new AegisError('E_VALIDATION', `The title must be 1 to ${TITLE_MAX} characters.`);
    if (!renameConversation(deps.db, { id: idOf(request), tenantId: p.tenantId, userId: p.userId, title })) throw new AegisError('E_NOT_FOUND');
    return { ok: true, title };
  });

  app.delete('/api/conversations/:id', async (request) => {
    const p = principalFrom(request);
    const id = idOf(request); const at = deps.clock.now();
    const removed = deleteConversation(deps.db, { id, tenantId: p.tenantId, userId: p.userId, now: at });
    if (removed === null) {
      // A thread this caller already deleted answers ok (deleting twice is a no-op); anyone else's, or an unknown id, is not found.
      const mine = deps.db.prepare('SELECT 1 FROM conversations WHERE conversation_id = ? AND tenant_id = ? AND user_id = ? AND deleted_at IS NOT NULL').get(id, p.tenantId, p.userId);
      if (mine) return { ok: true, deleted: true, alreadyDeleted: true };
      throw new AegisError('E_NOT_FOUND');
    }
    appendEvent(deps.db, { productId: p.productId, tenantId: p.tenantId, eventType: 'conversation.deleted', actorIdentity: p.userId, actorRole: p.role, occurredAt: at, workflowId: null, workflowVersion: null,
      inputSnapshotHash: hashWithDomain('AEG-INPUT-v1', { conversationId: id }), resultHash: hashWithDomain('AEG-RESULT-v1', { removedMessages: removed }), versions: { conversations: '1' },
      payloadHash: hashWithDomain('AEG-PAYLOAD-v1', { action: 'delete' }), correlationKey: id }, deps.ids);
    return { ok: true, deleted: true, removedMessages: removed, note: 'Deleted from your history. The audit log keeps only that it happened (no text).' };
  });
}
