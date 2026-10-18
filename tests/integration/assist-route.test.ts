import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';
import { registerAssistRoutes } from '../../src/api/routes/assist.js';
import { loadAssistContent } from '../../src/assist/content.js';
import { DISCLAIMER_TEXT } from '../../src/assist/contract.js';

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

function appWith(env: Record<string, string>, assistContentDir?: string, assistReleaseFile?: string, assistEndorsementsFile?: string): FastifyInstance {
  const db = openDb(':memory:');
  const clock = new FixedClock('2026-10-13T00:00:00Z');
  const ids = new SeqIdGen();
  migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
  seedAll(db, fixturesDirectory, clock, ids);
  const app = createApp({ db, clock, ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', ...env }), ...(assistContentDir ? { assistContentDir } : {}), ...(assistReleaseFile ? { assistReleaseFile } : {}), ...(assistEndorsementsFile ? { assistEndorsementsFile } : {}) });
  apps.push(app);
  return app;
}

function card(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'C1', language: 'en', hazard: 'flood', severity: 'high', title: 'T', synthetic: true,
    lines: [{ id: 'L1', kind: 'contact', text: 'Call.', sourceId: 'S1' }],
    sources: [{ sourceId: 'S1', publisher: 'P', url: 'https://example.org/x', accessed: '2026-10-14', status: 'SOURCED', passage: 'p' }],
    ...over,
  };
}
function tempContent(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'assist-'));
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  return dir;
}

describe('configuration', () => {
  it('Assist is off by default, and draft medical content is refused in cloud or without Assist', () => {
    expect(loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }).assist).toEqual({ enabled: false, draftMedical: false, preview: false });
    expect(() => loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_ASSIST_DRAFT_MEDICAL: 'true' })).toThrow(/requires AEGIS_ASSIST_ENABLED/);
    const cloud = { AEGIS_ENV: 'cloud', PORT: '8080', AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo', AEGIS_DB_PATH: '/tmp/aegis.db', AEGIS_ASSIST_ENABLED: 'true', AEGIS_ASSIST_DRAFT_MEDICAL: 'true' };
    expect(() => loadConfig(cloud)).toThrow(/must be false when AEGIS_ENV is cloud/);
    expect(loadConfig({ ...cloud, AEGIS_ASSIST_DRAFT_MEDICAL: 'false' }).assist.enabled).toBe(true);
  });
});

describe('GET /public/assist/cards', () => {
  it('does not exist unless Assist is enabled', async () => {
    const response = await appWith({}).inject({ method: 'GET', url: '/public/assist/cards' });
    expect(String(response.headers['content-type'] ?? '')).not.toMatch(/json/);   // the static app page or a 404, never card data
    expect(response.body).not.toMatch(/"cards"|contentHash/);
  });

  it('serves validated cards without a login, a cookie or tenant data, with caching and security headers', async () => {
    const response = await appWith({ AEGIS_ASSIST_ENABLED: 'true' }, tempContent({})).inject({ method: 'GET', url: '/public/assist/cards' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { cards: { card: { synthetic: boolean }; demoBanner: boolean }[]; disclaimer: string; origin: string };
    expect(body.disclaimer).toBe(DISCLAIMER_TEXT);
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.cards.every((c) => c.card.synthetic && c.demoBanner === false)).toBe(true);
    expect(body.origin).toBe('synthetic-fixture');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(JSON.stringify(body)).not.toMatch(/tenant|TENANT|userId/);
  });

  it('answers 304 when the ETag matches', async () => {
    const app = appWith({ AEGIS_ASSIST_ENABLED: 'true' }, tempContent({}));
    const first = await app.inject({ method: 'GET', url: '/public/assist/cards' });
    const second = await app.inject({ method: 'GET', url: '/public/assist/cards', headers: { 'if-none-match': first.headers.etag as string } });
    expect(second.statusCode).toBe(304);
  });

  it('leaves the authenticated API closed to an anonymous visitor', async () => {
    const app = appWith({ AEGIS_ASSIST_ENABLED: 'true' }, tempContent({}));
    expect((await app.inject({ method: 'GET', url: '/api/cards' })).statusCode).toBe(401);
  });

  it('rate limits one address after 60 requests a minute and recovers after the window', async () => {
    let t = 1_000_000;
    const app = Fastify();
    apps.push(app);
    registerAssistRoutes(app, loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_ASSIST_ENABLED: 'true' }), () => t, tempContent({}));
    for (let i = 0; i < 60; i += 1) expect((await app.inject({ method: 'GET', url: '/public/assist/cards' })).statusCode).toBe(200);
    const blocked = await app.inject({ method: 'GET', url: '/public/assist/cards' });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    t += 61_000;
    expect((await app.inject({ method: 'GET', url: '/public/assist/cards' })).statusCode).toBe(200);
  });
});

