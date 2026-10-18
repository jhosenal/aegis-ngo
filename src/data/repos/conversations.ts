import type { Db } from '../db.js';

export const TITLE_MAX = 80;
export const NEW_TITLE = 'New chat';
export interface ConversationRow { conversationId: string; title: string; createdAt: string; updatedAt: string }
export interface ListItem extends ConversationRow { excerpt: string }
export interface MessageOut { messageId: string; role: string; text: string; createdAt: string; blocks: unknown[]; notices: unknown[]; attachments: { cardId: string; revision: number }[] }

const oneLine = (text: string, max: number): string => text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Title from the first user text, by code (no model call). */
export const titleFrom = (text: string): string => oneLine(text, 60) || NEW_TITLE;
const likeOf = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const snippet = (text: string, q: string | null): string => {
  const flat = oneLine(text, 4000);
  if (!q) return flat.slice(0, 120);
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  const from = Math.max(0, (at < 0 ? 0 : at) - 40);
  return `${from > 0 ? '…' : ''}${flat.slice(from, from + 120)}`;
};

export type Ensure = 'created' | 'exists' | 'forbidden' | 'deleted';
/** The thread of a helper message: created on its first message (title from that text), reused afterwards; another owner's id, or a deleted thread, is refused. */
export function ensureConversation(db: Db, p: { id: string; tenantId: string; userId: string; firstText: string; now: string }): Ensure {
  const row = db.prepare('SELECT tenant_id, user_id, title, deleted_at FROM conversations WHERE conversation_id = ?').get(p.id) as { tenant_id: string; user_id: string; title: string; deleted_at: string | null } | undefined;
  if (!row) { db.prepare('INSERT INTO conversations (conversation_id, tenant_id, user_id, title, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)').run(p.id, p.tenantId, p.userId, titleFrom(p.firstText), p.now, p.now); return 'created'; }
  if (row.tenant_id !== p.tenantId || row.user_id !== p.userId) return 'forbidden';
  if (row.deleted_at) return 'deleted';
  if (row.title === NEW_TITLE) db.prepare('UPDATE conversations SET title = ? WHERE conversation_id = ?').run(titleFrom(p.firstText), p.id);
  return 'exists';
}
export function touchConversation(db: Db, id: string, now: string): void { db.prepare('UPDATE conversations SET updated_at = ? WHERE conversation_id = ?').run(now, id); }

export function createConversation(db: Db, p: { id: string; tenantId: string; userId: string; now: string }): ConversationRow {
  db.prepare('INSERT INTO conversations (conversation_id, tenant_id, user_id, title, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)').run(p.id, p.tenantId, p.userId, NEW_TITLE, p.now, p.now);
  return { conversationId: p.id, title: NEW_TITLE, createdAt: p.now, updatedAt: p.now };
}

const encode = (v: { u: string; i: string }): string => Buffer.from(JSON.stringify(v)).toString('base64url');
function decode(cursor: string | undefined): { u: string; i: string } | null {
  if (!cursor) return null;
  try { const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { u?: unknown; i?: unknown }; return typeof v.u === 'string' && typeof v.i === 'string' ? { u: v.u, i: v.i } : null; } catch { return null; }
}

