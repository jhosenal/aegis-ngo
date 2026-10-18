// OpenAQ v3 (AEG-OAQ-001). Needs a free API key (AEGIS_OPENAQ_API_KEY, never logged). Free for non-commercial use; each station carries its own licence.
export const OPENAQ_SOURCE_ID = 'SRC.OPENAQ.STATIONS';
export const OPENAQ_HOST = 'api.openaq.org';
export const OPENAQ_COUNTRIES: { code: 'MY' | 'SG' | 'BN'; id: number }[] = [{ code: 'MY', id: 2 }, { code: 'BN', id: 120 }, { code: 'SG', id: 231 }];
export const OPENAQ_CREDIT = 'Air quality measurements from OpenAQ (openaq.org); each station is credited to its operator under the licence shown.';
export const FRESH_HOURS = 24;

export interface OaqStation { id: number; name: string; lat: number; lng: number; provider: string | null; licence: string | null; pm25SensorId: number }

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Stations with a PM2.5 sensor that reported within `freshHours` of now. Throws if the reply has no results array. */
export function parseLocations(json: unknown, nowMs: number, freshHours = FRESH_HOURS): OaqStation[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new Error('locations: no results array');
  const out: OaqStation[] = [];
  for (const r of results as Record<string, unknown>[]) {
    const last = str((r['datetimeLast'] as { utc?: unknown } | null)?.utc);
    const coords = r['coordinates'] as { latitude?: unknown; longitude?: unknown } | null;
    const sensors = Array.isArray(r['sensors']) ? r['sensors'] as { id?: unknown; parameter?: { name?: unknown } }[] : [];
    const pm = sensors.find((s) => s.parameter?.name === 'pm25' && typeof s.id === 'number');
    if (!last || Date.parse(last) < nowMs - freshHours * 3_600_000 || !pm || typeof r['id'] !== 'number') continue;
    if (typeof coords?.latitude !== 'number' || typeof coords?.longitude !== 'number') continue;
    const licences = Array.isArray(r['licenses']) ? r['licenses'] as { name?: unknown }[] : [];
    out.push({ id: r['id'], name: str(r['name']) ?? `Station ${r['id']}`, lat: coords.latitude, lng: coords.longitude, provider: str((r['provider'] as { name?: unknown } | null)?.name), licence: str(licences[0]?.name), pm25SensorId: pm.id as number });
  }
  return out;
}

/** Latest values of one location, keyed by sensor id. */
export function parseLatest(json: unknown): { sensorId: number; value: number; observedAt: string }[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new Error('latest: no results array');
  return (results as { sensorsId?: unknown; value?: unknown; datetime?: { utc?: unknown } }[]).flatMap((r) =>
    typeof r.sensorsId === 'number' && typeof r.value === 'number' && Number.isFinite(r.value) && r.value >= 0 && typeof r.datetime?.utc === 'string' ? [{ sensorId: r.sensorsId, value: r.value, observedAt: r.datetime.utc }] : []);
}
