import { appendEvent, verifyStored } from '../audit/chainStore.js';
import { hashWithDomain } from '../engine/canonical.js';
import { AegisError } from '../engine/errors.js';
import type { Clock } from '../engine/clock.js';
import type { IdGen } from '../engine/ids.js';
import { getCardRevision, listCards } from '../data/repos/cards.js';
import { listVisibleEvidence } from '../data/repos/evidence.js';
import { resolveAttachments } from '../services/cardService.js';
import { toEvidenceViews } from '../sources/evidenceView.js';
import { runWorkflow } from '../services/workflowEngine.js';
import { canUseOperationalTools } from '../roles/access.js';
import { decisionHashOf } from '../services/workflows/resourceAssessment.js';
import { RunAssessmentBody, type ChatBodyT, type RunAssessmentBodyT } from '../types/api-schemas.js';
import type { ChatBlock, ChatReply, GatewayOutcome, Principal } from '../types/domain.js';
import type { ModelGateway } from '../providers/gateway.js';
import type { AegisConfig } from '../config/config.js';
import { getRoute } from '../registry/routes.js';
import { parseLocalCommand } from './router.js';
import { askSpecialist } from '../roles/manager.js';
import { planFor, type Tier } from '../roles/modes.js';
import { proposeWithLadder } from './ladder.js';
import { explainTextIsSafe } from '../roles/validate.js';

type Db = import('better-sqlite3').Database;

export interface ChatDeps {
  db: Db;
  clock: Clock;
  ids: IdGen;
  config: AegisConfig;
  gateway?: ModelGateway | null;
  /** Finds essential services near a point (hospital, pharmacy, police ...). Optional: without it the tool answers that the search is not available. */
  nearby?: import('../services/nearbyServices.js').NearbyFinder;
  /** Named pins the person may refer to ("near Orchard Road"). */
  namedPlaces?: () => { name: string; lat: number; lng: number }[];
}

interface RouteResult {
  blocks: ChatBlock[];
  outcomeCode: string;
  providerNotice: ChatReply['providerNotice'];
}

function cleanText(value: string): string {
  return value.replace(/[<>]/g, '');
}

function textBlock(text: string): ChatBlock {
  return { type: 'text', text: cleanText(text) };
}

function noticeBlock(code: string, text: string, level: 'info' | 'warning' | 'error' = 'warning'): ChatBlock {
  return { type: 'notice', level, code, text: cleanText(text) };
}

function helpText(): string {
  return [
    'Known commands:',
    'help',
    'list incidents',
    'open <cardId>',
    'assess <incidentCardId> unit <unitId> region <regionId> demand <N|unknown> [available <N|unknown>] [reserve <N|unknown>]',
    'verify audit',
    'explain <cardId>',
  ].join('\n');
}

