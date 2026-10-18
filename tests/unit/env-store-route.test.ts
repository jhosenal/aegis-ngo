import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerEnvironmentRoute } from '../../src/api/routes/environment.js';
import { EnvQuotaGate, ownerEnvQuotaConfig } from '../../src/costs/envQuota.js';
import { loadPriceBook } from '../../src/costs/pricebook.js';
import { FixedClock } from '../../src/engine/clock.js';
import { runEnvRefresh } from '../../src/services/envRefresh.js';
import { EnvStore } from '../../src/services/envStore.js';
import { GoogleEnvClient } from '../../src/sources/googleEnv.js';
import { loadPinRegistry } from '../../src/sources/pinRegistry.js';

const book = loadPriceBook();
const registry = loadPinRegistry();
const NOW = '2026-10-16T07:00:00.000Z';
const two = { ...registry, pins: registry.pins.slice(0, 2) };

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
function client(now: () => string) {
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('airquality')) return json({ dateTime: NOW, regionCode: 'my', indexes: [{ code: 'uaqi', aqi: 55 }], pollutants: [], healthRecommendations: {} });
    if (u.includes('forecast/hours')) return json({ forecastHours: [{ interval: { startTime: NOW } }], timeZone: { id: 'Asia/Kuala_Lumpur' } });
    if (u.includes('publicAlerts')) return json({ regionCode: 'SG', weatherAlerts: [] });
    return json({ currentTime: NOW, temperature: { degrees: 28, unit: 'CELSIUS' } });
  }) as typeof fetch;
  const gate = new EnvQuotaGate(new Database(':memory:'), book, ownerEnvQuotaConfig(book));
  return new GoogleEnvClient({ apiKeys: { air: 'TEST-AIR-KEY', weather: 'TEST-WEATHER-KEY' }, gate, now, fetchImpl });
}

describe('Google environment store and route (AEG-ENV-002)', () => {
  it('the route answers with every reading null and a visible remark while the refresh is off', async () => {
    const app = Fastify();
    registerEnvironmentRoute(app, registry, new EnvStore(), new FixedClock(NOW));
    const body = (await app.inject('/public/environment?country=SG')).json() as { status: { enabled: boolean }; pins: { country: string; air: unknown }[]; remarks: string[] };
    expect(body.status.enabled).toBe(false);
    expect(body.pins.length).toBeGreaterThan(0);
    expect(body.pins.every((p) => p.country === 'SG' && p.air === null)).toBe(true);
    expect(body.remarks.join(' ')).toContain('switched off');
    await app.close();
  });

  it('a refresh fills the store; readings carry the attribution and vanish after one hour; nothing is persisted', async () => {
    const store = new EnvStore();
    const clock = new FixedClock(NOW);
    const out = await runEnvRefresh({ registry: two, client: client(() => NOW), store, clock });
    expect(out.readings.length).toBeGreaterThan(0);
    expect(store.status).toMatchObject({ enabled: true, lastRunAt: NOW, lastFailures: 0 });
    const app = Fastify();
    registerEnvironmentRoute(app, two, store, clock);
    const body = (await app.inject('/public/environment')).json() as { pins: { pinId: string; air: { attribution: string; validUntil: string } | null; weather: { current: unknown } }[]; attribution: { air: string } };
    const first = body.pins.find((p) => p.air !== null)!;
    expect(first.air!.attribution).toBe(body.attribution.air);
    expect(first.air!.validUntil).toBe('2026-10-16T08:00:00.000Z');
    expect(store.get(first.pinId, 'AIR_CURRENT', '2026-10-16T07:59:59.000Z')).not.toBeNull();
    expect(store.get(first.pinId, 'AIR_CURRENT', '2026-10-16T08:00:00.000Z')).toBeNull();   // dropped at validUntil
    await app.close();
  });
});

