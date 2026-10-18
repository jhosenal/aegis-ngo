import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultEnvQuotaConfig, EnvQuotaGate, ownerEnvQuotaConfig, planEnvCapacity, OWNER_PLAN, type EnvQuotaConfig } from '../../src/costs/envQuota.js';
import { loadPriceBook, parsePriceBook } from '../../src/costs/pricebook.js';

const book = loadPriceBook();
const T = '2026-10-15T08:00:00.000Z';
const gate = (config?: Partial<EnvQuotaConfig>, b = book) => {
  const db = new Database(':memory:');
  return { db, g: new EnvQuotaGate(db, b, { ...defaultEnvQuotaConfig(b), ...config }) };
};
let n = 0;
const rid = () => `R${(n += 1)}`;

describe('Google Environment API quota gate (AEG-ENV-001)', () => {
  it('prices are the saved Google list: AQ $5.00/1000, Weather $0.15/1000, 10,000 free each', () => {
    expect(book.prices.find((p) => p.priceId === 'GMP.AIRQUALITY.REQ.T1')?.priceUsd).toBe('5.00');
    expect(book.prices.find((p) => p.priceId === 'GMP.WEATHER.REQ.T1')?.priceUsd).toBe('0.15');
    expect(book.freeTiers.find((f) => f.freeId === 'GMP.AIRQUALITY.FREE.REQ')?.quantityPerMonth).toBe('10000');
    expect(book.freeTiers.find((f) => f.freeId === 'GMP.WEATHER.FREE.REQ')?.quantityPerMonth).toBe('10000');
  });

  it('every new source check string appears in its saved page', () => {
    const rows: { id: string; check?: { file: string; contains: string[] } }[] = [
      ...book.prices.map((p) => ({ id: p.priceId, check: p.source.check })),
      ...book.freeTiers.map((f) => ({ id: f.freeId, check: f.source.check })),
    ].filter((r) => r.id.startsWith('GMP.'));
    expect(rows).toHaveLength(8);   // air quality, weather, Dynamic Street View and Places Text Search Enterprise (price and free tier each)
    let checked = 0;
    for (const r of rows) {
      expect(r.check).toBeDefined();
      // A source release does not carry the saved price pages (they stay private with the audit records), so a missing page is counted, not silently passed.
      const file = new URL(`../../${r.check!.file}`, import.meta.url);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const s of r.check!.contains) expect(text).toContain(s);
      checked += 1;
    }
    if (checked < rows.length) console.warn(`price-page check: ${checked} of ${rows.length} saved pages present; ${rows.length - checked} not verified here (private records).`);
  });

  it('defaults to the free cap and zero paid spend', () => {
    const cfg = defaultEnvQuotaConfig(book);
    expect(cfg.skus.AIR_QUALITY).toEqual({ monthlyCalls: 10000, dailyCalls: 334, monthlyPaidMicro: 0 });
    expect(cfg.skus.WEATHER.monthlyCalls).toBe(10000);
    expect(cfg.monthlyPaidMicro).toBe(0);
  });

  it('stops at the monthly cap and counts a released call as zero', () => {
    const { g } = gate({ skus: { AIR_QUALITY: { monthlyCalls: 3, dailyCalls: 99, monthlyPaidMicro: 0 }, WEATHER: { monthlyCalls: 3, dailyCalls: 99, monthlyPaidMicro: 0 } } });
    const a = g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'currentConditions', units: 1, now: T });
    const b = g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'currentConditions', units: 2, now: T });
    expect(a.ok && b.ok).toBe(true);
    expect(g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'currentConditions', units: 1, now: T })).toEqual({ ok: false, reason: 'MONTH_LIMIT' });
    g.release((a as { reservationId: string }).reservationId, T);
    expect(g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'currentConditions', units: 1, now: T }).ok).toBe(true);
  });

  it('keeps the two SKUs separate and resets on a new UTC month', () => {
    const { g } = gate({ skus: { AIR_QUALITY: { monthlyCalls: 1, dailyCalls: 1, monthlyPaidMicro: 0 }, WEATHER: { monthlyCalls: 1, dailyCalls: 1, monthlyPaidMicro: 0 } } });
    expect(g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 1, now: T }).ok).toBe(true);
    expect(g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 1, now: T }).ok).toBe(true);
    expect(g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 1, now: '2026-10-16T00:00:00.000Z' })).toEqual({ ok: false, reason: 'MONTH_LIMIT' });
    expect(g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 1, now: '2026-11-01T00:00:00.000Z' }).ok).toBe(true);
  });

  it('daily cap stops a burst before the monthly cap', () => {
    const { g } = gate({ skus: { AIR_QUALITY: { monthlyCalls: 10000, dailyCalls: 2, monthlyPaidMicro: 0 }, WEATHER: { monthlyCalls: 10000, dailyCalls: 2, monthlyPaidMicro: 0 } } });
    expect(g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 2, now: T }).ok).toBe(true);
    expect(g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 1, now: T })).toEqual({ ok: false, reason: 'DAY_LIMIT' });
  });

  it('refuses paid calls unless the owner funds a paid budget, then prices only the units above the free cap', () => {
    const cfg = (paid: number): Partial<EnvQuotaConfig> => ({ skus: { AIR_QUALITY: { monthlyCalls: 10100, dailyCalls: 10100, monthlyPaidMicro: paid }, WEATHER: { monthlyCalls: 10100, dailyCalls: 10100, monthlyPaidMicro: paid } }, monthlyPaidMicro: paid });
    const free = gate(cfg(0));
    expect(free.g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 10000, now: T }).ok).toBe(true);
    expect(free.g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 1, now: T })).toEqual({ ok: false, reason: 'PAID_BUDGET_LIMIT' });
    // 100 paid AQ events * $0.005 = $0.50 = 500,000 micro-USD; exactly funded passes, one micro-USD short fails.
    const funded = gate(cfg(500_000));
    expect(funded.g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 10000, now: T }).ok).toBe(true);
    const r = funded.g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 100, now: T });
    expect(r).toMatchObject({ ok: true, paidMicro: 500_000 });
    const short = gate(cfg(499_999));
    short.g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 10000, now: T });
    expect(short.g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 100, now: T })).toEqual({ ok: false, reason: 'PAID_BUDGET_LIMIT' });
  });

  it('a weather call is priced at $0.00015, not $0.005', () => {
    const cfg: Partial<EnvQuotaConfig> = { skus: { AIR_QUALITY: { monthlyCalls: 10001, dailyCalls: 10001, monthlyPaidMicro: 1_000 }, WEATHER: { monthlyCalls: 10001, dailyCalls: 10001, monthlyPaidMicro: 1_000 } }, monthlyPaidMicro: 1_000 };
    const { g } = gate(cfg);
    g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 10000, now: T });
    expect(g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 1, now: T })).toMatchObject({ ok: true, paidMicro: 150 });
  });

  it('never crosses the modelled 100,000-event band even if configured to', () => {
    const { g } = gate({ skus: { AIR_QUALITY: { monthlyCalls: 500000, dailyCalls: 500000, monthlyPaidMicro: 10 ** 12 }, WEATHER: { monthlyCalls: 1, dailyCalls: 1, monthlyPaidMicro: 10 ** 12 } }, monthlyPaidMicro: 10 ** 12 });
    expect(g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 100001, now: T })).toEqual({ ok: false, reason: 'BAND_LIMIT' });
  });

  it('fails closed on a missing price or free tier, bad units, a duplicate id and a bad config', () => {
    const raw = JSON.parse(readFileSync(new URL('../../records/costs/price-book.json', import.meta.url), 'utf8')) as { prices: { priceId: string }[] };
    raw.prices = raw.prices.filter((p) => p.priceId !== 'GMP.WEATHER.REQ.T1');
    expect(() => parsePriceBook(raw)).toThrow();          // the free tier would name an unknown price
    const noFree = JSON.parse(readFileSync(new URL('../../records/costs/price-book.json', import.meta.url), 'utf8')) as { freeTiers: { freeId: string }[] };
    noFree.freeTiers = noFree.freeTiers.filter((f) => f.freeId !== 'GMP.WEATHER.FREE.REQ');
    const { g } = gate({}, parsePriceBook(noFree));
    expect(g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 1, now: T })).toEqual({ ok: false, reason: 'NO_PRICE' });
    const ok = gate();
    expect(ok.g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 0, now: T })).toEqual({ ok: false, reason: 'BAD_UNITS' });
    expect(ok.g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 1.5, now: T })).toEqual({ ok: false, reason: 'BAD_UNITS' });
    ok.g.reserve({ reservationId: 'DUP', sku: 'WEATHER', endpoint: 'x', units: 1, now: T });
    expect(ok.g.reserve({ reservationId: 'DUP', sku: 'WEATHER', endpoint: 'x', units: 1, now: T })).toEqual({ ok: false, reason: 'DUPLICATE' });
    const bad = gate({ monthlyPaidMicro: -1 });
    expect(bad.g.reserve({ reservationId: rid(), sku: 'WEATHER', endpoint: 'x', units: 1, now: T })).toEqual({ ok: false, reason: 'BAD_CONFIG' });
  });

  it('settles a paged call down to the pages served and refuses to settle above the reservation', () => {
    const { g } = gate();
    const r = g.reserve({ reservationId: 'PG', sku: 'AIR_QUALITY', endpoint: 'history', units: 5, now: T });
    expect(r.ok).toBe(true);
    expect(() => g.settle('PG', 6, T)).toThrow();
    g.settle('PG', 2, T);
    expect(g.snapshot('AIR_QUALITY', T)).toMatchObject({ monthUsed: 2, dayUsed: 2, freeCap: 10000, paidBudgetMicro: 0 });
  });

  it('a liability keeps counting; a settled-to-zero call frees its units', () => {
    const { g } = gate({ skus: { AIR_QUALITY: { monthlyCalls: 2, dailyCalls: 2, monthlyPaidMicro: 0 }, WEATHER: { monthlyCalls: 2, dailyCalls: 2, monthlyPaidMicro: 0 } } });
    g.reserve({ reservationId: 'A', sku: 'AIR_QUALITY', endpoint: 'x', units: 2, now: T });
    g.markLiability('A', T);
    expect(g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 1, now: T })).toEqual({ ok: false, reason: 'MONTH_LIMIT' });
    g.settle('A', 0, T);
    expect(g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 1, now: T }).ok).toBe(true);
  });

  it('owner plan: 160 USD ceiling, 80 USD per service, 4 runs a day, 31-day month', () => {
    const aq = planEnvCapacity(book, { sku: 'AIR_QUALITY', paidBudgetMicro: OWNER_PLAN.perServiceMicro, daysInMonth: 31, runsPerDay: 4 })!;
    expect(aq).toMatchObject({ freeEvents: 10000, paidEvents: 16000, monthlyEvents: 26000, dailyEvents: 838, perRunEvents: 209, bandLimited: false, maxPaidMicro: 80_000_000 });
    const wx = planEnvCapacity(book, { sku: 'WEATHER', paidBudgetMicro: OWNER_PLAN.perServiceMicro, daysInMonth: 31, runsPerDay: 4 })!;
    // 80 USD would buy 533,333 weather events, but the modelled band stops at 100,000: the real ceiling is (100,000-10,000)*0.15/1000 = 13.50 USD.
    expect(wx).toMatchObject({ monthlyEvents: 100000, dailyEvents: 3225, perRunEvents: 806, bandLimited: true, maxPaidMicro: 13_500_000 });
    const cfg = ownerEnvQuotaConfig(book);
    expect(cfg.monthlyPaidMicro).toBe(160_000_000);
    expect(cfg.skus.AIR_QUALITY).toEqual({ monthlyCalls: 26000, dailyCalls: 838, monthlyPaidMicro: 80_000_000 });
    // 209 pins x 4 runs x 31 days: 1 AQ call and 3 weather calls (current, hourly forecast, alert) per pin per run stay inside both caps.
    const pins = aq.perRunEvents;
    expect(pins * 4 * 31).toBeLessThanOrEqual(aq.monthlyEvents);
    expect(pins * 3 * 4 * 31).toBeLessThanOrEqual(wx.monthlyEvents);
    expect(pins * 3 * 4).toBeLessThanOrEqual(wx.dailyEvents);
  });

  it('a service cannot spend into the other service share of the ceiling', () => {
    const cfg: EnvQuotaConfig = { skus: {
      AIR_QUALITY: { monthlyCalls: 10100, dailyCalls: 10100, monthlyPaidMicro: 250_000 },   // 50 paid events
      WEATHER: { monthlyCalls: 10100, dailyCalls: 10100, monthlyPaidMicro: 250_000 } }, monthlyPaidMicro: 10 ** 9 };
    const { g } = gate(cfg);
    g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 10000, now: T });
    expect(g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 50, now: T }).ok).toBe(true);
    expect(g.reserve({ reservationId: rid(), sku: 'AIR_QUALITY', endpoint: 'x', units: 1, now: T })).toEqual({ ok: false, reason: 'PAID_BUDGET_LIMIT' });
  });
});
