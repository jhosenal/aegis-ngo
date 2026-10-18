import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { insertEvidence, upsertSourceStatus } from '../../src/data/repos/evidence.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { generateLatestBulletin } from '../../src/services/broadcast/generate.js';
import { buildFactSheet } from '../../src/services/broadcast/factSheet.js';
import { latestAir, latestCapture, loadSchedule, msUntilLocalTime, nextAir, nextCapture, slotTimes } from '../../src/services/broadcast/schedule.js';
import { buildScript, validateScript } from '../../src/services/broadcast/script.js';
import type { EvidenceRecord } from '../../src/types/domain.js';

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const schedule = loadSchedule();

function quake(key: string, title: string, region: string, over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: `EV-${key}`, tenantScope: null, sourceId: 'SRC.USGS.LIVE', sourceRecordId: key, revision: 1, supersedesEvidenceId: null,
    sourceUrl: 'https://example.org/x', licenceRef: 'LIC.USGS-PUBLIC-DOMAIN-CREDIT-USGS', eventTime: '2026-10-15T20:30:00Z', publishedAt: '2026-10-15T20:40:00Z',
    fetchedAt: '2026-10-15T21:00:00Z', validUntil: '2026-10-18T20:40:00Z', regionId: region, rawArtifactHash: 'a', normalizedPayloadHash: 'b', adapterVersion: 't', intakeFlags: [],
    payload: { incidentKey: `USGS.${key}`, title, hazardType: 'EARTHQUAKE', alertLevel: 'GREEN', regionId: region, latE6: 5_000_000, lonE6: 115_000_000, affectedPeopleEstimate: null },
    synthetic: false, ...over,
  } as EvidenceRecord;
}

function harness(records: EvidenceRecord[], now: string) {
  const db = openDb(':memory:');
  migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
  for (const r of records) insertEvidence(db, r);
  const ok = (id: string, lastOkAt: string) => upsertSourceStatus(db, { sourceId: id, state: 'OK', lastOkAt, lastAttemptAt: lastOkAt, detail: null });
  ok('SRC.USGS.LIVE', '2026-10-15T21:50:00Z');
  ok('SRC.GDACS.LIVE', '2026-10-15T21:50:00Z');
  return { db, clock: new FixedClock(now), ids: new SeqIdGen() };
}

describe('broadcast schedule (AEG-NEWS-004)', () => {
  it('derives the UTC times from the local air time, the capture lead and the offset', () => {
    expect(slotTimes(schedule).map((s) => `${s.airLocal} air, ${s.captureLocal} capture, ${s.captureUtc} UTC`)).toEqual([
      '07:00 air, 06:00 capture, 22:00 UTC', '12:00 air, 11:00 capture, 03:00 UTC', '17:00 air, 16:00 capture, 08:00 UTC', '22:00 air, 21:00 capture, 13:00 UTC',
    ]);
  });
  it('finds the latest and the next capture across midnight UTC', () => {
    expect(latestCapture(schedule, '2026-10-15T22:30:00Z')).toMatchObject({ slot: { id: 'morning' }, captureAt: '2026-10-15T22:00:00.000Z', airAt: '2026-10-15T23:00:00.000Z' });
    expect(latestCapture(schedule, '2026-10-16T02:00:00Z').slot.id).toBe('morning');
    expect(nextCapture(schedule, '2026-10-15T22:30:00Z')).toMatchObject({ slot: { id: 'midday' }, captureAt: '2026-10-16T03:00:00.000Z' });
    expect(nextCapture(schedule, '2026-10-16T13:00:00Z').captureAt).toBe('2026-10-16T22:00:00.000Z');
  });
  it('finds the four daily air and weather update times (07:00, 12:00, 17:00, 22:00 local) across midnight UTC', () => {
    expect(nextAir(schedule, '2026-10-15T22:30:00Z')).toMatchObject({ slot: { id: 'morning' }, at: '2026-10-15T23:00:00.000Z' });
    expect(nextAir(schedule, '2026-10-16T09:00:00Z').at).toBe('2026-10-16T14:00:00.000Z');
    expect(latestAir(schedule, '2026-10-16T09:30:00Z')).toMatchObject({ slot: { id: 'evening' }, at: '2026-10-16T09:00:00.000Z' });
    expect(latestAir(schedule, '2026-10-16T00:30:00Z').slot.id).toBe('morning');
  });
  it('computes the wait until a local clock time for a one-off test run, across midnight, and refuses a bad time', () => {
    expect(msUntilLocalTime('2026-10-16T10:09:00Z', '18:30', 8)).toBe(21 * 60_000);            // 18:09 local -> 18:30 local
    expect(msUntilLocalTime('2026-10-16T10:30:00Z', '18:30', 8)).toBe(24 * 3_600_000);         // exactly now: tomorrow
    expect(msUntilLocalTime('2026-10-16T15:00:00Z', '01:15', 8)).toBe(2.25 * 3_600_000);       // 23:00 local -> 01:15 local
    expect(msUntilLocalTime('2026-10-16T10:00:00Z', '6:30pm', 8)).toBeNull();
  });
  it('never lists Google among the narrated sources and says why', () => {
    expect(schedule.narratedSources.map((s) => s.sourceId)).toEqual(['SRC.USGS.LIVE', 'SRC.GDACS.LIVE', 'SRC.NEA.PSI.LIVE', 'SRC.METMY.LIVE']);
    expect(schedule.neverNarrated[0]!.name).toMatch(/Google/);
    expect(schedule.languages.filter((l) => l.state === 'active').map((l) => l.code)).toEqual(['en']);
  });
});

