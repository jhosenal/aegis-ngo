import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/api/server.js';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { seedAll } from '../../src/services/seed.js';
import { buildHazardSummary, domainOfHazard, loadCatalogue, loadFeatured } from '../../src/services/hazardSummary.js';
import { toEvidenceViews } from '../../src/sources/evidenceView.js';
import type { EvidenceRecord } from '../../src/types/domain.js';

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

const NOW = '2026-10-13T12:00:00Z';
const SEED_NOW = '2026-10-13T00:00:00Z';   // fixtures/clock.json: the seed refuses any other clock
function harness() {
  const db = openDb(':memory:');
  const ids = new SeqIdGen();
  migrate(db, migrationDirectory, SEED_NOW);
  seedAll(db, fixturesDirectory, new FixedClock(SEED_NOW), ids);
  const app = createApp({ db, clock: new FixedClock(SEED_NOW), ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) });
  apps.push(app);
  return app;
}

function record(over: Partial<EvidenceRecord> & { key: string; hazard: string; alert?: string; people?: number | null; revision?: number; validUntil?: string | null; synthetic?: boolean; tenant?: string | null; source?: string; published?: string }): EvidenceRecord {
  const { key, hazard, alert = 'ORANGE', people = 100, revision = 1, validUntil = '2026-10-20T00:00:00Z', synthetic = true, tenant = null, source = 'SRC.T', published = '2026-10-12T00:00:00Z', ...rest } = over;
  return {
    evidenceId: `EV-${key}-${source}-r${revision}`, tenantScope: tenant, sourceId: source, sourceRecordId: key, revision, supersedesEvidenceId: null,
    sourceUrl: null, licenceRef: 'LIC.T', eventTime: '2026-10-12T00:00:00Z', publishedAt: published, fetchedAt: '2026-10-12T01:00:00Z', validUntil,
    regionId: 'REGION.T', rawArtifactHash: 'a', normalizedPayloadHash: 'b', adapterVersion: 't', intakeFlags: [],
    payload: { incidentKey: `INC.${key}`, title: `Title ${key}`, hazardType: hazard, alertLevel: alert, regionId: 'REGION.T', latE6: 4_500_000, lonE6: 101_100_000, affectedPeopleEstimate: people },
    synthetic, ...rest,
  } as EvidenceRecord;
}

const catalogue = loadCatalogue();
const featured = loadFeatured();
const summarise = (records: EvidenceRecord[], limit = 3) => buildHazardSummary(toEvidenceViews(records, null, NOW), catalogue, featured, NOW, limit);

