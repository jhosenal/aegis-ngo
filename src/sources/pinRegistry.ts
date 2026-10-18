// The monitored-pin registry for the Google Environment APIs (AEG-ENV-001). A pin is a place we poll Air Quality and/or Weather for.
// Data comes from fixtures/environment-pins.json (owner-supplied). Loading validates it: a bad coordinate, a duplicate id or two pins in one
// 500 m cell is refused, because every duplicate is a billed Google event that returns the same reading.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const PinSchema = z.object({
  pinId: z.string().regex(/^[a-z]{2}-(dis-)?\d{2}$/),
  country: z.enum(['SG', 'BN', 'MY']),
  region: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  roles: z.array(z.enum(['general', 'hazard'])).min(1),
  hazards: z.array(z.string().min(1).max(120)),
  needs: z.array(z.enum(['air', 'weather'])).min(1),
  mergedFrom: z.array(z.string()),
  /** A note means the owner must confirm something about this pin; the pin is still polled but is shown as unverified. */
  review: z.string().max(400).nullable(),
}).strict();

const RegistrySchema = z.object({
  schemaVersion: z.literal(1),
  registryId: z.literal('AEG-ENV-PINS'),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cellMeters: z.literal(500),
  provenance: z.string().min(1),
  pins: z.array(PinSchema).min(1),
}).strict();

export type EnvPin = z.infer<typeof PinSchema>;
export type PinRegistry = z.infer<typeof RegistrySchema>;

export const DEFAULT_PIN_REGISTRY = fileURLToPath(new URL('../../fixtures/environment-pins.json', import.meta.url));

const DEG_PER_500M = 0.0045;   // about 500 m of latitude

/** The 500 m grid cell a point falls in. Longitude is scaled by cos(latitude) so cells stay roughly square near the equator. */
export function cellKey(lat: number, lng: number): string {
  const y = Math.floor(lat / DEG_PER_500M);
  const x = Math.floor((lng * Math.cos((lat * Math.PI) / 180)) / DEG_PER_500M);
  return `${y}:${x}`;
}

export function parsePinRegistry(raw: unknown): PinRegistry {
  const registry = RegistrySchema.parse(raw);
  const ids = new Set<string>();
  const cells = new Map<string, string>();
  for (const pin of registry.pins) {
    if (ids.has(pin.pinId)) throw new Error(`duplicate pinId ${pin.pinId}`);
    ids.add(pin.pinId);
    const key = cellKey(pin.lat, pin.lng);
    const other = cells.get(key);
    if (other) throw new Error(`pins ${other} and ${pin.pinId} share one 500 m cell; merge them`);
    cells.set(key, pin.pinId);
  }
  return registry;
}

export function loadPinRegistry(file: string = DEFAULT_PIN_REGISTRY): PinRegistry {
  return parsePinRegistry(JSON.parse(readFileSync(file, 'utf8')));
}

export interface PinLoad { pins: number; airPins: number; weatherPins: number; needsReview: number }

export function pinLoad(registry: PinRegistry): PinLoad {
  return {
    pins: registry.pins.length,
    airPins: registry.pins.filter((p) => p.needs.includes('air')).length,
    weatherPins: registry.pins.filter((p) => p.needs.includes('weather')).length,
    needsReview: registry.pins.filter((p) => p.review !== null).length,
  };
}

/**
 * Billable events per month for the whole registry: one Air Quality call per air pin per run, and `weatherCallsPerPinPerRun` Weather calls
 * per weather pin per run (3 = current conditions, hourly forecast, alerts). The gate, not this number, is what enforces the limit.
 */
export function monthlyEvents(registry: PinRegistry, runsPerDay: number, daysInMonth: number, weatherCallsPerPinPerRun = 3): { airQuality: number; weather: number } {
  const load = pinLoad(registry);
  return {
    airQuality: load.airPins * runsPerDay * daysInMonth,
    weather: load.weatherPins * weatherCallsPerPinPerRun * runsPerDay * daysInMonth,
  };
}
