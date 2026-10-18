import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { latestSnapshotFetchedBy } from '../../src/data/repos/officialSnapshots.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { generateLatestBulletin } from '../../src/services/broadcast/generate.js';
import { buildFactSheet } from '../../src/services/broadcast/factSheet.js';
import { latestCapture, loadSchedule } from '../../src/services/broadcast/schedule.js';
import { buildScript, metMyText, validateScript } from '../../src/services/broadcast/script.js';
import { runMetMyIngest } from '../../src/services/metMyIngest.js';
import { forecastText, hasHaze, METMY_FORECAST_ID, METMY_WARNINGS_ID, parseForecast, parseWarnings, phraseEn } from '../../src/sources/metMy.js';

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const schedule = loadSchedule();
const resolver = { resolve: async () => ['93.184.216.34'] };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

// Shapes and phrases as the live api.data.gov.my replied on 2026-10-16.
const warningsReply = [
  { warning_issue: { issued: '2026-10-16T12:35:00', title_bm: 'x', title_en: 'Strong Winds and Rough Seas Warning' }, valid_from: '2026-10-16T12:00:00', valid_to: '2026-10-16T18:00:00', heading_en: 'Warning on Strong Wind and Rough Seas', text_en: 'long text' },
  { warning_issue: { issued: '2026-10-16T12:35:00', title_bm: 'x', title_en: 'Strong Winds and Rough Seas Warning' }, valid_from: '2026-10-14T00:00:00', valid_to: '2026-10-16T00:00:00', heading_en: 'old', text_en: 'old' },
  { warning_issue: { issued: '2026-10-16T16:10:00', title_bm: 'x', title_en: 'Thunderstorms Warning' }, valid_from: '2026-10-16T15:00:00', valid_to: '2026-10-16T20:00:00', heading_en: 'Thunderstorms', text_en: 'text' },
  { warning_issue: { issued: '2026-10-16T10:30:00', title_bm: 'x', title_en: 'No Advisory' }, valid_from: null, valid_to: null, heading_en: null, text_en: null },
];
const row = (location: string, date: string, m: string, a: string, n: string, min = 24, max = 33) => ({ location: { location_id: 'Ds', location_name: location }, date, morning_forecast: m, afternoon_forecast: a, night_forecast: n, summary_forecast: a, summary_when: 'Petang', min_temp: min, max_temp: max });
const forecastToday = [
  row('Kuala Lumpur', '2026-10-16', 'Ribut petir di beberapa tempat', 'Ribut petir di beberapa tempat', 'Hujan di beberapa tempat'),
  row('Johor Bahru', '2026-10-16', 'Tiada Hujan', 'Ribut petir di beberapa tempat', 'Tiada Hujan'),
  row('Kuantan', '2026-10-16', 'Jerebu', 'Ribut petir di beberapa tempat', 'Jerebu', 25, 34),
  row('Kuching', '2026-10-16', 'Tiada Hujan', 'Ribut petir di beberapa tempat', 'Hujan di beberapa tempat', 24, 34),
  row('Kota Kinabalu', '2026-10-16', 'Tiada Hujan', 'Ribut petir di beberapa tempat', 'Tiada Hujan', 25, 33),
  row('Kota Bharu', '2026-10-16', 'Tiada Hujan', 'Tiada Hujan', 'Tiada Hujan', 23, 33),
  row('Pekan', '2026-10-16', 'Jerebu', 'Tiada Hujan', 'Tiada Hujan'),
];
const forecastTomorrow = [row('Kuala Lumpur', '2026-10-17', 'Jerebu', 'Ribut petir', 'Jerebu'), row('Kuantan', '2026-10-17', 'Tiada Hujan', 'Tiada Hujan', 'Tiada Hujan')];

const fetcher = (over: { warnings?: () => Response; forecast?: (date: string) => Response } = {}) => (async (url: string | URL) => {
  const u = String(url);
  if (u.includes('/weather/warning')) return (over.warnings ?? (() => json(warningsReply)))();
  const date = /filter=(\d{4}-\d{2}-\d{2})@date/.exec(u)?.[1] ?? '';
  return (over.forecast ?? ((d: string) => json(d === '2026-10-16' ? forecastToday : forecastTomorrow)))(date);
}) as typeof fetch;

