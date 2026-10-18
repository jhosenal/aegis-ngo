// MetMalaysia weather warnings and district forecasts (AEG-METMY-001) from Malaysia's official open API, api.data.gov.my (keyless).
// LICENCE: not yet confirmed (the owner chose to proceed for the pilot and ignore licence checks for now). It is recorded as UNVERIFIED in the schedule and the notice,
// never as cleared, and must be settled before any release.
// The forecast text is Malay and uses a small closed set of phrases; each is translated by an explicit table. A phrase not in the table is NOT narrated (never guessed).
import { z } from 'zod';

/** The narrated source as the schedule lists it; its data is stored under the two ids below. */
export const METMY_SOURCE_ID = 'SRC.METMY.LIVE';
export const METMY_WARNINGS_ID = 'SRC.METMY.WARNINGS.LIVE';
export const METMY_FORECAST_ID = 'SRC.METMY.FORECAST.LIVE';
export const METMY_BASE = 'https://api.data.gov.my/weather';
export const warningsUrl = (): string => `${METMY_BASE}/warning?limit=50`;
export const forecastUrl = (date: string): string => `${METMY_BASE}/forecast?filter=${date}@date&limit=300`;

/** Closed set seen in the live data on 2026-10-16. Anything else returns null. */
const WEATHER: Record<string, string> = {
  'tiada hujan': 'no rain', 'hujan': 'rain', 'hujan di beberapa tempat': 'rain in a few places', 'hujan di kebanyakan tempat': 'rain in most places',
  'hujan di beberapa tempat di kawasan pedalaman': 'rain in a few inland places', 'ribut petir': 'thunderstorms', 'ribut petir di beberapa tempat': 'thunderstorms in a few places',
  'ribut petir di kebanyakan tempat': 'thunderstorms in most places', 'ribut petir di beberapa tempat di kawasan pedalaman': 'thunderstorms in a few inland places', 'jerebu': 'haze',
};
export const phraseEn = (bm: string | null | undefined): string | null => WEATHER[(bm ?? '').trim().toLowerCase()] ?? null;

export interface MetWarning { title: string; heading: string; issuedAt: string; validFrom: string; validTo: string }
export interface MetForecastRow { location: string; date: string; morning: string | null; afternoon: string | null; night: string | null; minTemp: number | null; maxTemp: number | null }

// API times are Malaysia local time without an offset.
const myToUtc = (local: string): string => {
  const ms = Date.parse(`${local}+08:00`);
  if (!Number.isFinite(ms)) throw new Error(`bad time ${local}`);
  return new Date(ms).toISOString();
};

const Warning = z.object({
  warning_issue: z.object({ issued: z.string(), title_en: z.string() }).passthrough(),
  valid_from: z.string().nullable(), valid_to: z.string().nullable(), heading_en: z.string().nullable().optional(),
}).passthrough();

/** Real warnings only: "No Advisory" entries and entries without a validity window are dropped. */
export function parseWarnings(raw: unknown): MetWarning[] {
  const list = z.array(z.unknown()).parse(raw);
  const out: MetWarning[] = [];
  for (const item of list) {
    const w = Warning.safeParse(item);
    if (!w.success) continue;
    const d = w.data;
    if (!d.valid_from || !d.valid_to || /^no advisory$/i.test(d.warning_issue.title_en.trim())) continue;
    out.push({ title: d.warning_issue.title_en.trim(), heading: (d.heading_en ?? d.warning_issue.title_en).trim(), issuedAt: myToUtc(d.warning_issue.issued), validFrom: myToUtc(d.valid_from), validTo: myToUtc(d.valid_to) });
  }
  return out;
}

const Forecast = z.object({
  location: z.object({ location_name: z.string() }).passthrough(), date: z.string(),
  morning_forecast: z.string().nullable().optional(), afternoon_forecast: z.string().nullable().optional(), night_forecast: z.string().nullable().optional(),
  min_temp: z.number().nullable().optional(), max_temp: z.number().nullable().optional(),
}).passthrough();

export function parseForecast(raw: unknown): MetForecastRow[] {
  const list = z.array(z.unknown()).parse(raw);
  const rows: MetForecastRow[] = [];
  for (const item of list) {
    const f = Forecast.safeParse(item);
    if (!f.success) continue;
    const d = f.data;
    rows.push({ location: d.location.location_name, date: d.date, morning: d.morning_forecast ?? null, afternoon: d.afternoon_forecast ?? null, night: d.night_forecast ?? null, minTemp: d.min_temp ?? null, maxTemp: d.max_temp ?? null });
  }
  if (list.length > 0 && rows.length === 0) throw new Error('forecast reply has no recognisable rows');
  return rows;
}

const PERIODS = ['morning', 'afternoon', 'night'] as const;
type Period = typeof PERIODS[number];
const joinList = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "in the morning and afternoon", "in the afternoon and at night", "at night", "all day". */
function whenText(periods: Period[]): string {
  const has = (p: Period): boolean => periods.includes(p);
  if (periods.length === 3) return 'all day';
  if (has('morning') && has('afternoon')) return 'in the morning and afternoon';
  if (has('afternoon') && has('night')) return 'in the afternoon and at night';
  if (has('morning') && has('night')) return 'in the morning and at night';
  return has('morning') ? 'in the morning' : has('afternoon') ? 'in the afternoon' : 'at night';
}

/** "haze in the morning and at night, thunderstorms in a few places in the afternoon", or null when any period uses a phrase we cannot translate. */
export function forecastText(row: MetForecastRow): string | null {
  const groups = new Map<string, Period[]>();
  for (const key of PERIODS) {
    const en = phraseEn(row[key]);
    if (en === null) return null;
    groups.set(en, [...(groups.get(en) ?? []), key]);
  }
  return [...groups.entries()].map(([weather, periods]) => `${weather} ${whenText(periods)}`).join(', ');
}
export const hasHaze = (row: MetForecastRow): boolean => [row.morning, row.afternoon, row.night].some((p) => phraseEn(p) === 'haze');
