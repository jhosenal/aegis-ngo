import { afterEach, describe, expect, it } from 'vitest';
import { loadChain, verifyStored } from '../../src/audit/chainStore.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { hashWithDomain } from '../../src/engine/canonical.js';
import { listEvidence } from '../../src/data/repos/evidence.js';
import { toEvidenceViews } from '../../src/sources/evidenceView.js';
import { seedAll } from '../../src/services/seed.js';
import { projectIncidentCards } from '../../src/services/incidentCards.js';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const fixturesDir = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const migrationDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const databases: ReturnType<typeof openDb>[] = [];

function freshDb(): ReturnType<typeof openDb> {
  const db = openDb(':memory:');
  databases.push(db);
  migrate(db, migrationDir, '2026-10-13T00:00:00Z');
  return db;
}

function seed(db: ReturnType<typeof openDb>) {
  return seedAll(db, fixturesDir, new FixedClock('2026-10-13T00:00:00Z'), new SeqIdGen());
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('fixture evidence pipeline', () => {
  it('applies all fixture polls with the specified evidence ids, duplicate and supersede behavior', () => {
    const db = freshDb();
    const summary = seed(db);
    const evidence = listEvidence(db);
    const ids = evidence.map((record) => record.evidenceId).sort();
    expect(ids).toEqual([
      'EV-SYN-B-7781-r1',
      'EV-SYN-BADCOORD-0003-r1',
      'EV-SYN-FLOOD-0001-r1',
      'EV-SYN-FLOOD-0001-r2',
      'EV-SYN-STALE-0002-r1',
    ]);
    expect(summary.polls[1]!.duplicates).toEqual(['SYN-FLOOD-0001']);
    expect(summary.polls[1]!.inserted).toEqual([]);
    expect(summary.polls[2]!.inserted).toEqual(['EV-SYN-FLOOD-0001-r2']);
    expect(summary.polls[2]!.superseded).toEqual([{ old: 'EV-SYN-FLOOD-0001-r1', new: 'EV-SYN-FLOOD-0001-r2' }]);
    const firstFlood = evidence.find((record) => record.evidenceId === 'EV-SYN-FLOOD-0001-r1')!;
    const revisedFlood = evidence.find((record) => record.evidenceId === 'EV-SYN-FLOOD-0001-r2')!;
    expect(firstFlood.supersedesEvidenceId).toBeNull();
    expect(revisedFlood.supersedesEvidenceId).toBe('EV-SYN-FLOOD-0001-r1');
    const fixture = JSON.parse(readFileSync(new URL('../../fixtures/feed-polls.json', import.meta.url), 'utf8')) as {
      polls: { records: unknown[] }[];
    };
    expect(firstFlood.rawArtifactHash).toBe(hashWithDomain('AEG-EVIDENCE-v1', fixture.polls[0]!.records[0]));
    expect(firstFlood.normalizedPayloadHash).toBe(hashWithDomain('AEG-EVIDENCE-v1', firstFlood.payload));
    expect(evidence.every((record) => record.intakeFlags.includes('SYNTHETIC') && record.synthetic)).toBe(true);
  });

  it('computes validity, derived flags and coordinates from fixture evidence', () => {
    const db = freshDb();
    seed(db);
    const records = listEvidence(db);
    const views = toEvidenceViews(records, null, '2026-10-13T01:00:00Z');
    const byId = new Map(views.map((view) => [view.evidenceId, view]));

    expect(Object.fromEntries(records.map((record) => [record.evidenceId, record.validUntil]))).toEqual({
      'EV-SYN-FLOOD-0001-r1': '2026-10-14T07:30:00Z',
      'EV-SYN-FLOOD-0001-r2': '2026-10-15T00:20:00Z',
      'EV-SYN-STALE-0002-r1': '2026-09-22T08:00:00Z',
      'EV-SYN-BADCOORD-0003-r1': '2026-10-13T23:00:00Z',
      'EV-SYN-B-7781-r1': '2026-10-14T09:00:00Z',
    });
    expect(byId.get('EV-SYN-FLOOD-0001-r1')!.flags).toContain('SUPERSEDED');
    expect(byId.get('EV-SYN-FLOOD-0001-r2')!.flags).toContain('CONFLICTING');
    expect(byId.get('EV-SYN-B-7781-r1')!.flags).toContain('CONFLICTING');
    expect(byId.get('EV-SYN-STALE-0002-r1')!.flags).toContain('STALE');
    expect(byId.get('EV-SYN-BADCOORD-0003-r1')!.flags).toEqual(['SYNTHETIC', 'COORD_INVALID']);
    expect(byId.get('EV-SYN-BADCOORD-0003-r1')!.payload).toMatchObject({ latE6: null, lonE6: null });
    expect(byId.get('EV-SYN-FLOOD-0001-r1')!.payload).toMatchObject({ latE6: 4_500_000, lonE6: 101_100_000 });
    expect(byId.get('EV-SYN-STALE-0002-r1')!.payload.latE6).toBe(-2_250_000);
  });

  it('keeps source status and feed B evidence on unavailable and malformed polls', () => {
    const db = freshDb();
    seed(db);
    const statuses = db.prepare('SELECT source_id, state, last_ok_at, last_attempt_at, detail FROM source_status ORDER BY source_id').all() as Array<{
      source_id: string; state: string; last_ok_at: string | null; last_attempt_at: string; detail: string | null;
    }>;
    expect(statuses).toEqual([
      { source_id: 'SRC.SYNTH_FEED_A', state: 'OK', last_ok_at: '2026-10-13T00:30:00Z', last_attempt_at: '2026-10-13T00:30:00Z', detail: null },
      { source_id: 'SRC.SYNTH_FEED_B', state: 'MALFORMED', last_ok_at: '2026-10-13T00:35:00Z', last_attempt_at: '2026-10-13T00:50:00Z', detail: 'Simulated unparseable body' },
    ]);
    const retained = listEvidence(db).find((record) => record.evidenceId === 'EV-SYN-B-7781-r1');
    expect(retained?.fetchedAt).toBe('2026-10-13T00:35:00Z');
    const fixture = JSON.parse(readFileSync(new URL('../../fixtures/feed-polls.json', import.meta.url), 'utf8')) as {
      polls: { records: unknown[] }[];
    };
    expect(retained?.rawArtifactHash).toBe(hashWithDomain('AEG-EVIDENCE-v1', fixture.polls[3]!.records[0]));

    const systemChain = loadChain(db, { productId: 'AEG', tenantId: 'SYSTEM' });
    expect(systemChain).toHaveLength(7);
    expect(systemChain.filter((event) => event.eventType === 'evidence.ingested')).toHaveLength(5);
    expect(systemChain.filter((event) => event.eventType === 'source.status_changed')).toHaveLength(2);
    expect(verifyStored(db, { productId: 'AEG', tenantId: 'SYSTEM' }).ok).toBe(true);
  });

  it('projects four incident cards and five revisions per tenant and is idempotent', () => {
    const db = freshDb();
    seed(db);
    const counts = db.prepare('SELECT tenant_id, COUNT(*) AS count FROM cards GROUP BY tenant_id ORDER BY tenant_id').all() as Array<{ tenant_id: string; count: number }>;
    expect(counts).toEqual([{ tenant_id: 'TENANT-A', count: 4 }, { tenant_id: 'TENANT-B', count: 4 }]);
    const cardIds = db.prepare('SELECT card_id FROM cards WHERE tenant_id = ? ORDER BY card_id').all('TENANT-A') as Array<{ card_id: string }>;
    expect(cardIds.map((row) => row.card_id)).toEqual([
      'INC-TENANT-A-SYN-B-7781',
      'INC-TENANT-A-SYN-BADCOORD-0003',
      'INC-TENANT-A-SYN-FLOOD-0001',
      'INC-TENANT-A-SYN-STALE-0002',
    ]);
    const revisions = db.prepare('SELECT c.tenant_id, COUNT(*) AS count FROM card_revisions AS r JOIN cards AS c ON c.card_id = r.card_id GROUP BY c.tenant_id ORDER BY c.tenant_id').all() as Array<{ tenant_id: string; count: number }>;
    expect(revisions).toEqual([{ tenant_id: 'TENANT-A', count: 5 }, { tenant_id: 'TENANT-B', count: 5 }]);
    expect(db.prepare('SELECT state FROM card_revisions WHERE card_id = ? AND revision = ?').get('INC-TENANT-A-SYN-FLOOD-0001', 1)).toEqual({ state: 'superseded' });
    expect(db.prepare('SELECT state FROM card_revisions WHERE card_id = ? AND revision = ?').get('INC-TENANT-A-SYN-FLOOD-0001', 2)).toEqual({ state: 'validated' });
    const bodyRow = db.prepare('SELECT body_json FROM card_revisions WHERE card_id = ? AND revision = ?').get('INC-TENANT-A-SYN-BADCOORD-0003', 1) as { body_json: string };
    const body = JSON.parse(bodyRow.body_json) as { synthetic: boolean; syntheticLabel: string | null; fields: { key: string; value: unknown; epistemic: string }[] };
    expect(body.synthetic).toBe(true);
    expect(body.syntheticLabel).toBe('SYNTHETIC DEMO DATA - not a real event');
    expect(body.fields.find((field) => field.key === 'location')).toMatchObject({ value: null, epistemic: 'unknown' });

    const before = db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number };
    const secondProjection = projectIncidentCards(db, new SeqIdGen(), '2026-10-13T00:00:00.000Z');
    const after = db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number };
    expect(secondProjection.created).toEqual([]);
    expect(after.count).toBe(before.count);

    const eventsBeforeSeedRerun = after.count;
    const secondSeed = seed(db);
    const eventsAfterSeedRerun = db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number };
    expect(secondSeed.polls).toEqual([]);
    expect(eventsAfterSeedRerun.count).toBe(eventsBeforeSeedRerun);
    expect(listEvidence(db)).toHaveLength(5);
  });

  it('produces identical evidence ids and hashes in two fresh seeded databases', () => {
    const firstDb = freshDb();
    const secondDb = freshDb();
    seed(firstDb);
    seed(secondDb);
    const selectHashes = (db: ReturnType<typeof openDb>) => listEvidence(db).map((record) => ({
      evidenceId: record.evidenceId,
      rawArtifactHash: record.rawArtifactHash,
      normalizedPayloadHash: record.normalizedPayloadHash,
    }));
    expect(selectHashes(firstDb)).toEqual(selectHashes(secondDb));
  });
});
