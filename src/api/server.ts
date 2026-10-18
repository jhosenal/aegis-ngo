import { withSwitches } from '../services/apiSwitches.js';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AegisConfig } from '../config/config.js';
import type { Clock } from '../engine/clock.js';
import type { IdGen } from '../engine/ids.js';
import { authenticateRequest } from './auth.js';
import { registerErrorHandlers } from './errors.js';
import { registerCardRoutes } from './routes/cards.js';
import { registerEvidenceRoute } from './routes/evidence.js';
import { registerHazardHistoryRoute } from './routes/hazardHistory.js';
import { registerHazardSummaryRoute } from './routes/hazardSummary.js';
import { registerEnvironmentRoute } from './routes/environment.js';
import { registerMapLocateRoute } from './routes/mapLocate.js';
import { registerBroadcastRoutes } from './routes/broadcast.js';
import { registerCreditsRoutes } from './routes/credits.js';
import { registerPlacesLookupRoute, registerStreetViewRoute } from './routes/streetview.js';
import { registerAdminPinRoutes } from './routes/adminPins.js';
import { registerPsiRoute } from './routes/psi.js';
import { EnvStore } from '../services/envStore.js';
import type { EnvOnDemand } from '../services/envOnDemand.js';
import { loadPinRegistry } from '../sources/pinRegistry.js';
import { PinCatalog } from '../services/pinCatalog.js';
import { createNearbyFinder, type NearbyFinder } from '../services/nearbyServices.js';
import { registerHealthRoute } from './routes/health.js';
import { registerIncidentRoute } from './routes/incidents.js';
import { registerMeRoute } from './routes/me.js';
import { registerPinRoutes } from './routes/pins.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerGoogleLoginRoutes } from './routes/googleLogin.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerJobsRoutes } from './routes/jobs.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerBudgetRoute } from './routes/budget.js';
import { registerChatRoute } from './routes/chat.js';
import { registerResourceAssessment } from '../services/workflows/resourceAssessment.js';
import type { ModelGateway } from '../providers/gateway.js';
import { registerModesRoute } from './routes/modes.js';
import { registerAssistRoutes } from './routes/assist.js';
import { registerStaticUi } from './staticUi.js';
import { registerHelperRoute } from './routes/helper.js';
import { registerConversationRoutes } from './routes/conversations.js';

type Db = import('better-sqlite3').Database;
let resourceAssessmentRegistered = false;

export interface AppDeps {
  /** Holder of the latest Google environment readings (memory only). Optional: without it the route answers with the refresh switched off. */
  envStore?: EnvStore;
  /** Click-to-fetch for one place (AEG-ENV-003). Absent unless AEGIS_ENV_ON_DEMAND=true and both Google service keys exist. */
  envOnDemand?: EnvOnDemand;
  /** Voice for approved bulletins (Google Cloud Text-to-Speech). Absent unless AEGIS_TTS_ENABLED=true; tests pass a fake. Without it the voice step is the browser-voice stub. */
  tts?: import('../services/voice.js').Synthesizer;
  /** Google Cloud Translation, the fast first pass for emergency translations (optional). */
  translator?: import('../services/translateGoogle.js').MachineTranslator;
  /** Google's real bill from the Cloud Billing export in BigQuery (optional, read-only). */
  billing?: import('../services/billingExport.js').BillingSource;
  /** Gemini 4 Argon on Vertex AI for the script review helper (optional). */
  reviewer?: import('../services/vertexGemini.js').VertexClient;
  /** The editable list of monitored pins (AEG-DATA-001). Built from the fixture registry and the database when absent. */
  pinCatalog?: PinCatalog;
  /** Nearest essential services (OpenStreetMap). A real one is built when absent; tests pass a fake. */
  nearby?: NearbyFinder;
  /** Admin-triggered Google refresh of the given pins (a billed call through the quota gate). Absent when the Google service keys are not set. */
  googleRefresh?: (pins: import('../sources/pinRegistry.js').EnvPin[]) => Promise<{ readings: number; failures: number; skipped: number }>;
  db: Db;
  clock: Clock;
  ids: IdGen;
  config: AegisConfig;
  gateway?: ModelGateway | null;
  hooks?: { afterCommit?: () => void };
  /** Test seam: where Assist card files are read from. */
  assistContentDir?: string;
  /** Test seam: the release record that holds or approves the public Assist content. */
  assistReleaseFile?: string;
  assistEndorsementsFile?: string;
  /** Test seam: replaces fetch for the Google token exchange. */
  fetchImpl?: typeof fetch;
  /** Test seam: the terms file. */
  termsFile?: string;
}

