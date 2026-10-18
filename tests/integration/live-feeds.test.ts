import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/api/server.js';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { listCards, getCardRevision } from '../../src/data/repos/cards.js';
import { getSourceStatus, listEvidence } from '../../src/data/repos/evidence.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { runLiveIngest } from '../../src/services/liveIngest.js';
import { GDACS_SOURCE_ID, USGS_SOURCE_ID, mapGdacs, mapUsgs } from '../../src/sources/liveFeeds.js';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const usgsSample = JSON.parse(readFileSync(here('../fixtures/live/usgs-sample.json'), 'utf8')) as { features: { id: string; properties: Record<string, unknown>; geometry: { coordinates: number[] } }[] };
const gdacsSample = JSON.parse(readFileSync(here('../fixtures/live/gdacs-sample.json'), 'utf8')) as { features: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }[] };
const NOW = '2026-10-15T20:00:00Z';
const PUBLIC_IP = { resolve: async () => ['93.184.216.34'] };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

function freshDb() {
  const db = openDb(':memory:');
  migrate(db, here('../../migrations/'), NOW);
  db.prepare('INSERT INTO tenants (tenant_id, product_id, name) VALUES (?, ?, ?)').run('TENANT-A', 'AEG', 'Tenant A');
  db.prepare('INSERT INTO users (user_id, tenant_id, role, display_name) VALUES (?, ?, ?, ?)').run('USER-A', 'TENANT-A', 'coordinator', 'User A');
  return db;
}

interface Routes { usgs?: () => Response; gdacs?: (type: string, page: number) => Response }
function fakeFetch(routes: Routes): typeof fetch {
  return (async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'earthquake.usgs.gov') return (routes.usgs ?? (() => new Response(JSON.stringify(usgsSample), { status: 200 })))();
    if (url.hostname === 'www.gdacs.org') {
      const type = url.searchParams.get('eventlist') ?? '';
      const page = Number(url.searchParams.get('pageNumber') ?? '1');
      if (routes.gdacs) return routes.gdacs(type, page);
      const mine = gdacsSample.features.filter((f) => f.properties['eventtype'] === type);
      return mine.length === 0 ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ type: 'FeatureCollection', features: mine }), { status: 200 });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
}

const run = (db: ReturnType<typeof openDb>, routes: Routes = {}, now = NOW, ids = new SeqIdGen()) =>
  runLiveIngest({ db, ids, clock: new FixedClock(now), fetchImpl: fakeFetch(routes), resolver: PUBLIC_IP });

