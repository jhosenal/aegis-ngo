import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { latestStationReadings } from '../../src/data/repos/stationReadings.js';
import { FixedClock } from '../../src/engine/clock.js';
import { runOpenAqScan } from '../../src/services/openAqIngest.js';
import { parseLatest, parseLocations } from '../../src/sources/openAq.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const NOW = '2026-10-16T13:00:00Z';
const resolver = { resolve: async () => ['93.184.216.34'] };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const loc = (id: number, last: string | null, parameter = 'pm25') => ({
  id, name: `Station ${id}`, coordinates: { latitude: 4.5, longitude: 114.2 }, datetimeLast: last ? { utc: last } : null,
  provider: { name: 'AirGradient' }, licenses: [{ name: 'CC BY 4.0' }], sensors: [{ id: id * 10, parameter: { name: parameter } }],
});

function setup() { const db = openDb(':memory:'); migrate(db, dir, '2026-10-16T00:00:00Z'); return db; }

describe('OpenAQ stations (AEG-OAQ-001)', () => {
  it('keeps only stations with a PM2.5 sensor that reported in the last 24 hours', () => {
    const stations = parseLocations({ results: [loc(1, '2026-10-16T12:00:00Z'), loc(2, '2024-10-29T03:00:00Z'), loc(3, null), loc(4, '2026-10-16T12:00:00Z', 'no2')] }, Date.parse(NOW));
    expect(stations.map((s) => s.id)).toEqual([1]);
    expect(stations[0]).toMatchObject({ provider: 'AirGradient', licence: 'CC BY 4.0', pm25SensorId: 10 });
    expect(() => parseLocations({ nope: true }, Date.parse(NOW))).toThrow();
  });
  it('drops negative or non-numeric latest values', () => {
    expect(parseLatest({ results: [{ sensorsId: 1, value: 12.5, datetime: { utc: 'x' } }, { sensorsId: 2, value: -999, datetime: { utc: 'x' } }, { sensorsId: 3, value: 'a', datetime: { utc: 'x' } }] })).toEqual([{ sensorId: 1, value: 12.5, observedAt: 'x' }]);
  });
  it('stores the latest PM2.5 per station, sends the key only as a header, and does nothing without a key', async () => {
    const db = setup();
    const seen: { url: string; key: string | null }[] = [];
    const fetchImpl = (async (url: URL, init?: RequestInit) => {
      const u = String(url);
      seen.push({ url: u, key: new Headers(init?.headers).get('x-api-key') });
      if (u.includes('/v3/locations?')) return json({ results: u.includes('countries_id=120') ? [loc(7, '2026-10-16T12:00:00Z')] : [] });
      return json({ results: [{ sensorsId: 70, value: 14.2, datetime: { utc: '2026-10-16T12:00:00Z' } }, { sensorsId: 99, value: 1, datetime: { utc: '2026-10-16T12:00:00Z' } }] });
    }) as unknown as typeof fetch;
    expect(await runOpenAqScan({ db, clock: new FixedClock(NOW), apiKey: undefined, fetchImpl, resolver })).toMatchObject({ outcome: 'SKIPPED' });
    expect(seen).toHaveLength(0);
    const r = await runOpenAqScan({ db, clock: new FixedClock(NOW), apiKey: 'TESTKEY', fetchImpl, resolver });
    expect(r).toMatchObject({ outcome: 'OK', stations: 1, stored: 1 });
    expect(seen.every((x) => x.key === 'TESTKEY' && !x.url.includes('TESTKEY'))).toBe(true);
    expect(latestStationReadings(db, 'pm25', '2026-10-15T00:00:00Z')).toEqual([expect.objectContaining({ stationId: 7, value: 14.2, country: 'BN', provider: 'AirGradient', licence: 'CC BY 4.0' })]);
  });
  it('a failing reply marks the source and stores nothing', async () => {
    const db = setup();
    const fetchImpl = (async () => json({}, 503)) as unknown as typeof fetch;
    expect(await runOpenAqScan({ db, clock: new FixedClock(NOW), apiKey: 'K', fetchImpl, resolver })).toMatchObject({ outcome: 'UNAVAILABLE', stored: 0 });
    expect(latestStationReadings(db, 'pm25', '2026-10-01T00:00:00Z')).toEqual([]);
  });
});
