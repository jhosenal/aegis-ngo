import type { FastifyInstance } from 'fastify';
import { AegisError } from '../../engine/errors.js';
import { HistoryQueryError, historyResponse, loadHistory, queryHistory, type HistoryQuery } from '../../services/hazardHistory.js';

/**
 * GET /public/hazards/history?from=&to=&domain=&minRank=&scale=&q=&hasLocation=&limit=   (public, read-only, no tenant data)
 * The whole history is a few hundred cards, so a client may call it once and filter locally; the filters here serve other clients and tests.
 * `fields=1` adds the card-format field list to each card (omitted by default to keep the payload small).
 */
export function registerHazardHistoryRoute(app: FastifyInstance, file?: string): void {
  const doc = loadHistory(file);
  app.get('/public/hazards/history', async (request, reply) => {
    const raw = request.query as Record<string, unknown>;
    const str = (k: string): string | undefined => (typeof raw[k] === 'string' && (raw[k] as string).length > 0 ? (raw[k] as string).slice(0, 120) : undefined);
    const int = (k: string, lo: number, hi: number): number | undefined => {
      const v = str(k);
      if (v === undefined) return undefined;
      if (!/^\d{1,4}$/.test(v) || Number(v) < lo || Number(v) > hi) throw new AegisError('E_VALIDATION', `${k} must be an integer from ${lo} to ${hi}`);
      return Number(v);
    };
    const q: HistoryQuery = {};
    const from = str('from'); if (from) q.from = from;
    const to = str('to'); if (to) q.to = to;
    const domain = int('domain', 1, 7); if (domain !== undefined) q.domain = domain;
    const minRank = int('minRank', 0, 3); if (minRank !== undefined) q.minRank = minRank;
    const scale = str('scale'); if (scale) q.scale = scale;
    const text = str('q'); if (text) q.q = text;
    const hasLocation = str('hasLocation');
    if (hasLocation !== undefined) {
      if (hasLocation !== 'true' && hasLocation !== 'false') throw new AegisError('E_VALIDATION', 'hasLocation must be true or false');
      q.hasLocation = hasLocation === 'true';
    }
    const limit = int('limit', 1, 1000); if (limit !== undefined) q.limit = limit;
    const includeFields = str('fields') === '1';
    try {
      const cards = queryHistory(doc, q);
      reply.header('Cache-Control', 'public, max-age=300');
      return historyResponse(doc, cards, q, includeFields);
    } catch (error) {
      if (error instanceof HistoryQueryError) throw new AegisError('E_VALIDATION', error.message);
      throw error;
    }
  });
}
