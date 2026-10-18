-- Conversations (AEG-CHAT-003, contract C0021): a thread of the helper chat that its owner can list, search, reopen, rename and delete.
-- Until now the thread key lived only in chat_messages.route_id ("helper:<uuid>"); this table gives each thread a title and a state, and chat_messages gains the thread id and the stored reply blocks
-- (mini cards, places, map focus) so a reopened chat shows what the person saw. Deleting a thread removes its messages and attachment links at once and keeps a tombstone row (no text).
CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX conversations_owner ON conversations(tenant_id, user_id, updated_at, conversation_id);
ALTER TABLE chat_messages ADD COLUMN conversation_id TEXT;
ALTER TABLE chat_messages ADD COLUMN blocks_json TEXT;
CREATE INDEX chat_messages_conversation ON chat_messages(conversation_id);
-- Old helper threads become conversations; the title is the first user message cut to 60 characters.
INSERT INTO conversations (conversation_id, tenant_id, user_id, title, created_at, updated_at, deleted_at)
SELECT substr(m.route_id, 8), m.tenant_id, m.user_id,
  COALESCE((SELECT substr(replace(replace(m2.text, char(10), ' '), char(13), ' '), 1, 60) FROM chat_messages m2 WHERE m2.route_id = m.route_id AND m2.role = 'user' ORDER BY m2.created_at, m2.rowid LIMIT 1), 'Chat'),
  MIN(m.created_at), MAX(m.created_at), NULL
FROM chat_messages m WHERE m.route_id LIKE 'helper:%' GROUP BY m.route_id, m.tenant_id, m.user_id;
UPDATE chat_messages SET conversation_id = substr(route_id, 8) WHERE route_id LIKE 'helper:%';