describe('content loading is fail-closed', () => {
  it('refuses to load when any card file is invalid or not an array', () => {
    expect(() => loadAssistContent({ draftMedical: false, allowFixture: false, dir: tempContent({ 'a.cards.json': [card(), { id: 'BAD' }] }) })).toThrow(/invalid assist card/);
    expect(() => loadAssistContent({ draftMedical: false, allowFixture: false, dir: tempContent({ 'a.cards.json': '{not json' }) })).toThrow(/not valid JSON/);
    expect(() => loadAssistContent({ draftMedical: false, allowFixture: false, dir: tempContent({ 'a.cards.json': { id: 'x' } }) })).toThrow(/JSON array/);
  });

  it('never invents content in a cloud-style load: an empty directory yields no cards', () => {
    const empty = tempContent({});
    expect(loadAssistContent({ draftMedical: false, allowFixture: false, dir: empty })).toMatchObject({ cards: [], origin: 'none' });
    expect(loadAssistContent({ draftMedical: false, allowFixture: true, dir: empty }).origin).toBe('synthetic-fixture');
  });

  it('ignores other JSON files in the folder, such as shelter data', () => {
    const dir = tempContent({ 'a.cards.json': [card()], 'shelters.synthetic.json': { not: 'cards' } });
    expect(loadAssistContent({ draftMedical: false, allowFixture: false, dir }).cards).toHaveLength(1);
  });

  it('hides cards that still wait for a source and cardiac drafts, even if they are in the content directory', () => {
    const pending = card({ id: 'C2', sources: [{ sourceId: 'S1', publisher: 'P', url: 'https://example.org/x', accessed: '2026-10-14', status: 'PENDING_SOURCE', passage: '' }] });
    const draftCardiac = card({ id: 'C3', hazard: 'cardiac', sources: [{ sourceId: 'S1', publisher: 'P', url: 'https://example.org/x', accessed: '2026-10-14', status: 'DRAFT_UNREVIEWED', passage: '' }] });
    const dir = tempContent({ 'a.cards.json': [card(), pending, draftCardiac] });
    const off = loadAssistContent({ draftMedical: false, allowFixture: false, dir });
    expect(off.cards.map((c) => c.card.id)).toEqual(['C1']);
  });
});

describe('the real content folder', () => {
  it('validates: every *.cards.json file in content/assist passes the contract and shows only SOURCED cards', () => {
    const real = loadAssistContent({ draftMedical: false, allowFixture: false });
    expect(real.origin === 'content' || real.origin === 'none').toBe(true);
    for (const { card: c } of real.cards) expect(c.sources.every((s) => s.status === 'SOURCED')).toBe(true);
  });
});

