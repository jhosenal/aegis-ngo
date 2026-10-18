import { describe, expect, it } from 'vitest';
import { temperatureBand, type EnvPinView } from '../../ui/src/dashboard/environment.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const pin = (degrees: number, unit = 'CELSIUS', validUntil = '2026-10-16T12:30:00Z'): Pick<EnvPinView, 'weather'> => ({
  weather: { current: { pinId: 'x', kind: 'WEATHER_CURRENT', sku: 'WEATHER', fetchedAt: '2026-10-16T11:30:00Z', validUntil, attribution: 'a', data: { temperature: { degrees, unit } } } as never, hourly: null, alerts: null },
});

describe('temperature ring (display only, computed from a live reading)', () => {
  it('uses the 35, 37 reference edges and our own lower edges', () => {
    expect(temperatureBand(pin(18), NOW)?.id).toBe('cool');
    expect(temperatureBand(pin(27.6), NOW)?.id).toBe('comfortable');
    expect(temperatureBand(pin(34.9), NOW)?.id).toBe('warm');
    expect(temperatureBand(pin(35), NOW)?.id).toBe('hot');
    expect(temperatureBand(pin(37), NOW)?.id).toBe('very-hot');
  });
  it('shows nothing once the reading has expired, for a non-Celsius unit, or with no reading', () => {
    expect(temperatureBand(pin(30, 'CELSIUS', '2026-10-16T11:59:00Z'), NOW)).toBeNull();
    expect(temperatureBand(pin(90, 'FAHRENHEIT'), NOW)).toBeNull();
    expect(temperatureBand({ weather: { current: null, hourly: null, alerts: null } }, NOW)).toBeNull();
  });
});
