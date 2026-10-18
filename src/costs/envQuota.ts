// Quota gate for the Google Environment APIs (Air Quality, Weather), AEG-ENV-001. The gate is COUNT-first: each SKU has a free monthly cap
// of events and a price per event above it, both read from the price book (a missing price or free tier is UNKNOWN and refuses the call).
// Reserve BEFORE every network attempt, settle with the pages actually served, release only when the call certainly was not billed.
// Defaults spend nothing: the monthly call cap is the free cap, and the paid budget is 0 until the owner raises it explicitly.
import type Database from 'better-sqlite3';
import { ceilNano, mul, rat, type Rat } from './money.js';
import { freeQuantity, unitNano, type PriceBook } from './pricebook.js';

export type EnvSku = 'AIR_QUALITY' | 'WEATHER';

interface SkuBinding { priceId: string; freeId: string }
const BINDINGS: Record<EnvSku, SkuBinding> = {
  AIR_QUALITY: { priceId: 'GMP.AIRQUALITY.REQ.T1', freeId: 'GMP.AIRQUALITY.FREE.REQ' },
  WEATHER: { priceId: 'GMP.WEATHER.REQ.T1', freeId: 'GMP.WEATHER.FREE.REQ' },
};

/** Only the first volume band (1..100,000 events/month) is in the price book, so the gate never lets a SKU cross it. */
export const FIRST_BAND_EVENTS = 100_000;

export interface EnvSkuLimits {
  /** Hard cap on billable events per UTC month. Must not exceed FIRST_BAND_EVENTS. */
  monthlyCalls: number;
  /** Hard cap on billable events per UTC day, so a loop cannot burn the month in an afternoon. */
  dailyCalls: number;
  /** Paid spend allowed for THIS SKU per UTC month, in micro-USD. 0 means free-tier only. */
  monthlyPaidMicro: number;
}

export interface EnvQuotaConfig {
  skus: Record<EnvSku, EnvSkuLimits>;
  /** Total paid spend allowed per UTC month across both SKUs, in micro-USD: an extra ceiling on top of each SKU's own. 0 means free-tier only. */
  monthlyPaidMicro: number;
}

/** The safe default: stop at the free cap, spend nothing, spread the free cap over a 30-day month. */
export function defaultEnvQuotaConfig(book: PriceBook): EnvQuotaConfig {
  const limits = (sku: EnvSku): EnvSkuLimits => {
    const free = freeQuantity(book, BINDINGS[sku].freeId);
    const monthly = free === null ? 0 : Number(free.n / free.d);
    return { monthlyCalls: monthly, dailyCalls: Math.ceil(monthly / 30), monthlyPaidMicro: 0 };
  };
  return { skus: { AIR_QUALITY: limits('AIR_QUALITY'), WEATHER: limits('WEATHER') }, monthlyPaidMicro: 0 };
}

export interface CapacityInput { sku: EnvSku; paidBudgetMicro: number; daysInMonth: number; runsPerDay: number }
export interface Capacity { freeEvents: number; paidEvents: number; monthlyEvents: number; dailyEvents: number; perRunEvents: number; bandLimited: boolean; maxPaidMicro: number }

/** How many billable events a paid budget buys, spread over the month's days and the daily refresh runs. Rounds DOWN everywhere. */
export function planEnvCapacity(book: PriceBook, input: CapacityInput): Capacity | null {
  const free = freeQuantity(book, BINDINGS[input.sku].freeId);
  const nano = unitNano(book, BINDINGS[input.sku].priceId);
  if (free === null || nano === null) return null;
  const freeEvents = Number(free.n / free.d);
  const unitMicro = rat(nano.n, nano.d * 1000n);
  const paidEvents = Number((rat(BigInt(input.paidBudgetMicro)).n * unitMicro.d) / unitMicro.n);
  const raw = freeEvents + paidEvents;
  const monthlyEvents = Math.min(raw, FIRST_BAND_EVENTS);
  const dailyEvents = Math.floor(monthlyEvents / input.daysInMonth);
  const maxPaidMicro = Number(ceilNano(mul(rat(BigInt(Math.max(0, monthlyEvents - freeEvents))), unitMicro)));
  return { freeEvents, paidEvents, monthlyEvents, dailyEvents, perRunEvents: Math.floor(dailyEvents / input.runsPerDay), bandLimited: raw > FIRST_BAND_EVENTS, maxPaidMicro };
}

/**
 * The owner's 2026-10-15 instruction: keep a 20% buffer of the 200 USD, so a 160 USD ceiling, split evenly over the two services (80 USD each),
 * refreshed 4 times a day (07:00, 12:00, 17:00, 22:00 owner local time, which are four distinct slots inside every UTC day).
 * This is the owner's own spending ceiling on real money; it is NOT a Google credit. The month is taken as 31 days (the worst case).
 */
export const OWNER_PLAN = { ceilingMicro: 160_000_000, perServiceMicro: 80_000_000, daysInMonth: 31, runsPerDay: 4 } as const;

