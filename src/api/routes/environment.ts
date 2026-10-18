import { demoReadings } from '../../services/sampleReadings.js';
import { customPin } from './credits.js';
import { coverageOf } from '../../domains/coverage.js';
import { pinHours } from '../../data/repos/pinObservations.js';
import { OPENMETEO_CREDIT } from '../../sources/openMeteo.js';
import { latestStationReadings } from '../../data/repos/stationReadings.js';
import { OPENAQ_CREDIT } from '../../sources/openAq.js';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '../../engine/clock.js';
import { pinViews, EnvStore } from '../../services/envStore.js';
import type { EnvOnDemand } from '../../services/envOnDemand.js';
import { loadPlaceMedia } from '../../services/placeMedia.js';
import { currentIncidentPoints, nearbyFor, type Nearby } from '../../services/nearby.js';
import { loadSchedule, slotTimes } from '../../services/broadcast/schedule.js';
import { AIR_ATTRIBUTION, WEATHER_ATTRIBUTION } from '../../sources/googleEnv.js';
import type { PinRegistry } from '../../sources/pinRegistry.js';

/**
 * GET /public/environment[?country=SG|BN|MY]: the monitored places with their latest unexpired Google air-quality and weather readings.
 * Readings live in memory for at most one hour (Google terms) and are never stored. When the refresh is off or a reading has expired the field is null.
 */