/** The owner's threads, newest first. With q (2 characters or more) the title and the message text of the owner's own threads are searched across ALL of them (not only the loaded page). */
export function listConversations(db: Db, p: { tenantId: string; userId: string; q: string | null; cursor?: string | undefined; limit: number }): { items: ListItem[]; nextCursor: string | null; complete: boolean } {
  const cur = decode(p.cursor);
  const where = ['c.tenant_id = @t', 'c.user_id = @u', 'c.deleted_at IS NULL'];
  const args: Record<string, unknown> = { t: p.tenantId, u: p.userId, n: p.limit + 1 };
  if (cur) { where.push('(c.updated_at < @cu OR (c.updated_at = @cu AND c.conversation_id < @ci))'); args['cu'] = cur.u; args['ci'] = cur.i; }
  if (p.q) { where.push("(c.title LIKE @like ESCAPE '\\' OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.conversation_id AND m.text LIKE @like ESCAPE '\\'))"); args['like'] = likeOf(p.q); }
  const rows = db.prepare(`SELECT c.conversation_id, c.title, c.created_at, c.updated_at FROM conversations c WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC, c.conversation_id DESC LIMIT @n`).all(args) as { conversation_id: string; title: string; created_at: string; updated_at: string }[];
  const page = rows.slice(0, p.limit);
  const items = page.map((r): ListItem => {
    const m = (p.q
      ? db.prepare("SELECT text FROM chat_messages WHERE conversation_id = ? AND text LIKE ? ESCAPE '\\' ORDER BY created_at, rowid LIMIT 1").get(r.conversation_id, likeOf(p.q))
      : db.prepare('SELECT text FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(r.conversation_id)) as { text: string } | undefined;
    return { conversationId: r.conversation_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, excerpt: m ? snippet(m.text, p.q) : '' };
  });
  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > p.limit && last ? encode({ u: last.updated_at, i: last.conversation_id }) : null, complete: true };
}

function owned(db: Db, id: string, tenantId: string, userId: string): ConversationRow | null {
  const r = db.prepare('SELECT conversation_id, title, created_at, updated_at FROM conversations WHERE conversation_id = ? AND tenant_id = ? AND user_id = ? AND deleted_at IS NULL').get(id, tenantId, userId) as { conversation_id: string; title: string; created_at: string; updated_at: string } | undefined;
  return r ? { conversationId: r.conversation_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at } : null;
}

/** One thread with its messages in order (cursor = last row seen). Null when it is not the caller's, or was deleted. */
export function getConversation(db: Db, p: { id: string; tenantId: string; userId: string; cursor?: string | undefined; limit: number }):
  (ConversationRow & { messages: MessageOut[]; nextCursor: string | null; status: 'complete' | 'interrupted' }) | null {
  const conv = owned(db, p.id, p.tenantId, p.userId); if (!conv) return null;
  const after = Number(p.cursor ?? 0); const from = Number.isFinite(after) && after > 0 ? after : 0;
  const rows = db.prepare('SELECT rowid AS rid, message_id, role, text, created_at, blocks_json FROM chat_messages WHERE conversation_id = ? AND rowid > ? ORDER BY rowid LIMIT ?').all(p.id, from, p.limit + 1) as { rid: number; message_id: string; role: string; text: string; created_at: string; blocks_json: string | null }[];
  const page = rows.slice(0, p.limit);
  const att = new Map<string, { cardId: string; revision: number }[]>();
  if (page.length > 0) {
    const ids = page.map((r) => r.message_id);
    for (const a of db.prepare(`SELECT message_id, card_id, revision FROM chat_attachments WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY card_id, revision`).all(...ids) as { message_id: string; card_id: string; revision: number }[])
      att.set(a.message_id, [...(att.get(a.message_id) ?? []), { cardId: a.card_id, revision: a.revision }]);
  }
  const messages = page.map((r): MessageOut => {
    let blocks: unknown[] = []; try { blocks = r.blocks_json ? JSON.parse(r.blocks_json) as unknown[] : []; } catch { blocks = []; }
    return { messageId: r.message_id, role: r.role, text: r.text, createdAt: r.created_at, blocks, notices: blocks.filter((b) => (b as { type?: string }).type === 'notice'), attachments: att.get(r.message_id) ?? [] };
  });
  const lastRole = (db.prepare('SELECT role FROM chat_messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 1').get(p.id) as { role: string } | undefined)?.role;
  const lastRid = page.length > 0 ? rows[page.length - 1]!.rid : null;
  return { ...conv, messages, nextCursor: rows.length > p.limit && lastRid !== null ? String(lastRid) : null, status: lastRole === 'user' ? 'interrupted' : 'complete' };
}

/** A rename by the owner. False when it is not the caller's thread. */
export function renameConversation(db: Db, p: { id: string; tenantId: string; userId: string; title: string }): boolean {
  return db.prepare('UPDATE conversations SET title = ? WHERE conversation_id = ? AND tenant_id = ? AND user_id = ? AND deleted_at IS NULL').run(p.title, p.id, p.tenantId, p.userId).changes === 1;
}

/** Delete from the owner's history: the messages and the attachment links go at once; a tombstone row (no text) stays so the id cannot be reused. Incident cards and evidence are never touched. Returns how many messages went, or null when it is not the caller's thread. */
export function deleteConversation(db: Db, p: { id: string; tenantId: string; userId: string; now: string }): number | null {
  return db.transaction((): number | null => {
    const conv = owned(db, p.id, p.tenantId, p.userId); if (!conv) return null;
    const ids = (db.prepare('SELECT message_id FROM chat_messages WHERE conversation_id = ?').all(p.id) as { message_id: string }[]).map((r) => r.message_id);
    for (const id of ids) db.prepare('DELETE FROM chat_attachments WHERE message_id = ?').run(id);
    db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(p.id);
    db.prepare("UPDATE conversations SET deleted_at = ?, title = 'Deleted conversation', updated_at = ? WHERE conversation_id = ?").run(p.now, p.now, p.id);
    return ids.length;
  })();
}
