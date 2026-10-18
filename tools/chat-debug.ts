// Read-only operational diagnostics. Never invokes a model or changes the database.
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/config.js';
import { projectRoot } from '../src/data/db.js';

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const tenant = option('--tenant'); const traceId = option('--trace');
const limit = Number(option('--limit') ?? '5');
if (!tenant || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Usage: --tenant TENANT-ID [--limit 1..100] [--trace TRACE-ID] [--include-content]');
if (args.includes('--include-content') && !traceId) throw new Error('--include-content requires one explicit --trace');
const config = loadConfig(process.env);
const db = new Database(resolve(projectRoot(), config.dbPath), { readonly: true });
try {
  const traces = traceId ? [{ trace_id: traceId }] : db.prepare('SELECT trace_id FROM chat_debug_events WHERE tenant_id=? GROUP BY trace_id ORDER BY MAX(event_id) DESC LIMIT ?').all(tenant, limit) as { trace_id: string }[];
  const result = traces.map(({ trace_id }) => {
    const rows = db.prepare('SELECT phase,occurred_at,elapsed_ms,details_json FROM chat_debug_events WHERE tenant_id=? AND trace_id=? ORDER BY event_id').all(tenant, trace_id) as { phase: string; occurred_at: string; elapsed_ms: number; details_json: string }[];
    const events = rows.map(({ details_json, ...row }) => ({ ...row, details: JSON.parse(details_json) as Record<string, unknown> }));
    const taskIds = [...new Set(events.flatMap((event) => typeof event.details.taskId === 'string' ? [event.details.taskId] : []))];
    const modelAttempts = taskIds.flatMap((taskId) => db.prepare('SELECT attempt_id,provider,requested_model,reported_model,outcome,started_at,ended_at,validation_result,usage_json,cost_basis FROM model_calls WHERE task_id=? ORDER BY rowid LIMIT 8').all(taskId));
    const messageIds = [...new Set(events.flatMap((event) => [event.details.messageId, event.details.assistantMessageId].filter((id): id is string => typeof id === 'string')))];
    const messages = args.includes('--include-content') ? messageIds.flatMap((id) => db.prepare('SELECT message_id,role,text FROM chat_messages WHERE tenant_id=? AND message_id=?').all(tenant, id)) : undefined;
    return { traceId: trace_id, events, modelAttempts, ...(messages ? { messages } : {}) };
  });
  console.log(JSON.stringify({ tenantId: tenant, contentIncluded: args.includes('--include-content'), traces: result }, null, 2));
} finally { db.close(); }
