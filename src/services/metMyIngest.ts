// Polls MetMalaysia's warnings (every call) and district forecasts (at most hourly) through the guarded fetch and stores a snapshot when the content changed (AEG-METMY-001).
// A failed or malformed poll changes only the source status; it never removes what was stored.
import type { Db } from '../data/db.js';
import { putSnapshotIfChanged } from '../data/repos/officialSnapshots.js';
import { upsertSourceStatus } from '../data/repos/evidence.js';
import type { Clock } from '../engine/clock.js';
import { forecastUrl, METMY_FORECAST_ID, METMY_WARNINGS_ID, parseForecast, parseWarnings, warningsUrl, type MetForecastRow, type MetWarning } from '../sources/metMy.js';
import { safeFetch, type FetchPolicy, type Resolver } from '../sources/safeFetch.js';
import type { SourceState } from '../types/domain.js';
import { dnsResolver } from './liveIngest.js';

const POLICY: FetchPolicy = { allowlist: ['api.data.gov.my'], maxBytes: 3_000_000, timeoutMs: 40_000, maxRedirects: 2 };
const FORECAST_REFRESH_MS = 55 * 60_000;
export interface ForecastPayload { dates: string[]; rows: MetForecastRow[] }
export interface MetMyResult { warnings: { outcome: SourceState; stored: boolean; count: number; detail: string | null }; forecast: { outcome: SourceState | 'SKIPPED'; stored: boolean; rows: number; detail: string | null } }

const localDate = (iso: string, plusDays = 0): string => new Date(Date.parse(iso) + 8 * 3_600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

export async function runMetMyIngest(deps: { db: Db; clock: Clock; fetchImpl?: typeof fetch; resolver?: Resolver }): Promise<MetMyResult> {
  const now = deps.clock.now();
  const fetchDeps = { resolver: deps.resolver ?? dnsResolver, fetchImpl: deps.fetchImpl ?? fetch };
  const status = (id: string): { last_ok_at: string | null } | undefined => deps.db.prepare('SELECT last_ok_at FROM source_status WHERE source_id = ?').get(id) as { last_ok_at: string | null } | undefined;
  const failed = (id: string, state: SourceState, detail: string): void => upsertSourceStatus(deps.db, { sourceId: id, state, lastOkAt: status(id)?.last_ok_at ?? null, lastAttemptAt: now, detail });
  const ok = (id: string): void => upsertSourceStatus(deps.db, { sourceId: id, state: 'OK', lastOkAt: now, lastAttemptAt: now, detail: null });
  const get = async (url: string): Promise<{ json: unknown } | { error: SourceState; detail: string }> => {
    try {
      const res = await safeFetch(url, POLICY, fetchDeps);
      if (res.status !== 200) return { error: 'UNAVAILABLE', detail: `HTTP ${res.status}` };
      try { return { json: JSON.parse(res.text) }; } catch { return { error: 'MALFORMED', detail: 'not JSON' }; }
    } catch (error) { return { error: 'UNAVAILABLE', detail: (error instanceof Error ? error.message : String(error)).slice(0, 160) }; }
  };

  const result: MetMyResult = { warnings: { outcome: 'OK', stored: false, count: 0, detail: null }, forecast: { outcome: 'SKIPPED', stored: false, rows: 0, detail: null } };

  const w = await get(warningsUrl());
  if ('error' in w) { failed(METMY_WARNINGS_ID, w.error, w.detail); result.warnings = { outcome: w.error, stored: false, count: 0, detail: w.detail }; }
  else {
    try {
      const warnings: MetWarning[] = parseWarnings(w.json);
      const stored = putSnapshotIfChanged(deps.db, METMY_WARNINGS_ID, now, warnings);
      ok(METMY_WARNINGS_ID);
      result.warnings = { outcome: 'OK', stored, count: warnings.length, detail: null };
    } catch (error) { const d = (error instanceof Error ? error.message : 'unreadable').slice(0, 160); failed(METMY_WARNINGS_ID, 'MALFORMED', d); result.warnings = { outcome: 'MALFORMED', stored: false, count: 0, detail: d }; }
  }

  const lastOk = status(METMY_FORECAST_ID)?.last_ok_at;
  if (lastOk && Date.parse(now) - Date.parse(lastOk) < FORECAST_REFRESH_MS) return result;
  const dates = [localDate(now), localDate(now, 1)];
  const rows: MetForecastRow[] = [];
  for (const date of dates) {
    const f = await get(forecastUrl(date));
    if ('error' in f) { failed(METMY_FORECAST_ID, f.error, f.detail); result.forecast = { outcome: f.error, stored: false, rows: 0, detail: f.detail }; return result; }
    try { rows.push(...parseForecast(f.json)); } catch (error) { const d = (error instanceof Error ? error.message : 'unreadable').slice(0, 160); failed(METMY_FORECAST_ID, 'MALFORMED', d); result.forecast = { outcome: 'MALFORMED', stored: false, rows: 0, detail: d }; return result; }
  }
  const payload: ForecastPayload = { dates, rows };
  const stored = putSnapshotIfChanged(deps.db, METMY_FORECAST_ID, now, payload);
  ok(METMY_FORECAST_ID);
  result.forecast = { outcome: 'OK', stored, rows: rows.length, detail: null };
  return result;
}