export function registerEnvironmentRoute(app: FastifyInstance, registerSource: PinRegistry | (() => PinRegistry), store: EnvStore, clock: Clock, onDemand: EnvOnDemand | null = null, db: import('better-sqlite3').Database | null = null): void {
  const media = loadPlaceMedia();
  const reg = (): PinRegistry => (typeof registerSource === 'function' ? registerSource() : registerSource);
  const placeOf = { get: (id: string) => reg().pins.find((p) => p.pinId === id) };
  /** Media for every place and, when the database is available, the current incidents near it (computed once per request). */
  const withMedia = <T extends { pinId: string }>(views: T[], nowIso: string): (T & { media: ReturnType<typeof loadPlaceMedia>[string] | null; nearby: Nearby | null })[] => {
    const points = db ? currentIncidentPoints(db as never, nowIso) : null;
    return views.map((v) => { const place = placeOf.get(v.pinId); return { ...v, media: media[v.pinId] ?? null, nearby: points && place ? nearbyFor(points, place) : null }; });
  };
  const schedule = loadSchedule();
  const times = slotTimes(schedule);
  /** A browser-restricted Maps JavaScript key. Keep the value in Secret Manager and never cache this response. */
  app.get('/public/maps-config', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const mapsApiKey = process.env.AEGIS_GOOGLE_MAPS_BROWSER_KEY?.trim() ?? '';
    return { mapsApiKey };
  });
  /** What every place must say next to its last-updated time: how often it is updated, and for how long a value may be shown. Owner wording: updated 4 times a day. */
  const updates = { perDay: times.length, timesLocal: times.map((t) => t.airLocal), timezone: schedule.timezone.name, valueShownMinutes: 60 };
  app.get('/public/environment', async (request, reply) => {
    const { country, sample: sampleFlag } = request.query as { country?: unknown; sample?: unknown };
    const now = clock.now();
    // Per-viewer SAMPLE mode: made-up readings in Google's format, built for this request only (a temporary store), never held, never Google data.
    const sample = sampleFlag === '1';
    const view = sample ? new EnvStore() : store;
    if (sample) for (const p of reg().pins) for (const r of demoReadings(p, now)) view.putDemo(r);
    const pins = pinViews(reg().pins.filter((p) => typeof country !== 'string' || p.country === country.toUpperCase()), view, now);
    reply.header('Cache-Control', sample ? 'no-store' : 'public, max-age=60');
    return {
      sample, demoActive: sample || store.demoActive(now),
      asOf: now,
      status: { ...store.status, enabled: store.status.enabled || onDemand !== null },
      onDemand: onDemand ? { enabled: true, ...onDemand.usage() } : { enabled: false },
      updates,
      attribution: { air: AIR_ATTRIBUTION, weather: WEATHER_ATTRIBUTION },
      registry: { id: reg().registryId, asOf: reg().asOf, pins: reg().pins.length },
      pins: withMedia(pins, now),
      remarks: [
        'Readings come from Google Air Quality and Weather APIs, are held in memory for at most one hour and are never stored. A null reading means none is currently held; it does not mean good air or calm weather.',
        'Each place may carry media: a link to its Wikipedia article and, when the article image is freely licensed, a thumbnail with its credit line. A place with no match shows no photo. If the image does not load, hide it and keep the credit and the link.',
        'Weather alerts are only asked for Singapore; Malaysia and Brunei have no Google alert source, so "no alert" is never shown for them.',
        `Every place shows when it was last updated (lastUpdatedAt) and that updates happen ${updates.perDay} times a day (${updates.timesLocal.join(', ')}). Google allows a value to be shown for one hour after it is fetched, so between updates the card shows the last-updated time and the update schedule instead of an old value.`,
        ...(onDemand ? ['Readings are fetched when a place is opened (not on a schedule), kept for at most one hour, and limited by a per-visitor rate limit and a daily cap.'] : store.status.enabled ? [] : ['The Google refresh is switched off on this server, so every reading is null.']),
      ],
    };
  });
  /** SAMPLE custom pin: Pro/Admin authorization is enforced by the auth hook; no credits, Google call or retained reading. */
  app.get('/public/environment/sample-pin', async (request, reply) => {
    const q = request.query as { lat?: string; lng?: string };
    const lat = Number(q.lat); const lng = Number(q.lng);
    reply.header('Cache-Control', 'no-store');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return reply.code(400).send({ error: 'E_VALIDATION', message: 'Send lat and lng as numbers.' });
    const where = coverageOf(lat, lng);
    if (!where) return reply.code(400).send({ error: 'E_VALIDATION', message: 'Dropped pins work inside Singapore, Malaysia and Brunei only.' });
    const now = clock.now(); const pin = customPin(lat, lng, where);
    const temp = new EnvStore(); for (const r of demoReadings(pin, now)) temp.putDemo(r);
    const [view] = pinViews([pin], temp, now);
    return { sample: true, asOf: now, attribution: { air: 'DEMO DATA: synthetic values, not from Google', weather: 'DEMO DATA: synthetic values, not from Google' }, pin: view, remarks: ['Sample values are made up to show how a card looks. They are not measurements and not Google data.'] };
  });
  /** GET /public/environment/pin/:pinId/history: 7 days of Open-Meteo MODELLED values for one place (stored, CC BY 4.0). Not Google data. */
  app.get('/public/environment/pin/:pinId/history', async (request, reply) => {
    const { pinId } = request.params as { pinId: string };
    if (!reg().pins.some((p) => p.pinId === pinId)) return reply.code(404).send({ error: 'E_NOT_FOUND', message: 'Unknown place.' });
    const now = clock.now();
    const hours = db ? pinHours(db, pinId, new Date(Date.parse(now) - 7 * 86_400_000).toISOString(), now) : [];
    const days = new Map<string, { tempMin: number | null; tempMax: number | null; rainMm: number; pm25Max: number | null; hours: number }>();
    for (const h of hours) {
      const day = new Date(Date.parse(h.hourAt) + 8 * 3_600_000).toISOString().slice(0, 10);   // Malaysia/Singapore/Brunei local day
      const d = days.get(day) ?? { tempMin: null, tempMax: null, rainMm: 0, pm25Max: null, hours: 0 };
      if (h.temp !== null) { d.tempMin = d.tempMin === null ? h.temp : Math.min(d.tempMin, h.temp); d.tempMax = d.tempMax === null ? h.temp : Math.max(d.tempMax, h.temp); }
      if (h.rain !== null) d.rainMm = Math.round((d.rainMm + h.rain) * 10) / 10;
      if (h.pm25 !== null) d.pm25Max = d.pm25Max === null ? h.pm25 : Math.max(d.pm25Max, h.pm25);
      d.hours += 1; days.set(day, d);
    }
    // Measured PM2.5 from the nearest OpenAQ station within 10 km that reported in the last 24 hours (null when none).
    const place = reg().pins.find((p) => p.pinId === pinId)!;
    const km = (a: { lat: number; lng: number }): number => { const R = 6371; const dLa = (a.lat - place.lat) * Math.PI / 180; const dLo = (a.lng - place.lng) * Math.PI / 180; const x = Math.sin(dLa / 2) ** 2 + Math.cos(place.lat * Math.PI / 180) * Math.cos(a.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
    const near = db ? latestStationReadings(db, 'pm25', new Date(Date.parse(now) - 24 * 3_600_000).toISOString()).map((r) => ({ r, d: km(r) })).filter((x) => x.d <= 10).sort((a, b) => a.d - b.d)[0] : undefined;
    const measured = near ? { kind: 'measured', parameter: 'PM2.5', value: near.r.value, unit: near.r.unit, observedAt: near.r.observedAt, stationName: near.r.name, distanceKm: Math.round(near.d * 10) / 10, provider: near.r.provider, licence: near.r.licence, credit: OPENAQ_CREDIT, note: 'Community or agency sensor reported through OpenAQ; not an official warning.' } : null;
    reply.header('Cache-Control', 'public, max-age=300');
    return { asOf: now, pinId, measured, credit: OPENMETEO_CREDIT, link: 'https://open-meteo.com/', licence: 'CC BY 4.0; non-commercial pilot; upstream model licences not yet checked', kind: 'modelled',
      days: [...days.entries()].map(([date, d]) => ({ date, ...d })), note: days.size === 0 ? 'No modelled history held for this place yet.' : null };
  });
  /** GET /public/environment/pin/:pinId: one place. With the on-demand lookup enabled this fetches (or reuses) its readings; otherwise it only reports what is held. */
  app.get('/public/environment/pin/:pinId', async (request, reply) => {
    const { pinId } = request.params as { pinId: string };
    const pin = reg().pins.find((p) => p.pinId === pinId);
    if (!pin) return reply.code(404).send({ error: 'E_NOT_FOUND', message: 'Unknown place.' });
    const lookup = onDemand ? await onDemand.lookup(pin, request.ip) : { status: 'disabled' as const, detail: 'live lookups are switched off on this server' };
    reply.header('Cache-Control', 'no-store');
    if (lookup.status === 'rate_limited') reply.code(429);
    const [view] = withMedia(pinViews([pin], store, clock.now()), clock.now());
    return {
      asOf: clock.now(), lookup, updates, attribution: { air: AIR_ATTRIBUTION, weather: WEATHER_ATTRIBUTION }, pin: view,
      remarks: ['Google readings are shown on screen only, kept for at most one hour and never narrated. A null reading means none is held, not good air or calm weather.'],
    };
  });
}