describe('live feed mapping (AEG-LIVE-001)', () => {
  it('USGS: keeps ASEAN countries and sea regions, drops the rest, states no estimate and keeps the source URL', () => {
    const recs = mapUsgs(usgsSample);
    const tails = recs.map((r) => r.title.split(',').pop()!.trim());
    expect(tails.sort()).toEqual(['Indonesia', 'Indonesia', 'Indonesia', 'Philippines', 'Philippines']);
    for (const r of recs) {
      expect(r.hazardType).toBe('EARTHQUAKE');
      expect(r.affectedPeopleEstimate).toBeNull();
      expect(r.sourceUrl).toMatch(/^https:\/\/earthquake\.usgs\.gov\/earthquakes\/eventpage\//);
      expect(r.lat).toMatch(/^-?\d+\.\d{6}$/);
      expect(r.publishedAt.endsWith('Z')).toBe(true);
      expect(['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNRATED']).toContain(r.alertLevel);
    }
  });

  it('USGS: an ASEAN sea region is kept only inside the ASEAN box, a non-earthquake type is dropped', () => {
    const base = structuredClone(usgsSample.features[0]!);
    const sea = { ...base, id: 'sea1', properties: { ...base.properties, place: 'Banda Sea', type: 'earthquake' }, geometry: { coordinates: [127.5, -6.0, 10] } };
    const far = { ...base, id: 'sea2', properties: { ...base.properties, place: 'Mid-Atlantic Ridge Sea', type: 'earthquake' }, geometry: { coordinates: [-30, 10, 10] } };
    const blast = { ...base, id: 'q3', properties: { ...base.properties, place: 'Java, Indonesia', type: 'quarry blast' }, geometry: { coordinates: [110, -7, 1] } };
    const ids = mapUsgs({ features: [sea, far, blast] }).map((r) => r.sourceRecordId);
    expect(ids).toEqual(['sea1']);
  });

  it('USGS: a feed with no features array is refused, not treated as zero events', () => {
    expect(() => mapUsgs({ nope: true })).toThrow();
    expect(() => mapUsgs(null)).toThrow();
  });

  it('GDACS: ASEAN-named events only, drought is not mapped, a cyclone card is name + where, ids are stable', () => {
    const recs = mapGdacs(gdacsSample.features, []);
    const byHazard = Object.fromEntries(recs.map((r) => [r.hazardType, r]));
    expect(Object.keys(byHazard).sort()).toEqual(['EARTHQUAKE', 'FLOOD', 'STORM', 'VOLCANO']);   // Serbia wildfire, Panama quake and the drought are gone
    expect(byHazard['STORM']!.title).toMatch(/ - (South China Sea|Philippine Sea|Western North Pacific|Bay of Bengal)/);
    expect(byHazard['STORM']!.lat).toMatch(/^-?\d+\.\d{6}$/);
    expect(byHazard['FLOOD']!.sourceRecordId).toMatch(/^FL-\d+$/);
    for (const r of recs) { expect(r.eventTime.endsWith('Z')).toBe(true); expect(r.title).toMatch(/\(GDACS [A-Z]{2} \d+\)$/); expect(r.affectedPeopleEstimate).toBeNull(); }
  });

  it('GDACS: a cyclone at sea with no country is included by position, far-away storms are not', () => {
    const tc = (name: string, id: number, lon: number, lat: number) => ({ geometry: { coordinates: [lon, lat] }, properties: { eventtype: 'TC', eventid: id, name, country: '', iso3: '', alertlevel: 'Red', fromdate: '2026-10-10T00:00:00', datemodified: '2026-10-16T00:00:00' } });
    const recs = mapGdacs([tc('CHAMPI-26', 1001338, 154.0, 11.3), tc('SCS-26', 5, 112.0, 14.0), tc('KOGUMA-26', 7, 150.0, 38.0), tc('SIMON-26', 8, -110.0, 15.0)], []);
    expect(recs.map((r) => r.title)).toEqual([
      'CHAMPI-26 - Western North Pacific, east of the Philippines (GDACS TC 1001338)',
      'SCS-26 - South China Sea (GDACS TC 5)',
    ]);
  });

  it('GDACS: an earthquake that USGS already reported (20 minutes, 200 km) is not counted twice', () => {
    const quake = gdacsSample.features.find((f) => f.properties['eventtype'] === 'EQ' && String(f.properties['country']).includes('Indonesia'))!;
    const u = mapUsgs(usgsSample)[0]!;
    const twin = structuredClone(quake);
    twin.properties['fromdate'] = new Date(Date.parse(u.eventTime) + 5 * 60_000).toISOString().slice(0, 19);
    twin.geometry.coordinates = [Number(u.lon) + 0.3, Number(u.lat) - 0.2];
    expect(mapGdacs([twin], [u])).toEqual([]);
    expect(mapGdacs([twin], [])).toHaveLength(1);
  });
});

describe('live ingestion into the evidence store (AEG-LIVE-001)', () => {
  it('writes public, non-synthetic evidence and cards that say so, with no demo label', async () => {
    const db = freshDb();
    const r = await run(db);
    expect(r.usgs).toMatchObject({ outcome: 'OK', fetched: 9, kept: 5, inserted: 5 });
    expect(r.gdacs.outcome).toBe('OK');
    expect(r.gdacs.inserted).toBe(4);
    const evidence = listEvidence(db);
    expect(evidence).toHaveLength(9);
    for (const e of evidence) {
      expect(e.synthetic).toBe(false);
      expect(e.tenantScope).toBeNull();
      expect(e.intakeFlags).not.toContain('SYNTHETIC');
      expect(e.payload.affectedPeopleEstimate).toBeNull();
      expect(e.licenceRef).toMatch(/^LIC\.(USGS|GDACS)/);
    }
    const cards = listCards(db, 'TENANT-A', 'incident');
    expect(cards).toHaveLength(9);
    const body = getCardRevision(db, 'TENANT-A', cards[0]!.cardId, cards[0]!.revision)!.body;
    expect(body.synthetic).toBe(false);
    expect(body.syntheticLabel).toBeNull();
    expect(getSourceStatus(db, USGS_SOURCE_ID)?.state).toBe('OK');
    expect(getSourceStatus(db, GDACS_SOURCE_ID)?.state).toBe('OK');
  });

  it('a second identical run changes nothing; a changed alert level becomes revision 2 and supersedes revision 1', async () => {
    const db = freshDb();
    const ids = new SeqIdGen();
    await run(db, {}, NOW, ids);
    const second = await run(db, {}, '2026-10-15T20:15:00Z', ids);
    expect(second.usgs).toMatchObject({ inserted: 0, duplicates: 5 });
    expect(second.gdacs).toMatchObject({ inserted: 0, duplicates: 4 });
    expect(listEvidence(db)).toHaveLength(9);

    const changed = structuredClone(usgsSample);
    changed.features.find((f) => f.id === mapUsgs(usgsSample)[0]!.sourceRecordId)!.properties['alert'] = 'orange';
    const third = await run(db, { usgs: () => new Response(JSON.stringify(changed), { status: 200 }) }, '2026-10-15T20:30:00Z', ids);
    expect(third.usgs).toMatchObject({ inserted: 1, superseded: 1 });
    const revs = listEvidence(db).filter((e) => e.sourceId === USGS_SOURCE_ID && e.sourceRecordId === mapUsgs(usgsSample)[0]!.sourceRecordId);
    expect(revs.map((e) => e.revision)).toEqual([1, 2]);
    expect(revs[1]!.payload.alertLevel).toBe('ORANGE');
  });

  it('a failed feed only changes its status; evidence already stored stays', async () => {
    const db = freshDb();
    const ids = new SeqIdGen();
    await run(db, {}, NOW, ids);
    const down = await run(db, { usgs: () => new Response('bad gateway', { status: 502 }), gdacs: () => { throw new Error('socket hang up'); } }, '2026-10-15T21:00:00Z', ids);
    expect(down.usgs).toMatchObject({ outcome: 'UNAVAILABLE', inserted: 0 });
    expect(down.gdacs.outcome).toBe('UNAVAILABLE');
    expect(listEvidence(db)).toHaveLength(9);
    expect(getSourceStatus(db, USGS_SOURCE_ID)?.state).toBe('UNAVAILABLE');
    expect(getSourceStatus(db, USGS_SOURCE_ID)?.lastOkAt).toBe('2026-10-15T20:00:00.000Z');
  });

  it('a malformed USGS body is MALFORMED, and a GDACS type that fails leaves the other types in place', async () => {
    const db = freshDb();
    const r = await run(db, {
      usgs: () => new Response('<html>not json</html>', { status: 200 }),
      gdacs: (type) => (type === 'FL' ? new Response('boom', { status: 500 }) : (type === 'VO'
        ? new Response(JSON.stringify({ features: gdacsSample.features.filter((f) => f.properties['eventtype'] === 'VO') }), { status: 200 })
        : new Response(null, { status: 204 }))),
    });
    expect(r.usgs.outcome).toBe('MALFORMED');
    expect(r.gdacs.outcome).toBe('OK');
    expect(r.gdacs.inserted).toBe(1);
    expect(r.gdacs.detail).toMatch(/FL:HTTP 500/);
  });

  it('GDACS paging stops at a short page and follows full pages', async () => {
    const db = freshDb();
    const eq = gdacsSample.features.find((f) => f.properties['eventtype'] === 'EQ' && String(f.properties['country']).includes('Indonesia'))!;
    const pageCalls: number[] = [];
    const full = Array.from({ length: 100 }, (_, i) => { const c = structuredClone(eq); c.properties['eventid'] = 5000 + i; return c; });
    await run(db, { gdacs: (type, page) => {
      if (type !== 'EQ') return new Response(null, { status: 204 });
      pageCalls.push(page);
      return page === 1 ? new Response(JSON.stringify({ features: full }), { status: 200 }) : new Response(JSON.stringify({ features: [] }), { status: 200 });
    } });
    expect(pageCalls).toEqual([1, 2]);
  });

  it('the guarded fetch refuses a feed host that resolves to a private address', async () => {
    const db = freshDb();
    const r = await runLiveIngest({ db, ids: new SeqIdGen(), clock: new FixedClock(NOW), fetchImpl: fakeFetch({}), resolver: { resolve: async () => ['10.0.0.5'] } });
    expect(r.usgs.outcome).toBe('UNAVAILABLE');
    expect(r.usgs.detail).toMatch(/non-public/);
    expect(listEvidence(db)).toHaveLength(0);
  });

  it('the public summary counts the live incidents as real, not synthetic', async () => {
    const db = freshDb();
    const ids = new SeqIdGen();
    await run(db, {}, NOW, ids);
    const app = createApp({ db, clock: new FixedClock(NOW), ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) });
    apps.push(app);
    const res = await app.inject({ method: 'GET', url: '/public/hazards/summary?limit=10' });
    const body = res.json() as { domains: { number: number; activeCount: number; activeIsSynthetic: boolean; incidents: { synthetic: boolean; syntheticLabel: string | null }[] }[] };
    const seismic = body.domains.find((d) => d.number === 1)!;
    // every mapped earthquake whose report is newer than its source's validity window (USGS 72 h, GDACS 168 h) counts exactly once
    const hours = (h: number) => h * 3_600_000;
    const usgsRecs = mapUsgs(usgsSample);
    const expectedUsgs = usgsRecs.filter((r) => Date.parse(r.publishedAt) + hours(72) >= Date.parse(NOW)).length;
    const expectedGdacsEq = mapGdacs(gdacsSample.features, usgsRecs).filter((r) => r.hazardType === 'EARTHQUAKE' && Date.parse(r.publishedAt) + hours(168) >= Date.parse(NOW)).length;
    expect(seismic.activeCount).toBe(expectedUsgs + expectedGdacsEq);
    expect(expectedUsgs).toBeGreaterThanOrEqual(3);
    expect(seismic.activeIsSynthetic).toBe(false);
    expect(seismic.incidents.every((i) => i.synthetic === false && i.syntheticLabel === null)).toBe(true);
    const freshGdacs = (hazard: string) => mapGdacs(gdacsSample.features, usgsRecs).filter((r) => r.hazardType === hazard && Date.parse(r.publishedAt) + hours(168) >= Date.parse(NOW)).length;
    expect(body.domains.find((d) => d.number === 7)!.activeCount).toBe(freshGdacs('VOLCANO'));
    expect(body.domains.find((d) => d.number === 2)!.activeCount).toBe(freshGdacs('FLOOD'));
    expect(body.domains.find((d) => d.number === 3)!.activeCount).toBe(freshGdacs('STORM'));
    expect(freshGdacs('VOLCANO')).toBeGreaterThanOrEqual(1);                                    // the Philippine volcano event is within its window
  });
});
