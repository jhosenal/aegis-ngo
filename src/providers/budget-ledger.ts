// GOLDEN (frozen by CON-002 budget contract). All money = integer micro-USD (1 USD = 1_000_000). Reserve BEFORE every network attempt.
import type Database from 'better-sqlite3';

export const BUDGET_SCHEMA = `
CREATE TABLE IF NOT EXISTS budget_reservations (
  reservation_id TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  attempt_id     TEXT NOT NULL UNIQUE,
  day_key        TEXT NOT NULL,                 -- YYYY-MM-DD (UTC)
  amount_micro   INTEGER NOT NULL CHECK (amount_micro >= 0),
  state          TEXT NOT NULL CHECK (state IN ('reserved','settled','released','liability')),
  settled_micro  INTEGER CHECK (settled_micro IS NULL OR settled_micro >= 0),
  price_snapshot_id TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  provider       TEXT                           -- funding key: 'google' | 'reapi' (S0038 finding 3); NULL on rows written before it existed
);
CREATE INDEX IF NOT EXISTS idx_budget_day  ON budget_reservations(day_key);
CREATE INDEX IF NOT EXISTS idx_budget_task ON budget_reservations(task_id);`;

/** `providerAccountMicro`, when present, is a per-funding allowance: a provider with no entry has an allowance of 0, so no spend is allowed (fail closed). */
export interface Limits { accountMicro: number; dayMicro: number; taskMicro: number; providerAccountMicro?: Record<string, number> }
export type ReserveResult = { ok: true; reservationId: string } | { ok: false; reason: 'ACCOUNT_LIMIT' | 'DAY_LIMIT' | 'TASK_LIMIT' | 'PROVIDER_LIMIT' | 'NO_PRICE' | 'DUPLICATE_ATTEMPT' };

// A row counts: settled -> settled_micro; reserved/liability -> amount_micro; released -> 0.
const COMMITTED = `CASE state WHEN 'settled' THEN COALESCE(settled_micro,0) WHEN 'released' THEN 0 ELSE amount_micro END`;

export class BudgetLedger {
  constructor(private db: Database.Database, private limits: Limits) {
    db.exec(BUDGET_SCHEMA);
    const columns = db.prepare('PRAGMA table_info(budget_reservations)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'provider')) db.exec('ALTER TABLE budget_reservations ADD COLUMN provider TEXT');
  }

  reserve(p: { reservationId: string; taskId: string; attemptId: string; dayKey: string; maxMicro: number; priceSnapshotId: string | null; now: string; provider?: string }): ReserveResult {
    if (!p.priceSnapshotId) return { ok: false, reason: 'NO_PRICE' };            // unknown pricing => no paid call
    const tx = this.db.transaction((): ReserveResult => {                         // use .immediate(): write lock taken at BEGIN
      const sum = (where: string, arg?: string) =>
        (this.db.prepare(`SELECT COALESCE(SUM(${COMMITTED}),0) AS s FROM budget_reservations ${where}`).get(...(arg === undefined ? [] : [arg])) as { s: number }).s;
      if (this.db.prepare('SELECT 1 FROM budget_reservations WHERE attempt_id=?').get(p.attemptId)) return { ok: false, reason: 'DUPLICATE_ATTEMPT' };
      if (sum('') + p.maxMicro > this.limits.accountMicro) return { ok: false, reason: 'ACCOUNT_LIMIT' };
      if (sum('WHERE day_key=?', p.dayKey) + p.maxMicro > this.limits.dayMicro) return { ok: false, reason: 'DAY_LIMIT' };
      if (sum('WHERE task_id=?', p.taskId) + p.maxMicro > this.limits.taskMicro) return { ok: false, reason: 'TASK_LIMIT' };
      if (this.limits.providerAccountMicro !== undefined) {
        const cap = p.provider === undefined ? 0 : this.limits.providerAccountMicro[p.provider] ?? 0;
        if (p.provider === undefined || sum('WHERE provider=?', p.provider) + p.maxMicro > cap) return { ok: false, reason: 'PROVIDER_LIMIT' };
      }
      this.db.prepare(`INSERT INTO budget_reservations (reservation_id,task_id,attempt_id,day_key,amount_micro,state,price_snapshot_id,created_at,updated_at,provider) VALUES (?,?,?,?,?,'reserved',?,?,?,?)`)
        .run(p.reservationId, p.taskId, p.attemptId, p.dayKey, p.maxMicro, p.priceSnapshotId, p.now, p.now, p.provider ?? null);
      return { ok: true, reservationId: p.reservationId };
    });
    return tx.immediate();
  }
  /** Known actual cost (<= reserved). If actual > reserved, record the larger value as liability (never silently clip). */
  settle(reservationId: string, actualMicro: number, now: string): void {
    this.db.prepare(`UPDATE budget_reservations SET state='settled', settled_micro=?, updated_at=? WHERE reservation_id=? AND state IN ('reserved','liability')`).run(actualMicro, now, reservationId);
  }
  /** Only when the provider certainly did not charge (e.g. request never left the process). */
  release(reservationId: string, now: string): void {
    this.db.prepare(`UPDATE budget_reservations SET state='released', updated_at=? WHERE reservation_id=? AND state='reserved'`).run(now, reservationId);
  }
  /** Timeout / missing usage / ambiguous charge: keep the full reserved amount until reconciled. */
  markLiability(reservationId: string, now: string): void {
    this.db.prepare(`UPDATE budget_reservations SET state='liability', updated_at=? WHERE reservation_id=? AND state='reserved'`).run(now, reservationId);
  }
  totals(): { committedMicro: number } {
    return { committedMicro: (this.db.prepare(`SELECT COALESCE(SUM(${COMMITTED}),0) AS s FROM budget_reservations`).get() as { s: number }).s };
  }
}
