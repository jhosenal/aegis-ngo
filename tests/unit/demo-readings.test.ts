import { describe, expect, it } from 'vitest';
import { demoReadings } from '../../src/api/routes/adminPins.js';
import type { EnvPin } from '../../src/sources/pinRegistry.js';

const pin = { pinId: 'my-01', country: 'MY', name: 'Kuala Lumpur', region: 'KL', lat: 3.139, lng: 101.687, roles: ['general'], hazards: [], needs: ['air', 'weather'] } as unknown as EnvPin;
const at = '2026-10-17T03:00:00.000Z';
type Rec = Record<string, unknown>;
const get = (r: unknown, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v as Rec | undefined)?.[k], r);

describe('sample (demo) readings carry the field names of Google\'s real responses', () => {
  const [air, weather] = demoReadings(pin, at);
  it('air: indexes[] and pollutants[] as the live canary showed (units, not unit)', () => {
    expect(air!.kind).toBe('AIR_CURRENT');
    const data = air!.data as Rec;
    expect(data['demo']).toBe(true);
    const index = (data['indexes'] as Rec[])[0]!;
    for (const k of ['code', 'displayName', 'aqi', 'aqiDisplay', 'color', 'category', 'dominantPollutant']) expect(index).toHaveProperty(k);
    expect(index['code']).toBe('uaqi');
    const pm25 = (data['pollutants'] as Rec[]).find((p) => p['code'] === 'pm25')!;
    expect(get(pm25, 'concentration.units')).toBe('MICROGRAMS_PER_CUBIC_METER');   // the pin card shows PM2.5 only for exactly this
    expect(typeof get(pm25, 'concentration.value')).toBe('number');
    expect((data['pollutants'] as Rec[]).map((p) => p['code'])).toEqual(['pm25', 'pm10', 'o3', 'no2', 'so2', 'co']);
    expect(air!.attribution).toContain('DEMO');
  });
  it('weather: temperature, precipitation qpf, wind, visibility and weatherCondition as the live canary showed', () => {
    const data = weather!.data as Rec;
    expect(data['demo']).toBe(true);
    expect(get(data, 'temperature.unit')).toBe('CELSIUS');
    expect(typeof get(data, 'temperature.degrees')).toBe('number');
    expect(get(data, 'precipitation.qpf.unit')).toBe('MILLIMETERS');
    expect(get(data, 'precipitation.probability.type')).toBe('RAIN');
    expect(typeof get(data, 'wind.speed.value')).toBe('number');
    expect(get(data, 'wind.speed.unit')).toBe('KILOMETERS_PER_HOUR');
    expect(get(data, 'visibility.unit')).toBe('KILOMETERS');
    expect(typeof get(data, 'weatherCondition.description.text')).toBe('string');
    expect(typeof get(data, 'weatherCondition.type')).toBe('string');
    expect(typeof data['relativeHumidity']).toBe('number');
  });
  it('is deterministic per pin and hour, and never claims to be Google', () => {
    expect(demoReadings(pin, at)).toEqual(demoReadings(pin, at));
    expect(JSON.stringify(demoReadings(pin, at))).not.toContain('Includes air quality data from Google');
  });
});
