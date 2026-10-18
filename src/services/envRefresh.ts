// One Google Environment refresh run into the in-memory store (AEG-ENV-002). Every call still goes through the quota gate inside the client.
import type { Clock } from '../engine/clock.js';
import { pollRegistry, type GoogleEnvClient, type PollOutcome } from '../sources/googleEnv.js';
import type { PinRegistry } from '../sources/pinRegistry.js';
import type { EnvStore } from './envStore.js';

export async function runEnvRefresh(p: { registry: PinRegistry; client: GoogleEnvClient; store: EnvStore; clock: Clock }): Promise<PollOutcome> {
  const outcome = await pollRegistry(p.registry, p.client);
  for (const reading of outcome.readings) p.store.put(reading);
  p.store.status = {
    ...p.store.status, enabled: true, lastRunAt: p.clock.now(), lastReadings: outcome.readings.length, lastFailures: outcome.failures.length,
    lastSkipped: outcome.skipped, alertsNotCovered: outcome.alertsNotCovered,
  };
  return outcome;
}