export function ownerEnvQuotaConfig(book: PriceBook): EnvQuotaConfig {
  const limits = (sku: EnvSku): EnvSkuLimits => {
    const cap = planEnvCapacity(book, { sku, paidBudgetMicro: OWNER_PLAN.perServiceMicro, daysInMonth: OWNER_PLAN.daysInMonth, runsPerDay: OWNER_PLAN.runsPerDay });
    if (cap === null) return { monthlyCalls: 0, dailyCalls: 0, monthlyPaidMicro: 0 };   // unknown price: nothing allowed
    return { monthlyCalls: cap.monthlyEvents, dailyCalls: cap.dailyEvents, monthlyPaidMicro: OWNER_PLAN.perServiceMicro };
  };
  return { skus: { AIR_QUALITY: limits('AIR_QUALITY'), WEATHER: limits('WEATHER') }, monthlyPaidMicro: OWNER_PLAN.ceilingMicro };
}

export const ENV_QUOTA_SCHEMA = `
CREATE TABLE IF NOT EXISTS env_api_usage (
  reservation_id TEXT PRIMARY KEY,
  sku            TEXT NOT NULL CHECK (sku IN ('AIR_QUALITY','WEATHER')),
  endpoint       TEXT NOT NULL,
  month_key      TEXT NOT NULL,                 -- YYYY-MM (UTC)
  day_key        TEXT NOT NULL,                 -- YYYY-MM-DD (UTC)
  units          INTEGER NOT NULL CHECK (units >= 0),
  paid_micro     INTEGER NOT NULL CHECK (paid_micro >= 0),
  state          TEXT NOT NULL CHECK (state IN ('reserved','settled','released','liability')),
  price_book_hash TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_env_usage_month ON env_api_usage(sku, month_key);
CREATE INDEX IF NOT EXISTS idx_env_usage_day   ON env_api_usage(sku, day_key);`;

export type EnvReserveRefusal =
  | 'BAD_UNITS' | 'NO_PRICE' | 'DUPLICATE' | 'BAND_LIMIT' | 'MONTH_LIMIT' | 'DAY_LIMIT' | 'PAID_BUDGET_LIMIT' | 'BAD_CONFIG';
export type EnvReserveResult =
  | { ok: true; reservationId: string; units: number; paidMicro: number; monthUsed: number; monthRemaining: number }
  | { ok: false; reason: EnvReserveRefusal };

export interface EnvUsageSnapshot {
  sku: EnvSku; monthKey: string; monthUsed: number; monthCap: number; dayUsed: number; dayCap: number; freeCap: number | null; paidMicro: number; paidBudgetMicro: number;
}

// A row counts while reserved/settled/liability; released counts 0.
const COUNTED = `state <> 'released'`;

export class EnvQuotaGate {
  constructor(private db: Database.Database, private book: PriceBook, private config: EnvQuotaConfig) {
    db.exec(ENV_QUOTA_SCHEMA);
  }

  private unitMicroCeil(sku: EnvSku): Rat | null {
    const nano = unitNano(this.book, BINDINGS[sku].priceId);
    return nano === null ? null : rat(nano.n, nano.d * 1000n);
  }

