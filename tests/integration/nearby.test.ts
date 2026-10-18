import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { seedAll } from '../../src/services/seed.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { loadConfig } from '../../src/config/config.js';
import { createApp } from '../../src/api/server.js';
import { StubProvider, type StubStep } from '../../src/providers/stubs.js';
import { ModelGateway } from '../../src/providers/gateway.js';
import { BudgetLedger } from '../../src/providers/budget-ledger.js';
import { bindingForRole } from '../../src/roles/manager.js';
import { createNearbyFinder, normalizeCategory, resolveCentre, type NearbyFinder, type NearbyResult } from '../../src/services/nearbyServices.js';
import { distanceMetres, overpassBoxQuery, overpassQuery, parseAll, parseOverpass } from '../../src/sources/overpass.js';
import { countByCategory, locateByName, searchNear, upsertPlaces } from '../../src/data/repos/essentialPlaces.js';
import type { ChatReply } from '../../src/types/domain.js';

const NOW = '2026-10-17T03:00:00Z';
const KL = { lat: 3.139, lng: 101.687 };
const named = [{ name: 'Orchard Road', lat: 1.3048, lng: 103.8318 }, { name: 'Kuala Lumpur City Centre', lat: 3.1579, lng: 101.7123 }];
const node = (id: number, name: string, lat: number, lon: number, tags: Record<string, string> = {}) => ({ type: 'node', id, lat, lon, tags: { name, ...tags } });
const reply = (elements: unknown[]) => new Response(JSON.stringify({ elements }), { status: 200 });
const publicIp = { resolve: async () => ['93.184.216.34'] };

