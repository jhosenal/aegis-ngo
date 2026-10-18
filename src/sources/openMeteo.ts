// Open-Meteo (AEG-OMET-001): free, keyless, CC BY 4.0, non-commercial use under 10,000 calls a day. Modelled values on a grid, NOT station readings.
// Terms read 2026-10-16 (open-meteo.com/en/terms and /en/licence): no retention limit stated; upstream national-service licences not checked (UNVERIFIED).
export const OPENMETEO_SOURCE_ID = 'SRC.OPENMETEO.PINS';
export const OPENMETEO_CREDIT = 'Weather and air quality modelled by Open-Meteo.com (CC BY 4.0). Model values, not station readings.';
export const OPENMETEO_HOSTS = ['api.open-meteo.com', 'air-quality-api.open-meteo.com'];
export const BATCH = 25;

export interface PinPoint { pinId: string; lat: number; lng: number }
export interface HourRow { hourAt: string; temp: number | null; rain: number | null; pm25: number | null; pm10: number | null }

const coords = (pins: PinPoint[]): string => `latitude=${pins.map((p) => p.lat).join(',')}&longitude=${pins.map((p) => p.lng).join(',')}`;
const tail = 'past_days=7&forecast_days=1&timezone=GMT';
export const weatherUrl = (pins: PinPoint[]): string => `https://api.open-meteo.com/v1/forecast?${coords(pins)}&hourly=temperature_2m,precipitation&${tail}`;
export const airUrl = (pins: PinPoint[]): string => `https://air-quality-api.open-meteo.com/v1/air-quality?${coords(pins)}&hourly=pm2_5,pm10&${tail}`;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One location per entry; Open-Meteo answers an array for several locations and a single object for one. Throws on an unexpected shape. */
export function parseHourly(json: unknown, fields: string[], expected: number): { times: string[]; values: Record<string, (number | null)[]> }[] {
  const list = Array.isArray(json) ? json : [json];
  if (list.length !== expected) throw new Error(`expected ${expected} locations, got ${list.length}`);
  return list.map((entry) => {
    const hourly = (entry as { hourly?: Record<string, unknown> })?.hourly;
    const times = hourly?.['time'];
    if (!hourly || !Array.isArray(times) || times.length === 0) throw new Error('no hourly times');
    const values: Record<string, (number | null)[]> = {};
    for (const f of fields) {
      const col = hourly[f];
      if (!Array.isArray(col) || col.length !== times.length) throw new Error(`column ${f} missing or wrong length`);
      values[f] = col.map(num);
    }
    return { times: times.map(String), values };
  });
}

/** timezone=GMT gives "2026-10-09T00:00"; store as UTC ISO. */
export const toUtcIso = (t: string): string => `${t.length === 16 ? `${t}:00` : t}.000Z`;
