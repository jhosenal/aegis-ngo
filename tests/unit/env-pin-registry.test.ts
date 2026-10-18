import { describe, expect, it } from 'vitest';
import { defaultEnvQuotaConfig, ownerEnvQuotaConfig } from '../../src/costs/envQuota.js';
import { loadPriceBook } from '../../src/costs/pricebook.js';
import { loadPinRegistry, monthlyEvents, parsePinRegistry, pinLoad } from '../../src/sources/pinRegistry.js';

const registry = loadPinRegistry();
const book = loadPriceBook();

describe('environment pin registry (AEG-ENV-001)', () => {
  it('holds 125 distinct pins: 127 owner rows less two merged duplicate coordinates', () => {
    expect(registry.pins).toHaveLength(125);
    const byId = new Map(registry.pins.map((p) => [p.pinId, p]));
    expect(byId.has('my-dis-01')).toBe(false);
    expect(byId.has('my-dis-06')).toBe(false);
    expect(byId.get('my-45')).toMatchObject({ roles: ['general', 'hazard'], mergedFrom: ['my-dis-01'] });
    expect(byId.get('my-58')).toMatchObject({ roles: ['general', 'hazard'], mergedFrom: ['my-dis-06'], hazards: ['High Tide / Tidal Surge'] });
    expect(byId.get('sg-04')?.name).toBe('Chinatown');
  });

  it('counts by country', () => {
    const n = (c: string) => registry.pins.filter((p) => p.country === c).length;
    expect({ SG: n('SG'), BN: n('BN'), MY: n('MY') }).toEqual({ SG: 23, BN: 21, MY: 81 });
  });

  it('only the five fire/haze hazard pins and the general pins use Air Quality', () => {
    const air = registry.pins.filter((p) => p.needs.includes('air')).map((p) => p.pinId);
    for (const id of ['bn-dis-03', 'bn-dis-06', 'my-dis-03', 'my-dis-11', 'sg-dis-03']) expect(air).toContain(id);
    const hazardOnly = registry.pins.filter((p) => p.roles.length === 1 && p.roles[0] === 'hazard');
    expect(hazardOnly.filter((p) => p.needs.includes('air'))).toHaveLength(5);
    expect(hazardOnly.filter((p) => !p.needs.includes('air')).every((p) => p.needs.length === 1 && p.needs[0] === 'weather')).toBe(true);
  });

  it('flags the three unconfirmed pins and keeps them in the registry', () => {
    expect(registry.pins.filter((p) => p.review !== null).map((p) => p.pinId).sort()).toEqual(['my-45', 'my-47', 'my-64']);
    expect(pinLoad(registry).needsReview).toBe(3);
  });

  it('fits the owner plan: monthly events stay inside both service caps', () => {
    const load = pinLoad(registry);
    expect(load).toMatchObject({ pins: 125, airPins: 105, weatherPins: 125 });
    const events = monthlyEvents(registry, 4, 31);
    const cfg = ownerEnvQuotaConfig(book);
    expect(events.airQuality).toBe(105 * 124);
    expect(events.airQuality).toBeLessThanOrEqual(cfg.skus.AIR_QUALITY.monthlyCalls);
    expect(events.weather).toBeLessThanOrEqual(cfg.skus.WEATHER.monthlyCalls);
    // per-run and daily load also fit, so no single day can exhaust the month
    expect(load.airPins * 4).toBeLessThanOrEqual(cfg.skus.AIR_QUALITY.dailyCalls);
    expect(load.weatherPins * 3 * 4).toBeLessThanOrEqual(cfg.skus.WEATHER.dailyCalls);
  });

  it('does NOT fit the free-only default: free cap is 10,000 AQ events and this load is 13,020', () => {
    const events = monthlyEvents(registry, 4, 31);
    expect(events.airQuality).toBeGreaterThan(defaultEnvQuotaConfig(book).skus.AIR_QUALITY.monthlyCalls);
  });

  it('refuses a duplicate id, two pins in one 500 m cell, and a bad coordinate', () => {
    const raw = JSON.parse(JSON.stringify(registry)) as typeof registry;
    const a = raw.pins[0]!;
    expect(() => parsePinRegistry({ ...raw, pins: [a, { ...a }] })).toThrow(/duplicate pinId/);
    expect(() => parsePinRegistry({ ...raw, pins: [a, { ...a, pinId: 'sg-99' }] })).toThrow(/share one 500 m cell/);
    expect(() => parsePinRegistry({ ...raw, pins: [{ ...a, lat: 91 }] })).toThrow();
    expect(() => parsePinRegistry({ ...raw, pins: [{ ...a, country: 'ID' }] })).toThrow();
  });
});