describe('nearby essential services (AEG-NEARBY-001)', () => {
  it('builds Overpass queries per category and parses, de-duplicates and sorts the answer by distance, dropping unnamed buildings', () => {
    expect(overpassQuery('hospital', 3.139, 101.687, 5000)).toContain('["amenity"="hospital"](around:5000,3.13900,101.68700)');
    expect(overpassQuery('disaster_centre', 3.1, 101.6, 5000)).toMatch(/bencana/i);
    expect(overpassQuery('pharmacy', 3.1, 101.6, 1000)).toContain('"healthcare"="pharmacy"');
    const places = parseOverpass({ elements: [
      node(1, 'Far Hospital', 3.2, 101.7), node(2, 'Near Hospital', 3.14, 101.688, { phone: '+60 3 1234 5678', 'addr:street': 'Jalan A' }), node(3, '', 3.139, 101.687),
      { type: 'way', id: 9, center: { lat: 3.141, lon: 101.69 }, tags: { name: 'Way Hospital' } }, node(4, 'Near Hospital', 3.14, 101.688),
    ] }, KL);
    expect(places.map((p) => p.name)).toEqual(['Near Hospital', 'Way Hospital', 'Far Hospital']);
    expect(places[0]).toMatchObject({ phone: '+60 3 1234 5678', address: 'Jalan A', osmUrl: 'https://www.openstreetmap.org/node/2' });
    expect(places[0]!.distanceM).toBe(Math.round(distanceMetres(KL.lat, KL.lng, 3.14, 101.688)));
    expect(() => parseOverpass({ nope: true }, KL)).toThrow();
  });

  it('understands the words people use for the categories and the place they mean', () => {
    expect([normalizeCategory('Chemist'), normalizeCategory('ER'), normalizeCategory('Police Station'), normalizeCategory('NADMA'), normalizeCategory('evacuation centre'), normalizeCategory('zoo')]).toEqual(['pharmacy', 'hospital', 'police', 'disaster_centre', 'shelter', null]);
    expect(resolveCentre('orchard', { view: KL, named })).toMatchObject({ name: 'Orchard Road', lat: 1.3048 });
    expect(resolveCentre('here', { view: KL, named })).toMatchObject({ lat: KL.lat, name: 'the centre of the map' });
    expect(resolveCentre('Atlantis', { view: KL, named })?.name).toMatch(/not found/);
    expect(resolveCentre(undefined, { view: null, named })).toBeNull();
  });

  it('finds the nearest, widens the radius once when nothing is close, caches repeats, and credits OpenStreetMap', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_u: URL, init: RequestInit) => {
      const q = decodeURIComponent(String(init.body).slice(5)); calls.push(q);
      return q.includes('around:5000') ? reply([]) : reply([node(7, 'Wide Hospital', 3.2, 101.7)]);
    }) as unknown as typeof fetch;
    const find = createNearbyFinder({ clock: new FixedClock(NOW), fetchImpl, resolver: publicIp, minGapMs: 0 });
    const r = await find({ category: 'hospital' }, { view: KL, named });
    expect(r).toMatchObject({ found: true, available: true, label: 'Hospitals', radiusM: 15000, credit: expect.stringContaining('OpenStreetMap') });
    expect(r.places?.[0]?.name).toBe('Wide Hospital');
    expect(calls).toHaveLength(2);                          // 5 km then 15 km
    await find({ category: 'hospital' }, { view: KL, named });
    expect(calls).toHaveLength(2);                          // served from the cache
    expect(r.advice).toMatch(/call your local emergency number/);
    expect(await find({ category: 'zoo' }, { view: KL, named })).toMatchObject({ found: false, available: true });
    expect(await find({ category: 'pharmacy' }, { view: null, named })).toMatchObject({ found: false, reason: expect.stringMatching(/need a place/) });
  });

  it('fails over to the next public Overpass server when one is at capacity, and remembers the one that answered', async () => {
    const hosts: string[] = [];
    const fetchImpl = (async (u: URL) => { hosts.push(u.hostname); return u.hostname === 'overpass-api.de' ? new Response('at capacity', { status: 502 }) : reply([node(1, 'Mirror Hospital', 3.14, 101.69)]); }) as unknown as typeof fetch;
    const find = createNearbyFinder({ clock: new FixedClock(NOW), fetchImpl, resolver: publicIp, minGapMs: 0 });
    expect((await find({ category: 'hospital' }, { view: KL, named })).places?.[0]?.name).toBe('Mirror Hospital');
    expect(hosts).toEqual(['overpass-api.de', 'overpass.private.coffee']);
    await find({ category: 'pharmacy' }, { view: KL, named });
    expect(hosts.slice(2)).toEqual(['overpass.private.coffee']);     // the working server is tried first next time
  });

  it('the stored copy answers first, offline and instantly; a category with no stored rows still goes live', async () => {
    const db = openDb(':memory:'); migrate(db, fileURLToPath(new URL('../../migrations/', import.meta.url)), NOW);
    expect(upsertPlaces(db, [
      { osmId: 'node/1', category: 'hospital', name: 'Hospital A', lat: 3.14, lng: 101.69, phone: '+60 3 1', website: null, address: null, operator: null },
      { osmId: 'node/2', category: 'hospital', name: 'Hospital B', lat: 3.3, lng: 101.8, phone: null, website: null, address: null, operator: null },
      { osmId: 'node/3', category: 'hospital', name: 'Far Hospital', lat: 5.4, lng: 100.3, phone: null, website: null, address: null, operator: null },
    ], NOW)).toBe(3);
    expect(countByCategory(db)).toEqual({ hospital: 3 });
    expect(searchNear(db, 'hospital', KL.lat, KL.lng, 5000, 8).map((p) => p.name)).toEqual(['Hospital A']);
    let liveCalls = 0;
    const fetchImpl = (async () => { liveCalls += 1; return reply([node(9, 'Live Pharmacy', 3.14, 101.69)]); }) as unknown as typeof fetch;
    const find = createNearbyFinder({ clock: new FixedClock(NOW), db, fetchImpl, resolver: publicIp, minGapMs: 0 });
    const r = await find({ category: 'hospital' }, { view: KL, named });
    expect(r.places?.map((p) => p.name)).toEqual(['Hospital A']);   // 5 km finds A, so the first radius that has results wins
    expect(liveCalls).toBe(0);
    const wide = await find({ category: 'hospital', radiusKm: 2, near: 'Orchard Road' }, { view: KL, named });
    expect(wide.places?.[0]?.name).toBe('Live Pharmacy');                        // nothing stored near Singapore: the copy may be incomplete, so the live search is tried
    expect(liveCalls).toBe(1);
    const live = await find({ category: 'pharmacy' }, { view: KL, named });
    expect(live.places?.[0]?.name).toBe('Live Pharmacy');                         // no pharmacies stored at all: live search
    expect(liveCalls).toBe(2);
    expect(overpassBoxQuery('hospital', 1, 2, 3, 4)).toContain('(1,2,3,4)');
    expect(parseAll({ elements: [node(1, 'X', 3.1, 101.6)] })).toEqual([expect.objectContaining({ name: 'X', id: 'node/1' })]);
  });

  it('a named area that is not a pin is located from the stored places that mention it ("jinjang clinic" with the map far away)', async () => {
    const db = openDb(':memory:'); migrate(db, fileURLToPath(new URL('../../migrations/', import.meta.url)), NOW);
    upsertPlaces(db, [
      { osmId: 'node/11', category: 'police', name: 'Jinjang Police Station', lat: 3.2142, lng: 101.6599, phone: null, website: null, address: 'Jalan Jinjang Utama Kuala Lumpur', operator: null },
      { osmId: 'node/12', category: 'pharmacy', name: 'Health Lane Family Pharmacy Jinjang', lat: 3.2106, lng: 101.6579, phone: null, website: null, address: null, operator: null },
      { osmId: 'node/13', category: 'clinic', name: 'Klinik Dekat Jinjang', lat: 3.2090, lng: 101.6581, phone: null, website: null, address: null, operator: null },
      { osmId: 'node/14', category: 'clinic', name: 'Klinik Faraway', lat: 5.4, lng: 100.3, phone: null, website: null, address: null, operator: null },
    ], NOW);
    expect(locateByName(db, 'Jinjang')).toMatchObject({ lat: expect.closeTo(3.211, 2), lng: expect.closeTo(101.659, 2) });
    expect(locateByName(db, 'Nowhereville')).toBeNull();
    const find = createNearbyFinder({ clock: new FixedClock(NOW), db, fetchImpl: (async () => { throw new Error('no live call expected'); }) as unknown as typeof fetch, resolver: publicIp, minGapMs: 0 });
    const far = { lat: 5, lng: 115 };   // the default ASEAN view, nowhere near Jinjang
    const r = await find({ category: 'clinic', near: 'Jinjang' }, { view: far, named });
    expect(r.available).toBe(true);
    expect(r.centreName).toBe('Jinjang');
    expect(r.places?.[0]?.name).toBe('Klinik Dekat Jinjang');
  });

  it('says plainly when the search cannot answer, and stops at the daily cap', async () => {
    const down = createNearbyFinder({ clock: new FixedClock(NOW), fetchImpl: (async () => new Response('busy', { status: 429 })) as unknown as typeof fetch, resolver: publicIp, minGapMs: 0 });
    expect(await down({ category: 'police' }, { view: KL, named })).toMatchObject({ found: false, available: false, reason: expect.stringMatching(/emergency number/) });
    const capped = createNearbyFinder({ clock: new FixedClock(NOW), fetchImpl: (async () => reply([node(1, 'A', 3.14, 101.69)])) as unknown as typeof fetch, resolver: publicIp, minGapMs: 0, dailyMax: 1 });
    expect((await capped({ category: 'clinic' }, { view: KL, named })).found).toBe(true);
    expect(await capped({ category: 'clinic', near: 'Orchard Road' }, { view: KL, named })).toMatchObject({ available: false, reason: expect.stringMatching(/daily limit/) });
  });
});

