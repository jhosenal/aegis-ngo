import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { latestPsiFetchedBy } from '../../src/data/repos/airReadings.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { generateLatestBulletin } from '../../src/services/broadcast/generate.js';
import { buildFactSheet } from '../../src/services/broadcast/factSheet.js';
import { latestCapture, loadSchedule } from '../../src/services/broadcast/schedule.js';
import { buildScript, psiText, validateScript } from '../../src/services/broadcast/script.js';
import { runPsiIngest } from '../../src/services/psiIngest.js';
import { bandOf, parsePsi, PSI_SOURCE_ID } from '../../src/sources/psi.js';

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const schedule = loadSchedule();

// The shape the real data.gov.sg v2 API returned on 2026-10-16 at 17:00 +08:00 (values from that reading).
const reply = (psi: Record<string, number>, timestamp = '2026-10-16T16:00:00+08:00') => ({
  code: 0, data: { regionMetadata: [], items: [{ date: '2026-10-16', updatedTimestamp: timestamp.replace(':00+', ':39+'), timestamp, readings: { psi_twenty_four_hourly: psi, pm25_twenty_four_hourly: { north: 112, south: 134, east: 153, west: 154, central: 177 }, no2_one_hour_max: { north: 15, south: 32, east: 38, west: 58, central: 44 } } }] },
});
const HAZE = { north: 160, south: 183, east: 203, west: 205, central: 227 };
const CLEAR = { north: 31, south: 38, east: 44, west: 29, central: 52 };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const resolver = { resolve: async () => ['93.184.216.34'] };

