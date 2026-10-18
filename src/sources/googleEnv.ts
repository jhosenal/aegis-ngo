// Google Environment APIs adapter (Air Quality + Weather), AEG-ENV-001. Written against the pages read on 2026-10-16:
//   https://developers.google.com/maps/documentation/air-quality/reference/rest/v1/currentConditions/lookup
//   https://developers.google.com/maps/documentation/weather/reference/rest/v1/currentConditions/lookup
//   https://developers.google.com/maps/documentation/weather/reference/rest/v1/forecast.hours/lookup
//   https://developers.google.com/maps/documentation/weather/reference/rest/v1/publicAlerts/lookup
//   https://docs.cloud.google.com/docs/authentication/api-keys-use  (REST keys go in the x-goog-api-key header)
// Every call reserves quota first. The key is sent in a header, never in a URL, and never appears in an error message.
// Nothing here persists data: the caller decides storage under the cache/retention decision (still open for Google data).
import { EnvQuotaGate, type EnvReserveRefusal, type EnvSku } from '../costs/envQuota.js';
import { describeFreshness, type FreshnessStatement } from './freshness.js';
import type { EnvPin, PinRegistry } from './pinRegistry.js';

export const AIR_HOST = 'airquality.googleapis.com';
export const WEATHER_HOST = 'weather.googleapis.com';
export const AIR_ATTRIBUTION = 'Source: Includes air quality data from Google';
export const WEATHER_ATTRIBUTION = 'Source: Includes weather data from Google';

export type EnvKind = 'AIR_CURRENT' | 'WEATHER_CURRENT' | 'WEATHER_HOURLY' | 'WEATHER_ALERTS';
const SKU: Record<EnvKind, EnvSku> = { AIR_CURRENT: 'AIR_QUALITY', WEATHER_CURRENT: 'WEATHER', WEATHER_HOURLY: 'WEATHER', WEATHER_ALERTS: 'WEATHER' };
const ENDPOINT: Record<EnvKind, string> = {
  AIR_CURRENT: 'currentConditions:lookup', WEATHER_CURRENT: 'currentConditions:lookup', WEATHER_HOURLY: 'forecast/hours:lookup', WEATHER_ALERTS: 'publicAlerts:lookup',
};
/** One page of 24 hours is ONE billable event. The default (240 hours) would be ten pages, so the adapter never asks for it and never follows nextPageToken. */
export const HOURLY_FORECAST_HOURS = 24;
const MAX_RESPONSE_CHARS = 262_144;
const AIR_EXTRA = ['LOCAL_AQI', 'HEALTH_RECOMMENDATIONS', 'DOMINANT_POLLUTANT_CONCENTRATION', 'POLLUTANT_CONCENTRATION'];

/**
 * Longest time a reading may be kept, in minutes, from the Google Maps Platform Service Specific Terms (last modified 2026-10-15):
 * Air Quality 2.2.1 current conditions and hourly forecast: one hour, then delete. Weather 21.2.1 current condition, hourly forecast and public
 * alert values: one hour, then delete. The general terms (3.2.3(b)) forbid caching beyond what those tables allow. Historic Air Quality values
 * (history:lookup) may be kept until the agreement ends and Weather hourly history for 240 hours; this adapter does not fetch history yet.
 */
export const CACHE_LIMIT_MINUTES: Record<EnvKind, number> = { AIR_CURRENT: 60, WEATHER_CURRENT: 60, WEATHER_HOURLY: 60, WEATHER_ALERTS: 60 };

export type EnvErrorCode = 'GATE' | 'AUTH' | 'QUOTA' | 'BAD_REQUEST' | 'TRANSIENT' | 'TIMEOUT' | 'MALFORMED';
export class EnvCallError extends Error {
  constructor(readonly code: EnvErrorCode, message: string, readonly gateReason?: EnvReserveRefusal) {
    super(message);
    this.name = 'EnvCallError';
  }
}

