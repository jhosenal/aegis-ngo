import type { Db } from '../db.js';

export interface StationReading { stationId: number; parameter: string; observedAt: string; value: number; unit: string; name: string; country: string; lat: number; lng: number; provider: string | null; licence: string | null }

export function insertStationReadings(db: Db, rows: StationReading[], fetchedAt: string): number {
  const stmt = db.prepare(`INSERT OR IGNORE INTO station_readings (station_id, parameter, observed_at, value, unit, name, country, lat, lng, provider, licence, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return db.transaction(() => rows.reduce((n, r) => n + stmt.run(r.stationId, r.parameter, r.observedAt, r.value, r.unit, r.name, r.country, r.lat, r.lng, r.provider, r.licence, fetchedAt).changes, 0))();
}

export function purgeStationReadings(db: Db, nowIso: string, keepDays = 30): number {
  return db.prepare('DELETE FROM station_readings WHERE observed_at < ?').run(new Date(Date.parse(nowIso) - keepDays * 86_400_000).toISOString()).changes;
}

/** The newest reading per station since `sinceIso` (use: the last 24 hours). */
export function latestStationReadings(db: Db, parameter: string, sinceIso: string): StationReading[] {
  return (db.prepare(`SELECT r.* FROM station_readings r JOIN (SELECT station_id, MAX(observed_at) AS m FROM station_readings WHERE parameter = ? AND observed_at >= ? GROUP BY station_id) x
    ON x.station_id = r.station_id AND x.m = r.observed_at WHERE r.parameter = ?`).all(parameter, sinceIso, parameter) as Record<string, unknown>[])
    .map((r) => ({ stationId: r.station_id as number, parameter: r.parameter as string, observedAt: r.observed_at as string, value: r.value as number, unit: r.unit as string, name: r.name as string,
      country: r.country as string, lat: r.lat as number, lng: r.lng as number, provider: r.provider as string | null, licence: r.licence as string | null }));
}