describe('last-updated time per place and click-to-fetch (AEG-ENV-003)', () => {
  const sgPin = registry.pins.find((p) => p.country === 'SG' && p.needs.includes('air') && p.needs.includes('weather'))!;
  const myPin = registry.pins.find((p) => p.country === 'MY' && p.needs.includes('air') && p.needs.includes('weather'))!;
  const calls: string[] = [];
  const spyClient = (clock: { now: () => string }) => {
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url); calls.push(u);
      if (u.includes('airquality')) return json({ dateTime: clock.now(), regionCode: 'my', indexes: [{ code: 'uaqi', aqi: 55 }], pollutants: [], healthRecommendations: {} });
      if (u.includes('publicAlerts')) return json({ regionCode: 'SG', weatherAlerts: [] });
      return json({ currentTime: clock.now(), temperature: { degrees: 28, unit: 'CELSIUS' } });
    }) as typeof fetch;
    const gate = new EnvQuotaGate(new Database(':memory:'), book, ownerEnvQuotaConfig(book));
    return new GoogleEnvClient({ apiKeys: { air: 'TEST-AIR-KEY', weather: 'TEST-WEATHER-KEY' }, gate, now: () => clock.now(), fetchImpl });
  };

  it('every place says never, fresh or expired, and keeps its last-updated time after the one-hour reading is gone', async () => {
    const t = { v: NOW }; const clock = { now: () => t.v };
    const store = new EnvStore();
    const { pinViews } = await import('../../src/services/envStore.js');
    expect(pinViews([myPin], store, NOW)[0]).toMatchObject({ readingState: 'never', lastUpdatedAt: null });
    store.put((await spyClient(clock).fetchKind(myPin, 'AIR_CURRENT')));
    expect(pinViews([myPin], store, NOW)[0]).toMatchObject({ readingState: 'fresh', lastUpdatedAt: NOW, air: expect.anything() });
    const later = '2026-10-16T09:30:00.000Z';
    const expired = pinViews([myPin], store, later)[0]!;
    expect(expired).toMatchObject({ readingState: 'expired', lastUpdatedAt: NOW, air: null });
  });

  it('a lookup fetches once, then serves the cache; air + weather (+ alerts for Singapore) only; concurrent clicks share one call', async () => {
    const { EnvOnDemand } = await import('../../src/services/envOnDemand.js');
    const t = { v: NOW }; const clock = { now: () => t.v };
    const store = new EnvStore(); calls.length = 0;
    const od = new EnvOnDemand({ client: spyClient(clock), store, clock: new FixedClock(NOW), dailyMax: 10, perClientPerMinute: 5 });
    const [a, b] = await Promise.all([od.lookup(sgPin, 'v1'), od.lookup(sgPin, 'v2')]);
    expect([a.status, b.status]).toEqual(['fetched', 'fetched']);
    expect(calls.length).toBe(3);                                  // air, current weather, alerts: one shared round
    expect((await od.lookup(sgPin, 'v1')).status).toBe('cached');  // no new call
    expect(calls.length).toBe(3);
    calls.length = 0;
    expect((await od.lookup(myPin, 'v1')).status).toBe('fetched');
    expect(calls.length).toBe(2);                                  // no alert source for Malaysia, none asked
  });

  it('rate-limits a visitor and caps the lookups per day, and a failed lookup is recorded as failed, not as a reading', async () => {
    const { EnvOnDemand } = await import('../../src/services/envOnDemand.js');
    const pins = registry.pins.filter((p) => p.country === 'MY' && p.needs.includes('air') && p.needs.includes('weather')).slice(0, 4);
    const clock = new FixedClock(NOW); const store = new EnvStore();
    const od = new EnvOnDemand({ client: spyClient(clock), store, clock, dailyMax: 3, perClientPerMinute: 2 });
    expect((await od.lookup(pins[0]!, 'same')).status).toBe('fetched');
    expect((await od.lookup(pins[1]!, 'same')).status).toBe('fetched');
    expect((await od.lookup(pins[2]!, 'same')).status).toBe('rate_limited');
    expect((await od.lookup(pins[2]!, 'other')).status).toBe('fetched');
    expect((await od.lookup(pins[3]!, 'third')).status).toBe('daily_cap');
    const failing = new GoogleEnvClient({ apiKeys: { air: 'k', weather: 'k' }, gate: new EnvQuotaGate(new Database(':memory:'), book, ownerEnvQuotaConfig(book)), now: () => NOW, fetchImpl: (async () => new Response('x', { status: 503 })) as typeof fetch });
    const s2 = new EnvStore();
    const od2 = new EnvOnDemand({ client: failing, store: s2, clock, dailyMax: 5, perClientPerMinute: 5 });
    expect((await od2.lookup(pins[0]!, 'c')).status).toBe('unavailable');
    expect(s2.lastFetched(pins[0]!.pinId)).toMatchObject({ outcome: 'failed' });
  });

  it('the place route is disabled by default, 404 for an unknown place, and shows the last-updated fields when enabled', async () => {
    const { EnvOnDemand } = await import('../../src/services/envOnDemand.js');
    const clock = new FixedClock(NOW);
    const off = Fastify(); registerEnvironmentRoute(off, registry, new EnvStore(), clock);
    const offBody = (await off.inject(`/public/environment/pin/${myPin.pinId}`)).json() as { lookup: { status: string }; pin: { readingState: string }; updates: { perDay: number; timesLocal: string[]; valueShownMinutes: number } };
    expect(offBody.updates).toMatchObject({ perDay: 4, timesLocal: ['07:00', '12:00', '17:00', '22:00'], valueShownMinutes: 60 });
    expect(offBody.lookup.status).toBe('disabled');
    expect(offBody.pin.readingState).toBe('never');
    expect((await off.inject('/public/environment/pin/nope-00')).statusCode).toBe(404);
    const store = new EnvStore();
    const on = Fastify(); registerEnvironmentRoute(on, registry, store, clock, new EnvOnDemand({ client: spyClient(clock), store, clock, dailyMax: 5, perClientPerMinute: 5 }));
    const onBody = (await on.inject(`/public/environment/pin/${myPin.pinId}`)).json() as { lookup: { status: string }; pin: { readingState: string; lastUpdatedAt: string; air: { attribution: string } } };
    expect(onBody.lookup.status).toBe('fetched');
    expect(onBody.pin).toMatchObject({ readingState: 'fresh', lastUpdatedAt: NOW });
    expect(onBody.pin.air.attribution).toBe('Source: Includes air quality data from Google');
    const all = (await on.inject('/public/environment')).json() as { pins: { lastUpdatedAt: string | null }[]; onDemand: { enabled: boolean } };
    expect(all.onDemand.enabled).toBe(true);
    expect((all as unknown as { updates: { perDay: number } }).updates.perDay).toBe(4);
    expect(all.pins.filter((p) => p.lastUpdatedAt !== null)).toHaveLength(1);
    await off.close(); await on.close();
  });
});
