import type { FastifyInstance } from 'fastify';
import { AegisError } from '../../engine/errors.js';
import { addBookmark, addCredit, creditBalance, deleteBookmark, listBookmarks, purchasedOn } from '../../data/repos/credits.js';
import { coverageOf } from '../../domains/coverage.js';
import { AIR_ATTRIBUTION, WEATHER_ATTRIBUTION } from '../../sources/googleEnv.js';
import type { EnvPin } from '../../sources/pinRegistry.js';
import { pinViews, EnvStore } from '../../services/envStore.js';
import { principalFrom } from '../auth.js';
import type { AppDeps } from '../server.js';

/** Credits (tokens) instead of dollars (AEG-CREDIT-001). STUB: nothing is charged; "buying" adds demo credits and the response says so. */
export const CREDIT_RULES = {
  starter: 5,
  pinLookupCost: 1,
  packs: [{ id: 'small', credits: 10, label: '10 credits' }, { id: 'medium', credits: 50, label: '50 credits' }, { id: 'large', credits: 200, label: '200 credits' }],
  dailyPurchaseCap: 400,
  maxBookmarks: 20,
} as const;
const STUB_NOTE = 'Demo only: no payment provider is connected and nothing is charged. Real payments need a payment provider and the owner\'s approval.';

/** A synthetic pin for a dropped location. The id comes from the point rounded to 3 decimals (about 110 m), so nearby drops share one cached reading. */
export function customPin(lat: number, lng: number, country: 'SG' | 'BN' | 'MY'): EnvPin {
  const la = Math.round(lat * 1000) / 1000; const lo = Math.round(lng * 1000) / 1000;
  return { pinId: `cust-${la.toFixed(3)}_${lo.toFixed(3)}`, country, region: 'Dropped pin', name: `Dropped pin (${la.toFixed(3)}, ${lo.toFixed(3)})`, lat: la, lng: lo, roles: ['general'], hazards: [], needs: ['air', 'weather'], mergedFrom: [], review: null };
}

export function registerCreditsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const store = deps.envStore ?? new EnvStore();
  const me = (request: Parameters<typeof principalFrom>[0]): string => principalFrom(request).userId;
  const summary = (userId: string) => {
    addCredit(deps.db, { userId, delta: CREDIT_RULES.starter, reason: 'STARTER', ref: 'starter grant', at: deps.clock.now() });   // once: the unique index ignores a repeat
    return { balance: creditBalance(deps.db, userId), pinLookupCost: CREDIT_RULES.pinLookupCost, packs: CREDIT_RULES.packs, stub: true, note: STUB_NOTE, liveLookup: deps.envOnDemand !== undefined };
  };

  app.get('/api/credits', async (request, reply) => { reply.header('Cache-Control', 'no-store'); return summary(me(request)); });

  app.post('/api/credits/buy-stub', async (request) => {
    const userId = me(request);
    const pack = CREDIT_RULES.packs.find((p) => p.id === String((request.body as { packId?: unknown } | null)?.packId));
    if (!pack) throw new AegisError('E_VALIDATION', 'Send packId small, medium or large.');
    const at = deps.clock.now();
    if (purchasedOn(deps.db, userId, at.slice(0, 10)) + pack.credits > CREDIT_RULES.dailyPurchaseCap) throw new AegisError('E_VALIDATION', 'Daily limit of demo credits reached.');
    summary(userId);
    addCredit(deps.db, { userId, delta: pack.credits, reason: 'STUB_PURCHASE', ref: `${pack.id} (stub, no payment)`, at });
    return { ...summary(userId), bought: pack.credits };
  });

  /** Check air quality and weather at ANY dropped point in Singapore, Malaysia or Brunei, live from Google, for credits. The reading stays in memory for one hour and is never stored. */
  app.post('/api/pins/lookup', async (request, reply) => {
    const userId = me(request);
    const body = (request.body ?? {}) as { lat?: unknown; lng?: unknown };
    const lat = Number(body.lat); const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new AegisError('E_VALIDATION', 'Send lat and lng as numbers.');
    const country = coverageOf(lat, lng);
    reply.header('Cache-Control', 'no-store');
    if (!country) throw new AegisError('E_VALIDATION', 'Custom pins work inside Singapore, Malaysia and Brunei only.');
    const state = summary(userId);
    if (!deps.envOnDemand) return reply.code(503).send({ status: 'disabled', detail: 'Live lookups are switched off on this server; no credits were used.', balance: state.balance });
    if (state.balance < CREDIT_RULES.pinLookupCost) throw new AegisError('E_INSUFFICIENT_CREDITS', `A place check costs ${CREDIT_RULES.pinLookupCost} credit; you have ${state.balance}. Buy credits (demo) to continue.`);
    const pin = customPin(lat, lng, country);
    const result = await deps.envOnDemand.lookup(pin, userId);
    if (result.status === 'rate_limited' || result.status === 'daily_cap' || result.status === 'unavailable' || result.status === 'disabled') {
      return reply.code(result.status === 'rate_limited' ? 429 : 503).send({ status: result.status, detail: result.detail, balance: state.balance });
    }
    const at = deps.clock.now();
    addCredit(deps.db, { userId, delta: -CREDIT_RULES.pinLookupCost, reason: 'PIN_LOOKUP', ref: pin.pinId, at });
    const [view] = pinViews([pin], store, at);
    return { status: result.status, balance: creditBalance(deps.db, userId), cost: CREDIT_RULES.pinLookupCost, attribution: { air: AIR_ATTRIBUTION, weather: WEATHER_ATTRIBUTION }, pin: view, validMinutes: 60, remarks: ['Google readings are shown on screen only, kept for at most one hour and never saved. Saving a place keeps its name and coordinates only.'] };
  });

  app.get('/api/bookmarks', async (request, reply) => { reply.header('Cache-Control', 'no-store'); return { bookmarks: listBookmarks(deps.db, me(request)), max: CREDIT_RULES.maxBookmarks }; });
  app.post('/api/bookmarks', async (request) => {
    const userId = me(request);
    const b = (request.body ?? {}) as { name?: unknown; lat?: unknown; lng?: unknown };
    const lat = Number(b.lat); const lng = Number(b.lng);
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
    if (!name) throw new AegisError('E_VALIDATION', 'Give the place a name.');
    if (!coverageOf(lat, lng)) throw new AegisError('E_VALIDATION', 'Saved places work inside Singapore, Malaysia and Brunei only.');
    if (listBookmarks(deps.db, userId).length >= CREDIT_RULES.maxBookmarks) throw new AegisError('E_VALIDATION', `You can save up to ${CREDIT_RULES.maxBookmarks} places.`);
    const bookmark = { bookmarkId: deps.ids.next('BKM'), name, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, createdAt: deps.clock.now() };
    addBookmark(deps.db, userId, bookmark);
    return { bookmark };
  });
  app.delete('/api/bookmarks/:bookmarkId', async (request) => {
    if (!deleteBookmark(deps.db, me(request), (request.params as { bookmarkId: string }).bookmarkId)) throw new AegisError('E_NOT_FOUND');
    return { ok: true };
  });
}