  reserve(p: { reservationId: string; sku: EnvSku; endpoint: string; units: number; now: string }): EnvReserveResult {
    if (!Number.isSafeInteger(p.units) || p.units < 1) return { ok: false, reason: 'BAD_UNITS' };
    const limits = this.config.skus[p.sku];
    if (!limits || !Number.isSafeInteger(limits.monthlyCalls) || limits.monthlyCalls < 0 || !Number.isSafeInteger(limits.dailyCalls) || limits.dailyCalls < 0
      || !Number.isSafeInteger(limits.monthlyPaidMicro) || limits.monthlyPaidMicro < 0
      || !Number.isSafeInteger(this.config.monthlyPaidMicro) || this.config.monthlyPaidMicro < 0) return { ok: false, reason: 'BAD_CONFIG' };
    const free = freeQuantity(this.book, BINDINGS[p.sku].freeId);
    const unitMicro = this.unitMicroCeil(p.sku);
    if (free === null || unitMicro === null) return { ok: false, reason: 'NO_PRICE' };   // unknown is never free
    const freeCap = Number(free.n / free.d);
    const monthKey = p.now.slice(0, 7);
    const dayKey = p.now.slice(0, 10);

    const tx = this.db.transaction((): EnvReserveResult => {
      if (this.db.prepare('SELECT 1 FROM env_api_usage WHERE reservation_id=?').get(p.reservationId)) return { ok: false, reason: 'DUPLICATE' };
      const used = (this.db.prepare(`SELECT COALESCE(SUM(units),0) AS s FROM env_api_usage WHERE sku=? AND month_key=? AND ${COUNTED}`).get(p.sku, monthKey) as { s: number }).s;
      const dayUsed = (this.db.prepare(`SELECT COALESCE(SUM(units),0) AS s FROM env_api_usage WHERE sku=? AND day_key=? AND ${COUNTED}`).get(p.sku, dayKey) as { s: number }).s;
      const paidSoFar = (this.db.prepare(`SELECT COALESCE(SUM(paid_micro),0) AS s FROM env_api_usage WHERE month_key=? AND ${COUNTED}`).get(monthKey) as { s: number }).s;
      const paidSku = (this.db.prepare(`SELECT COALESCE(SUM(paid_micro),0) AS s FROM env_api_usage WHERE sku=? AND month_key=? AND ${COUNTED}`).get(p.sku, monthKey) as { s: number }).s;
      const after = used + p.units;
      if (after > FIRST_BAND_EVENTS) return { ok: false, reason: 'BAND_LIMIT' };
      if (after > limits.monthlyCalls) return { ok: false, reason: 'MONTH_LIMIT' };
      if (dayUsed + p.units > limits.dailyCalls) return { ok: false, reason: 'DAY_LIMIT' };
      const paidUnits = Math.max(0, after - freeCap) - Math.max(0, used - freeCap);
      const paidMicro = Number(ceilNano(mul(rat(BigInt(paidUnits)), unitMicro)));
      if (paidSku + paidMicro > limits.monthlyPaidMicro || paidSoFar + paidMicro > this.config.monthlyPaidMicro) return { ok: false, reason: 'PAID_BUDGET_LIMIT' };
      this.db.prepare(`INSERT INTO env_api_usage (reservation_id,sku,endpoint,month_key,day_key,units,paid_micro,state,price_book_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'reserved',?,?,?)`)
        .run(p.reservationId, p.sku, p.endpoint, monthKey, dayKey, p.units, paidMicro, this.book.hash, p.now, p.now);
      return { ok: true, reservationId: p.reservationId, units: p.units, paidMicro, monthUsed: after, monthRemaining: limits.monthlyCalls - after };
    });
    return tx.immediate();
  }

  /**
   * Records the events actually billed (for example, pages served by a paged endpoint). It can only shrink the reservation: serving more than
   * was reserved is a caller bug and throws. The paid amount reserved is kept, so a settle never understates spend.
   */
  settle(reservationId: string, actualUnits: number, now: string): void {
    if (!Number.isSafeInteger(actualUnits) || actualUnits < 0) throw new RangeError('actualUnits must be a non-negative integer');
    const row = this.db.prepare(`SELECT units, state FROM env_api_usage WHERE reservation_id=?`).get(reservationId) as { units: number; state: string } | undefined;
    if (!row) throw new RangeError('unknown reservation');
    if (row.state !== 'reserved' && row.state !== 'liability') return;
    if (actualUnits > row.units) throw new RangeError('actualUnits exceeds the reservation; reserve the maximum pages first');
    this.db.prepare(`UPDATE env_api_usage SET state='settled', units=?, updated_at=? WHERE reservation_id=?`).run(actualUnits, now, reservationId);
  }

  /** Only when Google certainly did not bill (the request never left the process, or it was refused before service). */
  release(reservationId: string, now: string): void {
    this.db.prepare(`UPDATE env_api_usage SET state='released', updated_at=? WHERE reservation_id=? AND state='reserved'`).run(now, reservationId);
  }

  /** Timeout or ambiguous outcome: keep the full reservation counted until it is reconciled. */
  markLiability(reservationId: string, now: string): void {
    this.db.prepare(`UPDATE env_api_usage SET state='liability', updated_at=? WHERE reservation_id=? AND state='reserved'`).run(now, reservationId);
  }

  snapshot(sku: EnvSku, now: string): EnvUsageSnapshot {
    const monthKey = now.slice(0, 7);
    const dayKey = now.slice(0, 10);
    const free = freeQuantity(this.book, BINDINGS[sku].freeId);
    const limits = this.config.skus[sku];
    return {
      sku, monthKey,
      monthUsed: (this.db.prepare(`SELECT COALESCE(SUM(units),0) AS s FROM env_api_usage WHERE sku=? AND month_key=? AND ${COUNTED}`).get(sku, monthKey) as { s: number }).s,
      monthCap: limits.monthlyCalls,
      dayUsed: (this.db.prepare(`SELECT COALESCE(SUM(units),0) AS s FROM env_api_usage WHERE sku=? AND day_key=? AND ${COUNTED}`).get(sku, dayKey) as { s: number }).s,
      dayCap: limits.dailyCalls,
      freeCap: free === null ? null : Number(free.n / free.d),
      paidMicro: (this.db.prepare(`SELECT COALESCE(SUM(paid_micro),0) AS s FROM env_api_usage WHERE sku=? AND month_key=? AND ${COUNTED}`).get(sku, monthKey) as { s: number }).s,
      paidBudgetMicro: limits.monthlyPaidMicro,
    };
  }
}