describe('NEA PSI (AEG-PSI-001)', () => {
  it('uses NEA bands: 0-50 Good, 51-100 Moderate, 101-200 Unhealthy, 201-300 Very Unhealthy, above 300 Hazardous', () => {
    expect([0, 50, 51, 100, 101, 200, 201, 300, 301, 450].map(bandOf)).toEqual(['Good', 'Good', 'Moderate', 'Moderate', 'Unhealthy', 'Unhealthy', 'Very Unhealthy', 'Very Unhealthy', 'Hazardous', 'Hazardous']);
  });
  it('parses the real-time reply to UTC and refuses a shape it does not know', () => {
    const r = parsePsi(reply(HAZE));
    expect(r.observedAt).toBe('2026-10-16T08:00:00.000Z');
    expect(r.psi.central).toBe(227);
    expect(r.pm25?.west).toBe(154);
    expect(() => parsePsi({ code: 0, data: { items: [] } })).toThrow();
    expect(() => parsePsi(reply({ ...HAZE, north: -4 }))).toThrow();
    expect(() => parsePsi({ nope: true })).toThrow();
  });

  it('stores each published reading once and records the poll outcome; a bad poll keeps what it had', async () => {
    const db = openDb(':memory:'); migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    const clock = new FixedClock('2026-10-16T08:03:00Z');
    const ok = await runPsiIngest({ db, clock, resolver, fetchImpl: (async () => json(reply(HAZE))) as typeof fetch });
    expect(ok).toMatchObject({ outcome: 'OK', stored: true, observedAt: '2026-10-16T08:00:00.000Z' });
    const again = await runPsiIngest({ db, clock, resolver, fetchImpl: (async () => json(reply(HAZE))) as typeof fetch });
    expect(again.stored).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM air_readings').get()).toEqual({ n: 1 });
    const bad = await runPsiIngest({ db, clock, resolver, fetchImpl: (async () => json({ nope: 1 })) as typeof fetch });
    expect(bad).toMatchObject({ outcome: 'MALFORMED', stored: false });
    const down = await runPsiIngest({ db, clock, resolver, fetchImpl: (async () => new Response('', { status: 503 })) as typeof fetch });
    expect(down).toMatchObject({ outcome: 'UNAVAILABLE', detail: 'HTTP 503' });
    expect(db.prepare('SELECT last_ok_at FROM source_status WHERE source_id = ?').get(PSI_SOURCE_ID)).toEqual({ last_ok_at: '2026-10-16T08:03:00.000Z' });   // the last good poll survives
    expect(latestPsiFetchedBy(db, PSI_SOURCE_ID, '2026-10-16T08:00:00Z')).toBeNull();   // fetched after that instant: not known yet
    expect(latestPsiFetchedBy(db, PSI_SOURCE_ID, '2026-10-16T08:05:00Z')?.reading.psi.central).toBe(227);
    db.close();
  });

  it('says it in plain words with NEA band names and ranges, and sounds good when the air is Good or Moderate', () => {
    const { slot, captureAt, airAt } = latestCapture(schedule, '2026-10-16T08:05:00Z');
    const mk = (psi: Record<string, number>) => buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [], statuses: [], psi: { reading: parsePsi(reply(psi)), fetchedAt: '2026-10-16T08:01:00Z' } });
    const hazy = mk(HAZE).psi!;
    expect(psiText(hazy, 8)).toBe("NEA's 24-hour PSI, the air quality index, at 16:00 local time ranged from 160 in the north to 227 in the central region. Central, west and east are in the Very Unhealthy band, 201 to 300. South and north are in the Unhealthy band, 101 to 200.");
    expect(psiText(mk(CLEAR).psi!, 8)).toMatch(/^NEA's 24-hour PSI, the air quality index, at 16:00 local time ranged from \d+ in the [a-z ]+ to 52 in the central region\./);
    expect(psiText(mk(CLEAR).psi!, 8)).not.toContain('good news');
    expect(psiText(mk(CLEAR).psi!, 8)).toContain('are in the Good band, 0 to 50');
  });

  it('puts it in the Singapore segment, the headline and the lower third; the validator accepts it and rejects an invented reading', () => {
    const { slot, captureAt, airAt } = latestCapture(schedule, '2026-10-16T08:05:00Z');
    const facts = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [], statuses: [], psi: { reading: parsePsi(reply(HAZE)), fetchedAt: '2026-10-16T08:01:00Z' } });
    const b = buildScript({ schedule, facts, greeting: slot.greeting, nextAirLocal: '22:00', generatedAt: captureAt, bulletinId: 'B1' });
    const sg = b.segments.find((s) => s.id === 'country-sgp')!;
    expect(sg.text).toContain("First, Singapore. NEA's 24-hour PSI, the air quality index, at 16:00 local time ranged from 160 in the north to 227 in the central region");
    expect(sg.lowerThird).toContain('National Environment Agency (NEA) PSI via data.gov.sg');
    expect(sg.sourceIds).toContain(PSI_SOURCE_ID);
    expect(b.segments[0]!.text).toContain('The main story: air quality in Singapore is in the Very Unhealthy band, in 3 of 5 regions.');
    expect(b.credits.lines.join('\n')).toContain('Singapore Open Data Licence version 1.0');
    expect(validateScript(b, facts, schedule)).toEqual([]);
    const bad = { ...b, segments: b.segments.map((s) => s.id === 'country-sgp' ? { ...s, text: `${s.text} PSI in the west is 311 and rising.` } : s) };
    expect(validateScript(bad, facts, schedule).join()).toMatch(/number 311/);
  });

  it('does not credit or name the NEA when no reading was available, and says so', () => {
    const { slot, captureAt, airAt } = latestCapture(schedule, '2026-10-16T08:05:00Z');
    const facts = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [], statuses: [] });
    const b = buildScript({ schedule, facts, greeting: slot.greeting, nextAirLocal: '22:00', generatedAt: captureAt, bulletinId: 'B2' });
    expect(b.segments.find((s) => s.id === 'country-sgp')!.text).toContain('An air quality (PSI) reading from the National Environment Agency was not available at capture.');
    expect(b.lowerThird).not.toContain('NEA');
    expect(b.credits.lines.join('\n')).not.toContain('data.gov.sg');
    expect(validateScript(b, facts, schedule)).toEqual([]);
  });

  it('the generator uses the reading fetched by the capture window and ignores a later one', async () => {
    const db = openDb(':memory:'); migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    const ids = new SeqIdGen();
    await runPsiIngest({ db, clock: new FixedClock('2026-10-16T08:01:00Z'), resolver, fetchImpl: (async () => json(reply(HAZE))) as typeof fetch });
    await runPsiIngest({ db, clock: new FixedClock('2026-10-16T09:20:00Z'), resolver, fetchImpl: (async () => json(reply(CLEAR, '2026-10-16T17:00:00+08:00'))) as typeof fetch });
    const r = generateLatestBulletin({ db, clock: new FixedClock('2026-10-16T08:02:00Z'), ids, schedule });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bulletin.segments.find((s) => s.id === 'country-sgp')!.text).toContain('227 in the central region');
    db.close();
  });
});

