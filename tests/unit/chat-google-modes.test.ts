import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import { googleChatReady, modesFor, planFor } from '../../src/roles/modes.js';
import type { Principal } from '../../src/types/domain.js';

const live = (extra: Record<string, string> = {}) => loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_PROVIDER_MODE: 'live', AEGIS_PRIMARY_PROVIDER: 'google', AEGIS_GOOGLE_API_KEY: 'k', AEGIS_GOOGLE_MODEL: 'gemini-3.8-flash', AEGIS_PRICE_SNAPSHOT_ID: 'P1', AEGIS_MODELS_ENABLED: 'true', AEGIS_BUDGET_GOOGLE_MICRO: '1000000', AEGIS_PRICE_INPUT_MICRO_PER_MTOK: '1500000', AEGIS_PRICE_OUTPUT_MICRO_PER_MTOK: '7500000', AEGIS_PRICE_CAPTURED_AT: '2026-10-17T00:00:00Z', AEGIS_BUDGET_ACCOUNT_MICRO: '2000000', AEGIS_BUDGET_DAY_MICRO: '1000000', AEGIS_BUDGET_TASK_MICRO: '10000', AEGIS_GOOGLE_CHAT_MODELS: 'gemini-3.5-flash-lite,gemini-3.8-flash,gemini-4-argon', ...extra });
const user = (p: Partial<Principal> = {}): Principal => ({ userId: 'U1', tenantId: 'T', productId: 'P', role: 'coordinator', ...p } as Principal);

describe('Gemini chat models: Flash for everyone, Flash-Lite and Argon for Pro and Admin only', () => {
  it('lists the three ids with the right availability per person', () => {
    const cfg = live();
    const avail = (p: Principal) => Object.fromEntries(modesFor(p, cfg).filter((m) => m.id.startsWith('gemini')).map((m) => [m.id, m.available]));
    expect(avail(user())).toEqual({ 'gemini-3.5-flash-lite': false, 'gemini-3.8-flash': true, 'gemini-4-argon': false });
    expect(avail(user({ plan: 'pro' }))).toEqual({ 'gemini-3.5-flash-lite': true, 'gemini-3.8-flash': true, 'gemini-4-argon': true });
    expect(avail(user({ isAdmin: true }))).toEqual({ 'gemini-3.5-flash-lite': true, 'gemini-3.8-flash': true, 'gemini-4-argon': true });
  });
  it('enforces it on the request itself: a posted id the person may not use is refused, and the id is sent to the gateway', () => {
    const cfg = live();
    expect(planFor('gemini-3.8-flash', user(), cfg)[0]).toMatchObject({ label: 'Flash', model: 'gemini-3.8-flash' });
    expect(() => planFor('gemini-4-argon', user(), cfg)).toThrow(/not available/);
    expect(() => planFor('gemini-3.5-flash-lite', user({ plan: 'standard' }), cfg)).toThrow(/not available/);
    expect(planFor('gemini-4-argon', user({ plan: 'pro' }), cfg)[0]).toMatchObject({ label: 'Argon', model: 'gemini-4-argon' });
  });
  it('a model not in the enable list stays pending even for an admin (for example Argon until its quota exists)', () => {
    const cfg = live({ AEGIS_GOOGLE_CHAT_MODELS: 'gemini-3.5-flash-lite,gemini-3.8-flash' });
    const argon = modesFor(user({ isAdmin: true }), cfg).find((m) => m.id === 'gemini-4-argon')!;
    expect(argon.available).toBe(false); expect(argon.note).toMatch(/pending/);
    expect(() => planFor('gemini-4-argon', user({ isAdmin: true }), cfg)).toThrow(/not available/);
    expect(planFor('gemini-3.5-flash-lite', user({ isAdmin: true }), cfg)[0]!.model).toBe('gemini-3.5-flash-lite');
  });
  it('is all unavailable (pending) until Google is the live primary provider', () => {
    const cfg = loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' });
    expect(googleChatReady(cfg)).toBe(false);
    for (const m of modesFor(user({ isAdmin: true }), cfg).filter((x) => x.id.startsWith('gemini'))) { expect(m.available).toBe(false); expect(m.note).toMatch(/pending/); }
    expect(() => planFor('gemini-3.8-flash', user(), cfg)).toThrow();
  });
  it('a legacy registered-users setting cannot unlock Pro models for a stored Standard account', () => {
    const cfg = live({ AEGIS_REGISTERED_USERS:'U1', AEGIS_PREMIUM_MODES_ENABLED:'true' });
    expect(() => planFor('gemini-4-argon', user({plan:'standard'}), cfg)).toThrow();
    expect(() => planFor('gemini-3.5-flash-lite', user({plan:'standard'}), cfg)).toThrow();
    expect(modesFor(user({plan:'standard'}),cfg).find(m=>m.id==='pro')?.available).toBe(false);
  });
});
