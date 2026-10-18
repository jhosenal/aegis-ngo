// Admin Desk > Data control (AEG-DATA-001): the list of monitored pins with filters, add, delete and restore, refresh of any data source, demo data, export, history.
// Administrators only. Coordinates and descriptions are edited here; no Google reading is ever written to the database or to an export.
import type { FastifyInstance } from 'fastify';
import { AegisError } from '../../engine/errors.js';
import { openAqKeyFromEnv } from './adminPinsSupport.js';
import { listSourceStatuses } from '../../data/repos/evidence.js';
import { RandomIdGen } from '../../engine/ids.js';
import { runLiveIngest } from '../../services/liveIngest.js';
import { runMetMyIngest } from '../../services/metMyIngest.js';
import { runOpenAqScan } from '../../services/openAqIngest.js';
import { runOpenMeteoScan } from '../../services/openMeteoIngest.js';
import { runPsiIngest } from '../../services/psiIngest.js';
import { EnvStore, pinViews } from '../../services/envStore.js';
import { PinCatalog, type NewPin } from '../../services/pinCatalog.js';
import type { EnvPin } from '../../sources/pinRegistry.js';
import { demoReadings } from '../../services/sampleReadings.js';
import type { EnvReading } from '../../sources/googleEnv.js';
import { principalFrom } from '../auth.js';
import type { AppDeps } from '../server.js';

export const REFRESH_SOURCES = ['usgs-gdacs', 'psi', 'metmy', 'openmeteo', 'openaq', 'google'] as const;
type RefreshSource = typeof REFRESH_SOURCES[number];
const GOOGLE_MIN_GAP_MS = 10 * 60_000;

export { demoReadings };

