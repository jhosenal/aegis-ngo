import { resolve } from 'node:path';
import { loadConfig } from '../config/config.js';
import { openDb, projectRoot } from '../data/db.js';
import { migrate } from '../data/migrate.js';
import { hasAnyTenants } from '../data/repos/apiAuth.js';
import { RandomIdGen } from '../engine/ids.js';
import { FixedClock, SystemClock } from '../engine/clock.js';
import { seedAll, fixedNowFromFixture } from '../services/seed.js';
import { BudgetLedger } from '../providers/budget-ledger.js';
import { StubProvider } from '../providers/stubs.js';
import type { ModelProvider } from '../types/domain.js';
import { GoogleProvider } from '../providers/google.js';
import { ReapiProvider } from '../providers/reapi.js';
import { RequestPacer } from '../providers/pacer.js';
import { ModelGateway } from '../providers/gateway.js';
import { bindingForRole } from '../roles/manager.js';
import { runLiveIngest } from '../services/liveIngest.js';
import { EnvQuotaGate, ownerEnvQuotaConfig } from '../costs/envQuota.js';
import { loadPriceBook } from '../costs/pricebook.js';
import { generateLatestBulletin } from '../services/broadcast/generate.js';
import { latestAir, latestCapture, loadSchedule, msUntilLocalTime, nextAir } from '../services/broadcast/schedule.js';
import { findBulletin } from '../data/repos/broadcast.js';
import { runPsiIngest } from '../services/psiIngest.js';
import { runOpenMeteoScan } from '../services/openMeteoIngest.js';
import { runOpenAqScan } from '../services/openAqIngest.js';
import { runMetMyIngest } from '../services/metMyIngest.js';
import { runEnvRefresh } from '../services/envRefresh.js';
import { EnvStore } from '../services/envStore.js';
import { EnvOnDemand } from '../services/envOnDemand.js';
import { GoogleEnvClient, googleEnvKeysFromEnv } from '../sources/googleEnv.js';
import { loadPinRegistry } from '../sources/pinRegistry.js';
import { PinCatalog } from '../services/pinCatalog.js';
import type { AppDeps } from './server.js';
import { createApp } from './server.js';
import { loadEssentialSeedIfEmpty } from '../data/essentialSeed.js';
import { ttsFromEnv } from '../services/voice.js';
import { translatorFromEnv } from '../services/translateGoogle.js';
import { billingFromEnv } from '../services/billingExport.js';
import { vertexFromEnv } from '../services/vertexGemini.js';

function buildGateway(db: ReturnType<typeof openDb>, clock: SystemClock, ids: RandomIdGen, config: ReturnType<typeof loadConfig>): ModelGateway | null {
  const ledger = new BudgetLedger(db, {
    accountMicro: config.budget.accountMicro,
    dayMicro: config.budget.dayMicro,
    taskMicro: config.budget.taskMicro,
    providerAccountMicro: { google: config.budget.googleMicro, reapi: config.budget.reapiMicro },
  });
  const live = config.providerMode === 'live';
  // Both providers are built when their keys exist; AEGIS_PRIMARY_PROVIDER decides which one is tried first.
  const google: ModelProvider | null = !live
    ? new StubProvider('stub-google', [{ type: 'error', kind: 'BAD_REQUEST' }])
    : config.google.apiKey
      ? new GoogleProvider({
        apiKey: config.google.apiKey,
        pacer: new RequestPacer({
          minIntervalMs: config.google.minIntervalMs,
          dailyCap: config.google.dailyRequestCap,
          maxWaitMs: Math.min(15_000, config.gateway.totalDeadlineMs),
        }),
      })
      : null;
  const reapi: ModelProvider | null = !live
    ? new StubProvider('stub-reapi', [{ type: 'error', kind: 'BAD_REQUEST' }])
    : config.reapi.apiKey && config.reapi.baseUrl
      ? new ReapiProvider({ apiKey: config.reapi.apiKey, baseUrl: config.reapi.baseUrl, tokenParam: config.reapi.tokenParam })
      : null;
  const primary = config.primaryProvider === 'reapi' ? reapi : google;
  const backup = config.primaryProvider === 'reapi' ? google : reapi;
  if (primary === null) return null;   // config validation already refuses a live run without the primary key
  return new ModelGateway({
    db, clock, ids, config, ledger, primary, backup,
    binding: (role) => bindingForRole(role, config),
    price: live ? {
      id: config.budget.priceSnapshotId,
      capturedAt: config.price.capturedAt,
      inputMicroPerMTok: config.price.inputMicroPerMTok,
      outputMicroPerMTok: config.price.outputMicroPerMTok,
      source: config.price.source,
    } : null,
    sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
    rng: () => 0.5,
    monotonicMs: () => performance.now(),
  });
}