export function createApp(rawDeps: AppDeps): FastifyInstance {
  // A service an administrator has switched off reads as absent for every route (see services/apiSwitches.ts).
  const deps = withSwitches(rawDeps);
  const app = Fastify({ logger: { level: 'error' } });
  registerErrorHandlers(app);
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Content-Security-Policy', request.url.startsWith('/api/') ? "default-src 'self'; style-src 'self' 'unsafe-inline'" : [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Wikimedia hosts serve the place photos (AEG-MEDIA-001); a photo that fails to load falls back to the icon, but it must not be blocked by our own policy.
      "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com https://upload.wikimedia.org https://thumb.wikimedia.org",
      "connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com data: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      "frame-src 'self' https://*.google.com",
      "worker-src 'self' blob:",
    ].join('; '));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', request.url.startsWith('/api/') ? 'no-referrer' : 'strict-origin-when-cross-origin');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.addHook('preHandler', async (request) => authenticateRequest(request, deps));

  registerHealthRoute(app, deps.config);
  registerSessionRoutes(app, deps);
  registerGoogleLoginRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerJobsRoutes(app, deps);
  registerMeRoute(app);
  registerCardRoutes(app, deps.db, deps.clock);
  registerEvidenceRoute(app, deps.db, deps.clock);
  registerIncidentRoute(app, deps.db);
  registerHazardSummaryRoute(app, deps.db, deps.clock);
  const pinCatalog = deps.pinCatalog ?? new PinCatalog(deps.db, loadPinRegistry());
  registerEnvironmentRoute(app, () => pinCatalog.registry(), deps.envStore ?? new EnvStore(), deps.clock, deps.envOnDemand ?? null, deps.db);
  registerMapLocateRoute(app, deps.db, pinCatalog);
  registerAdminPinRoutes(app, deps, pinCatalog);
  registerBroadcastRoutes(app, deps.db, deps.clock);
  registerCreditsRoutes(app, deps);
  registerStreetViewRoute(app, deps.clock);
  registerPlacesLookupRoute(app, deps.clock);
  registerPsiRoute(app, deps.db, deps.clock);
  registerHazardHistoryRoute(app);
  registerPinRoutes(app, deps.db, deps.clock);
  if (!resourceAssessmentRegistered) {
    registerResourceAssessment();
    resourceAssessmentRegistered = true;
  }
  registerWorkflowRoutes(app, deps);
  registerAuditRoutes(app, deps);
  registerBudgetRoute(app, deps.db, deps.config);
  registerChatRoute(app, deps);
  // The helper may find hospitals, pharmacies and so on near a named pin or the map view (OpenStreetMap, free); tests pass a fake finder.
  registerConversationRoutes(app, deps);
  registerHelperRoute(app, { ...deps, nearby: deps.nearby ?? createNearbyFinder({ clock: deps.clock, db: deps.db }), namedPlaces: () => pinCatalog.pins().map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })) } as AppDeps);
  registerModesRoute(app, deps);
  registerAssistRoutes(app, deps.config, Date.now, deps.assistContentDir, deps.assistReleaseFile, deps.assistEndorsementsFile);
  registerStaticUi(app);

  return app;
}
