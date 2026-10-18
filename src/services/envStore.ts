// In-memory holder of the latest Google Environment readings (AEG-ENV-002). It never writes to disk: the Google Maps Platform terms allow
// current air quality / weather values to be kept for one hour at most, so a reading is dropped at its validUntil and a restart empties it.
import type { EnvKind, EnvReading } from '../sources/googleEnv.js';
import type { EnvPin } from '../sources/pinRegistry.js';

export interface EnvRunStatus {
  enabled: boolean;
  /** True only when the four daily runs are armed. A one-off test capture leaves it false. */
  scheduled: boolean;
  lastRunAt: string | null;
  lastReadings: number;
  lastFailures: number;
  lastSkipped: number;
  alertsNotCovered: number;
}

export class EnvStore {
  private readonly readings = new Map<string, EnvReading>();
  status: EnvRunStatus = { enabled: false, scheduled: false, lastRunAt: null, lastReadings: 0, lastFailures: 0, lastSkipped: 0, alertsNotCovered: 0 };

  /** When a pin was last fetched. This is OUR metadata (a time and an outcome), not Google content, so it outlives the one-hour reading and lets the card say how old the information is. */
  private readonly fetched = new Map<string, { at: string; outcome: 'ok' | 'failed' }>();

  /** Fetch times of pins whose last reading is DEMO data, so clearing the demo also clears the "last updated" it made. */
  private readonly demoFetched = new Map<string, string>();

  /** Synthetic readings for the admin "dummy data" function. They carry data.demo and are never Google data. Returns how many were removed. */
  clearDemo(): number {
    let n = 0;
    for (const [key, r] of this.readings) if (r.data['demo'] === true) { this.readings.delete(key); n += 1; }
    for (const [pinId, at] of this.demoFetched) { if (this.fetched.get(pinId)?.at === at) this.fetched.delete(pinId); }
    this.demoFetched.clear();
    return n;
  }
  /** True while any unexpired SAMPLE (demo) reading is held, so the page can warn everyone that sample numbers are showing. */
  demoActive(nowIso: string): boolean { this.purge(nowIso); for (const r of this.readings.values()) if ((r.data as Record<string, unknown>)['demo'] === true) return true; return false; }

  putDemo(reading: EnvReading): void { this.put(reading); this.demoFetched.set(reading.pinId, reading.fetchedAt); }

  put(reading: EnvReading): void {
    this.readings.set(`${reading.pinId}|${reading.kind}`, reading);
    this.markFetched(reading.pinId, reading.fetchedAt, 'ok');
  }

  markFetched(pinId: string, at: string, outcome: 'ok' | 'failed'): void {
    const current = this.fetched.get(pinId);
    if (!current || at >= current.at) this.fetched.set(pinId, { at, outcome });
  }

  lastFetched(pinId: string): { at: string; outcome: 'ok' | 'failed' } | null { return this.fetched.get(pinId) ?? null; }

  private purge(nowIso: string): void {
    for (const [key, r] of this.readings) if (r.validUntil <= nowIso) this.readings.delete(key);
  }

  get(pinId: string, kind: EnvKind, nowIso: string): EnvReading | null {
    this.purge(nowIso);
    return this.readings.get(`${pinId}|${kind}`) ?? null;
  }

  all(nowIso: string): EnvReading[] {
    this.purge(nowIso);
    return [...this.readings.values()];
  }
}

export interface EnvPinView {
  pinId: string; name: string; region: string; country: string; lat: number; lng: number; roles: string[]; hazards: string[];
  /** Null when no unexpired reading is held; the UI then says "not available", never a default value. */
  air: EnvReading | null;
  weather: { current: EnvReading | null; hourly: EnvReading | null; alerts: EnvReading | null };
  unverified: string | null;
  /** When this place was last fetched (our own time), or null if never. Kept after the reading expires. */
  lastUpdatedAt: string | null;
  lastOutcome: 'ok' | 'failed' | null;
  /** fresh = an unexpired reading is held; expired = fetched before but the one-hour limit has passed; never = not fetched since the server started. */
  readingState: 'fresh' | 'expired' | 'never';
}

export function pinViews(pins: readonly EnvPin[], store: EnvStore, nowIso: string): EnvPinView[] {
  return pins.map((p) => {
    const air = store.get(p.pinId, 'AIR_CURRENT', nowIso);
    const weather = { current: store.get(p.pinId, 'WEATHER_CURRENT', nowIso), hourly: store.get(p.pinId, 'WEATHER_HOURLY', nowIso), alerts: store.get(p.pinId, 'WEATHER_ALERTS', nowIso) };
    const last = store.lastFetched(p.pinId);
    const fresh = air !== null || weather.current !== null || weather.hourly !== null || weather.alerts !== null;
    return {
      pinId: p.pinId, name: p.name, region: p.region, country: p.country, lat: p.lat, lng: p.lng, roles: p.roles, hazards: p.hazards,
      air, weather, unverified: p.review,
      lastUpdatedAt: last?.at ?? null, lastOutcome: last?.outcome ?? null,
      readingState: fresh ? 'fresh' as const : last ? 'expired' as const : 'never' as const,
    };
  });
}
