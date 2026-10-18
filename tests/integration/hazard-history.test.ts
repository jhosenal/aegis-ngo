import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import { HistoryQueryError, loadHistory, queryHistory } from '../../src/services/hazardHistory.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const doc = loadHistory();
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

function app() {
  const db = openDb(':memory:');
  const ids = new SeqIdGen();
  migrate(db, `${root}migrations/`, '2026-10-13T00:00:00Z');
  seedAll(db, `${root}fixtures/`, new FixedClock('2026-10-13T00:00:00Z'), ids);
  const a = createApp({ db, clock: new FixedClock('2026-10-13T00:00:00Z'), ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) });
  apps.push(a);
  return a;
}

describe('ten-year hazard history (AEG-HIST-001)', () => {
  it('holds a few hundred sourced cards across the mapped domains, window starting 2016', () => {
    expect(doc.window.from).toBe('2016-01-01');
    expect(doc.cards.length).toBeGreaterThan(250);
    expect(new Set(doc.cards.map((c) => c.domain))).toEqual(new Set([1, 2, 3, 4, 5, 7]));
    expect(Math.min(...doc.cards.map((c) => Date.parse(c.eventStart)))).toBeGreaterThanOrEqual(Date.parse('2016-01-01T00:00:00Z'));
  });

  it('every card is complete: provenance, attribution, hash, time of retrieval, tags; no figures and no casualty claims', () => {
    for (const c of doc.cards) {
      const p = c.provenance;
      expect(p.retrievedAt, c.id).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(p.rawSha256, c.id).toMatch(/^[0-9a-f]{64}$/);
      expect(p.licence.attribution, c.id).toBeTruthy();
      expect(p.apiUrl.startsWith('https://'), c.id).toBe(true);
      expect(p.licence.status, c.id).toBeTruthy();
      expect(c.affectedPeopleEstimate).toBeNull();
      expect(c.tags.some((t) => t.startsWith('source:'))).toBe(true);
      expect(c.tags).toContain('status:sourced');
      if (p.sourceId === 'SRC.GDACS.API') expect(p.licence.attribution).toMatch(/Indicative only/);
    }
    // casualty words may appear only inside a quoted source statement, never in Aegis's own text
    const own = doc.cards.map((c) => ({ ...c, impact: null, tags: c.tags.filter((t) => !t.startsWith('impact:')) }));
    expect(JSON.stringify(own)).not.toMatch(/\b(killed|deaths?|casualt\w*|fatalit\w*)\b/i);
  });

  it('impact figures are quoted from a USGS statement, carry their quote, and are consistent with it', () => {
    const withFigures = doc.cards.filter((c) => c.impact && c.impact.figures.length > 0);
    expect(withFigures.length).toBeGreaterThan(20);
    for (const c of withFigures) {
      expect(['SRC.USGS.FDSN', 'SRC.WHO.DON']).toContain(c.provenance.sourceId);
      for (const f of c.impact!.figures) {
        expect(c.impact!.statement.toLowerCase(), c.id).toContain(f.quote.toLowerCase());
        expect(f.value).toBeGreaterThanOrEqual(0);
      }
    }
    const palu = doc.cards.find((c) => c.id === 'HX-1-USGS-us1000h3p4');
    expect(palu?.impact?.figures).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'killed', value: 2077, qualifier: 'at least' })]));
    expect(palu?.affectedPeopleEstimate).toBeNull();
  });

  it('WHO outbreak cards carry the WHO page, the non-commercial licence status and a real event date, never a 1990s item', () => {
    const who = doc.cards.filter((c) => c.domain === 5);
    expect(who.length).toBeGreaterThan(15);
    for (const c of who) {
      expect(c.provenance.sourceId).toBe('SRC.WHO.DON');
      expect(c.provenance.sourcePage).toMatch(/^https:\/\/www\.who\.int\/emergencies\/disease-outbreak-news\/item\//);
      expect(c.provenance.licence.status).toBe('STATED_NON_COMMERCIAL');
      expect(Number(c.eventStart.slice(0, 4))).toBeGreaterThanOrEqual(2016);
      expect(c.location.latE6).toBeNull();
    }
  });

  it('WHO counts are quoted from the notice opening, never from another period, another country or an ambiguous list', () => {
    const who = doc.cards.filter((c) => c.domain === 5);
    const withFigures = who.filter((c) => (c.impact?.figures.length ?? 0) > 0);
    expect(withFigures.length).toBeGreaterThan(12);
    for (const c of withFigures) {
      expect(['cases', 'deaths']).toEqual(expect.arrayContaining([c.impact!.figures[0]!.kind]));
      for (const f of c.impact!.figures) expect(c.impact!.statement.toLowerCase(), c.id).toContain(f.quote.toLowerCase());
      expect(new Set(c.impact!.figures.map((f) => f.kind)).size, c.id).toBe(c.impact!.figures.length);   // at most one figure per kind
    }
    const find = (needle: RegExp, year: string) => who.find((c) => needle.test(c.title) && c.eventStart.startsWith(year))!;
    const cambodia = find(/H5N1\) ?- ?Cambodia|H5N1\)- Cambodia|H5N1\) - Cambodia/, '2025');
    expect(cambodia.impact!.figures.map((f) => [f.kind, f.value])).toEqual([['cases', 11], ['deaths', 6]]);
    const anthrax = find(/Anthrax/, '2025');
    expect(anthrax.impact!.figures.map((f) => [f.kind, f.value])).toEqual([['cases', 4], ['deaths', 1]]);
    // the 2022 "six deaths" in the measles notice belong to 2022, not to the 2023 event
    const measles = find(/Measles/, '2023');
    expect(measles.impact!.figures.map((f) => f.kind)).toEqual(['cases']);
    expect(measles.impact!.figures[0]!.value).toBe(2161);
    // mixed numbers across years or sentences: the statement is kept, no figure is claimed
    expect(find(/Dengue/, '2022').impact!.figures).toEqual([]);
    // the monkeypox notice shares the generic id "2019DON" with other notices and must not be lost to deduplication
    expect(who.some((c) => /Monkeypox/.test(c.title))).toBe(true);
  });

  it('haze episodes are Singapore PSI runs with a band rating, the Open Data Licence notice and a sampling caveat', () => {
    const haze = doc.cards.filter((c) => c.domain === 4);
    expect(haze.length).toBeGreaterThan(3);
    for (const c of haze) {
      expect(c.provenance.sourceId).toBe('SRC.DATAGOVSG.PSI');
      expect(c.provenance.licence.attribution).toMatch(/Singapore Open Data Licence version 1\.0/);
      expect(c.rating.scale).toBe('NEA PSI band (24-hour)');
      expect(c.measurements[0]!.label).toMatch(/one reading per day at 12:00/);
      expect(c.measurements.find((m) => m.key === 'peakPsi24h')!.value).toBeGreaterThan(100);
    }
    expect(doc.remark).toMatch(/sampled once a day/);
  });

  it('the raw files on disk still match the hashes on the cards', () => {
    const seen = new Map<string, string>();
    for (const c of doc.cards) {
      for (const p of [c.provenance, ...c.corroboration]) seen.set(p.rawFile as string, p.rawSha256 as string);
      if (c.impact) seen.set(c.impact.rawFile, c.impact.rawSha256);
    }
    expect(seen.size).toBeGreaterThan(5);
    for (const [file, sha] of seen) expect(createHash('sha256').update(readFileSync(`${root}${file}`)).digest('hex'), file).toBe(sha);
  });

  it('cyclones have no map location; every other located card has coordinates inside the world', () => {
    for (const c of doc.cards) {
      if (c.domain === 3) expect(c.location.latE6, c.id).toBeNull();
      if (c.location.latE6 !== null) {
        expect(Math.abs(c.location.latE6)).toBeLessThanOrEqual(90_000_000);
        expect(Math.abs(c.location.lonE6 as number)).toBeLessThanOrEqual(180_000_000);
      }
    }
  });

  it('the reconciliation block accounts for the raw events', () => {
    const r = doc.reconciliation as { rawEvents: { USGS: number; GDACS: number }; usgsOutside: number; gdacsOutside: number; mergedEq: number;
      who: { rawItems: number; kept: number }; psi: { daysTotal: number; daysWithReading: number; episodes: number } };
    const stage1 = doc.cards.filter((c) => /^HX-\d-(USGS|GDACS)-/.test(c.id)).length;
    const rawTotal = r.rawEvents.USGS + r.rawEvents.GDACS;
    expect(stage1 + r.usgsOutside + r.gdacsOutside + r.mergedEq).toBeLessThanOrEqual(rawTotal);
    expect(doc.cards.filter((c) => c.domain === 5).length).toBe(r.who.kept);
    expect(r.who.rawItems).toBeGreaterThan(r.who.kept);
    expect(doc.cards.filter((c) => c.domain === 4).length).toBe(r.psi.episodes);
    expect(r.psi.daysWithReading).toBeLessThanOrEqual(r.psi.daysTotal);
  });

  it('a duplicate earthquake from two sources is one card with two provenance entries', () => {
    for (const c of doc.cards.filter((x) => x.corroboration.length > 0 && x.domain !== 4)) {
      expect(c.domain).toBe(1);
      expect(c.provenance.sourceId).toBe('SRC.USGS.FDSN');
    }
    const ids = doc.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('date range keeps events that overlap it, and an open end counts as a point in time', () => {
    const hit = queryHistory(doc, { from: '2018-01-01', to: '2018-12-31', limit: 1000 });
    expect(hit.length).toBeGreaterThan(0);
    for (const c of hit) {
      const s = Date.parse(c.eventStart); const e = c.eventEnd ? Date.parse(c.eventEnd) : s;
      expect(s <= Date.parse('2018-12-31T23:59:59.999Z') && e >= Date.parse('2018-01-01T00:00:00Z'), c.id).toBe(true);
    }
    expect(queryHistory(doc, { from: '2030-01-01' })).toEqual([]);
    expect(() => queryHistory(doc, { from: '2019-01-01', to: '2018-01-01' })).toThrow(HistoryQueryError);
    expect(() => queryHistory(doc, { from: 'yesterday' })).toThrow(HistoryQueryError);
  });

  it('domain, rating rank, scale, location and text search filters work', () => {
    const quakes = queryHistory(doc, { domain: 1, limit: 1000 });
    expect(quakes.length).toBeGreaterThan(0);
    expect(quakes.every((c) => c.domain === 1)).toBe(true);
    const top = queryHistory(doc, { scale: 'GDACS', minRank: 2, limit: 1000 });
    expect(top.every((c) => c.rating.scale === 'GDACS' && (c.rating.rank ?? -1) >= 2)).toBe(true);
    const pinned = queryHistory(doc, { hasLocation: true, limit: 1000 });
    expect(pinned.every((c) => c.location.latE6 !== null)).toBe(true);
    const sample = quakes.find((c) => c.countries.length > 0)!;
    const found = queryHistory(doc, { q: sample.countries[0]!.toLowerCase(), domain: 1, limit: 1000 });
    expect(found.some((c) => c.id === sample.id)).toBe(true);
    expect(queryHistory(doc, { q: 'zzzzqqqq' })).toEqual([]);
  });

  it('the public endpoint answers without a token, validates input and carries the credits', async () => {
    const a = app();
    const ok = await a.inject({ method: 'GET', url: '/public/hazards/history?domain=1&limit=5&fields=1' });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { cards: { fields: unknown[] }[]; credits: string[]; remark: string };
    expect(body.cards.length).toBeLessThanOrEqual(5);
    expect(body.cards[0]!.fields.length).toBeGreaterThan(5);
    expect(body.credits.join(' ')).toMatch(/U\.S\. Geological Survey|GDACS/);
    expect(body.remark).toMatch(/affectedPeopleEstimate/);
    const light = await a.inject({ method: 'GET', url: '/public/hazards/history?domain=1&limit=2' });
    expect((light.json() as { cards: Record<string, unknown>[] }).cards[0]).not.toHaveProperty('fields');
    for (const bad of ['domain=9', 'minRank=x', 'from=nope', 'hasLocation=maybe', 'limit=0']) {
      const r = await a.inject({ method: 'GET', url: `/public/hazards/history?${bad}` });
      expect(r.statusCode, bad).toBe(400);
    }
  });
});