export function registerAdminPinRoutes(app: FastifyInstance, deps: AppDeps, catalog: PinCatalog): void {
  const store = deps.envStore ?? new EnvStore();
  const admin = (request: Parameters<typeof principalFrom>[0]): string => { const p = principalFrom(request); if (p.isAdmin !== true) throw new AegisError('E_FORBIDDEN_ROLE'); return p.userId; };
  let lastGoogleAt = 0;

  const meteoByPin = (): Map<string, { rows: number; latestHour: string | null }> => {
    const rows = deps.db.prepare('SELECT pin_id, COUNT(*) AS n, MAX(hour_at) AS latest FROM pin_observations GROUP BY pin_id').all() as { pin_id: string; n: number; latest: string | null }[];
    return new Map(rows.map((r) => [r.pin_id, { rows: r.n, latestHour: r.latest }]));
  };

  app.get('/api/admin/pins', async (request, reply) => {
    admin(request);
    reply.header('Cache-Control', 'no-store');
    const q = request.query as Record<string, string | undefined>;
    const now = deps.clock.now();
    const meteo = meteoByPin();
    const views = new Map(pinViews(catalog.pins(), store, now).map((v) => [v.pinId, v]));
    const rows = catalog.all().map((p) => {
      const v = views.get(p.pinId);
      const demo = v ? [v.air, v.weather.current].some((x) => x?.data?.['demo'] === true) : false;
      const m = meteo.get(p.pinId);
      return { pinId: p.pinId, name: p.name, country: p.country, region: p.region, lat: p.lat, lng: p.lng, roles: p.roles, hazards: p.hazards, needs: p.needs, origin: p.origin, removed: p.removed, review: p.review,
        lastUpdatedAt: v?.lastUpdatedAt ?? null, readingState: demo ? 'demo' : v?.readingState ?? 'never', meteoRows: m?.rows ?? 0, meteoLatestHour: m?.latestHour ?? null };
    });
    const text = (q['q'] ?? '').trim().toLowerCase();
    const filtered = rows.filter((p) =>
      (q['removed'] === '1' ? p.removed : !p.removed)
      && (!q['country'] || p.country === q['country'])
      && (!q['region'] || p.region === q['region'])
      && (!q['role'] || (p.roles as string[]).includes(q['role']))
      && (!q['origin'] || p.origin === q['origin'])
      && (!q['status'] || p.readingState === q['status'])
      && (!q['meteo'] || (q['meteo'] === 'with' ? p.meteoRows > 0 : p.meteoRows === 0))
      && (!text || p.name.toLowerCase().includes(text) || p.pinId.toLowerCase().includes(text) || p.region.toLowerCase().includes(text)));
    const active = rows.filter((p) => !p.removed);
    const byRegion = new Map<string, number>();
    for (const p of active) byRegion.set(`${p.country}|${p.region}`, (byRegion.get(`${p.country}|${p.region}`) ?? 0) + 1);
    const limit = Math.min(500, Math.max(1, Number(q['limit'] ?? 200) || 200)); const offset = Math.max(0, Number(q['offset'] ?? 0) || 0);
    return {
      asOf: now, total: filtered.length, pins: filtered.slice(offset, offset + limit),
      summary: {
        active: active.length, removed: rows.length - active.length, added: active.filter((p) => p.origin === 'admin').length,
        byCountry: { SG: active.filter((p) => p.country === 'SG').length, MY: active.filter((p) => p.country === 'MY').length, BN: active.filter((p) => p.country === 'BN').length },
        withLive: active.filter((p) => p.readingState === 'fresh').length, withDemo: active.filter((p) => p.readingState === 'demo').length, withMeteo: active.filter((p) => p.meteoRows > 0).length,
        withoutMeteo: active.filter((p) => p.meteoRows === 0).length,
      },
      filters: { regions: [...byRegion.entries()].map(([k, count]) => { const [country, region] = k.split('|'); return { country, region, count }; }).sort((a, b) => `${a.country}${a.region}`.localeCompare(`${b.country}${b.region}`)) },
      sources: listSourceStatuses(deps.db).filter((s) => /LIVE$|PINS|STATIONS/.test(s.sourceId)),
      capabilities: { google: deps.googleRefresh !== undefined, openaq: openAqKeyFromEnv() !== undefined },
    };
  });

  app.post('/api/admin/pins', async (request) => {
    const by = admin(request);
    const pin = catalog.add((request.body ?? {}) as NewPin, by, deps.clock.now());
    // pull its 7-day modelled history straight away (free); a failure here does not undo the add
    let meteo = 'not run';
    try { const r = await runOpenMeteoScan({ db: deps.db, clock: deps.clock, pins: [{ pinId: pin.pinId, lat: pin.lat, lng: pin.lng }] }); meteo = `${r.outcome}, ${r.rows} rows`; } catch { meteo = 'unavailable'; }
    return { pin, meteo };
  });

  app.delete('/api/admin/pins/:pinId', async (request) => {
    const by = admin(request);
    const { pinId } = request.params as { pinId: string };
    catalog.remove(pinId, by, deps.clock.now());
    return { ok: true };
  });
  app.post('/api/admin/pins/:pinId/restore', async (request) => {
    const by = admin(request);
    catalog.restore((request.params as { pinId: string }).pinId, by, deps.clock.now());
    return { ok: true };
  });

  /** Refresh chosen sources now. Free sources run as asked; Google is a billed call: it needs confirmGoogle, one run per 10 minutes, and goes through the quota gate. */
  const refresh = async (by: string, sources: RefreshSource[], pins: EnvPin[], confirmGoogle: boolean): Promise<{ source: string; outcome: string; detail: string }[]> => {
    const out: { source: string; outcome: string; detail: string }[] = [];
    const at = () => deps.clock.now();
    for (const source of sources) {
      try {
        if (source === 'usgs-gdacs') { const r = await runLiveIngest({ db: deps.db, ids: new RandomIdGen(), clock: deps.clock }); out.push({ source, outcome: `USGS ${r.usgs.outcome}, GDACS ${r.gdacs.outcome}`, detail: `+${r.usgs.inserted} USGS, +${r.gdacs.inserted} GDACS, ${r.cardsCreated} cards` }); }
        else if (source === 'psi') { const r = await runPsiIngest({ db: deps.db, clock: deps.clock }); out.push({ source, outcome: r.outcome, detail: r.observedAt ? `observed ${r.observedAt}${r.stored ? ' (new)' : ''}` : r.detail ?? '' }); }
        else if (source === 'metmy') { const r = await runMetMyIngest({ db: deps.db, clock: deps.clock }); out.push({ source, outcome: `warnings ${r.warnings.outcome}, forecast ${r.forecast.outcome}`, detail: `${r.warnings.count} warnings, ${r.forecast.rows ?? 0} forecast rows` }); }
        else if (source === 'openmeteo') { const r = await runOpenMeteoScan({ db: deps.db, clock: deps.clock, pins: pins.map((p) => ({ pinId: p.pinId, lat: p.lat, lng: p.lng })) }); out.push({ source, outcome: r.outcome, detail: `${r.pins} pins, ${r.rows} hourly rows${r.detail ? `, ${r.detail}` : ''}` }); }
        else if (source === 'openaq') { const r = await runOpenAqScan({ db: deps.db, clock: deps.clock, apiKey: openAqKeyFromEnv() }); out.push({ source, outcome: r.outcome, detail: `${r.stations} stations, ${r.stored} new readings${r.detail ? `, ${r.detail}` : ''}` }); }
        else if (source === 'google') {
          if (!deps.googleRefresh) { out.push({ source, outcome: 'UNAVAILABLE', detail: 'the Google service keys are not set on this server' }); continue; }
          if (!confirmGoogle) { out.push({ source, outcome: 'NOT_RUN', detail: 'a Google refresh needs your explicit confirmation' }); continue; }
          const wait = GOOGLE_MIN_GAP_MS - (Date.now() - lastGoogleAt);
          if (wait > 0) { out.push({ source, outcome: 'NOT_RUN', detail: `one Google refresh per 10 minutes; try again in ${Math.ceil(wait / 60_000)} min` }); continue; }
          if (pins.length > 130) { out.push({ source, outcome: 'NOT_RUN', detail: 'a Google refresh is limited to 130 pins at a time' }); continue; }
          lastGoogleAt = Date.now();
          const r = await deps.googleRefresh(pins);
          out.push({ source, outcome: r.failures === 0 ? 'OK' : 'PARTIAL', detail: `${r.readings} readings, ${r.failures} failures, ${r.skipped} skipped, for ${pins.length} pins (shown for one hour, never saved)` });
        }
      } catch (error) { out.push({ source, outcome: 'FAILED', detail: (error instanceof Error ? error.message : String(error)).slice(0, 160) }); }
    }
    catalog.log('REFRESH', null, by, at(), `${sources.join(', ')} for ${pins.length} pins: ${out.map((o) => `${o.source}=${o.outcome}`).join('; ')}`);
    return out;
  };
  const pickSources = (body: Record<string, unknown>): RefreshSource[] => {
    const wanted = Array.isArray(body['sources']) ? body['sources'].map(String) : [];
    const sources = REFRESH_SOURCES.filter((s) => wanted.includes(s));
    if (sources.length === 0) throw new AegisError('E_VALIDATION', 'Tick at least one source to refresh.');
    return sources;
  };
  const pickPins = (body: Record<string, unknown>): EnvPin[] => {
    const all = catalog.pins();
    if (!Array.isArray(body['pinIds']) || body['pinIds'].length === 0) return all;
    const ids = new Set(body['pinIds'].map(String));
    const chosen = all.filter((p) => ids.has(p.pinId));
    if (chosen.length === 0) throw new AegisError('E_NOT_FOUND');
    return chosen;
  };

  app.post('/api/admin/data/refresh', async (request) => {
    const by = admin(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const pins = pickPins(body);
    return { results: await refresh(by, pickSources(body), pins, body['confirmGoogle'] === true), pins: pins.length };
  });
  app.post('/api/admin/pins/:pinId/refresh', async (request) => {
    const by = admin(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const pin = catalog.pins().find((p) => p.pinId === (request.params as { pinId: string }).pinId);
    if (!pin) throw new AegisError('E_NOT_FOUND');
    return { results: await refresh(by, pickSources(body).filter((s) => s === 'openmeteo' || s === 'google'), [pin], body['confirmGoogle'] === true), pins: 1 };
  });

  app.post('/api/admin/data/dummy', async (request) => {
    const by = admin(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const now = deps.clock.now();
    if (body['action'] === 'clear') { const n = store.clearDemo(); catalog.log('DUMMY_CLEAR', null, by, now, `${n} readings removed`); return { cleared: n }; }
    if (body['action'] !== 'load') throw new AegisError('E_VALIDATION', 'Send action load or clear.');
    const pins = pickPins(body);
    let n = 0;
    for (const pin of pins) for (const reading of demoReadings(pin, now)) { store.putDemo(reading); n += 1; }
    catalog.log('DUMMY_LOAD', null, by, now, `${n} demo readings for ${pins.length} pins`);
    return { loaded: n, pins: pins.length, note: 'Demo data is synthetic, labelled DEMO, kept in memory for one hour and never saved. It is not Google data.' };
  });

  /** Pins and their coordinates only: no reading, no Google content. */
  app.get('/api/admin/pins/export.csv', async (request, reply) => {
    const by = admin(request);
    const esc = (v: unknown): string => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const lines = ['pinId,name,country,region,lat,lng,roles,origin,removed', ...catalog.all().map((p) => [p.pinId, p.name, p.country, p.region, p.lat, p.lng, p.roles.join('|'), p.origin, p.removed].map(esc).join(','))];
    catalog.log('EXPORT', null, by, deps.clock.now(), `${lines.length - 1} pins`);
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="aegis-pins.csv"');
    return `${lines.join('\n')}\n`;
  });

  app.get('/api/admin/pins/history', async (request, reply) => { admin(request); reply.header('Cache-Control', 'no-store'); return { history: catalog.history(80) }; });
}
