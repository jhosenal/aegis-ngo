import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { pinCoverage, pinHours } from '../../src/data/repos/pinObservations.js';
import { FixedClock } from '../../src/engine/clock.js';
import { runOpenMeteoScan } from '../../src/services/openMeteoIngest.js';
import { toUtcIso } from '../../src/sources/openMeteo.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const resolver = { resolve: async () => ['93.184.216.34'] };
const times = ['2026-10-15T00:00', '2026-10-15T01:00'];
const pins = [{ pinId: 'bn-01', lat: 4.89, lng: 114.94 }, { pinId: 'my-01', lat: 3.14, lng: 101.69 }];
const wx = (n: number) => Array.from({ length: n }, (_, i) => ({ hourly: { time: times, temperature_2m: [27 + i, 28 + i], precipitation: [0, 1.5] } }));
const aq = (n: number) => Array.from({ length: n }, (_, i) => ({ hourly: { time: times, pm2_5: [10 + i, null], pm10: [20, 21] } }));
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

function setup() { const db = openDb(':memory:'); migrate(db, dir, '2026-10-16T00:00:00Z'); return db; }

describe('Open-Meteo pin scan (AEG-OMET-001)', () => {
  it('stores modelled hourly rows per pin, keeps a null as null, and reports coverage', async () => {
    const db = setup();
    const fetchImpl = (async (url: string) => json(String(url).includes('air-quality') ? aq(2) : wx(2))) as unknown as typeof fetch;
    const r = await runOpenMeteoScan({ db, clock: new FixedClock('2026-10-16T01:00:00Z'), pins, fetchImpl, resolver });
    expect(r).toMatchObject({ outcome: 'OK', pins: 2, rows: 4, failedBatches: 0 });
    const rows = pinHours(db, 'my-01', '2026-10-14T00:00:00Z', '2026-10-16T00:00:00Z');
    expect(rows.map((x) => [x.hourAt, x.temp, x.rain, x.pm25, x.pm10])).toEqual([['2026-10-15T00:00:00.000Z', 28, 0, 11, 20], ['2026-10-15T01:00:00.000Z', 29, 1.5, null, 21]]);
    expect(pinCoverage(db)).toEqual({ pins: 2, rows: 4, latestHour: '2026-10-15T01:00:00.000Z' });
    expect(db.prepare("SELECT state FROM source_status WHERE source_id = 'SRC.OPENMETEO.PINS'").get()).toEqual({ state: 'OK' });
  });
  it('a malformed or failing reply stores nothing and marks the source, keeping the last good time', async () => {
    const db = setup();
    const bad = (async () => json([{ hourly: {} }, { hourly: {} }])) as unknown as typeof fetch;
    expect((await runOpenMeteoScan({ db, clock: new FixedClock('2026-10-16T01:00:00Z'), pins, fetchImpl: bad, resolver })).outcome).toBe('MALFORMED');
    const down = (async () => json({}, 503)) as unknown as typeof fetch;
    const r = await runOpenMeteoScan({ db, clock: new FixedClock('2026-10-16T02:00:00Z'), pins, fetchImpl: down, resolver });
    expect(r).toMatchObject({ outcome: 'UNAVAILABLE', rows: 0 });
    expect(pinCoverage(db).rows).toBe(0);
  });
  it('converts the model GMT hour labels to UTC ISO', async () => {
    expect(toUtcIso('2026-10-15T01:00')).toBe('2026-10-15T01:00:00.000Z');
  });
});
