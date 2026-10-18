import { ensureConversation, touchConversation } from '../data/repos/conversations.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ChatBody } from '../types/api-schemas.js';
import type { ChatBlock, ChatReply, Principal } from '../types/domain.js';
import type { ChatDeps } from './chatService.js';
import { resolveAttachments } from '../services/cardService.js';
import { INTERNAL_TOOLS, cardContext, internalMcp } from '../mcp/internal.js';
import { planFor } from '../roles/modes.js';
import { appendEvent } from '../audit/chainStore.js';
import { hashWithDomain } from '../engine/canonical.js';
import { AegisError } from '../engine/errors.js';
import type { ChatTrace } from './debug.js';
import { buildHelperSystemPrompt, loadHelperFormulation } from './helperFormulation.js';
import type { NearbyArgs } from '../services/nearbyServices.js';
import { looksLikeInjection } from './helperGuards.js';
import { SEATS } from '../roles/seats.js';

/** What the workspace tools returned, as plain text: used when the model cannot write the answer, so the person still gets the facts the code read. */
function calculatedResult(toolData: unknown[]): string | null {
  for (const entry of toolData) {
    const { tool, data } = entry as { tool?: string; data?: { cards?: { title?: unknown; state?: unknown; synthetic?: unknown }[]; returned?: number; hasMore?: boolean } };
    if ((tool === 'aegis_list_incidents' || tool === 'aegis_list_resources') && Array.isArray(data?.cards) && data.cards.length > 0) {
      const what = tool === 'aegis_list_incidents' ? 'Incident cards in this workspace' : 'Resource cards in this workspace';
      const items = data.cards.map((card) => `${String(card.title ?? 'Untitled').replace(/[<>]/g, '').slice(0, 90)}${card.synthetic === true ? ' (synthetic example)' : ''}`);
      return `${what} (${data.returned ?? data.cards.length}${data.hasMore ? ', more exist' : ''}): ${items.join('; ')}.`;
    }
  }
  return null;
}

export const HelperBody = ChatBody.extend({ conversationId: z.string().uuid().optional() });
// Lenient on extra keys (a model may add a field such as "reason"); strict on what matters: scope, a short message, and a named tool call or null.
const Answer = z.object({ scope: z.enum(['in', 'out']).optional(), message: z.string().max(2200).default(''), toolCall: z.object({ name: z.string().max(80), arguments: z.record(z.string(), z.unknown()).default({}) }).nullable().default(null) });
// The prompt is built from the formulation AEG.CHAT.HELPER (content/chat/helper.formulation.json, SOP AEG-SOP-006), not written here.