describe('bulletin generator', () => {
  const NOW = '2026-10-15T22:05:00Z';   // just after the 06:00 MYT capture of 16 October
  const records = [
    quake('a', 'M 4.8 - 40 km NE of Sandakan, Malaysia', 'REGION.MALAYSIA'),
    quake('b', 'M 5.1 - Banda Sea, Indonesia', 'REGION.INDONESIA'),
    quake('late', 'M 4.9 - 10 km W of Kuching, Malaysia', 'REGION.MALAYSIA', { fetchedAt: '2026-10-15T22:30:00Z' }),   // fetched after capture: ignored
    quake('demo', 'M 6.0 - Demo, Malaysia', 'REGION.MALAYSIA', { synthetic: true }),
    quake('google', 'Google weather reading for Genting', 'REGION.MALAYSIA', { sourceId: 'SRC.GOOGLE.WEATHER' }),
  ];

  it('builds the fact sheet as at the capture time from narratable, real sources only', () => {
    const h = harness(records, NOW);
    const { slot, captureAt, airAt } = latestCapture(schedule, NOW);
    const facts = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: records, statuses: [] });
    const my = facts.countries.find((c) => c.iso3 === 'MYS')!;
    expect(my.incidents.map((i) => i.incidentKey)).toEqual(['USGS.a']);
    expect(facts.elsewhereCount).toBe(1);
    expect(facts.feeds.every((f) => f.freshAtCapture === false)).toBe(true);   // no status rows given: unknown, not fresh
    expect(facts.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [...records].reverse(), statuses: [] }).hash).toBe(facts.hash);   // same facts, same hash
    h.db.close();
  });

  it('writes a sourced script with capture time, credits and the AI disclosure, and stores it once', () => {
    const h = harness(records, NOW);
    const first = generateLatestBulletin({ db: h.db, clock: h.clock, ids: h.ids, schedule });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);
    const text = first.bulletin.segments.map((s) => s.text).join('\n');
    expect(text).toContain('Good morning. This is the Aegis 07:00 briefing for Friday, 16 October, with data as of 06:00 local time.');
    expect(text).toContain('magnitude 4.8, 40 km NE of Sandakan, Malaysia');
    expect(text).not.toMatch(/Kuching|Demo|Genting|Google/);
    expect(text).not.toContain('had not updated');   // the calm script says nothing when the feeds are normal
    expect(text).not.toMatch(/zero threat|sleep safely|it is safe|they are safe|completely safe/i);
    expect(text).toContain('Finally, Brunei. Our feeds record nothing for Brunei right now.');
    expect(text).toContain('so a quiet feed is not a guarantee of safety');   // said once, in the closing
    expect(first.bulletin.lowerThird).toBe('Data captured 06:00 MYT · Source: U.S. Geological Survey (USGS), Global Disaster Alert and Coordination System (GDACS)');
    expect(first.bulletin.credits.lines.join('\n')).toMatch(/AI-generated presenter\. Synthetic voice \(Kokoro, stock voice, no cloning\)\./);
    expect(first.bulletin.credits.lines.join('\n')).toContain('Indicative only');
    expect(first.bulletin.segments.map((s) => s.id)).toEqual(['headline', 'country-sgp', 'country-mys', 'country-brn', 'closing']);
    expect(first.bulletin.segments.find((s) => s.id === 'country-mys')!.focus).toMatchObject({ kind: 'incident', lat: 5, lon: 115 });
    expect(first.bulletin.segments.find((s) => s.id === 'country-sgp')!.focus).toMatchObject({ kind: 'country' });
    const second = generateLatestBulletin({ db: h.db, clock: h.clock, ids: h.ids, schedule });
    expect(second.ok && second.created).toBe(false);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM broadcast_bulletins').get()).toEqual({ n: 1 });
    h.db.close();
  });

  it('gives every segment its own lower third and an estimated start and length that add up', () => {
    const h = harness(records, NOW);
    const r = generateLatestBulletin({ db: h.db, clock: h.clock, ids: h.ids, schedule });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const segs = r.bulletin.segments;
    expect(segs.find((x) => x.id === 'country-mys')!.lowerThird).toBe('Source: U.S. Geological Survey (USGS) · Data captured 06:00 MYT');
    expect(segs.find((x) => x.id === 'country-sgp')!.lowerThird).toBe('Feeds checked, nothing recorded: U.S. Geological Survey (USGS), Global Disaster Alert and Coordination System (GDACS) · Data captured 06:00 MYT');
    expect(segs.find((x) => x.id === 'closing')!.lowerThird).toBe('Data captured 06:00 MYT · Next briefing 12:00');
    let at = 0;
    for (const seg of segs) { expect(seg.startSec).toBeCloseTo(at, 1); expect(seg.durationSec).toBeGreaterThan(1); at += seg.durationSec; }
    expect(r.bulletin.estimatedSeconds).toBeCloseTo(at + 8, 1);
    expect(r.bulletin.timingBasis).toMatch(/142 words a minute/);
    h.db.close();
  });

  it('says so when a feed had not updated, and when nothing is recorded anywhere', () => {
    const h = harness([], NOW);
    upsertSourceStatus(h.db, { sourceId: 'SRC.GDACS.LIVE', state: 'UNAVAILABLE', lastOkAt: '2026-10-15T15:00:00Z', lastAttemptAt: NOW, detail: 'down' });
    const r = generateLatestBulletin({ db: h.db, clock: h.clock, ids: h.ids, schedule });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = r.bulletin.segments.map((s) => s.text).join('\n');
    expect(text).toContain('Our feeds record no earthquake, storm, flood, volcano or wildfire in Singapore, Malaysia and Brunei.');
    expect(text).toContain('may be incomplete');
    expect(text).not.toContain('updating normally');
    h.db.close();
  });
});

