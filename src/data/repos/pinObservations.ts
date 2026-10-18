import type { Db } from '../db.js';

export interface PinHour { pinId: string; hourAt: string; temp: number | null; rain: number | null; pm25: number | null; pm10: number | null }

export function upsertPinHours(db: Db, rows: PinHour[], fetchedAt: string): void {
  const stmt = db.prepare(`INSERT INTO pin_observations (pin_id, hour_at, temp_c, rain_mm, pm25, pm10, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pin_id, hour_at) DO UPDATE SET temp_c = COALESCE(excluded.temp_c, temp_c), rain_mm = COALESCE(excluded.rain_mm, rain_mm),
      pm25 = COALESCE(excluded.pm25, pm25), pm10 = COALESCE(excluded.pm10, pm10), fetched_at = excluded.fetched_at`);
  db.transaction(() => { for (const r of rows) stmt.run(r.pinId, r.hourAt, r.temp, r.rain, r.pm25, r.pm10, fetchedAt); })();
}

/** Drops rows older than the keep window (30 days for the pilot). */
export function purgePinHours(db: Db, nowIso: string, keepDays = 30): number {
  return db.prepare('DELETE FROM pin_observations WHERE hour_at < ?').run(new Date(Date.parse(nowIso) - keepDays * 86_400_000).toISOString()).changes;
}

export function pinHours(db: Db, pinId: string, sinceIso: string, untilIso: string): PinHour[] {
  return (db.prepare('SELECT * FROM pin_observations WHERE pin_id = ? AND hour_at >= ? AND hour_at <= ? ORDER BY hour_at').all(pinId, sinceIso, untilIso) as
    { pin_id: string; hour_at: string; temp_c: number | null; rain_mm: number | null; pm25: number | null; pm10: number | null }[])
    .map((r) => ({ pinId: r.pin_id, hourAt: r.hour_at, temp: r.temp_c, rain: r.rain_mm, pm25: r.pm25, pm10: r.pm10 }));
}

export function pinCoverage(db: Db): { pins: number; rows: number; latestHour: string | null } {
  const r = db.prepare('SELECT COUNT(DISTINCT pin_id) AS pins, COUNT(*) AS rows, MAX(hour_at) AS latest FROM pin_observations').get() as { pins: number; rows: number; latest: string | null };
  return { pins: r.pins, rows: r.rows, latestHour: r.latest };
}