export interface EnvReading {
  pinId: string;
  kind: EnvKind;
  sku: EnvSku;
  fetchedAt: string;
  validUntil: string;
  attribution: string;
  /** Verified top-level fields only; nested shapes are passed through unchanged, never reinterpreted. */
  data: Record<string, unknown>;
  /** How old this reading is and what is known about the source's cadence; shown on the card next to the attribution. */
  freshness: FreshnessStatement;
}

const FRESHNESS_KEY: Record<EnvKind, string> = {
  AIR_CURRENT: 'GOOGLE_AIR_QUALITY', WEATHER_CURRENT: 'GOOGLE_WEATHER_CURRENT', WEATHER_HOURLY: 'GOOGLE_WEATHER_HOURLY', WEATHER_ALERTS: 'GOOGLE_WEATHER_ALERTS',
};

/** The provider's own timestamp for the data. Weather current is stamped with the request time, so it is not an observation time and is not used. */
function observedAtOf(kind: EnvKind, data: Record<string, unknown>): string | null {
  if (kind === 'AIR_CURRENT') return typeof data['dateTime'] === 'string' ? data['dateTime'] : null;
  if (kind === 'WEATHER_HOURLY') {
    const first = Array.isArray(data['forecastHours']) ? data['forecastHours'][0] : undefined;
    const interval = isRecord(first) && isRecord(first['interval']) ? first['interval']['startTime'] : undefined;
    return typeof interval === 'string' ? interval : null;
  }
  return null;
}

/** One restricted key per service, so a leaked or over-used key is contained to that API. */
export interface GoogleEnvKeys { air: string; weather: string }

/** Reads AEGIS_GOOGLE_AIR_API_KEY and AEGIS_GOOGLE_WEATHER_API_KEY. A missing name is reported by name only, never by value. */
export function googleEnvKeysFromEnv(env: Record<string, string | undefined>): GoogleEnvKeys {
  const air = (env['AEGIS_GOOGLE_AIR_API_KEY'] ?? '').trim();
  const weather = (env['AEGIS_GOOGLE_WEATHER_API_KEY'] ?? '').trim();
  const missing = [air ? '' : 'AEGIS_GOOGLE_AIR_API_KEY', weather ? '' : 'AEGIS_GOOGLE_WEATHER_API_KEY'].filter(Boolean);
  if (missing.length > 0) throw new EnvCallError('AUTH', `Missing: ${missing.join(', ')}`);
  return { air, weather };
}