describe('script validator: nothing the fact sheet does not support', () => {
  const { slot, captureAt, airAt } = latestCapture(schedule, '2026-10-15T22:05:00Z');
  const facts = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [quake('a', 'M 4.8 - 40 km NE of Sandakan, Malaysia', 'REGION.MALAYSIA')], statuses: [] });
  const good = buildScript({ schedule, facts, greeting: slot.greeting, nextAirLocal: '12:00', generatedAt: captureAt, bulletinId: 'B1' });

  it('accepts the template text', () => {
    expect(validateScript(good, facts, schedule)).toEqual([]);
  });
  it('rejects an invented number, an invented agency and Google', () => {
    const bad = { ...good, segments: good.segments.map((s) => s.id === 'country-sgp' ? { ...s, text: `${s.text} PSI is 87 according to NEA and Google Weather reports 31 degrees.` } : s) };
    const problems = validateScript(bad, facts, schedule).join('\n');
    expect(problems).toMatch(/number 87/);
    expect(problems).toMatch(/number 31/);
    expect(problems).toMatch(/names "NEA"/);
    expect(problems).toMatch(/names "Google"/);
  });
  it('rejects a segment that cites evidence outside the fact sheet', () => {
    const bad = { ...good, segments: good.segments.map((s) => s.id === 'headline' ? { ...s, evidenceIds: ['EV-nope'] } : s) };
    expect(validateScript(bad, facts, schedule).join()).toMatch(/EV-nope/);
  });
});