function saveUserMessage(deps: ChatDeps, principal: Principal, body: ChatBodyT): string {
  const messageId = deps.ids.next('MSG');
  const insert = deps.db.transaction(() => {
    deps.db.prepare(
      'INSERT INTO chat_messages (message_id, tenant_id, user_id, role, text, route_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    ).run(messageId, principal.tenantId, principal.userId, 'user', body.text, deps.clock.now());
  });
  insert.immediate();
  return messageId;
}

function saveAttachments(deps: ChatDeps, messageId: string, cards: ReturnType<typeof resolveAttachments>): void {
  if (cards.length === 0) return;
  const insert = deps.db.transaction(() => {
    const statement = deps.db.prepare('INSERT INTO chat_attachments (message_id, card_id, revision) VALUES (?, ?, ?)');
    for (const card of cards) statement.run(messageId, card.cardId, card.revision);
  });
  insert.immediate();
}

function recordRoute(
  deps: ChatDeps,
  principal: Principal,
  messageId: string,
  routeId: string | null,
  source: ChatReply['route']['source'],
  outcomeCode: string,
): void {
  const tx = deps.db.transaction(() => {
    deps.db.prepare('UPDATE chat_messages SET route_id = ? WHERE message_id = ? AND tenant_id = ?')
      .run(routeId, messageId, principal.tenantId);
    appendEvent(deps.db, {
      productId: principal.productId,
      tenantId: principal.tenantId,
      eventType: 'chat.routed',
      actorIdentity: principal.userId,
      actorRole: principal.role,
      occurredAt: deps.clock.now(),
      workflowId: null,
      workflowVersion: null,
      inputSnapshotHash: null,
      resultHash: null,
      versions: {},
      payloadHash: hashWithDomain('AEG-PAYLOAD-v1', { routeId, source, outcomeCode }),
      correlationKey: messageId,
    }, deps.ids);
  });
  tx.immediate();
}

function reply(
  messageId: string,
  routeId: string | null,
  source: ChatReply['route']['source'],
  blocks: ChatBlock[],
  providerNotice: ChatReply['providerNotice'],
  attachedRevisions: ChatReply['attachedRevisions'],
  mode: ChatReply['mode'],
  escalatedTo: ChatReply['escalatedTo'],
): ChatReply {
  return { messageId, route: { routeId, source }, blocks, providerNotice, attachedRevisions, mode, escalatedTo };
}

function denied(code: string): RouteResult {
  return { blocks: [noticeBlock(code, 'This request could not be completed.', 'error')], outcomeCode: code, providerNotice: null };
}

function clarification(notice: ChatReply['providerNotice']): RouteResult {
  const blocks: ChatBlock[] = [textBlock(helpText())];
  if (notice) blocks.push(noticeBlock(notice, 'Use a known command or try again later.'));
  return { blocks, outcomeCode: notice ?? 'CLARIFICATION_REQUIRED', providerNotice: notice };
}

function cardReference(cardId: string, revision: number): ChatBlock {
  return { type: 'cardRef', cardId, revision };
}

function routeArgs(deps: ChatDeps, body: ChatBodyT, args: Record<string, unknown>, principal: Principal, attachments: ReturnType<typeof resolveAttachments>): RunAssessmentBodyT {
  const incidentCardId = args.incidentCardId;
  if (typeof incidentCardId !== 'string') throw new AegisError('E_VALIDATION');
  const attached = attachments.find((card) => card.cardId === incidentCardId);
  const latest = attached ?? getCardRevision(deps.db, principal.tenantId, incidentCardId);
  if (!latest || latest.kind !== 'incident') throw new AegisError('E_NOT_FOUND');
  const incidentRevision = attached?.revision ?? (typeof args.incidentRevision === 'number' ? args.incidentRevision : latest.revision);
  const parsed = RunAssessmentBody.parse({
    incidentCardId,
    incidentRevision,
    regionId: args.regionId,
    unitId: args.unitId,
    ...(typeof args.asOf === 'string' ? { asOf: args.asOf } : {}),
    ...(typeof args.demandUnits === 'number' || args.demandUnits === null ? { demandUnits: args.demandUnits } : {}),
    ...(typeof args.availableUnits === 'number' || args.availableUnits === null ? { availableUnits: args.availableUnits } : {}),
    ...(typeof args.reserveUnits === 'number' || args.reserveUnits === null ? { reserveUnits: args.reserveUnits } : {}),
    idempotencyKey: body.idempotencyKey,
  });
  return parsed;
}

function renderCardExplanation(deps: ChatDeps, principal: Principal, cardId: string, revision?: number): { cardText: string; card: NonNullable<ReturnType<typeof getCardRevision>> } {
  const card = getCardRevision(deps.db, principal.tenantId, cardId, revision);
  if (!card) throw new AegisError('E_NOT_FOUND');
  const evidence = toEvidenceViews(listVisibleEvidence(deps.db, principal.tenantId), card.evidenceIds, deps.clock.now());
  const lines = [
    `Card ${card.cardId} revision ${card.revision}`,
    `Status: ${card.state}`,
    `Summary: ${card.body.summary}`,
    ...card.body.fields.map((field) => `${field.label}: ${String(field.value ?? 'unknown')}${field.unit ? ` ${field.unit}` : ''}`),
    ...card.body.warnings.map((warning) => `Warning: ${warning.message}`),
    ...card.body.assumptions.map((assumption) => `Assumption: ${assumption}`),
    ...evidence.map((item) => `Evidence ${item.evidenceId} flags: ${item.flags.join(', ') || 'none'}`),
  ];
  return { cardText: lines.map(cleanText).join('\n'), card };
}

async function executeRoute(
  deps: ChatDeps,
  principal: Principal,
  body: ChatBodyT,
  messageId: string,
  routeId: string,
  args: Record<string, unknown>,
  attachments: ReturnType<typeof resolveAttachments>,
): Promise<RouteResult> {
  let route;
  try { route = getRoute(routeId); }
  catch { return denied('E_ROUTE_DENIED'); }
  if (!route.allowedRoles.includes(principal.role)) return denied('E_FORBIDDEN_ROLE');
  try {
    switch (routeId) {
      case 'I_aegis_help_show':
        return { blocks: [textBlock(helpText())], outcomeCode: 'OK', providerNotice: null };
      case 'I_aegis_incident_list': {
        const incidents = listCards(deps.db, principal.tenantId, 'incident');
        const rows = incidents.map((card) => [card.cardId, cleanText(card.title), card.state]);
        return {
          blocks: [{ type: 'table', columns: ['Card', 'Incident', 'Status'], rows }],
          outcomeCode: 'OK', providerNotice: null,
        };
      }
      case 'I_aegis_card_open': {
        if (typeof args.cardId !== 'string') return denied('E_VALIDATION');
        const attached = attachments.find((card) => card.cardId === args.cardId && (args.revision === undefined || card.revision === args.revision));
        const card = attached ?? getCardRevision(deps.db, principal.tenantId, args.cardId,
          typeof args.revision === 'number' ? args.revision : undefined);
        if (!card) return denied('E_NOT_FOUND');
        return { blocks: [cardReference(card.cardId, card.revision), textBlock(`${card.title}: ${card.body.summary}`)], outcomeCode: 'OK', providerNotice: null };
      }
      case 'I_aegis_resource_assess': {
        if (!canUseOperationalTools(principal)) return denied('E_FORBIDDEN_ROLE');
        const input = routeArgs(deps, body, args, principal, attachments);
        const run = runWorkflow({ db: deps.db, clock: deps.clock, ids: deps.ids, principal }, 'AEG.W.RESOURCE-ASSESSMENT', input, { idempotencyKey: input.idempotencyKey });
        if (run.state === 'failed') return denied(run.errorCode ?? 'E_INTERNAL');
        if (!run.resultCardId || run.resultRevision === null) return { blocks: [textBlock('The assessment needs more information.')], outcomeCode: 'AWAITING_INPUT', providerNotice: null };
        const card = getCardRevision(deps.db, principal.tenantId, run.resultCardId, run.resultRevision);
        if (!card) return denied('E_INTERNAL');
        return {
          blocks: [cardReference(card.cardId, card.revision), textBlock(`${card.body.summary}\nDecision hash: ${decisionHashOf(card.body)}`)],
          outcomeCode: run.state === 'awaiting-input' ? 'AWAITING_INPUT' : 'OK', providerNotice: null,
        };
      }
      case 'I_aegis_audit_verify': {
        const result = verifyStored(deps.db, { productId: principal.productId, tenantId: principal.tenantId });
        return { blocks: [textBlock(result.ok ? 'Audit chain is valid.' : 'Audit chain verification found errors.')], outcomeCode: result.ok ? 'OK' : 'AUDIT_INVALID', providerNotice: null };
      }
      case 'I_aegis_card_explain': {
        if (typeof args.cardId !== 'string') return denied('E_VALIDATION');
        const attached = attachments.find((card) => card.cardId === args.cardId && (args.revision === undefined || card.revision === args.revision));
        const explained = renderCardExplanation(deps, principal, args.cardId,
          attached?.revision ?? (typeof args.revision === 'number' ? args.revision : undefined));
        const blocks: ChatBlock[] = [cardReference(explained.card.cardId, explained.card.revision), textBlock(explained.cardText)];
        if (deps.config.modelsEnabled && attached && deps.gateway) {
          // Try each tier of the user's mode; step up only when the summary fails the safety check and the cause is not budget or refusal.
          const tiers = planFor(body.mode, principal, deps.config);
          let outcome: GatewayOutcome | null = null;
          let accepted = false;
          for (const [index, tier] of tiers.entries()) {
            outcome = await askSpecialist(deps.gateway, principal, deps.ids.next('CHAT-TASK'), explained.cardText, tier.model);
            if (outcome.status === 'OK' && outcome.text !== null && explainTextIsSafe(outcome.text, explained.cardText)) {
              blocks.push(textBlock(`Model-written summary: ${outcome.text}`));
              accepted = true;
              break;
            }
            if (outcome.notice === 'BUDGET_EXHAUSTED' || outcome.notice === 'REFUSED' || index === tiers.length - 1) break;
          }
          if (!accepted) blocks.push(noticeBlock(outcome?.notice ?? 'MODELS_UNAVAILABLE', 'The optional model summary was not used.'));
          return { blocks, outcomeCode: 'OK', providerNotice: outcome?.notice ?? null };
        }
        return { blocks, outcomeCode: 'OK', providerNotice: null };
      }
      default:
        return denied('E_ROUTE_DENIED');
    }
  } catch (error: unknown) {
    if (error instanceof AegisError) return denied(error.code);
    throw error;
  }
}

export async function handleChat(deps: ChatDeps, principal: Principal, body: ChatBodyT): Promise<ChatReply> {
  const messageId = saveUserMessage(deps, principal, body);
  let attachments: ReturnType<typeof resolveAttachments> = [];
  let routeId: string | null = null;
  let source: ChatReply['route']['source'] = 'clarify';
  let outcome: RouteResult;
  let escalatedTo: ChatReply['escalatedTo'] = null;
  let tiers: Tier[] = [];
  try {
    tiers = planFor(body.mode, principal, deps.config);
    attachments = resolveAttachments(deps.db, principal, body.attachments);
    saveAttachments(deps, messageId, attachments);
    const local = parseLocalCommand(body.text);
    if (local.routeId !== null) {
      routeId = local.routeId;
      source = 'local';
      outcome = await executeRoute(deps, principal, body, messageId, local.routeId, local.args, attachments);
      if (outcome.outcomeCode.startsWith('E_')) source = 'denied';
    } else if (!deps.config.modelsEnabled) {
      outcome = clarification('MODELS_DISABLED');
    } else if (!deps.gateway) {
      outcome = clarification('MODELS_UNAVAILABLE');
    } else {
      const judged = await proposeWithLadder(deps.gateway, deps.config, principal, deps.ids, body.text, tiers);
      if (judged.tier.label === 'Pro' || judged.tier.label === 'Expert') escalatedTo = judged.tier.label;
      switch (judged.kind) {
        case 'unavailable':
          outcome = clarification(judged.notice);
          break;
        case 'clarify':
          outcome = clarification(null);
          break;
        case 'denied':
          source = 'denied';
          routeId = judged.routeId;
          outcome = denied(judged.code);
          break;
        case 'accept':
          source = 'model';
          routeId = judged.routeId;
          outcome = await executeRoute(deps, principal, body, messageId, judged.routeId, judged.args, attachments);
          if (outcome.outcomeCode.startsWith('E_')) source = 'denied';
          if (judged.notice !== null) outcome = { ...outcome, providerNotice: judged.notice };
          break;
      }
    }
  } catch (error: unknown) {
    const code = error instanceof AegisError ? error.code : 'E_INTERNAL';
    source = 'denied';
    outcome = denied(code);
  }
  recordRoute(deps, principal, messageId, routeId, source, outcome.outcomeCode);
  return reply(messageId, routeId, source, outcome.blocks, outcome.providerNotice, attachments.map(({ cardId, revision }) => ({ cardId, revision })), body.mode, escalatedTo);
}
