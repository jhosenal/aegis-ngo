import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { defaultEnvQuotaConfig, EnvQuotaGate, ownerEnvQuotaConfig, type EnvQuotaConfig } from '../../src/costs/envQuota.js';
import { loadPriceBook } from '../../src/costs/pricebook.js';
import { AIR_ATTRIBUTION, EnvCallError, GoogleEnvClient, googleEnvKeysFromEnv, pollRegistry, WEATHER_ATTRIBUTION } from '../../src/sources/googleEnv.js';
import { loadPinRegistry } from '../../src/sources/pinRegistry.js';

const KEY = 'TEST-AIR-KEY-do-not-leak-0123456789';
const WKEY = 'TEST-WEATHER-KEY-do-not-leak-9876543210';
const book = loadPriceBook();
const registry = loadPinRegistry();
const NOW = '2026-10-16T07:00:00.000Z';

interface Seen { url: string; method: string; headers: Record<string, string>; body: string | null }
function harness(handler: (seen: Seen) => Response | Promise<Response>, config?: EnvQuotaConfig) {
  const db = new Database(':memory:');
  const gate = new EnvQuotaGate(db, book, config ?? ownerEnvQuotaConfig(book));
  const calls: Seen[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const seen: Seen = { url: String(url), method: String(init?.method ?? 'GET'), headers: init?.headers as Record<string, string>, body: typeof init?.body === 'string' ? init.body : null };
    calls.push(seen);
    return handler(seen);
  }) as typeof fetch;
  const client = new GoogleEnvClient({ apiKeys: { air: KEY, weather: WKEY }, gate, now: () => NOW, fetchImpl });
  return { db, gate, calls, client };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const pin = registry.pins.find((p) => p.pinId === 'my-41')!;
const used = (h: ReturnType<typeof harness>, sku: 'AIR_QUALITY' | 'WEATHER') => h.gate.snapshot(sku, NOW).monthUsed;