describe('real coordinates and major alerts elsewhere (AEG-NEWS-004)', () => {
  const NOW2 = '2026-10-15T22:05:00Z';
  const gdacs = (key: string, title: string, region: string, alert: string, hazard: string): EvidenceRecord => quake(key, title, region, {
    sourceId: 'SRC.GDACS.LIVE', licenceRef: 'LIC.GDACS-CC-BY-4.0-INDICATIVE-ONLY', eventTime: '2026-10-15T20:00:00Z',
    payload: { incidentKey: `GDACS.${key}`, title, hazardType: hazard, alertLevel: alert, regionId: region, latE6: 11_300_000, lonE6: 154_000_000, affectedPeopleEstimate: null },
  } as Partial<EvidenceRecord>);

  it('hashes a fact sheet whose coordinates are decimals (3.5222, 101.909) and gives the same hash for the same facts', () => {
    const { slot, captureAt, airAt } = latestCapture(schedule, NOW2);
    const recs = [quake('frac', 'M 4.9 - 10 km W of Bentong, Malaysia', 'REGION.MALAYSIA', { payload: { incidentKey: 'USGS.frac', title: 'M 4.9 - 10 km W of Bentong, Malaysia', hazardType: 'EARTHQUAKE', alertLevel: 'GREEN', regionId: 'REGION.MALAYSIA', latE6: 3_522_200, lonE6: 101_909_000, affectedPeopleEstimate: null } } as Partial<EvidenceRecord>)];
    const a = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: recs, statuses: [] });
    expect(a.countries.find((c) => c.iso3 === 'MYS')!.incidents[0]).toMatchObject({ lat: 3.5222, lon: 101.909 });
    expect(buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [...recs], statuses: [] }).hash).toBe(a.hash);
  });

  it('adds a major-alerts segment for RED and ORANGE alerts outside Singapore, Malaysia and Brunei, most severe first, with its own sources, and validates', () => {
    const { slot, captureAt, airAt } = latestCapture(schedule, NOW2);
    const recs = [
      gdacs('tc', 'Tropical Cyclone CHAMPI-26 - Western North Pacific, east of the Philippines (GDACS TC 1001338)', 'REGION.GUAM', 'RED', 'STORM'),
      gdacs('vo', 'Eruption  Kanlaon (GDACS VO 1000152)', 'REGION.PHILIPPINES', 'ORANGE', 'VOLCANO'),
      gdacs('fl', 'Flood in Bangkok (GDACS FL 77)', 'REGION.THAILAND', 'GREEN', 'FLOOD'),
    ];
    const facts = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: recs, statuses: [] });
    expect(facts.majorElsewhere.map((i) => i.incidentKey)).toEqual(['GDACS.tc', 'GDACS.vo']);   // green is not major; red comes first
    const b = buildScript({ schedule, facts, greeting: slot.greeting, nextAirLocal: '12:00', generatedAt: captureAt, bulletinId: 'MJ' });
    const seg = b.segments.find((s) => s.id === 'region-alerts')!;
    expect(b.segments.map((s) => s.id)).toEqual(['headline', 'country-sgp', 'country-mys', 'country-brn', 'region-alerts', 'closing']);
    expect(seg.text).toContain('Elsewhere in ASEAN, 2 major alerts. Tropical Cyclone CHAMPI-26 - Western North Pacific, east of the Philippines. GDACS rates it red.');
    expect(seg.text).toContain('Eruption Kanlaon. GDACS rates it orange.');
    expect(seg.text).not.toContain('A tropical cyclone: Tropical Cyclone');
    expect(seg.lowerThird).toBe('Source: Global Disaster Alert and Coordination System (GDACS) · Data captured 06:00 MYT');
    expect(seg.focus).toMatchObject({ kind: 'incident', lat: 11.3, lon: 154 });
    expect(validateScript(b, facts, schedule)).toEqual([]);
    const none = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [], statuses: [] });
    expect(buildScript({ schedule, facts: none, greeting: slot.greeting, nextAirLocal: '12:00', generatedAt: captureAt, bulletinId: 'MJ2' }).segments.some((s) => s.id === 'region-alerts')).toBe(false);
  });
});
