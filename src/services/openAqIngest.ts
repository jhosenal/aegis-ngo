// OpenAQ station scan (AEG-OAQ-001): current PM2.5 of stations that reported in the last 24 h in Malaysia, Singapore and Brunei. A failure changes only the source status.
import type { Db } from '../data/db.js';
import { upsertSourceStatus } from '../data/repos/evidence.js';
import { insertStationReadings, purgeStationReadings, type StationReading } from '../data/repos/stationReadings.js';
import type { Clock } from '../engine/clock.js';
import { OPENAQ_COUNTRIES, OPENAQ_HOST, OPENAQ_SOURCE_ID, parseLatest, parseLocations } from '../sources/openAq.js';
import { safeFetch, type FetchPolicy, type Resolver } from '../sources/safeFetch.js';
import { dnsResolver } from './liveIngest.js';

const POLICY: FetchPolicy = { allowlist: [OPENAQ_HOST], maxBytes: 4_000_000, timeoutMs: 30_000, maxRedirects: 2 };
export interface OpenAqResult { outcome: 'OK' | 'UNAVAILABLE' | 'MALFORMED' | 'SKIPPED'; stations: number; stored: number; detail: string | null }
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 160);

export async function runOpenAqScan(deps: { db: Db; clock: Clock; apiKey: string | undefined; fetchImpl?: typeof fetch; resolver?: Resolver }): Promise<OpenAqResult> {
  if (!deps.apiKey) return { outcome: 'SKIPPED', stations: 0, stored: 0, detail: 'no API key set' };
  const now = deps.clock.now();
  const previous = deps.db.prepare('SELECT last_ok_at FROM source_status WHERE source_id = ?').get(OPENAQ_SOURCE_ID) as { last_ok_at: string | null } | undefined;
  const opts = { resolver: deps.resolver ?? dnsResolver, fetchImpl: deps.fetchImpl ?? fetch, headers: { 'X-API-Key': deps.apiKey } };
  const get = async (path: string): Promise<unknown> => {
    const res = await safeFetch(`https://${OPENAQ_HOST}${path}`, POLICY, opts);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(res.text);
  };
  let stations = 0; let stored = 0; let failed = 0; let detail: string | null = null; let malformed = false;
  for (const country of OPENAQ_COUNTRIES) {
    try {
      const list = parseLocations(await get(`/v3/locations?countries_id=${country.id}&limit=1000`), Date.parse(now));
      for (const st of list) {
        try {
          const latest = parseLatest(await get(`/v3/locations/${st.id}/latest`)).filter((x) => x.sensorId === st.pm25SensorId);
          const rows: StationReading[] = latest.map((x) => ({ stationId: st.id, parameter: 'pm25', observedAt: new Date(x.observedAt).toISOString(), value: x.value, unit: 'ug/m3', name: st.name, country: country.code, lat: st.lat, lng: st.lng, provider: st.provider, licence: st.licence }));
          stored += insertStationReadings(deps.db, rows, now);
          stations += rows.length > 0 ? 1 : 0;
        } catch (error) { failed += 1; detail = errText(error); malformed ||= error instanceof SyntaxError; }
      }
    } catch (error) { failed += 1; detail = errText(error); malformed ||= error instanceof SyntaxError || /no results/.test(errText(error)); }
  }
  const outcome = failed === 0 ? 'OK' : malformed ? 'MALFORMED' : 'UNAVAILABLE';
  if (failed === 0) purgeStationReadings(deps.db, now);
  upsertSourceStatus(deps.db, { sourceId: OPENAQ_SOURCE_ID, state: outcome, lastOkAt: failed === 0 ? now : previous?.last_ok_at ?? null, lastAttemptAt: now, detail: failed === 0 ? null : `${failed} call(s) failed: ${detail}` });
  return { outcome, stations, stored, detail };
}