describe('MetMalaysia source (AEG-METMY-001)', () => {
  it('translates only the phrases it knows and never guesses', () => {
    expect(phraseEn('Ribut petir di beberapa tempat')).toBe('thunderstorms in a few places');
    expect(phraseEn('Jerebu')).toBe('haze');
    expect(phraseEn('Tiada Hujan')).toBe('no rain');
    expect(phraseEn('Hujan lebat')).toBeNull();
    const r = parseForecast(forecastToday.slice(2, 3))[0]!;
    expect(forecastText(r)).toBe('haze in the morning and at night, thunderstorms in a few places in the afternoon');
    expect(hasHaze(r)).toBe(true);
    expect(forecastText({ ...r, afternoon: 'Hujan lebat' })).toBeNull();   // one unknown phrase: the district is left out
  });
  it('keeps real warnings, converts Malaysia time to UTC and drops "No Advisory"', () => {
    const w = parseWarnings(warningsReply);
    expect(w).toHaveLength(3);
    expect(w.find((x) => x.title === 'Thunderstorms Warning')).toMatchObject({ validFrom: '2026-10-16T07:00:00.000Z', validTo: '2026-10-16T12:00:00.000Z' });
    expect(() => parseWarnings({ nope: 1 })).toThrow();
    expect(() => parseForecast([{ nonsense: true }])).toThrow();
  });

  it('stores a snapshot only when the content changed, fetches the forecast at most hourly, and keeps the last good status on failure', async () => {
    const db = openDb(':memory:'); migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    const t1 = new FixedClock('2026-10-16T09:00:00Z');
    const a = await runMetMyIngest({ db, clock: t1, resolver, fetchImpl: fetcher() });
    expect(a.warnings).toMatchObject({ outcome: 'OK', stored: true, count: 3 });
    expect(a.forecast).toMatchObject({ outcome: 'OK', stored: true, rows: 9 });
    const b = await runMetMyIngest({ db, clock: new FixedClock('2026-10-16T09:15:00Z'), resolver, fetchImpl: fetcher() });
    expect(b.warnings.stored).toBe(false);                      // unchanged
    expect(b.forecast.outcome).toBe('SKIPPED');                 // forecast fetched less than 55 minutes ago
    const c = await runMetMyIngest({ db, clock: new FixedClock('2026-10-16T10:00:00Z'), resolver, fetchImpl: fetcher({ warnings: () => new Response('', { status: 503 }) }) });
    expect(c.warnings).toMatchObject({ outcome: 'UNAVAILABLE', detail: 'HTTP 503' });
    expect(db.prepare('SELECT last_ok_at FROM source_status WHERE source_id = ?').get(METMY_WARNINGS_ID)).toEqual({ last_ok_at: '2026-10-16T09:15:00.000Z' });
    const d = await runMetMyIngest({ db, clock: new FixedClock('2026-10-16T11:00:00Z'), resolver, fetchImpl: fetcher({ forecast: () => json({ nope: 1 }) }) });
    expect(d.forecast.outcome).toBe('MALFORMED');
    expect(latestSnapshotFetchedBy(db, METMY_FORECAST_ID, '2026-10-16T09:30:00Z')).not.toBeNull();   // what was stored survives
    db.close();
  });

  const mkFacts = async (now: string, captureNow: string) => {
    const db = openDb(':memory:'); migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    await runMetMyIngest({ db, clock: new FixedClock(now), resolver, fetchImpl: fetcher() });
    const { slot, captureAt, airAt } = latestCapture(schedule, captureNow);
    const cutoff = new Date(Date.parse(captureAt) + 5 * 60_000).toISOString();
    const facts = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [], statuses: [], metMy: {
      warnings: latestSnapshotFetchedBy(db, METMY_WARNINGS_ID, cutoff), forecast: latestSnapshotFetchedBy(db, METMY_FORECAST_ID, cutoff) } });
    db.close();
    return { facts, slot, captureAt };
  };

  it('fact sheet: warnings active at capture only, today\'s key districts, haze districts, and tomorrow\'s forecast for the night slot', async () => {
    const day = await mkFacts('2026-10-16T08:00:00Z', '2026-10-16T08:05:00Z');   // capture 16:00 local
    expect(day.facts.metMy!.warnings).toEqual([
      { title: 'Strong Winds and Rough Seas Warning', validTo: '2026-10-16T10:00:00.000Z' },
      { title: 'Thunderstorms Warning', validTo: '2026-10-16T12:00:00.000Z' },
    ]);
    expect(day.facts.metMy).toMatchObject({ forecastLabel: 'today', forecastDate: '2026-10-16', hazeCount: 2, hazeLocations: ['Kuantan', 'Pekan'] });
    expect(day.facts.metMy!.key.map((k) => k.location)).toEqual(['Kuala Lumpur', 'Johor Bahru', 'Kuching', 'Kota Kinabalu', 'Kuantan', 'Kota Bharu']);
    const night = await mkFacts('2026-10-16T13:00:00Z', '2026-10-16T13:05:00Z');   // capture 21:00 local: tomorrow's forecast
    expect(night.facts.metMy).toMatchObject({ forecastLabel: 'tomorrow', forecastDate: '2026-10-17', hazeCount: 1, hazeLocations: ['Kuala Lumpur'] });
    expect(night.facts.metMy!.warnings).toEqual([]);   // the thunderstorm warning ended at 20:00; no warning was active at the 21:00 capture
    expect(night.facts.metMy!.warningsKnown).toBe(true);
  });

  it('the Malaysia segment reads the warnings, the districts and the haze, credits MetMalaysia, and validates', async () => {
    const { facts, slot, captureAt } = await mkFacts('2026-10-16T08:00:00Z', '2026-10-16T08:05:00Z');
    const text = metMyText(facts.metMy!, 8);
    expect(text).toContain('MetMalaysia has 2 active weather warnings: Strong Winds and Rough Seas Warning, valid until 18:00; Thunderstorms Warning, valid until 20:00.');
    expect(text).toContain("MetMalaysia's forecast for today. For Kuala Lumpur, thunderstorms in a few places in the morning and afternoon, rain in a few places at night, 24 to 33 degrees.");
    expect((text.match(/\bFor [A-Z]/g) ?? []).length).toBe(2);   // two cities are read; the others are pointed to
    expect(text).toContain('Forecasts for other cities are on the MetMalaysia site.');
    expect(text).toContain('The forecast for today includes haze in 2 districts, Kuantan and Pekan.');
    const b = buildScript({ schedule, facts, greeting: slot.greeting, nextAirLocal: '22:00', generatedAt: captureAt, bulletinId: 'M1' });
    const my = b.segments.find((s) => s.id === 'country-mys')!;
    expect(my.sourceIds).toContain('SRC.METMY.LIVE');
    expect(my.lowerThird).toContain('Malaysian Meteorological Department (MetMalaysia)');
    expect(my.text.startsWith('Now Malaysia. MetMalaysia has 2 active weather warnings')).toBe(true);
    expect(b.segments[0]!.text).toContain('The main story: MetMalaysia has 2 active weather warnings.');
    expect(b.segments[0]!.text).toContain('Our feeds record no earthquake, storm, flood, volcano or wildfire in Singapore, Malaysia and Brunei');
    expect(b.segments[0]!.text).not.toContain('good news');   // warnings and haze are active: no "good news" in the headline
    expect(b.credits.lines.join('\n')).toContain('Licence terms not yet confirmed; used for this pilot only.');
    expect(validateScript(b, facts, schedule)).toEqual([]);
    const bad = { ...b, segments: b.segments.map((s) => s.id === 'country-mys' ? { ...s, text: `${s.text} Highs of 41 degrees are expected.` } : s) };
    expect(validateScript(bad, facts, schedule).join()).toMatch(/number 41/);
  });

  it('says "midnight" for a warning that ends at 00:00', () => {
    const text = metMyText({ warnings: [{ title: 'Strong Winds and Rough Seas Warning', validTo: '2026-10-16T16:00:00.000Z' }], warningsKnown: true, forecastDate: null, forecastLabel: null, key: [], hazeCount: 0, hazeLocations: [] }, 8);
    expect(text).toBe('MetMalaysia has one active weather warning: Strong Winds and Rough Seas Warning, valid until midnight.');
  });

  it('without any MetMalaysia data the bulletin neither names nor credits it', async () => {
    const { slot, captureAt, airAt } = latestCapture(schedule, '2026-10-16T08:05:00Z');
    const facts = buildFactSheet({ schedule, slot, captureAt, airAt, evidence: [], statuses: [] });
    const b = buildScript({ schedule, facts, greeting: slot.greeting, nextAirLocal: '22:00', generatedAt: captureAt, bulletinId: 'M2' });
    expect(b.segments.find((s) => s.id === 'country-mys')!.text).not.toContain('MetMalaysia');
    expect(b.lowerThird).not.toContain('MetMalaysia');
    expect(validateScript(b, facts, schedule)).toEqual([]);
  });

  it('the generator picks the snapshot known by the capture window, not a later one', async () => {
    const db = openDb(':memory:'); migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    await runMetMyIngest({ db, clock: new FixedClock('2026-10-16T08:01:00Z'), resolver, fetchImpl: fetcher() });
    await runMetMyIngest({ db, clock: new FixedClock('2026-10-16T09:30:00Z'), resolver, fetchImpl: fetcher({ warnings: () => json([]) }) });
    const r = generateLatestBulletin({ db, clock: new FixedClock('2026-10-16T08:02:00Z'), ids: new SeqIdGen(), schedule });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bulletin.segments.find((s) => s.id === 'country-mys')!.text).toContain('2 active weather warnings');
    db.close();
  });
});