/** signal: aborted when the person cancels or closes the page; it stops the model request, skips every later step and records "Cancelled". */
export async function handleHelper(deps: ChatDeps, principal: Principal, body: z.infer<typeof HelperBody>, trace?: ChatTrace, signal?: AbortSignal): Promise<ChatReply> {
  const tiers = planFor(body.mode, principal, deps.config);
  const attachments = resolveAttachments(deps.db, principal, body.attachments);
  const conversationId = body.conversationId ?? randomUUID();
  const conversation = `helper:${conversationId}`;
  // The thread: created on its first message (title from that text by code), reused afterwards; another owner's thread or a deleted one is refused before anything is stored.
  const thread = ensureConversation(deps.db, { id: conversationId, tenantId: principal.tenantId, userId: principal.userId, firstText: body.text, now: deps.clock.now() });
  if (thread === 'forbidden') throw new AegisError('E_VALIDATION', 'That conversation is not yours.');
  if (thread === 'deleted') throw new AegisError('E_VALIDATION', 'That conversation was deleted. Start a new chat.');
  const taskId = deps.ids.next('HELPER-TASK'); // shared by both model steps and all retries: one request budget
  const messageId = deps.ids.next('MSG');
  const history = deps.db.prepare('SELECT role,text FROM chat_messages WHERE tenant_id=? AND user_id=? AND route_id=? ORDER BY rowid DESC LIMIT 6').all(principal.tenantId, principal.userId, conversation) as { role: string; text: string }[];
  trace?.log('context', { taskId, messageId, conversationId: body.conversationId, historyCount: history.length });
  const saveUser = deps.db.transaction(() => {
    deps.db.prepare('INSERT INTO chat_messages(message_id,tenant_id,user_id,role,text,route_id,created_at,conversation_id) VALUES(?,?,?,?,?,?,?,?)').run(messageId, principal.tenantId, principal.userId, 'user', body.text, conversation, deps.clock.now(), conversationId);
    for (const card of attachments) deps.db.prepare('INSERT INTO chat_attachments(message_id,card_id,revision) VALUES(?,?,?)').run(messageId, card.cardId, card.revision);
  });
  saveUser.immediate();
  const blocks: ChatBlock[] = [];
  let notice: ChatReply['providerNotice'] = !deps.config.modelsEnabled ? 'MODELS_DISABLED' : !deps.gateway ? 'MODELS_UNAVAILABLE' : null;
  let source: ChatReply['route']['source'] = 'clarify';
  let toolUsed: string | null = null;
  const toolData: unknown[] = [];
  const tools = internalMcp(deps.db, principal, { jsonrpc: '2.0', id: taskId, method: 'tools/list' });
  const formulation = loadHelperFormulation();
  const system = buildHelperSystemPrompt(formulation, JSON.stringify('tools' in tools.result ? tools.result.tools : INTERNAL_TOOLS));
  const context = {
    request: body.text,
    // True when the page sent the centre of the map the person is looking at: then "nearest ..." never needs asking where.
    mapCentreKnown: body.view !== undefined,
    // Bound independent fields so truncation never cuts the user request or corrupts JSON.
    history: history.reverse().map((item) => ({ role: item.role, text: item.text.slice(0, 180) })),
    attached: attachments.map((card) => ({ cardId: card.cardId, revision: card.revision, synthetic: card.body.synthetic, summary: card.body.summary.slice(0, 100) })),
  };
  // A request that tries to rewrite or reveal the rules never reaches the model: standard polite refusal, no cost (AEG-SOP-006).
  const injected = !notice && looksLikeInjection(body.text);
  if (injected) { blocks.push({ type: 'text', text: formulation.refusal }); source = 'denied'; }
  if (!notice && !injected && deps.gateway) {
    for (let step = 0; step < 2; step += 1) {
      if (signal?.aborted) { notice = 'CANCELLED'; trace?.log('cancelled', { taskId, modelStep: step + 1 }); break; }
      const user = JSON.stringify({ ...context, toolResults: toolData });
      if (system.length + user.length > SEATS.helper.maxInputChars) { notice = 'MODELS_UNAVAILABLE'; trace?.log('error', { taskId, errorCode: 'HELPER_CONTEXT_LIMIT', inputChars: system.length + user.length }); break; }
      trace?.log('model.start', { taskId, modelStep: step + 1, inputChars: system.length + user.length });
      const result = await deps.gateway.call('helper', { taskId, tenantId: principal.tenantId, system, user,
        responseSchemaId: 'helper-turn-v1', dataClass: 'tenant_private' }, (text) => {
        try { return Answer.safeParse(JSON.parse(text)).success; } catch { return false; }
      }, { primaryModel: tiers[0]?.model, signal });
      notice = result.notice;
      if (result.status === 'CANCELLED') { trace?.log('cancelled', { taskId, modelStep: step + 1, attempts: result.attempts }); break; }
      // The provider's own filter rejected this request (HTTP 400): treat it as out of scope, not as an outage.
      if (result.attempts.some((attempt) => attempt.outcome === 'BAD_REQUEST')) { blocks.push({ type: 'text', text: formulation.refusal }); source = 'model'; notice = null; break; }
      trace?.log('model.result', { taskId, modelStep: step + 1, status: result.status, notice, outputChars: result.text?.length ?? 0, attempts: result.attempts });
      if (result.status !== 'OK' || result.text === null) { notice ??= 'MODELS_UNAVAILABLE'; break; }
      const answer = Answer.parse(JSON.parse(result.text));
      source = 'model';
      if (answer.scope === 'out') {   // outside what the helper may discuss: the standard polite refusal, never the model's own words
        blocks.push({ type: 'text', text: formulation.refusal });
        source = 'model'; toolUsed = null;
        break;
      }
      if (!answer.toolCall) {
        if (answer.message.trim()) blocks.push({ type: 'text', text: answer.message.replace(/[<>]/g, '') });
        else { notice = 'MODELS_UNAVAILABLE'; }
        break;
      }
      if (step === 1) { blocks.push({ type: 'notice', level: 'info', code: 'HELPER_TOOL_LIMIT', text: 'The helper reached its tool limit. Ask a follow-up to inspect another card.' }); break; }
      toolUsed = answer.toolCall.name;
      const debugToolName = INTERNAL_TOOLS.some((tool) => tool.name === toolUsed) ? toolUsed : '[unregistered]';
      trace?.log('tool.start', { taskId, toolName: debugToolName });
      try {
        // The nearby search is the one asynchronous tool (it asks OpenStreetMap), so it is handled here, with the same untrusted-data rules as the others.
        const response = toolUsed === 'aegis_find_nearby'
          ? await nearbyTool(deps, answer.toolCall.arguments, body.view ?? null)
          : internalMcp(deps.db, principal, { jsonrpc: '2.0', id: taskId, method: 'tools/call', params: answer.toolCall }, attachments, deps.clock.now());
        if ('structuredContent' in response.result) {
          const serialized = JSON.stringify(response.result.structuredContent);
          trace?.log('tool.result', { taskId, toolName: debugToolName, resultChars: serialized.length, resultTruncated: serialized.length > 2200 });
          // Stop oversized results rather than leaking/truncating a partial card.
          const data = toolUsed === 'aegis_find_nearby' ? slimNearby(response.result.structuredContent as NearbyShape) : serialized.length <= 2200 ? response.result.structuredContent : { note: 'Result too large. Ask to open a specific card with fewer fields.' };
          toolData.push({ tool: toolUsed, data });
          blocks.push({ type: 'notice', level: 'info', code: 'HELPER_TOOL_READ', text: `Read workspace information: ${toolUsed.replace('aegis_', '').replaceAll('_', ' ')}.` });
          const record = response.result.structuredContent as ReturnType<typeof cardContext>;
          if (record && typeof record.cardId === 'string' && typeof record.revision === 'number') blocks.push({ type: 'cardRef', cardId: record.cardId, revision: record.revision });
          if (toolUsed === 'aegis_find_nearby') {
            const n = response.result.structuredContent as NearbyShape;
            if (n.found && n.places && n.places.length > 0 && n.centre && n.category) blocks.push({ type: 'places', category: n.category, label: n.label ?? n.category, centre: n.centre, centreName: n.centreName ?? '', radiusM: n.radiusM ?? 0, credit: n.credit ?? '', advice: n.advice ?? '', places: n.places });
          }
          const focus = response.result.structuredContent as { found?: boolean; cardId?: string; revision?: number; lat?: number | null; lng?: number | null; hazard?: string; title?: string; alertLevel?: string | null; country?: string | null; eventTime?: string | null; why?: string };
          if (toolUsed === 'aegis_show_on_map' && focus.found === true && typeof focus.cardId === 'string' && typeof focus.revision === 'number' && typeof focus.lat === 'number' && typeof focus.lng === 'number') {
            blocks.push({ type: 'mapFocus', cardId: focus.cardId, revision: focus.revision, lat: focus.lat, lng: focus.lng, hazard: String(focus.hazard ?? ''), title: String(focus.title ?? '').slice(0, 160), alertLevel: focus.alertLevel ?? null, country: focus.country ?? null, eventTime: focus.eventTime ?? null, why: String(focus.why ?? '').slice(0, 200) });
          }
        }
      } catch (error) {
        trace?.log('tool.error', { taskId, toolName: debugToolName, errorCode: error instanceof AegisError ? error.code : 'E_INTERNAL' });
        source = 'denied';
        blocks.push({ type: 'notice', level: 'warning', code: error instanceof AegisError ? error.code : 'E_INTERNAL', text: 'This tool request was not permitted or its record was unavailable.' });
        break;
      }
    }
  }
  // The model could not write the answer but the code already read the facts: show them ("Showing the calculated result only").
  if (notice && notice !== 'MODELS_DISABLED' && notice !== 'CANCELLED' && !blocks.some((block) => block.type === 'text')) {
    const calculated = calculatedResult(toolData);
    if (calculated) blocks.push({ type: 'text', text: calculated });
  }
  if (notice) blocks.push({ type: 'notice', level: notice === 'CANCELLED' ? 'info' : 'warning', code: notice, text: notice === 'MODELS_DISABLED' ? 'The LLM helper is disabled. The card workspace remains available.' : notice === 'BUDGET_EXHAUSTED' ? 'The helper reached its configured spending limit. Your cards remain available.' : notice === 'CANCELLED' ? 'Cancelled. No system action was taken.' : 'The LLM helper could not answer. Please retry; no system action was taken.' });
  const text = blocks.map((block) => block.type === 'text' ? block.text : block.type === 'notice' ? block.text : '').join('\n');
  const assistantMessageId = deps.ids.next('MSG');
  const finish = deps.db.transaction(() => {
    deps.db.prepare('INSERT INTO chat_messages(message_id,tenant_id,user_id,role,text,route_id,created_at,conversation_id,blocks_json) VALUES(?,?,?,?,?,?,?,?,?)').run(assistantMessageId, principal.tenantId, principal.userId, 'assistant', text, conversation, deps.clock.now(), conversationId, JSON.stringify(blocks));
    touchConversation(deps.db, conversationId, deps.clock.now());
    appendEvent(deps.db, { productId: principal.productId, tenantId: principal.tenantId, eventType: 'helper.completed', actorIdentity: principal.userId,
      actorRole: principal.role, occurredAt: deps.clock.now(), workflowId: null, workflowVersion: null, inputSnapshotHash: hashWithDomain('AEG-INPUT-v1', { text: body.text, attached: body.attachments }),
      resultHash: hashWithDomain('AEG-HELPER-v1', { blocks: JSON.parse(JSON.stringify(blocks, (_k, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? String(v) : v))) as unknown }), versions: { helper: '1' }, payloadHash: hashWithDomain('AEG-PAYLOAD-v1', { tool: toolUsed, source, notice }), correlationKey: taskId }, deps.ids);
  });
  finish.immediate();
  trace?.log('completed', { taskId, messageId, assistantMessageId, source, notice, outputChars: text.length, blockTypes: blocks.map((block) => block.type) });
  return { messageId, conversationId, route: { routeId: null, source }, blocks, providerNotice: notice,
    attachedRevisions: attachments.map(({ cardId, revision }) => ({ cardId, revision })), mode: body.mode, escalatedTo: null };
}