describe('released advice in the bulletin (AEG-ADVICE-001)', () => {
  it('quotes NEA advice only when the guidance cards are released for exactly this content, and says nothing otherwise', async () => {
    const { loadAssistContent } = await import('../../src/assist/content.js');
    const { releasedPsiAdvice, parsePsiAdviceLine } = await import('../../src/services/broadcast/advice.js');
    const content = loadAssistContent({ draftMedical: false, allowFixture: false });
    const held = { status: 'HELD', contentHash: null, reviewedBy: null, reviewedAt: null, evidenceRef: null, note: 'held' } as never;
    const approved = { status: 'APPROVED', contentHash: content.hash, reviewedBy: 'Aegis project team', reviewedAt: '2026-10-16', evidenceRef: 'S0013', reviewScope: 'SOURCES_CHECKED_NOT_CLINICAL' } as never;
    const stale = { ...(approved as object), contentHash: '0'.repeat(64) } as never;
    expect(releasedPsiAdvice('Very Unhealthy', { content, record: held })).toEqual([]);
    expect(releasedPsiAdvice('Very Unhealthy', { content, record: stale })).toEqual([]);          // content changed since approval
    expect(releasedPsiAdvice('Very Unhealthy', { content, record: null })).toEqual([]);
    const lines = releasedPsiAdvice('Very Unhealthy', { content, record: approved });
    expect(lines.map((l) => `${l.group}: ${l.advice}`)).toEqual([
      'healthy persons: Avoid prolonged or strenuous outdoor physical exertion',
      'the elderly, pregnant women and children: Minimise outdoor activity',
      'people with chronic lung or heart disease: Avoid outdoor activity',
      'the public: Drink plenty of water to stay hydrated',
    ]);
    expect(releasedPsiAdvice('Moderate', { content, record: approved }).some((l) => l.group === 'the public')).toBe(false);   // hydration is quoted only for Unhealthy and worse
    expect(releasedPsiAdvice('Good', { content, record: approved }).every((l) => l.band === 'Good')).toBe(true);
    expect(parsePsiAdviceLine('PSI 201-300 (Very Unhealthy), healthy persons: Avoid outdoor activity.')).toEqual({ band: 'Very Unhealthy', advice: 'Avoid outdoor activity' });
    expect(parsePsiAdviceLine('Normal Activities')).toBeNull();
  });

  it('puts the quoted advice in the Singapore segment, valid against the fact sheet, and not at all when none is passed', async () => {
    const { loadAssistContent } = await import('../../src/assist/content.js');
    const { releasedPsiAdvice } = await import('../../src/services/broadcast/advice.js');
    const content = loadAssistContent({ draftMedical: false, allowFixture: false });
    const approved = { status: 'APPROVED', contentHash: content.hash, reviewedBy: 'Aegis project team', reviewedAt: '2026-10-16', evidenceRef: 'S0013', reviewScope: 'SOURCES_CHECKED_NOT_CLINICAL' } as never;
    const { slot, captureAt, airAt } = latestCapture(schedule, '2026-10-16T08:05:00Z');
    const psi = { reading: parsePsi(reply(HAZE)), fetchedAt: '2026-10-16T08:01:00Z' };
    const withAdvice = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [], statuses: [], psi, adviceFor: (band) => releasedPsiAdvice(band, { content, record: approved }) });
    const b = buildScript({ schedule, facts: withAdvice, greeting: slot.greeting, nextAirLocal: '22:00', generatedAt: captureAt, bulletinId: 'B3' });
    const sg = b.segments.find((s) => s.id === 'country-sgp')!.text;
    expect(sg).toContain('NEA advises healthy persons: Avoid prolonged or strenuous outdoor physical exertion. For the elderly, pregnant women and children: Minimise outdoor activity. For people with chronic lung or heart disease: Avoid outdoor activity. For the public: Drink plenty of water to stay hydrated.');
    expect(validateScript(b, withAdvice, schedule)).toEqual([]);
    const none = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [], statuses: [], psi });
    expect(none.advice).toEqual([]);
    expect(buildScript({ schedule, facts: none, greeting: slot.greeting, nextAirLocal: '22:00', generatedAt: captureAt, bulletinId: 'B4' }).segments.find((s) => s.id === 'country-sgp')!.text).not.toContain('advice');
    expect(withAdvice.hash).not.toBe(none.hash);   // the advice is part of what the bulletin hash covers
  });
});

describe('GET /public/air/psi (AEG-PSI-001)', () => {
  it('is null before the first poll, then returns the latest reading with NEA bands, age and the licence notice', async () => {
    const Fastify = (await import('fastify')).default;
    const { registerPsiRoute } = await import('../../src/api/routes/psi.js');
    const db = openDb(':memory:'); migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    const clock = new FixedClock('2026-10-16T09:10:00Z');
    const app = Fastify(); registerPsiRoute(app, db, clock);
    const empty = (await app.inject('/public/air/psi')).json() as { reading: unknown; attribution: string };
    expect(empty.reading).toBeNull();
    await runPsiIngest({ db, clock, resolver, fetchImpl: (async () => json(reply(HAZE, '2026-10-16T17:00:00+08:00'))) as typeof fetch });
    const body = (await app.inject('/public/air/psi')).json() as { reading: { ageMinutes: number; highest: { region: string; psi: number; band: string }; regions: { region: string; band: string; pm25_24h: number | null }[] }; bands: { band: string }[]; attribution: string };
    expect(body.reading.highest).toEqual({ region: 'central', psi: 227, band: 'Very Unhealthy' });
    expect(body.reading.ageMinutes).toBe(10);
    expect(body.reading.regions.find((r) => r.region === 'north')).toMatchObject({ band: 'Unhealthy', pm25_24h: 112 });
    expect(body.bands.map((b) => b.band)).toEqual(['Good', 'Moderate', 'Unhealthy', 'Very Unhealthy', 'Hazardous']);
    expect(body.attribution).toContain('Singapore Open Data Licence version 1.0');
    await app.close(); db.close();
  });
});