describe('Google Environment adapter (AEG-ENV-001)', () => {
  it('Air Quality: POST with the key in a header only, location and extra computations in the body', async () => {
    const h = harness(() => json({ dateTime: NOW, regionCode: 'my', indexes: [{ code: 'uaqi', aqi: 55 }], pollutants: [], healthRecommendations: {}, junk: 1 }));
    const reading = await h.client.fetchKind(pin, 'AIR_CURRENT');
    const c = h.calls[0]!;
    expect(c.method).toBe('POST');
    expect(c.url).toBe('https://airquality.googleapis.com/v1/currentConditions:lookup');
    expect(c.url).not.toContain(KEY);
    expect(c.headers['x-goog-api-key']).toBe(KEY);
    const body = JSON.parse(c.body!) as { location: { latitude: number; longitude: number }; extraComputations: string[] };
    expect(body.location).toEqual({ latitude: pin.lat, longitude: pin.lng });
    expect(body.extraComputations).toEqual(expect.arrayContaining(['LOCAL_AQI', 'HEALTH_RECOMMENDATIONS', 'DOMINANT_POLLUTANT_CONCENTRATION', 'POLLUTANT_CONCENTRATION']));
    expect(reading.data).not.toHaveProperty('junk');
    expect(reading.attribution).toBe(AIR_ATTRIBUTION);
    expect(reading.validUntil).toBe('2026-10-16T08:00:00.000Z');   // one hour: the Google caching limit
    expect(reading.freshness).toMatchObject({ sourceKey: 'GOOGLE_AIR_QUALITY', observedAt: NOW, ageMinutes: 0 });
    expect(used(h, 'AIR_QUALITY')).toBe(1);
  });

  it('Weather: GET with query coordinates, hourly asks for exactly one 24-hour page and never follows the next page token', async () => {
    const h = harness((s) => (s.url.includes('forecast/hours') ? json({ forecastHours: [{}], nextPageToken: 'abc' }) : json({ currentTime: NOW, temperature: { degrees: 30 } })));
    const hourly = await h.client.fetchKind(pin, 'WEATHER_HOURLY');
    const u = new URL(h.calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://weather.googleapis.com/v1/forecast/hours:lookup');
    expect(u.searchParams.get('hours')).toBe('24');
    expect(u.searchParams.get('pageSize')).toBe('24');
    expect(u.searchParams.get('location.latitude')).toBe(String(pin.lat));
    expect(h.calls[0]!.url).not.toContain(WKEY);
    expect(h.calls[0]!.headers['x-goog-api-key']).toBe(WKEY);      // weather calls use the weather key, never the air key
    expect(hourly.data['truncated']).toBe(true);
    expect(h.calls).toHaveLength(1);                       // no second page
    const current = await h.client.fetchKind(pin, 'WEATHER_CURRENT');
    expect(current.attribution).toBe(WEATHER_ATTRIBUTION);
    expect(used(h, 'WEATHER')).toBe(2);
  });

  it('alerts: Malaysia answers 404 not-supported, a coverage gap (unsupported) that is not billed', async () => {
    const h = harness(() => json({ error: { code: 404, message: 'Information is not supported for this location.', status: 'NOT_FOUND' } }, 404));
    const r = await h.client.fetchKind(pin, 'WEATHER_ALERTS');
    expect(r.data).toEqual({ regionCode: null, alerts: [], truncated: false, unsupported: true });
    expect(r.freshness.text).toContain('does not mean "no alert"');
    expect(used(h, 'WEATHER')).toBe(0);
  });

  it('an empty nextPageToken is not a next page', async () => {
    const h = harness(() => json({ weatherAlerts: [], regionCode: 'SG', nextPageToken: '' }));
    const r = await h.client.fetchKind(pin, 'WEATHER_ALERTS');
    expect(r.data).toMatchObject({ truncated: false, unsupported: false });
  });

  it('alerts: an empty answer is an empty list, not a hazard claim; real alerts keep their data source', async () => {
    const empty = harness(() => json({ regionCode: 'MY' }));
    const none = await empty.client.fetchKind(pin, 'WEATHER_ALERTS');
    expect(none.data).toEqual({ regionCode: 'MY', alerts: [], truncated: false, unsupported: false });
    const some = harness(() => json({ regionCode: 'SG', weatherAlerts: [{ alertId: 'A1', severity: 'SEVERE', dataSource: { name: 'MSS', authorityUri: 'https://x' }, extra: 1 }] }));
    const r = await some.client.fetchKind(pin, 'WEATHER_ALERTS');
    expect((r.data['alerts'] as Record<string, unknown>[])[0]).toEqual({ alertId: 'A1', severity: 'SEVERE', dataSource: { name: 'MSS', authorityUri: 'https://x' } });
  });

  it('a definite HTTP error releases the reservation and maps the code; the key never appears in the error', async () => {
    for (const [status, code] of [[400, 'BAD_REQUEST'], [403, 'AUTH'], [429, 'QUOTA'], [503, 'TRANSIENT'], [504, 'TIMEOUT']] as const) {
      const h = harness(() => json({ error: { message: `bad ${KEY}` } }, status));
      const err = await h.client.fetchKind(pin, 'AIR_CURRENT').catch((e: unknown) => e) as EnvCallError;
      expect(err).toBeInstanceOf(EnvCallError);
      expect(err.code).toBe(code);
      expect(err.message).not.toContain(KEY);
      expect(used(h, 'AIR_QUALITY')).toBe(0);
    }
  });

  it('a network failure keeps the call counted as a liability', async () => {
    const h = harness(() => { throw new TypeError('socket hang up'); });
    const err = await h.client.fetchKind(pin, 'WEATHER_CURRENT').catch((e: unknown) => e) as EnvCallError;
    expect(err.code).toBe('TRANSIENT');
    expect(used(h, 'WEATHER')).toBe(1);
  });

  it('a 200 with a bad body is MALFORMED but still counts as billed', async () => {
    const h = harness(() => new Response('<html>', { status: 200 }));
    const err = await h.client.fetchKind(pin, 'AIR_CURRENT').catch((e: unknown) => e) as EnvCallError;
    expect(err.code).toBe('MALFORMED');
    expect(used(h, 'AIR_QUALITY')).toBe(1);
  });

  it('refuses before any network call when the gate says no', async () => {
    const h = harness(() => json({}), defaultEnvQuotaConfig(book));
    const exhausted: EnvQuotaConfig = { ...defaultEnvQuotaConfig(book), skus: { AIR_QUALITY: { monthlyCalls: 0, dailyCalls: 0, monthlyPaidMicro: 0 }, WEATHER: { monthlyCalls: 0, dailyCalls: 0, monthlyPaidMicro: 0 } } };
    const g = harness(() => json({}), exhausted);
    const err = await g.client.fetchKind(pin, 'AIR_CURRENT').catch((e: unknown) => e) as EnvCallError;
    expect(err).toMatchObject({ code: 'GATE', gateReason: 'MONTH_LIMIT' });
    expect(g.calls).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it('reads the two key names from the environment and reports a missing one by name only', () => {
    expect(googleEnvKeysFromEnv({ AEGIS_GOOGLE_AIR_API_KEY: ' a ', AEGIS_GOOGLE_WEATHER_API_KEY: 'w' })).toEqual({ air: 'a', weather: 'w' });
    expect(() => googleEnvKeysFromEnv({ AEGIS_GOOGLE_AIR_API_KEY: 'secretvalue' })).toThrow(/AEGIS_GOOGLE_WEATHER_API_KEY/);
    try { googleEnvKeysFromEnv({ AEGIS_GOOGLE_AIR_API_KEY: 'secretvalue' }); } catch (e) { expect(String((e as Error).message)).not.toContain('secretvalue'); }
  });

  it('no reading is ever valid for longer than the one-hour Google caching limit, even if asked to be', async () => {
    const db = new Database(':memory:');
    const gate = new EnvQuotaGate(db, book, ownerEnvQuotaConfig(book));
    const fetchImpl = (async () => json({ regionCode: 'my' })) as typeof fetch;
    const client = new GoogleEnvClient({ apiKeys: { air: KEY, weather: WKEY }, gate, now: () => NOW, fetchImpl, validMinutes: 600 });
    for (const kind of ['AIR_CURRENT', 'WEATHER_CURRENT', 'WEATHER_HOURLY', 'WEATHER_ALERTS'] as const) {
      const r = await client.fetchKind(pin, kind);
      expect(Date.parse(r.validUntil) - Date.parse(r.fetchedAt)).toBeLessThanOrEqual(60 * 60_000);
    }
  });

  it('requires both keys', () => {
    const db = new Database(':memory:');
    expect(() => new GoogleEnvClient({ apiKeys: { air: '', weather: WKEY }, gate: new EnvQuotaGate(db, book, defaultEnvQuotaConfig(book)), now: () => NOW })).toThrow(EnvCallError);
  });

  it('full run: 105 air + 2x125 weather + 23 Singapore alert calls, hazard pins first, inside the owner plan', async () => {
    const order: string[] = [];
    const h = harness((s) => { order.push(s.url); return s.url.includes('airquality') ? json({ regionCode: 'my' }) : json({}); });
    const out = await pollRegistry(registry, h.client);
    expect(out.failures).toEqual([]);
    expect(out.readings).toHaveLength(105 + 2 * 125 + 23);
    expect(out.alertsNotCovered).toBe(102);
    expect(out.skipped).toBe(0);
    expect(used(h, 'AIR_QUALITY')).toBe(105);
    expect(used(h, 'WEATHER')).toBe(2 * 125 + 23);
    const first = h.calls[0]!;
    const lat = first.body ? (JSON.parse(first.body) as { location: { latitude: number } }).location.latitude : Number(new URL(first.url).searchParams.get('location.latitude'));
    const hazardLats = registry.pins.filter((p) => p.roles.includes('hazard')).map((p) => p.lat);
    expect(hazardLats).toContain(lat);                       // the first call goes to a hazard pin
  });

  it('a bad key stops the whole run after one failure instead of repeating it', async () => {
    const h = harness(() => json({}, 403));
    const out = await pollRegistry(registry, h.client);
    expect(h.calls).toHaveLength(1);
    expect(out.failures).toHaveLength(1);
    expect(out.skipped).toBe(105 + 2 * 125 + 23 - 1);
  });

  it('when the daily cap is hit, that service stops and hazard pins were served first', async () => {
    const tight: EnvQuotaConfig = { ...ownerEnvQuotaConfig(book), skus: { AIR_QUALITY: { monthlyCalls: 26000, dailyCalls: 10, monthlyPaidMicro: 80_000_000 }, WEATHER: { monthlyCalls: 100000, dailyCalls: 3225, monthlyPaidMicro: 80_000_000 } } };
    const h = harness((s) => (s.url.includes('airquality') ? json({ regionCode: 'my' }) : json({})), tight);
    const out = await pollRegistry(registry, h.client);
    expect(out.readings.filter((r) => r.sku === 'AIR_QUALITY')).toHaveLength(10);
    expect(out.failures.filter((f) => f.gateReason === 'DAY_LIMIT')).toHaveLength(1);   // one refusal, then the service is stopped
    expect(out.skipped).toBe(105 - 11);
    const served = new Set(out.readings.filter((r) => r.sku === 'AIR_QUALITY').map((r) => r.pinId));
    const hazardAir = registry.pins.filter((p) => p.roles.includes('hazard') && p.needs.includes('air')).map((p) => p.pinId);
    for (const id of hazardAir) expect(served.has(id)).toBe(true);
  });
});