type NearbyShape = { found?: boolean; available?: boolean; reason?: string | null; category?: string; label?: string; centre?: { lat: number; lng: number }; centreName?: string; radiusM?: number; credit?: string; advice?: string; places?: { id: string; name: string; lat: number; lng: number; distanceM: number; phone: string | null; website: string | null; address: string | null; osmUrl: string }[] };
/** What the model sees of a nearby result: names, distances and phones only (coordinates and links go to the map, not into the prompt). */
function slimNearby(n: NearbyShape): unknown {
  return { found: n.found, available: n.available, reason: n.reason, category: n.label, near: n.centreName, radiusKm: n.radiusM ? Math.round(n.radiusM / 1000) : undefined, places: (n.places ?? []).slice(0, 5).map((p) => ({ name: p.name, distanceM: p.distanceM, phone: p.phone })), advice: n.advice };
}
async function nearbyTool(deps: ChatDeps, args: Record<string, unknown>, view: { lat: number; lng: number } | null): Promise<{ result: { structuredContent: unknown } }> {
  if (!deps.nearby) return { result: { structuredContent: { found: false, available: false, reason: 'The nearby search is not switched on on this server. In an emergency call your local emergency number.' } } };
  const a: NearbyArgs = { ...(typeof args['category'] === 'string' ? { category: args['category'] } : {}), ...(typeof args['near'] === 'string' ? { near: args['near'] } : {}), ...(typeof args['radiusKm'] === 'number' ? { radiusKm: args['radiusKm'] } : {}) };
  return { result: { structuredContent: await deps.nearby(a, { view, named: deps.namedPlaces?.() ?? [] }) } };
}
