// Open-Meteo scan of the monitored pins (AEG-OMET-001): 7 days of hourly modelled temperature, rain and PM2.5/PM10, stored for trends. A failed batch changes only the source status.
import type { Db } from '../data/db.js';
import { pinCoverage, purgePinHours, upsertPinHours, type PinHour } from '../data/repos/pinObservations.js';
import { upsertSourceStatus } from '../data/repos/evidence.js';
import type { Clock } from '../engine/clock.js';
import { airUrl, BATCH, OPENMETEO_HOSTS, OPENMETEO_SOURCE_ID, parseHourly, toUtcIso, weatherUrl, type PinPoint } from '../sources/openMeteo.js';
import { safeFetch, type FetchPolicy, type Resolver } from '../sources/safeFetch.js';
import { dnsResolver } from './liveIngest.js';

const POLICY: FetchPolicy = { allowlist: OPENMETEO_HOSTS, maxBytes: 8_000_000, timeoutMs: 30_000, maxRedirects: 2 };
export interface OpenMeteoResult { outcome: 'OK' | 'UNAVAILABLE' | 'MALFORMED'; pins: number; rows: number; failedBatches: number; detail: string | null }

export async function runOpenMeteoScan(deps: { db: Db; clock: Clock; pins: PinPoint[]; fetchImpl?: typeof fetch; resolver?: Resolver }): Promise<OpenMeteoResult> {
  const now = deps.clock.now();
  const previous = deps.db.prepare('SELECT last_ok_at FROM source_status WHERE source_id = ?').get(OPENMETEO_SOURCE_ID) as { last_ok_at: string | null } | undefined;
  const opts = { resolver: deps.resolver ?? dnsResolver, fetchImpl: deps.fetchImpl ?? fetch };
  let rows = 0; let failed = 0; let detail: string | null = null; let malformed = false; const seen = new Set<string>();
  for (let i = 0; i < deps.pins.length; i += BATCH) {
    const batch = deps.pins.slice(i, i + BATCH);
    try {
      const [w, a] = [await safeFetch(weatherUrl(batch), POLICY, opts), await safeFetch(airUrl(batch), POLICY, opts)];
      if (w.status !== 200 || a.status !== 200) throw new Error(`HTTP ${w.status}/${a.status}`);
      const wx = parseHourly(JSON.parse(w.text), ['temperature_2m', 'precipitation'], batch.length);
      const aq = parseHourly(JSON.parse(a.text), ['pm2_5', 'pm10'], batch.length);
      const out: PinHour[] = [];
      batch.forEach((pin, k) => {
        const byHour = new Map<string, PinHour>();
        const hour = (t: string): PinHour => { const h = toUtcIso(t); let r = byHour.get(h); if (!r) { r = { pinId: pin.pinId, hourAt: h, temp: null, rain: null, pm25: null, pm10: null }; byHour.set(h, r); } return r; };
        wx[k]!.times.forEach((t, j) => { const r = hour(t); r.temp = wx[k]!.values['temperature_2m']![j] ?? null; r.rain = wx[k]!.values['precipitation']![j] ?? null; });
        aq[k]!.times.forEach((t, j) => { const r = hour(t); r.pm25 = aq[k]!.values['pm2_5']![j] ?? null; r.pm10 = aq[k]!.values['pm10']![j] ?? null; });
        out.push(...byHour.values()); seen.add(pin.pinId);
      });
      upsertPinHours(deps.db, out, now); rows += out.length;
    } catch (error) {
      failed += 1; malformed ||= error instanceof SyntaxError || /expected|column|hourly/.test(String((error as Error).message));
      detail = (error instanceof Error ? error.message : String(error)).slice(0, 160);
    }
  }
  const outcome = failed === 0 ? 'OK' : malformed ? 'MALFORMED' : 'UNAVAILABLE';
  if (failed === 0) purgePinHours(deps.db, now);
  upsertSourceStatus(deps.db, { sourceId: OPENMETEO_SOURCE_ID, state: outcome, lastOkAt: failed === 0 ? now : previous?.last_ok_at ?? null, lastAttemptAt: now, detail: failed === 0 ? null : `${failed} batch(es) failed: ${detail}` });
  return { outcome, pins: seen.size, rows, failedBatches: failed, detail };
}

export { pinCoverage };
