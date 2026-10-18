import type { ChatDeps } from './chatService.js';
import type { Principal } from '../types/domain.js';

/** Explicit metadata schema: no prompts, replies, credentials or raw tool payloads. */
export interface ChatDebugDetails {
  requestId?: string; taskId?: string; messageId?: string; assistantMessageId?: string;
  conversationId?: string; mode?: string; source?: string; routeId?: string | null;
  inputChars?: number; outputChars?: number; attachmentCount?: number; historyCount?: number;
  inputHash?: string; modelStep?: number; status?: string; notice?: string | null;
  toolName?: string; resultChars?: number; resultTruncated?: boolean; errorCode?: string;
  blockTypes?: string[];
  attempts?: { attemptId: string; provider: string; outcome: string; costBasis: string }[];
}
export type ChatDebugPhase = 'request' | 'context' | 'model.start' | 'model.result' | 'tool.start' | 'tool.result' | 'tool.error' | 'cancelled' | 'completed' | 'error';
export interface ChatTrace { id: string; log: (phase: ChatDebugPhase, details: ChatDebugDetails) => void }

export function createChatTrace(deps: Pick<ChatDeps, 'db' | 'clock' | 'ids'>, principal: Principal, endpoint: 'helper' | 'chat'): ChatTrace {
  const id = deps.ids.next('TRACE'); const started = performance.now();
  return { id, log: (phase, details) => {
    // Telemetry must never break a successful reply or replay a model/tool call.
    try {
      deps.db.prepare('INSERT INTO chat_debug_events(trace_id,tenant_id,user_id,endpoint,phase,occurred_at,elapsed_ms,details_json) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, principal.tenantId, principal.userId, endpoint, phase, deps.clock.now(), Math.max(0, Math.round(performance.now() - started)), JSON.stringify(details));
    } catch { console.error('Chat debug metadata could not be recorded', { traceId: id, phase }); }
  } };
}
