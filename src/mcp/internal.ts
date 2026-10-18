import { z } from 'zod';
import { getCardRevision, listCards } from '../data/repos/cards.js';
import { AegisError } from '../engine/errors.js';
import { findIncident } from '../services/mapFocus.js';
import type { CardRevision, Principal } from '../types/domain.js';

type Db = import('better-sqlite3').Database;
const noArgs = z.object({}).strict();
const mapArgs = z.object({ hazard: z.string().min(2).max(24).optional(), country: z.string().min(2).max(30).optional(), rank: z.enum(['worst', 'latest']).optional() }).strict();
const cardArgs = z.object({ cardId: z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/), revision: z.number().int().positive().optional() }).strict();
export const INTERNAL_TOOLS = [
  { name: 'aegis_find_nearby', description: 'Find the nearest essential services: hospital, clinic, pharmacy, police, fire_station, disaster_centre or shelter. near: a named place on the map (optional; default the centre of the map the person is looking at); radiusKm 1 to 20 (optional, default 5). The map then shows them as pins with a list.', inputSchema: { type: 'object', properties: { category: { type: 'string', enum: ['hospital', 'clinic', 'pharmacy', 'police', 'fire_station', 'disaster_centre', 'shelter'] }, near: { type: 'string' }, radiusKm: { type: 'number' } }, required: ['category'], additionalProperties: false } },
  { name: 'aegis_show_on_map', description: 'Find the current incident the person wants to SEE (for example the worst flood, the latest earthquake, a storm in the Philippines). The map then zooms to it and opens its card. hazard: flood, earthquake, storm, wildfire or volcano (optional); country: plain name (optional); rank: worst or latest.', inputSchema: { type: 'object', properties: { hazard: { type: 'string' }, country: { type: 'string' }, rank: { type: 'string', enum: ['worst', 'latest'] } }, additionalProperties: false } },
  { name: 'aegis_list_incidents', description: 'Read incident card summaries in the signed-in workspace.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aegis_list_resources', description: 'Read resource card summaries. Does not imply deployment.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aegis_get_card', description: 'Read one card and its fields, source references, assumptions and warnings. Use an attached revision when provided.', inputSchema: { type: 'object', properties: { cardId: { type: 'string' }, revision: { type: 'integer', minimum: 1 } }, required: ['cardId'], additionalProperties: false } },
].map((tool) => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }));

export function cardContext(card: CardRevision) {
  return { cardId: card.cardId, revision: card.revision, title: card.title, state: card.state,
    synthetic: card.body.synthetic, syntheticLabel: card.body.syntheticLabel,
    summary: card.body.summary.slice(0, 500), fields: card.body.fields.slice(0, 12),
    evidenceIds: card.evidenceIds, assumptions: card.body.assumptions.slice(0, 3),
    warnings: card.body.warnings.slice(0, 3), missing: card.body.missing };
}

/** Internal MCP request adapter. No public transport or write tools are exposed yet. */
export function internalMcp(db: Db, principal: Principal, request: { jsonrpc: '2.0'; id: string; method: 'tools/list' | 'tools/call'; params?: { name: string; arguments?: unknown } }, attached: CardRevision[] = [], nowIso?: string) {
  if (request.method === 'tools/list') return { jsonrpc: '2.0', id: request.id, result: { tools: INTERNAL_TOOLS } };
  const tool = INTERNAL_TOOLS.find((item) => item.name === request.params?.name);
  if (!tool) throw new AegisError('E_ROUTE_DENIED');
  let data: unknown;
  if (tool.name === 'aegis_show_on_map') {
    const parsed = mapArgs.safeParse(request.params?.arguments ?? {});
    if (!parsed.success) throw new AegisError('E_VALIDATION');
    data = findIncident(db, principal, nowIso ?? new Date().toISOString(), parsed.data);
  } else if (tool.name === 'aegis_get_card') {
    const parsed = cardArgs.safeParse(request.params?.arguments ?? {});
    if (!parsed.success) throw new AegisError('E_VALIDATION');
    const pinnedRevision = attached.find((card) => card.cardId === parsed.data.cardId)?.revision;
    if (pinnedRevision !== undefined && parsed.data.revision !== undefined && pinnedRevision !== parsed.data.revision) throw new AegisError('E_VALIDATION');
    const card = getCardRevision(db, principal.tenantId, parsed.data.cardId, pinnedRevision ?? parsed.data.revision);
    if (!card) throw new AegisError('E_NOT_FOUND');
    data = cardContext(card);
  } else {
    if (!noArgs.safeParse(request.params?.arguments ?? {}).success) throw new AegisError('E_VALIDATION');
    const cards = listCards(db, principal.tenantId, tool.name === 'aegis_list_incidents' ? 'incident' : 'resource');
    data = { cards: cards.slice(0, 8).map((item) => {
      const record = getCardRevision(db, principal.tenantId, item.cardId, item.revision);
      return { cardId: item.cardId, revision: item.revision, title: item.title, state: item.state, synthetic: record?.body.synthetic ?? true };
    }), returned: Math.min(cards.length, 8), hasMore: cards.length > 8 };
  }
  return { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false } };
}