export async function startServer(): Promise<void> {
  const config = loadConfig(process.env);
  const root = projectRoot();
  const dbPath = config.dbPath === ':memory:' ? config.dbPath : resolve(root, config.dbPath);
  const db = openDb(dbPath);
  const clock = new SystemClock();
  const fixturesPath = resolve(root, 'fixtures');

  try {
    migrate(db, resolve(root, 'migrations'), clock.now());
    const seeded = loadEssentialSeedIfEmpty(db, resolve(root, 'content/places/essential-places.seed.json.gz'), clock.now());   // the hosted database starts empty
    if (seeded > 0) console.log(`essential places: loaded ${seeded} from the seed`);
    if (!hasAnyTenants(db)) {
      const seedClock = new FixedClock(fixedNowFromFixture(fixturesPath));
      seedAll(db, fixturesPath, seedClock, new RandomIdGen());
    }

    const ids = new RandomIdGen();
    const envStore = new EnvStore();
    const catalog = new PinCatalog(db, loadPinRegistry());   // the editable list of pins (AEG-DATA-001), shared by the routes and every timer
    // Admin-triggered Google refresh (Admin Desk > Data control): a billed call through the quota gate, never on a timer. Available only when both service keys are set.
    let googleRefresh: AppDeps['googleRefresh'];
    try {
      const book = loadPriceBook();
      const adminClient = new GoogleEnvClient({ apiKeys: googleEnvKeysFromEnv(process.env), gate: new EnvQuotaGate(db, book, ownerEnvQuotaConfig(book)), now: () => clock.now() });
      googleRefresh = async (pins) => { const o = await runEnvRefresh({ registry: { ...catalog.registry(), pins }, client: adminClient, store: envStore, clock }); return { readings: o.readings.length, failures: o.failures.length, skipped: o.skipped }; };
    } catch { /* service keys not set: the admin Google refresh is unavailable */ }
    // Click-to-fetch Google air quality and weather for one place (AEG-ENV-003): opt-in, billed per lookup through the quota gate, with a visitor rate limit and a daily cap.
    let envOnDemand: EnvOnDemand | undefined;
    if (process.env['AEGIS_ENV_ON_DEMAND'] === 'true') {
      try {
        const book = loadPriceBook();
        const client = new GoogleEnvClient({ apiKeys: googleEnvKeysFromEnv(process.env), gate: new EnvQuotaGate(db, book, ownerEnvQuotaConfig(book)), now: () => clock.now(), timeoutMs: 8_000 });
        const dailyMax = Number(process.env['AEGIS_ENV_ON_DEMAND_DAILY_MAX'] ?? 300);
        const perClientPerMinute = Number(process.env['AEGIS_ENV_ON_DEMAND_PER_MINUTE'] ?? 6);
        envOnDemand = new EnvOnDemand({ client, store: envStore, clock, dailyMax: Number.isFinite(dailyMax) && dailyMax > 0 ? dailyMax : 300, perClientPerMinute: Number.isFinite(perClientPerMinute) && perClientPerMinute > 0 ? perClientPerMinute : 6 });
        console.log(`env-on-demand: on (daily cap ${envOnDemand.usage().dailyMax} lookups)`);
      } catch (error: unknown) {
        console.error(`env-on-demand not started: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    const tts = ttsFromEnv(process.env);
    const translator = translatorFromEnv(process.env);
    const billing = billingFromEnv(process.env);
    const reviewer = vertexFromEnv(process.env);
    if (reviewer) console.log(`script review: ${reviewer.model} on Vertex AI (${reviewer.project}, ${reviewer.location})`);
    if (billing) console.log('billing: reading the Cloud Billing export from BigQuery');
    if (translator) console.log('translation: Google Cloud Translation on (first pass)');
    if (tts) console.log(`voice: Google Cloud Text-to-Speech on (${tts.voice})`);
    const app = createApp({ db, clock, ids, config, gateway: buildGateway(db, clock, ids, config), envStore, pinCatalog: catalog, ...(tts ? { tts } : {}), ...(translator ? { translator } : {}), ...(billing ? { billing } : {}), ...(reviewer ? { reviewer } : {}), ...(googleRefresh ? { googleRefresh } : {}), ...(envOnDemand ? { envOnDemand } : {}) });
    const address = await app.listen({ host: config.host, port: config.port });
    console.log(address);
    console.log(`storage=${config.storageMode}`);
    console.log(`models=${config.modelsEnabled}`);
    console.log(`providers=${config.providerMode}`);
    // Broadcast bulletins (AEG-NEWS-004): at each slot's capture time, build the fact sheet and the script from the narratable feeds and store it once.
    // Opt-in (AEGIS_BROADCAST=true). No model call, no cloud call, no spend. A catch-up run after a restart still uses data as at the capture time.
    if (process.env['AEGIS_BROADCAST'] === 'true') {
      const schedule = loadSchedule();
      let working = false;
      const tickBroadcast = async (): Promise<void> => {
        if (working) return;
        working = true;
        try {
          // A bulletin is due: take a fresh NEA PSI reading first so the capture window holds it (the PSI is hourly; the other feeds poll every 15 minutes).
          const due = latestCapture(schedule, clock.now());
          if (!findBulletin(db, due.slot.id, due.captureAt, 'en')) {
            const psi = await runPsiIngest({ db, clock });
            console.log(`psi (before bulletin) ${psi.outcome}${psi.observedAt ? ` observed ${psi.observedAt}` : ''}${psi.detail ? ` ${psi.detail}` : ''}`);
            const my = await runMetMyIngest({ db, clock });
            console.log(`metmy (before bulletin) warnings=${my.warnings.outcome} forecast=${my.forecast.outcome}`);
          }
          const r = generateLatestBulletin({ db, clock, ids, schedule });
          if (!r.ok) console.error(`broadcast: ${r.slotId} ${r.captureAt} NOT published: ${r.problems.join('; ')}`);
          else if (r.created) console.log(`broadcast: ${r.bulletin.slotId} captured ${r.bulletin.captureAt} stored (${r.bulletin.segments.length} segments)`);
        } catch (error: unknown) {
          console.error(`broadcast failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        } finally { working = false; }
      };
      void tickBroadcast();
      setInterval(() => { void tickBroadcast(); }, 60_000).unref();
      console.log('broadcast: checking every minute for a due capture');
    }
    // Google air quality and weather for the monitored pins: opt-in because every call is a billed event (through the quota gate: 160 USD ceiling, 4 runs a day).
    // Needs AEGIS_ENV_REFRESH=true and both service keys. Readings stay in memory for at most one hour. Do not enable a full run without the owner's go-ahead.
    // AEGIS_ENV_REFRESH_ONCE_AT=HH:MM[,HH:MM] (Malaysia time) runs ONE extra refresh at each time given, once,  (a test capture) without switching the four daily runs on.
    const onceAt = process.env['AEGIS_ENV_REFRESH_ONCE_AT'] ?? '';
    if (process.env['AEGIS_ENV_REFRESH'] === 'true' || onceAt !== '') {
      try {
        const registry = catalog.registry();
        const limit = Number(process.env['AEGIS_ENV_REFRESH_MAX_PINS'] ?? registry.pins.length);
        const scoped = { ...registry, pins: registry.pins.slice(0, Number.isInteger(limit) && limit > 0 ? limit : registry.pins.length) };
        const book = loadPriceBook();
        const envClient = new GoogleEnvClient({ apiKeys: googleEnvKeysFromEnv(process.env), gate: new EnvQuotaGate(db, book, ownerEnvQuotaConfig(book)), now: () => clock.now() });
        // Runs at the four daily update times (07:00, 12:00, 17:00, 22:00 Malaysia and Singapore time) from content/broadcast/schedule.json, not on an interval.
        const schedule = loadSchedule();
        let busy = false;
        const run = async (): Promise<void> => {
          if (busy) return;
          busy = true;
          try {
            const r = await runEnvRefresh({ registry: scoped, client: envClient, store: envStore, clock });
            console.log(`env-refresh readings=${r.readings.length} failures=${r.failures.length} skipped=${r.skipped}`);
          } catch (error: unknown) {
            console.error(`env-refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`);
          } finally { busy = false; }
        };
        const arm = (): void => {
          const next = nextAir(schedule, clock.now());
          const wait = Math.max(1000, Date.parse(next.at) - Date.parse(clock.now())) + 1000;   // a second late, so a timer that fires a millisecond early cannot run the same slot twice
          const timer = setTimeout(() => { void run().finally(arm); }, Math.min(wait, 2_147_000_000));
          timer.unref();
          console.log(`env-refresh next at ${next.at} (${next.slot.airLocal} local)`);
        };
        for (const at of onceAt.split(',').map((x) => x.trim()).filter(Boolean)) {
          const wait = msUntilLocalTime(clock.now(), at, schedule.timezone.utcOffsetHours);
          if (wait === null) console.error(`env-refresh: AEGIS_ENV_REFRESH_ONCE_AT must be HH:MM (comma separated for several), got "${at}"`);
          else {
            const t = setTimeout(() => { console.log(`env-refresh: one-off test capture (${at}) starting`); void run(); }, wait);
            t.unref();
            console.log(`env-refresh: one-off test capture at ${at} local (in ${Math.round(wait / 60_000)} min) over ${scoped.pins.length} pins`);
          }
        }
        if (process.env['AEGIS_ENV_REFRESH'] === 'true') {
          // After a restart inside the hour that follows an update time, run once so the values can be shown for the rest of that hour.
          envStore.status.scheduled = true;
          if (Date.parse(clock.now()) - Date.parse(latestAir(schedule, clock.now()).at) < 60 * 60_000) void run();
          arm();
          console.log(`env-refresh at the 4 daily update times over ${scoped.pins.length} pins`);
        }
      } catch (error: unknown) {
        console.error(`env-refresh not started: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    // Live public feeds (USGS, GDACS): opt-in, because a test or demo run must not reach the network. Needs no key and makes no paid call.
    if (process.env['AEGIS_LIVE_FEEDS'] === 'true') {
      const minutes = Math.max(5, Number(process.env['AEGIS_LIVE_FEEDS_MINUTES'] ?? 15) || 15);
      let running = false;
      const tick = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
          const r = await runLiveIngest({ db, ids, clock });
          const psi = await runPsiIngest({ db, clock });
          console.log(`psi ${psi.outcome}${psi.stored ? ' (new reading)' : ''}${psi.observedAt ? ` observed ${psi.observedAt}` : ''}`);
          const my = await runMetMyIngest({ db, clock });
          console.log(`metmy warnings=${my.warnings.outcome}(${my.warnings.count}${my.warnings.stored ? ', changed' : ''}) forecast=${my.forecast.outcome}${my.forecast.rows ? `(${my.forecast.rows} rows${my.forecast.stored ? ', changed' : ''})` : ''}`);
          // Open-Meteo pin scan: at most once every 6 hours (7 days of hourly modelled values for the 125 pins).
          const last = db.prepare('SELECT last_attempt_at FROM source_status WHERE source_id = ?').get('SRC.OPENMETEO.PINS') as { last_attempt_at: string } | undefined;
          if (!last || Date.parse(clock.now()) - Date.parse(last.last_attempt_at) >= 6 * 3_600_000) {
            const om = await runOpenMeteoScan({ db, clock, pins: catalog.pins().map((p) => ({ pinId: p.pinId, lat: p.lat, lng: p.lng })) });
            console.log(`open-meteo pins=${om.pins} rows=${om.rows} ${om.outcome}${om.detail ? ` ${om.detail}` : ''}`);
          }
          // OpenAQ stations (measured PM2.5, community and agency sensors): needs AEGIS_OPENAQ_API_KEY; at most once an hour.
          if (process.env['AEGIS_OPENAQ_API_KEY']) {
            const lastAq = db.prepare('SELECT last_attempt_at FROM source_status WHERE source_id = ?').get('SRC.OPENAQ.STATIONS') as { last_attempt_at: string } | undefined;
            if (!lastAq || Date.parse(clock.now()) - Date.parse(lastAq.last_attempt_at) >= 60 * 60_000) {
              const aq = await runOpenAqScan({ db, clock, apiKey: process.env['AEGIS_OPENAQ_API_KEY'] });
              console.log(`openaq stations=${aq.stations} stored=${aq.stored} ${aq.outcome}${aq.detail ? ` ${aq.detail}` : ''}`);
            }
          }
          console.log(`live-feeds usgs=${r.usgs.outcome}(+${r.usgs.inserted}) gdacs=${r.gdacs.outcome}(+${r.gdacs.inserted}) cards+${r.cardsCreated}`);
        } catch (error: unknown) {
          console.error(`live-feeds failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        } finally {
          running = false;
        }
      };
      void tick();
      const timer = setInterval(() => { void tick(); }, minutes * 60_000);
      timer.unref();
      console.log(`live-feeds every ${minutes} min`);
    }
    // Cloud Run sends SIGTERM before it stops an instance: stop accepting requests, then close the database.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => { void app.close().finally(() => { db.close(); process.exit(0); }); });
    }
  } catch (error: unknown) {
    db.close();
    throw error;
  }
}

void startServer().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'API startup failed');
  process.exitCode = 1;
});