describe('release hold (supervisor decision of 2026-10-14)', () => {
  const cloud = { AEGIS_ENV: 'cloud', PORT: '8080', AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo', AEGIS_DB_PATH: '/tmp/aegis-test.db', AEGIS_ASSIST_ENABLED: 'true' };
  const dir = () => tempContent({ 'a.cards.json': [card()] });
  const hashOf = (d: string) => loadAssistContent({ draftMedical: false, allowFixture: false, dir: d }).hash;
  const releaseFile = (record: Record<string, unknown>): string => {
    const d = mkdtempSync(join(tmpdir(), 'release-'));
    writeFileSync(join(d, 'assist-release.json'), JSON.stringify(record));
    return join(d, 'assist-release.json');
  };
  const held = { status: 'HELD', contentHash: null, reviewedBy: null, reviewedAt: null, evidenceRef: null };
  const approved = (hash: string) => ({ status: 'APPROVED', contentHash: hash, reviewedBy: 'reviewer', reviewedAt: '2026-10-15', evidenceRef: 'S0099', reviewScope: 'SOURCES_CHECKED_NOT_CLINICAL' });
  const get = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/public/assist/cards' });

  it('a cloud build serves nothing while the release is held, and says why', async () => {
    const response = await get(appWith(cloud, dir(), releaseFile(held)));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'E_RELEASE_HELD' });
    expect(response.body).not.toMatch(/"cards"/);
  });

  it('a missing or invalid release record counts as held', async () => {
    expect((await get(appWith(cloud, dir(), join(tmpdir(), 'no-such-release.json')))).statusCode).toBe(503);
    expect((await get(appWith(cloud, dir(), releaseFile({ status: 'APPROVED' })))).statusCode).toBe(503);   // fails the schema
  });

  it('an approval that lacks reviewer, date or evidence does not release', async () => {
    const d = dir();
    const incomplete = { ...approved(hashOf(d)), evidenceRef: null };
    expect((await get(appWith(cloud, d, releaseFile(incomplete)))).statusCode).toBe(503);
  });

  it('an approval for different content does not release: any card change cancels it', async () => {
    const d = dir();
    const stale = approved('0'.repeat(64));
    const response = await get(appWith(cloud, d, releaseFile(stale)));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ message: expect.stringMatching(/changed since it was approved/) });
  });

  it('an approval naming the exact served content releases it', async () => {
    const d = dir();
    const response = await get(appWith(cloud, d, releaseFile(approved(hashOf(d)))));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ released: true });
  });

  it('an approval without a scope does not release (the reader must be told what the approval means)', async () => {
    const d = dir();
    const { reviewScope: _omitted, ...noScope } = approved(hashOf(d));
    expect((await get(appWith(cloud, d, releaseFile(noScope)))).statusCode).toBe(503);
  });

  it('a released response tells the reader plainly when the approval was not clinical, and when it was', async () => {
    const d = dir();
    const notClinical = (await get(appWith(cloud, d, releaseFile(approved(hashOf(d)))))).json() as { approval: { text: string; scope: string } };
    expect(notClinical.approval.scope).toBe('SOURCES_CHECKED_NOT_CLINICAL');
    expect(notClinical.approval.text).toMatch(/not been clinically reviewed/);
    const clinical = (await get(appWith(cloud, d, releaseFile({ ...approved(hashOf(d)), reviewScope: 'CLINICAL' })))).json() as { approval: { text: string } };
    expect(clinical.approval.text).toMatch(/^Reviewed and approved by reviewer/);
    expect(clinical.approval.text).not.toMatch(/not been clinically reviewed/);
  });

  it('a held preview carries no approval notice', async () => {
    const body = (await get(appWith({ ...cloud, AEGIS_ASSIST_PREVIEW: 'true' }, dir(), releaseFile(held)))).json() as { approval: unknown };
    expect(body.approval).toBeNull();
  });

  it('an endorsement counts only for exactly the served content, and a broken file counts as none', async () => {
    const d = dir();
    const file = (content: unknown): string => {
      const folder = mkdtempSync(join(tmpdir(), 'endorse-'));
      writeFileSync(join(folder, 'e.json'), typeof content === 'string' ? content : JSON.stringify(content));
      return join(folder, 'e.json');
    };
    const entry = (contentHash: string) => ({ organisation: 'Synthetic Test Organisation', endorsedBy: 'A. Tester', endorsedOn: '2026-10-16', contentHash });
    const preview = { ...cloud, AEGIS_ASSIST_PREVIEW: 'true' };
    const current = (await get(appWith(preview, d, releaseFile(held), file([entry(hashOf(d))])))).json() as { endorsements: { organisation: string }[] };
    expect(current.endorsements.map((e) => e.organisation)).toEqual(['Synthetic Test Organisation']);
    const stale = (await get(appWith(preview, d, releaseFile(held), file([entry('0'.repeat(64))])))).json() as { endorsements: unknown[] };
    expect(stale.endorsements).toEqual([]);
    const broken = (await get(appWith(preview, d, releaseFile(held), file('{ not json')))).json() as { endorsements: unknown[] };
    expect(broken.endorsements).toEqual([]);
    const extraKey = (await get(appWith(preview, d, releaseFile(held), file([{ ...entry(hashOf(d)), verified: true }])))).json() as { endorsements: unknown[] };
    expect(extraKey.endorsements).toEqual([]);   // strict schema: an unknown field invalidates the file rather than being half-trusted
  });

  it('the shipped endorsement list is empty: no organisation is named as an endorser until it really endorses', async () => {
    const { readEndorsements } = await import('../../src/assist/release.js');
    expect(readEndorsements()).toEqual([]);
  });

  it('buildApprovalRecord binds the approval to the hash it is given', async () => {
    const { buildApprovalRecord, decideRelease } = await import('../../src/assist/release.js');
    const hash = 'a'.repeat(64);
    const record = buildApprovalRecord({ contentHash: hash, reviewedBy: 'Aegis project team', reviewedAt: '2026-10-17', evidenceRef: 'S0099', reviewScope: 'SOURCES_CHECKED_NOT_CLINICAL' });
    expect(decideRelease(record, hash).released).toBe(true);
    expect(decideRelease(record, 'b'.repeat(64)).released).toBe(false);
  });

  it('serves the remarks next to the cards, and a changed remark changes the cache tag but not the content hash', async () => {
    const d = dir();
    const preview = { ...cloud, AEGIS_ASSIST_PREVIEW: 'true' };
    writeFileSync(join(d, 'remarks.json'), JSON.stringify([{ id: 'TEST-ONE', text: 'A first test remark.' }]));
    const first = await get(appWith(preview, d, releaseFile(held)));
    expect((first.json() as { remarks: { id: string }[] }).remarks.map((r) => r.id)).toEqual(['TEST-ONE']);
    writeFileSync(join(d, 'remarks.json'), JSON.stringify([{ id: 'TEST-ONE', text: 'A changed test remark.' }]));
    const second = await get(appWith(preview, d, releaseFile(held)));
    expect(second.headers.etag).not.toBe(first.headers.etag);
    expect((second.json() as { contentHash: string }).contentHash).toBe((first.json() as { contentHash: string }).contentHash);
  });

  it('the real content folder ships remarks, so the preview always states what is not done', async () => {
    const response = await get(appWith({ AEGIS_ASSIST_ENABLED: 'true' }, undefined, releaseFile(held)));
    expect((response.json() as { remarks: { id: string }[] }).remarks.map((r) => r.id)).toEqual(expect.arrayContaining(['MVP-NOT-CLINICAL', 'MVP-PERMISSION']));
  });

  it('a private preview serves the content but marks it as not released', async () => {
    const response = await get(appWith({ ...cloud, AEGIS_ASSIST_PREVIEW: 'true' }, dir(), releaseFile(held)));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ released: false, notReleasedBanner: expect.stringMatching(/Under review/) });
  });

  it('a local or test run serves the content with released=false while it is held', async () => {
    const response = await get(appWith({ AEGIS_ASSIST_ENABLED: 'true' }, dir(), releaseFile(held)));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ released: false });
  });

  it('the shipped release record is HELD, or approved by a named owner for exactly the shipped content (owner decision 2026-10-16, sources checked, not clinical)', async () => {
    const { readReleaseRecord } = await import('../../src/assist/release.js');
    const record = readReleaseRecord();
    expect(record).not.toBeNull();
    if (record === null || record.status === 'HELD') return;
    expect(record).toMatchObject({ status: 'APPROVED', reviewedBy: 'Jhosen Choong', evidenceRef: 'S0013', reviewScope: 'SOURCES_CHECKED_NOT_CLINICAL' });
    expect(record.contentHash).toBe(loadAssistContent({ draftMedical: false, allowFixture: false }).hash);
  });

  it('preview needs Assist enabled', () => {
    expect(() => loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_ASSIST_PREVIEW: 'true' })).toThrow(/requires AEGIS_ASSIST_ENABLED/);
  });
});