export interface GoogleEnvOptions {
  apiKeys: GoogleEnvKeys;
  gate: EnvQuotaGate;
  now: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** May only SHORTEN the permitted time; a longer value is clamped to CACHE_LIMIT_MINUTES for the kind. */
  validMinutes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in source) out[key] = source[key];
  return out;
}
/** Google sends nextPageToken as an empty string when there is no next page (seen live), so only a non-empty string counts. */
function hasNextPage(body: Record<string, unknown>): boolean {
  return typeof body['nextPageToken'] === 'string' && body['nextPageToken'] !== '';
}
function plusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export class GoogleEnvClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly validMinutes: number;
  private sequence = 0;

  constructor(private readonly options: GoogleEnvOptions) {
    if (!options.apiKeys.air || !options.apiKeys.weather) throw new EnvCallError('AUTH', 'Google Air Quality and Weather API keys are both required');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.validMinutes = options.validMinutes ?? 60;
  }

  private request(kind: EnvKind, pin: EnvPin): { url: string; init: RequestInit } {
    const host = SKU[kind] === 'AIR_QUALITY' ? AIR_HOST : WEATHER_HOST;
    const base = `https://${host}/v1/${ENDPOINT[kind]}`;
    const headers: Record<string, string> = { 'x-goog-api-key': SKU[kind] === 'AIR_QUALITY' ? this.options.apiKeys.air : this.options.apiKeys.weather };
    if (kind === 'AIR_CURRENT') {
      return {
        url: base,
        init: {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ location: { latitude: pin.lat, longitude: pin.lng }, extraComputations: AIR_EXTRA, languageCode: 'en' }),
        },
      };
    }
    const query = new URLSearchParams({ 'location.latitude': String(pin.lat), 'location.longitude': String(pin.lng) });
    if (kind === 'WEATHER_CURRENT') query.set('unitsSystem', 'METRIC');
    if (kind === 'WEATHER_HOURLY') { query.set('hours', String(HOURLY_FORECAST_HOURS)); query.set('pageSize', String(HOURLY_FORECAST_HOURS)); }
    if (kind === 'WEATHER_ALERTS') query.set('languageCode', 'en');
    return { url: `${base}?${query.toString()}`, init: { method: 'GET', headers } };
  }

  async fetchKind(pin: EnvPin, kind: EnvKind): Promise<EnvReading> {
    const sku = SKU[kind];
    const startedAt = this.options.now();
    this.sequence += 1;
    const reservationId = `${kind}:${pin.pinId}:${startedAt}:${this.sequence}`;
    const reserved = this.options.gate.reserve({ reservationId, sku, endpoint: ENDPOINT[kind], units: 1, now: startedAt });
    if (!reserved.ok) throw new EnvCallError('GATE', `Quota gate refused the call (${reserved.reason})`, reserved.reason);

    const { url, init } = this.request(kind, pin);
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal, redirect: 'error' });
    } catch (error: unknown) {
      // The request may have reached Google before the failure, so it stays counted until reconciled.
      this.options.gate.markLiability(reservationId, this.options.now());
      if (signal.aborted || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) throw new EnvCallError('TIMEOUT', 'Google request timed out');
      throw new EnvCallError('TRANSIENT', 'Google request failed before a response');
    }

    const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
    if (response.status < 200 || response.status > 299) {
      // Google bills a successful request, so a definite HTTP error releases the reservation.
      this.options.gate.release(reservationId, this.options.now());
      if (kind === 'WEATHER_ALERTS' && response.status === 404) {
        // Observed live 2026-10-16: Malaysia answers 404 NOT_FOUND "Information is not supported for this location". A coverage gap, not a failure.
        return {
          pinId: pin.pinId, kind, sku, fetchedAt: startedAt, validUntil: plusMinutes(startedAt, Math.min(this.validMinutes, CACHE_LIMIT_MINUTES[kind])), attribution: WEATHER_ATTRIBUTION,
          data: { regionCode: null, alerts: [], truncated: false, unsupported: true },
          freshness: describeFreshness(FRESHNESS_KEY[kind], null, startedAt, { unsupported: true }),
        };
      }
      if (response.status === 401 || response.status === 403) throw new EnvCallError('AUTH', `Google rejected the credentials (${response.status})`);
      if (response.status === 429) throw new EnvCallError('QUOTA', 'Google rate or quota limit (429)');
      if (response.status === 408 || response.status === 504) throw new EnvCallError('TIMEOUT', `Google timed out (${response.status})`);
      if (response.status >= 500) throw new EnvCallError('TRANSIENT', `Google server error (${response.status})`);
      throw new EnvCallError('BAD_REQUEST', `Google rejected the request (${response.status})`);
    }

    // A 2xx is a billed event even if the body is unusable.
    this.options.gate.settle(reservationId, 1, this.options.now());
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new EnvCallError('MALFORMED', 'Google returned a body that is not JSON'); }
    if (!isRecord(body)) throw new EnvCallError('MALFORMED', 'Google returned an unexpected body');

    const data = this.normalise(kind, body);
    return {
      pinId: pin.pinId,
      kind,
      sku,
      fetchedAt: startedAt,
      validUntil: plusMinutes(startedAt, Math.min(this.validMinutes, CACHE_LIMIT_MINUTES[kind])),
      attribution: sku === 'AIR_QUALITY' ? AIR_ATTRIBUTION : WEATHER_ATTRIBUTION,
      data,
      freshness: describeFreshness(FRESHNESS_KEY[kind], observedAtOf(kind, data), startedAt),
    };
  }

  private normalise(kind: EnvKind, body: Record<string, unknown>): Record<string, unknown> {
    if (kind === 'AIR_CURRENT') return pick(body, ['dateTime', 'regionCode', 'indexes', 'pollutants', 'healthRecommendations']);
    if (kind === 'WEATHER_CURRENT') {
      return pick(body, ['currentTime', 'timeZone', 'weatherCondition', 'temperature', 'feelsLikeTemperature', 'precipitation', 'wind', 'visibility', 'isDaytime',
        'relativeHumidity', 'uvIndex', 'thunderstormProbability', 'cloudCover', 'currentConditionsHistory']);
    }
    if (kind === 'WEATHER_HOURLY') {
      // Only the first page is ever used; a nextPageToken is reported, not followed (each page is a billed event).
      return { ...pick(body, ['forecastHours', 'timeZone']), truncated: hasNextPage(body) };
    }
    const alerts = Array.isArray(body['weatherAlerts']) ? body['weatherAlerts'].filter(isRecord) : [];
    return {
      regionCode: typeof body['regionCode'] === 'string' ? body['regionCode'] : null,
      // An empty list means "no alert from a source Google carries for this point", not "no hazard"; coverage excludes Malaysia and Indonesia.
      alerts: alerts.map((a) => pick(a, ['alertId', 'alertTitle', 'eventType', 'areaName', 'severity', 'certainty', 'urgency', 'startTime', 'expirationTime', 'dataSource', 'description', 'instruction', 'polygon'])),
      truncated: hasNextPage(body),
      unsupported: false,
    };
  }
}

