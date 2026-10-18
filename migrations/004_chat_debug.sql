-- Operational metadata only. Conversation text remains in chat_messages.
CREATE TABLE chat_debug_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  phase TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  details_json TEXT NOT NULL
);
CREATE INDEX chat_debug_tenant_trace ON chat_debug_events(tenant_id, trace_id, event_id);
CREATE INDEX chat_debug_time ON chat_debug_events(occurred_at);