describe('chat helper finds help nearby', () => {
  const active: { app: FastifyInstance; db: ReturnType<typeof openDb> }[] = [];
  afterEach(async () => { for (const i of active.splice(0)) { await i.app.close(); i.db.close(); } });
  const answer = (message: string, toolCall: { name: string; arguments: Record<string, unknown> } | null = null): StubStep => ({ type: 'ok', text: JSON.stringify({ scope: 'in', message, toolCall }), usage: { inputTokens: 20, outputTokens: 20 } });
  async function harness(script: StubStep[], nearby: NearbyFinder) {
    const db = openDb(':memory:'); const clock = new FixedClock(NOW); const ids = new SeqIdGen();
    migrate(db, fileURLToPath(new URL('../../migrations/', import.meta.url)), clock.now());
    seedAll(db, fileURLToPath(new URL('../../fixtures/', import.meta.url)), new FixedClock('2026-10-13T00:00:00Z'), ids);
    const config = loadConfig({ AEGIS_ENV: 'test', AEGIS_MODELS_ENABLED: 'true', AEGIS_GOOGLE_MODEL: 'TEST', AEGIS_PRICE_SNAPSHOT_ID: 'TEST', AEGIS_BUDGET_ACCOUNT_MICRO: '1000000', AEGIS_BUDGET_DAY_MICRO: '1000000', AEGIS_BUDGET_TASK_MICRO: '10000' });
    const provider = new StubProvider('stub-google', script);
    const gateway = new ModelGateway({ db, clock, ids, config, primary: provider, backup: null, ledger: new BudgetLedger(db, { accountMicro: 1000000, dayMicro: 1000000, taskMicro: 10000 }), binding: (role) => bindingForRole(role, config),
      price: { id: 'TEST', capturedAt: clock.now(), inputMicroPerMTok: 80000, outputMicroPerMTok: 400000, source: 'test-vector' }, sleep: async () => {}, rng: () => 0, monotonicMs: () => 0 });
    const app = createApp({ db, clock, ids, config, gateway, nearby }); active.push({ app, db });
    const token = ((await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD' } })).json() as { token: string }).token;
    const ask = async (text: string, extra: Record<string, unknown> = {}) => (await app.inject({ method: 'POST', url: '/api/helper', headers: { authorization: `Bearer ${token}` }, payload: { text, mode: 'normal', conversationId: 'b4c9e266-3c84-4621-9f2f-3680f13ef218', attachments: [], ...extra } })).json() as ChatReply & { error?: unknown };
    return { provider, ask };
  }

  it('"where is the nearest hospital": the tool gets the map view, the reply carries a places block, and the model only sees names, distances and phones', async () => {
    let seen: { args: unknown; ctx: unknown } | null = null;
    const nearby: NearbyFinder = async (args, ctx): Promise<NearbyResult> => { seen = { args, ctx }; return { found: true, available: true, reason: null, category: 'hospital', label: 'Hospitals', centre: KL, centreName: 'the centre of the map', radiusM: 5000, credit: '(c) OpenStreetMap contributors (ODbL)', advice: 'Call first.', places: [{ id: 'node/2', name: 'Near Hospital', lat: 3.14, lng: 101.688, distanceM: 140, phone: '+60 3 1234 5678', website: null, address: null, operator: null, osmUrl: 'https://www.openstreetmap.org/node/2' }] }; };
    const h = await harness([answer('', { name: 'aegis_find_nearby', arguments: { category: 'hospital' } }), answer('The nearest hospital is Near Hospital, 140 m away. The map now shows it.')], nearby);
    const r = await h.ask('Where is the nearest hospital?', { view: KL });
    if (!r.blocks) throw new Error(JSON.stringify(r));
    expect(seen).toMatchObject({ args: { category: 'hospital' }, ctx: { view: KL } });
    const places = r.blocks.find((b) => b.type === 'places');
    expect(places).toMatchObject({ type: 'places', category: 'hospital', credit: expect.stringContaining('OpenStreetMap') });
    expect(r.blocks.some((b) => b.type === 'text' && /Near Hospital/.test(b.text))).toBe(true);
    const second = h.provider.calls[1]!;
    expect(second.user).toContain('Near Hospital');
    expect(second.user).toContain('+60 3 1234 5678');
    expect(second.user).not.toContain('101.688');           // coordinates go to the map, not into the prompt
    expect(h.provider.calls[0]!.system).toContain('aegis_find_nearby');
  });

  it('no finder or an unavailable search: no places block, and the honest reason reaches the model', async () => {
    const nearby: NearbyFinder = async () => ({ found: false, available: false, reason: 'The nearby search service is not answering right now. In an emergency call your local emergency number.' });
    const h = await harness([answer('', { name: 'aegis_find_nearby', arguments: { category: 'pharmacy', near: 'Orchard Road' } }), answer('I cannot search right now. In an emergency call your local emergency number.')], nearby);
    const r = await h.ask('Find a pharmacy near Orchard Road');
    expect(r.blocks.some((b) => b.type === 'places')).toBe(false);
    expect(h.provider.calls[1]!.user).toContain('not answering');
  });
});