export interface PollOutcome {
  readings: EnvReading[];
  failures: { pinId: string; kind: EnvKind; code: EnvErrorCode; gateReason?: EnvReserveRefusal }[];
  /** Calls not attempted because the quota gate or a credential failure stopped that service. */
  skipped: number;
  /** Pins whose country has no known alert source: not asked, so no-alert must never be shown for them. */
  alertsNotCovered: number;
}

/**
 * Countries where the alerts endpoint is known to answer. Verified live 2026-10-16: SG answers 200, MY answers 404 (unsupported).
 * Brunei is not in Google's published provider list and is not probed. Asking an unsupported point wastes a request every run.
 */
export const ALERT_COVERED_COUNTRIES: ReadonlySet<string> = new Set(['SG']);

const GATE_STOPS = new Set<EnvReserveRefusal>(['MONTH_LIMIT', 'DAY_LIMIT', 'PAID_BUDGET_LIMIT', 'BAND_LIMIT', 'NO_PRICE', 'BAD_CONFIG']);

/** One refresh run over the registry. Hazard pins go first so a tight daily cap drops routine pins, not incident pins. */
export async function pollRegistry(registry: PinRegistry, client: GoogleEnvClient): Promise<PollOutcome> {
  const ordered = [...registry.pins].sort((a, b) => Number(b.roles.includes('hazard')) - Number(a.roles.includes('hazard')));
  const out: PollOutcome = { readings: [], failures: [], skipped: 0, alertsNotCovered: 0 };
  const stopped = new Set<EnvSku>();
  let authFailed = false;
  for (const pin of ordered) {
    const kinds: EnvKind[] = [];
    if (pin.needs.includes('air')) kinds.push('AIR_CURRENT');
    if (pin.needs.includes('weather')) {
      kinds.push('WEATHER_CURRENT', 'WEATHER_HOURLY');
      if (ALERT_COVERED_COUNTRIES.has(pin.country)) kinds.push('WEATHER_ALERTS');
      else out.alertsNotCovered += 1;
    }
    for (const kind of kinds) {
      if (authFailed || stopped.has(SKU[kind])) { out.skipped += 1; continue; }
      try {
        out.readings.push(await client.fetchKind(pin, kind));
      } catch (error: unknown) {
        const e = error instanceof EnvCallError ? error : new EnvCallError('TRANSIENT', 'unexpected failure');
        out.failures.push({ pinId: pin.pinId, kind, code: e.code, ...(e.gateReason ? { gateReason: e.gateReason } : {}) });
        if (e.code === 'AUTH') authFailed = true;                  // a bad key must not be retried 500 times
        if (e.code === 'GATE' && e.gateReason && GATE_STOPS.has(e.gateReason)) stopped.add(SKU[kind]);
      }
    }
  }
  return out;
}
