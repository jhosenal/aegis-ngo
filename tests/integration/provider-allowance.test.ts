import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { loadConfig } from '../../src/config/config.js';
import { BudgetLedger } from '../../src/providers/budget-ledger.js';
import { ModelGateway } from '../../src/providers/gateway.js';
import { StubProvider, type StubStep } from '../../src/providers/stubs.js';
import type { PriceSnapshot } from '../../src/providers/pricing.js';
import type { RoleBinding } from '../../src/types/domain.js';

type Db = import('better-sqlite3').Database;
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const databases: Db[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

// A deliberately high configured (Google-style) price so that "ceiling" and "own published price" differ clearly.
const price: PriceSnapshot = { id: 'PRICE-TEST', capturedAt: '2026-10-14T00:00:00Z', inputMicroPerMTok: 300_000, outputMicroPerMTok: 2_500_000, source: 'test' };

function harness(opts: { reapiAllowance: number; backupModel: string; backup?: StubStep[] }) {
  const db = openDb(':memory:');
  databases.push(db);
  migrate(db, migrationDirectory, '2026-10-14T00:00:00Z');
  const config = loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_MODELS_ENABLED: 'true', AEGIS_PRICE_SNAPSHOT_ID: 'PRICE-TEST', AEGIS_BUDGET_ACCOUNT_MICRO: '2000000', AEGIS_BUDGET_DAY_MICRO: '2000000', AEGIS_BUDGET_TASK_MICRO: '2000000' });
  const ledger = new BudgetLedger(db, { accountMicro: 2_000_000, dayMicro: 2_000_000, taskMicro: 2_000_000, providerAccountMicro: { google: 2_000_000, reapi: opts.reapiAllowance } });
  const primary = new StubProvider('stub-google', [{ type: 'error', kind: 'AUTH' }]);
  const backup = new StubProvider('stub-reapi', opts.backup ?? [{ type: 'ok', text: 'valid', usage: { inputTokens: 1000, outputTokens: 200 } }]);
  const binding: RoleBinding = {
    roleId: 'manager', bindingVersion: 'T', primaryModel: 'google-model', backupModel: opts.backupModel, allowedDataClasses: ['public'],
    maxInputChars: 1000, maxOutputTokens: 100, totalDeadlineMs: 15000, maxAttemptsTotal: 3, maxCostPerTaskMicro: 2_000_000, priceSnapshotId: 'PRICE-TEST',
  };
  const gateway = new ModelGateway({
    db, clock: new FixedClock('2026-10-14T01:00:00Z'), ids: new SeqIdGen(), config, ledger, primary, backup, binding: () => binding, price,
    sleep: async () => undefined, rng: () => 0.5, monotonicMs: () => 0,
  });
  const task = (n: number) => ({ taskId: `T-${n}`, system: 's'.repeat(100), user: '', responseSchemaId: 'x', dataClass: 'public' as const });
  return { db, gateway, backup, ledger, task, call: (n: number) => gateway.call('manager', task(n), (text: string) => text.includes('valid')) };
}

describe('S0038 finding 3: the reAPI allowance is enforced by the runtime gateway', () => {
  it('refuses every reAPI fallback call when no allowance exists (fail closed), and never calls the provider', async () => {
    const h = harness({ reapiAllowance: 0, backupModel: 'gpt-6-luna' });
    const result = await h.call(1);
    expect(result.status).not.toBe('OK');
    expect(h.backup.calls).toHaveLength(0);
    expect(h.db.prepare("SELECT retry_reason FROM model_calls WHERE outcome = 'BUDGET_DENIED'").all().length).toBeGreaterThan(0);
  });

  it('spends reAPI only up to the allowance across calls, and records the funding provider on every reservation', async () => {
    const h = harness({ reapiAllowance: 500, backupModel: 'gpt-6-luna', backup: Array.from({ length: 10 }, () => ({ type: 'ok' as const, text: 'valid', usage: { inputTokens: 1000, outputTokens: 200 } })) });
    const statuses: string[] = [];
    for (let n = 1; n <= 10; n++) statuses.push((await h.call(n)).status);
    // each priced call settles at 160 micro-USD (1000 in at 0.08 + 200 out at 0.40 per million): three fit under 500, the fourth is refused before any provider call
    expect(statuses.filter((status) => status === 'OK')).toHaveLength(3);
    expect(h.backup.calls).toHaveLength(3);
    const spent = (h.db.prepare("SELECT COALESCE(SUM(CASE state WHEN 'settled' THEN settled_micro WHEN 'released' THEN 0 ELSE amount_micro END),0) AS s FROM budget_reservations WHERE provider = 'reapi'").get() as { s: number }).s;
    expect(spent).toBe(480);
    expect(spent).toBeLessThanOrEqual(500);
    expect((h.db.prepare('SELECT COUNT(*) AS n FROM budget_reservations WHERE provider IS NULL').get() as { n: number }).n).toBe(0);
  });

  it('settles a priced reAPI model at its own published price as measured, and an unpriced model at the configured ceiling as estimated', async () => {
    const priced = harness({ reapiAllowance: 1_000_000, backupModel: 'gpt-6-luna' });
    expect((await priced.call(1)).status).toBe('OK');
    const row = priced.db.prepare("SELECT settled_micro, cost_basis FROM budget_reservations r JOIN model_calls m ON m.reservation_id = r.reservation_id WHERE r.provider = 'reapi'").get() as { settled_micro: number; cost_basis: string };
    expect(row.cost_basis).toBe('measured');
    expect(row.settled_micro).toBe(Math.ceil((1000 * 80_000 + 200 * 400_000) / 1_000_000));      // 0.08 / 0.40 USD per million tokens
    const unpriced = harness({ reapiAllowance: 1_000_000, backupModel: 'unlisted-model' });
    expect((await unpriced.call(1)).status).toBe('OK');
    const other = unpriced.db.prepare("SELECT settled_micro, cost_basis FROM budget_reservations r JOIN model_calls m ON m.reservation_id = r.reservation_id WHERE r.provider = 'reapi'").get() as { settled_micro: number; cost_basis: string };
    expect(other.cost_basis).toBe('estimated');
    expect(other.settled_micro).toBe(Math.ceil((1000 * 300_000 + 200 * 2_500_000) / 1_000_000));  // the conservative ceiling
  });
});
