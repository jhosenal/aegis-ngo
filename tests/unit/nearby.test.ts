import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerEnvironmentRoute } from '../../src/api/routes/environment.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { insertEvidence } from '../../src/data/repos/evidence.js';
import { FixedClock } from '../../src/engine/clock.js';
import { currentIncidentPoints, nearbyFor, type IncidentPoint } from '../../src/services/nearby.js';
import { EnvStore } from '../../src/services/envStore.js';
import { loadPinRegistry } from '../../src/sources/pinRegistry.js';
import type { EvidenceRecord } from '../../src/types/domain.js';

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const NOW = '2026-10-16T10:00:00.000Z';
const pt = (key: string, hazard: IncidentPoint['hazard'], lat: number, lon: number): IncidentPoint => ({ incidentKey: key, title: key, hazard, alertLevel: 'GREEN', lat, lon, sourceId: 'SRC.USGS.LIVE', eventTime: null });

describe('incidents near a place (AEG-NEARBY-001)', () => {
  const bentong = { lat: 3.5222, lng: 101.909 };
  it('counts by hazard within 100 km, nearest first, and leaves out what is further away', () => {
    const points = [pt('quake-near', 'earthquake', 3.6, 101.9), pt('flood-60km', 'flood', 3.0, 102.2), pt('storm-far', 'storm', 11.3, 154.0), pt('fire-300km', 'wildfire', 1.3, 103.8)];
    const n = nearbyFor(points, bentong);
    expect(n).toMatchObject({ radiusKm: 100, total: 2, counts: { earthquake: 1, flood: 1, storm: 0, wildfire: 0, volcano: 0 } });
    expect(n.items.map((i) => i.title)).toEqual(['quake-near', 'flood-60km']);
    expect(n.items[0]!.distanceKm).toBeLessThan(15);
    expect(n.note).toContain('Zero means none recorded by those feeds, not that nothing is happening');
    expect(nearbyFor([], bentong)).toMatchObject({ total: 0, counts: { earthquake: 0 } });
  });

  const rec = (key: string, hazard: string, lat: number, lon: number, over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
    evidenceId: `EV-${key}`, tenantScope: null, sourceId: 'SRC.USGS.LIVE', sourceRecordId: key, revision: 1, supersedesEvidenceId: null, sourceUrl: 'https://example.org', licenceRef: 'LIC.T',
    eventTime: '2026-10-16T08:00:00Z', publishedAt: '2026-10-16T08:10:00Z', fetchedAt: '2026-10-16T08:20:00Z', validUntil: '2026-10-19T08:10:00Z', regionId: 'REGION.MALAYSIA',
    rawArtifactHash: 'a', normalizedPayloadHash: 'b', adapterVersion: 't', intakeFlags: [],
    payload: { incidentKey: `K.${key}`, title: key, hazardType: hazard, alertLevel: 'GREEN', regionId: 'REGION.MALAYSIA', latE6: Math.round(lat * 1e6), lonE6: Math.round(lon * 1e6), affectedPeopleEstimate: null },
    synthetic: false, ...over,
  }) as EvidenceRecord;

  it('uses only current, real, located incidents (not stale, not synthetic, not without coordinates)', () => {
    const db = openDb(':memory:'); migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    for (const r of [
      rec('quake', 'EARTHQUAKE', 3.6, 101.9), rec('stale', 'FLOOD', 3.6, 101.9, { validUntil: '2026-10-16T09:00:00Z' }), rec('demo', 'FLOOD', 3.6, 101.9, { synthetic: true }),
      rec('nocoord', 'STORM', 0, 0, { payload: { incidentKey: 'K.nocoord', title: 'x', hazardType: 'STORM', alertLevel: 'RED', regionId: 'R', latE6: null, lonE6: null, affectedPeopleEstimate: null } } as Partial<EvidenceRecord>),
    ]) insertEvidence(db, r);
    expect(currentIncidentPoints(db, NOW).map((p) => p.incidentKey)).toEqual(['K.quake']);
    db.close();
  });

  it('every place in /public/environment carries nearby counts, and the single-place route too', async () => {
    const db = openDb(':memory:'); migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    insertEvidence(db, rec('quake', 'EARTHQUAKE', 3.6, 101.9));
    const registry = loadPinRegistry();
    const app = Fastify(); registerEnvironmentRoute(app, registry, new EnvStore(), new FixedClock(NOW), null, db);
    const all = (await app.inject('/public/environment')).json() as { pins: { pinId: string; nearby: { total: number; counts: { earthquake: number } } }[] };
    expect(all.pins).toHaveLength(125);
    expect(all.pins.every((p) => p.nearby !== null)).toBe(true);
    const bentongPin = all.pins.find((p) => p.pinId === 'my-34')!;
    expect(bentongPin.nearby.counts.earthquake).toBe(1);
    expect(all.pins.find((p) => p.pinId === 'sg-01')!.nearby.total).toBe(0);   // Orchard Road is far from that quake
    const one = (await app.inject('/public/environment/pin/my-34')).json() as { pin: { nearby: { total: number } } };
    expect(one.pin.nearby.total).toBe(1);
    await app.close(); db.close();
  });
});
