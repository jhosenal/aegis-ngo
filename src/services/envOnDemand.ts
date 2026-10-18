// Click-to-fetch Google air quality and weather for ONE monitored place (AEG-ENV-003). A scheduled refresh cannot keep 125 places current: Google lets
// a reading be kept for one hour at most, and refreshing all places hourly would cost far more than the owner's ceiling. So a lookup happens when a
// visitor opens a place, costs about 2 requests (air quality + current weather, plus alerts for Singapore), and is cached for the permitted hour.
// Because the public can trigger billed calls, there are three limits: a per-visitor rate limit, a daily cap on lookups that reach Google, and one
// shared call for concurrent clicks on the same place. Every call still goes through the quota gate inside the client. Off unless AEGIS_ENV_ON_DEMAND=true.
import type { Clock } from '../engine/clock.js';
import { ALERT_COVERED_COUNTRIES, EnvCallError, type EnvKind, type GoogleEnvClient } from '../sources/googleEnv.js';
import type { EnvPin } from '../sources/pinRegistry.js';
import type { EnvStore } from './envStore.js';

export type LookupStatus = 'fetched' | 'cached' | 'rate_limited' | 'daily_cap' | 'unavailable' | 'disabled';
export interface LookupResult { status: LookupStatus; detail: string | null }

export interface OnDemandOptions { client: GoogleEnvClient; store: EnvStore; clock: Clock; dailyMax: number; perClientPerMinute: number }

export function kindsFor(pin: EnvPin): EnvKind[] {
  const kinds: EnvKind[] = [];
  if (pin.needs.includes('air')) kinds.push('AIR_CURRENT');
  if (pin.needs.includes('weather')) {
    kinds.push('WEATHER_CURRENT');
    if (ALERT_COVERED_COUNTRIES.has(pin.country)) kinds.push('WEATHER_ALERTS');
  }
  return kinds;
}

export class EnvOnDemand {
  private readonly inFlight = new Map<string, Promise<LookupResult>>();
  private readonly clients = new Map<string, { windowStart: number; count: number }>();
  private day = '';
  private lookupsToday = 0;

  constructor(private readonly o: OnDemandOptions) {}

  usage(): { day: string; lookupsToday: number; dailyMax: number } { return { day: this.day, lookupsToday: this.lookupsToday, dailyMax: this.o.dailyMax }; }

  async lookup(pin: EnvPin, clientKey: string): Promise<LookupResult> {
    const now = this.o.clock.now();
    const kinds = kindsFor(pin);
    if (kinds.length === 0) return { status: 'unavailable', detail: 'this place needs neither air quality nor weather' };
    if (kinds.every((k) => this.o.store.get(pin.pinId, k, now) !== null)) return { status: 'cached', detail: null };
    const existing = this.inFlight.get(pin.pinId);
    if (existing) return existing;   // concurrent clicks share one call

    const nowMs = Date.parse(now);
    const entry = this.clients.get(clientKey);
    if (!entry || nowMs - entry.windowStart >= 60_000) this.clients.set(clientKey, { windowStart: nowMs, count: 1 });
    else if (entry.count >= this.o.perClientPerMinute) return { status: 'rate_limited', detail: 'too many lookups from this visitor; try again in a minute' };
    else entry.count += 1;
    if (this.clients.size > 5000) for (const [k, v] of this.clients) if (nowMs - v.windowStart >= 60_000) this.clients.delete(k);

    const today = now.slice(0, 10);
    if (today !== this.day) { this.day = today; this.lookupsToday = 0; }
    if (this.lookupsToday >= this.o.dailyMax) return { status: 'daily_cap', detail: 'the daily limit of live lookups has been reached; readings return tomorrow' };
    this.lookupsToday += 1;

    const run = (async (): Promise<LookupResult> => {
      let got = 0; let failure: string | null = null;
      for (const kind of kinds) {
        try { this.o.store.put(await this.o.client.fetchKind(pin, kind)); got += 1; }
        catch (error: unknown) { failure = error instanceof EnvCallError ? error.code : 'UNKNOWN'; if (error instanceof EnvCallError && (error.code === 'GATE' || error.code === 'AUTH')) break; }
      }
      if (got === 0) this.o.store.markFetched(pin.pinId, this.o.clock.now(), 'failed');
      return got > 0 ? { status: 'fetched', detail: failure ? `partial: ${failure}` : null } : { status: 'unavailable', detail: failure ?? 'no reading' };
    })().finally(() => { this.inFlight.delete(pin.pinId); });
    this.inFlight.set(pin.pinId, run);
    return run;
  }
}