describe('hazard summary for the landing page (AEG-HOME-001)', () => {
  it('maps hazard types to the seven domains and leaves unknown types unmapped', () => {
    expect(domainOfHazard('EARTHQUAKE')).toBe(1);
    expect(domainOfHazard('flash flood')).toBe(2);
    expect(domainOfHazard('Typhoon')).toBe(3);
    expect(domainOfHazard('HAZE')).toBe(4);
    expect(domainOfHazard('OUTBREAK')).toBe(5);
    expect(domainOfHazard('VOLCANO')).toBe(7);
    expect(domainOfHazard('ALIEN')).toBeNull();
  });

  it('always returns all seven domains, in order, each with its reference incidents', () => {
    const s = summarise([]);
    expect(s.domains.map((d) => d.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.domains.every((d) => d.activeCount === 0 && d.incidents.length === 0)).toBe(true);
    expect(s.domains.every((d) => d.reference.length >= 2)).toBe(true);
    expect(s.domains.map((d) => d.reference.length)).toEqual([3, 3, 3, 3, 3, 3, 3]);
  });

  it('counts distinct active incidents per domain; stale and superseded revisions do not count', () => {
    const s = summarise([
      record({ key: 'F1', hazard: 'FLOOD' }),
      record({ key: 'F2', hazard: 'FLOOD', validUntil: '2026-10-01T00:00:00Z' }),            // stale
      record({ key: 'F3', hazard: 'FLOOD', revision: 1 }), record({ key: 'F3', hazard: 'FLOOD', revision: 2 }), // one incident, latest revision
      record({ key: 'Q1', hazard: 'EARTHQUAKE' }),
    ]);
    expect(s.domains[1]!.activeCount).toBe(2);
    expect(s.domains[0]!.activeCount).toBe(1);
  });

  it('counts one incident reported by two feeds once', () => {
    const a = record({ key: 'A', hazard: 'FLOOD', source: 'SRC.A' });
    const b = { ...record({ key: 'B', hazard: 'FLOOD', source: 'SRC.B', published: '2026-10-12T09:00:00Z' }), payload: { ...a.payload } };
    const s = summarise([a, b]);
    expect(s.domains[1]!.activeCount).toBe(1);
  });

  it('lists the biggest incidents first and bounds the list, not the count', () => {
    const recs = [
      record({ key: 'G', hazard: 'FLOOD', alert: 'GREEN', people: 5 }),
      record({ key: 'R', hazard: 'FLOOD', alert: 'RED', people: 10 }),
      record({ key: 'O1', hazard: 'FLOOD', alert: 'ORANGE', people: 900 }),
      record({ key: 'O2', hazard: 'FLOOD', alert: 'ORANGE', people: 50 }),
    ];
    const d = summarise(recs, 2).domains[1]!;
    expect(d.activeCount).toBe(4);
    expect(d.incidents.map((i) => i.title)).toEqual(['Title R', 'Title O1']);
  });

  it('keeps unknown location and unknown people unknown, and labels synthetic data', () => {
    const r = record({ key: 'X', hazard: 'STORM', people: null });
    r.payload.latE6 = null; r.payload.lonE6 = null;
    const i = summarise([r]).domains[2]!.incidents[0]!;
    expect(i.latE6).toBeNull();
    expect(i.fields.find((f) => f.key === 'location')).toMatchObject({ value: null, epistemic: 'unknown' });
    expect(i.fields.find((f) => f.key === 'affectedPeopleEstimate')).toMatchObject({ value: null, epistemic: 'unknown' });
    expect(i.syntheticLabel).toContain('SYNTHETIC');
    expect(summarise([r]).domains[2]!.activeIsSynthetic).toBe(true);
  });

  it('counts unmapped hazard types separately, never inside a domain', () => {
    const s = summarise([record({ key: 'Z', hazard: 'ALIEN' })]);
    expect(s.unmappedActive).toBe(1);
    expect(s.domains.reduce((n, d) => n + d.activeCount, 0)).toBe(0);
  });

  it('every reference card carries its provenance and tags; sourced ones are complete, unsourced ones carry no source facts', () => {
    const cards = summarise([]).domains.flatMap((d) => d.reference);
    expect(cards.length).toBe(21);
    for (const c of cards) {
      expect(c.tags.length).toBeGreaterThanOrEqual(3);
      expect(c.tags).toContain(`status:${c.status.toLowerCase()}`);
      expect(c.fields.find((f) => f.key === 'affectedPeopleEstimate')).toMatchObject({ value: null, epistemic: 'unknown' });
      if (c.status === 'SOURCED') {
        expect(c.provenance.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(c.provenance.rawSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(c.provenance.licence.attribution).toBeTruthy();
        expect(c.provenance.sourcePage).toMatch(/^https:\/\//);
      } else {
        expect(c.provenance.sourceId).toBeNull();
        expect(c.measurements).toEqual([]);
      }
    }
    expect(cards.filter((c) => c.status === 'SOURCED')).toHaveLength(10);
  });

  it('the raw source files on disk still match the hashes recorded on the cards', async () => {
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const root = fileURLToPath(new URL('../../', import.meta.url));
    for (const c of featured.incidents.filter((i) => i.status === 'SOURCED')) {
      const bytes = readFileSync(`${root}${c.provenance.rawFile}`);
      expect(createHash('sha256').update(bytes).digest('hex'), c.id).toBe(c.provenance.rawSha256);
    }
  });

  it('cyclone cards keep their location unknown (a GDACS track point is not an impact location) and state no casualty figures', () => {
    const storms = summarise([]).domains[2]!.reference;
    expect(storms).toHaveLength(3);
    for (const c of storms) expect(c.location).toMatchObject({ latE6: null, lonE6: null });
    expect(JSON.stringify(featured.incidents)).not.toMatch(/\b(killed|deaths?|casualt\w*|fatalit\w*)\b/i);
  });

  it('is public: it answers without a token, uses public evidence only, and shows the seeded synthetic demo', async () => {
    const app = harness();
    const res = await app.inject({ method: 'GET', url: '/public/hazards/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=60');
    const body = res.json() as { domains: { number: number; activeCount: number; activeIsSynthetic: boolean }[]; remarks: string[] };
    expect(body.domains).toHaveLength(7);
    const flood = body.domains.find((d) => d.number === 2)!;
    expect(flood.activeCount).toBe(1);                    // the seeded synthetic flood
    expect(flood.activeIsSynthetic).toBe(true);
    expect(body.domains.find((d) => d.number === 3)!.activeCount).toBe(0);   // the 2026-09-20 storm is stale
    const quake = (res.json() as { domains: { number: number; incidents: { latE6: number | null }[] }[] }).domains.find((d) => d.number === 1)!;
    expect(quake.incidents[0]!.latE6).toBeNull();          // bad coordinates stay unknown, never repaired
    expect(JSON.stringify(body)).not.toMatch(/tenant/i);
    const limited = await app.inject({ method: 'GET', url: '/public/hazards/summary?limit=99' });
    expect(limited.statusCode).toBe(200);
  });
});
