import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { listEvidence, listSourceStatuses } from '../../data/repos/evidence.js';
import { countByCategory } from '../../data/repos/essentialPlaces.js';
import type { Clock } from '../../engine/clock.js';
import { buildDataConfidence } from '../../services/dataConfidence.js';
import { buildHazardTrend } from '../../services/hazardTrend.js';
import { buildHazardSummary, loadCatalogue, loadFeatured } from '../../services/hazardSummary.js';
import { toEvidenceViews } from '../../sources/evidenceView.js';

type Db = import('better-sqlite3').Database;

/**
 * GET /public/hazards/summary[?limit=1..50]  (public, read-only, no tenant data).
 * Lives under /public so the authentication hook, which guards /api only, does not apply; it reads public evidence (tenant_scope IS NULL) only.
 */
export function registerHazardSummaryRoute(app: FastifyInstance, db: Db, clock: Clock): void {
  const catalogue = loadCatalogue();
  const featured = loadFeatured();
  app.get('/public/hazards/summary', async (request, reply) => {
    const raw = (request.query as { limit?: unknown }).limit;
    const parsed = typeof raw === 'string' && /^\d{1,3}$/.test(raw) ? Number(raw) : 3;
    const limit = Math.min(50, Math.max(1, parsed));
    const publicEvidence = listEvidence(db).filter((record) => record.tenantScope === null);
    const views = toEvidenceViews(publicEvidence, null, clock.now());
    reply.header('Cache-Control', 'public, max-age=60');
    return buildHazardSummary(views, catalogue, featured, clock.now(), limit);
  });
  /** GET /public/hazards/trend[?days=1..30]: real incidents per UTC day and per domain, and per ASEAN state. Public evidence only. */
  app.get('/public/hazards/trend', async (request, reply) => {
    const raw = (request.query as { days?: unknown }).days;
    const days = typeof raw === 'string' && /^\d{1,3}$/.test(raw) ? Number(raw) : 7;
    const views = toEvidenceViews(listEvidence(db).filter((record) => record.tenantScope === null), null, clock.now());
    reply.header('Cache-Control', 'public, max-age=60');
    return buildHazardTrend(views, clock.now(), days);
  });
  /** GET /public/places/counts: how many essential places (hospitals, clinics, pharmacies, police, fire stations, disaster centres) are stored, by category. OpenStreetMap data. */
  app.get('/public/places/counts', async (_request, reply) => {
    const byCategory = countByCategory(db);
    reply.header('Cache-Control', 'public, max-age=300');
    return { total: Object.values(byCategory).reduce((sum, n) => sum + n, 0), byCategory, source: 'OpenStreetMap contributors (ODbL)', note: 'Locations of essential places, not live capacity or deployments.' };
  });
  /** GET /public/aha-weekly: the AHA Centre weekly figures, transcribed from the published PDFs (content/aha/weekly-update.json). Reported figures only, never computed. */
  const ahaFile = fileURLToPath(new URL('../../../content/aha/weekly-update.json', import.meta.url));
  app.get('/public/aha-weekly', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    // AEGIS_AHA_WEEKLY=false turns the transcribed AHA figures off (the browser test run does, so its specs keep the synthetic demo cards). On by default.
    if (process.env['AEGIS_AHA_WEEKLY'] === 'false') return {};
    return JSON.parse(readFileSync(ahaFile, 'utf8')) as unknown;
  });
  /** GET /public/data-confidence: PROVISIONAL health score of the live feeds for the landing-page tile. Public evidence only. */
  app.get('/public/data-confidence', async (_request, reply) => {
    const views = toEvidenceViews(listEvidence(db).filter((record) => record.tenantScope === null), null, clock.now());
    reply.header('Cache-Control', 'public, max-age=60');
    return buildDataConfidence(views, listSourceStatuses(db), clock.now());
  });
}
