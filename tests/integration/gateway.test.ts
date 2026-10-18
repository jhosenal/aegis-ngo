import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { loadChain } from '../../src/audit/chainStore.js';
import { loadConfig } from '../../src/config/config.js';
import { BudgetLedger } from '../../src/providers/budget-ledger.js';
import { ModelGateway } from '../../src/providers/gateway.js';
import { StubProvider, type StubStep } from '../../src/providers/stubs.js';
import { CircuitBreaker } from '../../src/providers/circuit.js';
import { actualMicro, reservationMicro, type PriceSnapshot } from '../../src/providers/pricing.js';
import type { GatewayOutcome, RoleBinding } from '../../src/types/domain.js';

type Db = import('better-sqlite3').Database;
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const databases: Db[] = [];
const tempDirectories: string[] = [];
const price: PriceSnapshot = {
  id: 'PRICE-TEST', capturedAt: '2026-10-13T00:00:00Z',
  inputMicroPerMTok: 1_000_000, outputMicroPerMTok: 2_000_000, source: 'test-vector',
};

interface HarnessOptions {
  primary?: StubStep[];
  backup?: StubStep[] | null;
  limits?: number;
  maxPrimaryAttempts?: number;
  maxAttemptsTotal?: number;
  deadlineMs?: number;
  circuitThreshold?: number;
  circuitCooldownMs?: number;
  monotonicReadings?: number[];
  bindingDataClasses?: ('public' | 'tenant_private')[];
  reapiDataClasses?: ('public' | 'tenant_private')[];
  includeTenant?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  const db = openDb(':memory:');
  databases.push(db);
  migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
  const limits = options.limits ?? 1000;
  const config = loadConfig({
    AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_MODELS_ENABLED: 'true',
    AEGIS_PRICE_SNAPSHOT_ID: 'PRICE-TEST',
    AEGIS_BUDGET_ACCOUNT_MICRO: String(limits), AEGIS_BUDGET_DAY_MICRO: String(limits), AEGIS_BUDGET_TASK_MICRO: String(limits),
    AEGIS_MAX_PRIMARY_ATTEMPTS: String(options.maxPrimaryAttempts ?? 2),
    AEGIS_MAX_ATTEMPTS_TOTAL: String(options.maxAttemptsTotal ?? 3),
    AEGIS_TOTAL_DEADLINE_MS: String(options.deadlineMs ?? 15000),
    AEGIS_CIRCUIT_FAILURE_THRESHOLD: String(options.circuitThreshold ?? 3),
    AEGIS_CIRCUIT_COOLDOWN_MS: String(options.circuitCooldownMs ?? 30000),
    AEGIS_REAPI_ALLOWED_DATA_CLASSES: (options.reapiDataClasses ?? ['public']).join(','),
  });
  const primary = new StubProvider('stub-google', options.primary ?? [{ type: 'ok', text: 'valid', usage: { inputTokens: 40, outputTokens: 10 } }]);
  const backup = options.backup === null ? null : new StubProvider('stub-reapi', options.backup ?? [{ type: 'ok', text: 'backup-valid', usage: { inputTokens: 40, outputTokens: 10 } }]);
  const ledger = new BudgetLedger(db, { accountMicro: limits, dayMicro: limits, taskMicro: limits });
  const clock = new FixedClock('2026-10-13T01:00:00Z');
  const ids = new SeqIdGen();
    let monotonic = 0;
    const monotonicReadings = options.monotonicReadings ? [...options.monotonicReadings] : [];
  const sleeps: number[] = [];
  const binding: RoleBinding = {
    roleId: 'manager', bindingVersion: 'TEST-1', primaryModel: 'google-model-test',
    backupModel: backup ? 'reapi-model-test' : null,
    allowedDataClasses: options.bindingDataClasses ?? ['public', 'tenant_private'],
    maxInputChars: 1000, maxOutputTokens: 50,
    totalDeadlineMs: options.deadlineMs ?? 15000,
    maxAttemptsTotal: options.maxAttemptsTotal ?? 3, maxCostPerTaskMicro: limits, priceSnapshotId: 'PRICE-TEST',
  };
  const gateway = new ModelGateway({
    db, clock, ids, config, ledger, primary, backup, binding: () => binding, price,
      sleep: async (ms) => { sleeps.push(ms); monotonic += ms; }, rng: () => 0.5,
      monotonicMs: () => {
        const next = monotonicReadings.shift();
        if (next !== undefined) monotonic = next;
        return monotonic;
      },
  });
  const task = {
    taskId: 'TASK-TEST', ...(options.includeTenant === false ? {} : { tenantId: 'TENANT-A' }),
    system: 's'.repeat(100), user: '', responseSchemaId: 'test-schema', dataClass: 'public' as const,
  };
  return { db, gateway, primary, backup, ledger, config, clock, sleeps, task, advance: (ms: number) => { monotonic += ms; } };
}

function reservations(db: Db): Array<{ state: string; amount_micro: number; settled_micro: number | null }> {
  return db.prepare('SELECT state, amount_micro, settled_micro FROM budget_reservations ORDER BY rowid').all() as Array<{ state: string; amount_micro: number; settled_micro: number | null }>;
}

function modelRows(db: Db): Array<{ outcome: string; is_stub: number; input_hash: string; usage_json: string | null; reservation_id: string | null }> {
  return db.prepare('SELECT outcome, is_stub, input_hash, usage_json, reservation_id FROM model_calls ORDER BY rowid').all() as Array<{ outcome: string; is_stub: number; input_hash: string; usage_json: string | null; reservation_id: string | null }>;
}

function attemptOutcomes(result: GatewayOutcome): string[] {
  return result.attempts.map((attempt) => attempt.outcome);
}

async function call(harness: ReturnType<typeof makeHarness>, validate = (text: string) => text.includes('valid')): Promise<GatewayOutcome> {
  return harness.gateway.call('manager', harness.task, validate);
}

interface GatewayProcess {
  child: ChildProcess;
  ready: Promise<void>;
  done: Promise<GatewayOutcome>;
  start(): void;
  exited: Promise<void>;
}

function startGatewayProcess(dbPath: string, workerKey: string): GatewayProcess {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const helper = fileURLToPath(new URL('./helpers/gateway-worker.ts', import.meta.url));
  const child = spawn(process.execPath, [tsxCli, helper, dbPath, workerKey], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  let resolveDone: (result: GatewayOutcome) => void = () => undefined;
  let rejectDone: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const done = new Promise<GatewayOutcome>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', (error) => reject(error));
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Gateway process ${workerKey} exited ${String(code)}: ${stderr}`));
    });
  });
  lines.on('line', (line) => {
    let message: unknown;
    try { message = JSON.parse(line) as unknown; }
    catch { rejectReady(new Error(`Gateway process ${workerKey} emitted invalid JSON: ${line}`)); return; }
    if (typeof message !== 'object' || message === null || !('type' in message)) return;
    if (message.type === 'ready') resolveReady();
    else if (message.type === 'done' && 'result' in message) resolveDone(message.result as GatewayOutcome);
    else if (message.type === 'failed') {
      const failure = new Error(`Gateway process ${workerKey} failed: ${'message' in message ? String(message.message) : 'unknown error'}`);
      rejectReady(failure);
      rejectDone(failure);
    }
  });
  child.once('error', (error) => { rejectReady(error); rejectDone(error); });
  return {
    child, ready, done, exited,
    start: () => { child.stdin?.write('start\n'); },
  };
}

async function runConcurrentGatewayProcesses(dbPath: string): Promise<GatewayOutcome[]> {
  const processes = ['left', 'right'].map((workerKey) => startGatewayProcess(dbPath, workerKey));
  try {
    await Promise.all(processes.map((gatewayProcess) => gatewayProcess.ready));
    for (const gatewayProcess of processes) gatewayProcess.start();
    const results = await Promise.all(processes.map((gatewayProcess) => gatewayProcess.done));
    await Promise.all(processes.map((gatewayProcess) => gatewayProcess.exited));
    return results;
  } finally {
    for (const gatewayProcess of processes) {
      if (gatewayProcess.child.exitCode === null) gatewayProcess.child.kill();
    }
  }
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('TSK-011 provider gateway', () => {
  it('AEG-TST-008 pricing vectors calculate reservations and measured cost', () => {
    expect(reservationMicro('s'.repeat(100), '', 50, price)).toBe(200);
    expect(actualMicro({ inputTokens: 40, outputTokens: 10 }, price)).toBe(60);
  });

  it('AEG-TST-008 G1 settles measured usage and stores no prompt text', async () => {
    const harness = makeHarness();
    const result = await call(harness);
    expect(result).toMatchObject({ status: 'OK', text: 'valid', notice: null });
    expect(result.attempts).toHaveLength(1);
    expect(reservations(harness.db)).toEqual([{ state: 'settled', amount_micro: 200, settled_micro: 60 }]);
    const rows = modelRows(harness.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'OK', is_stub: 1 });
    expect(rows[0]?.input_hash).toMatch(/^[0-9a-f]{64}$/);
    const columns = harness.db.prepare('PRAGMA table_info(model_calls)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain('system');
    expect(columns.map((column) => column.name)).not.toContain('user');
  });

  it('AEG-TST-008 G2 retries primary twice then succeeds with backup after one 200 ms sleep', async () => {
    const harness = makeHarness({ primary: [
      { type: 'error', kind: 'TRANSIENT' }, { type: 'error', kind: 'TRANSIENT' },
    ] });
    const result = await call(harness);
    expect(result).toMatchObject({ status: 'OK', text: 'backup-valid', notice: 'GOOGLE_UNAVAILABLE_BACKUP_USED' });
    expect(result.attempts).toHaveLength(3);
    expect(harness.primary.calls).toHaveLength(2);
    expect(harness.backup?.calls).toHaveLength(1);
    expect(harness.sleeps).toEqual([200]);
  });

  it('AEG-TST-008 G3 retains three timeout reservations as liabilities', async () => {
    const harness = makeHarness({ primary: [
      { type: 'error', kind: 'TIMEOUT' }, { type: 'error', kind: 'TIMEOUT' },
    ], backup: [{ type: 'error', kind: 'TIMEOUT' }] });
    const result = await call(harness);
    expect(result).toMatchObject({ status: 'DEGRADED', text: null, notice: 'MODELS_UNAVAILABLE' });
    expect(attemptOutcomes(result)).toEqual(['TIMEOUT', 'TIMEOUT', 'TIMEOUT']);
    expect(reservations(harness.db)).toHaveLength(3);
    expect(harness.ledger.totals()).toEqual({ committedMicro: 600 });
    expect(reservations(harness.db).every((reservation) => reservation.state === 'liability')).toBe(true);
  });

  it('AEG-TST-008 G4 opens the auth-failing circuit and records a skipped attempt next call', async () => {
    const harness = makeHarness({ primary: [
      { type: 'error', kind: 'AUTH' }, { type: 'ok', text: 'unexpected', usage: { inputTokens: 1, outputTokens: 1 } },
    ], backup: [
      { type: 'ok', text: 'backup-valid', usage: { inputTokens: 40, outputTokens: 10 } },
      { type: 'ok', text: 'backup-valid-again', usage: { inputTokens: 40, outputTokens: 10 } },
    ] });
    const first = await call(harness);
    expect(first.text).toBe('backup-valid');
    expect(harness.primary.calls).toHaveLength(1);
    const second = await call(harness);
    expect(second.text).toBe('backup-valid-again');
    expect(attemptOutcomes(second)).toEqual(['CIRCUIT_OPEN', 'OK']);
    expect(harness.primary.calls).toHaveLength(1);
    expect(reservations(harness.db)).toHaveLength(3);
  });

  it('AEG-TST-008 G5 discards malformed text and uses backup once', async () => {
    const harness = makeHarness({ primary: [{ type: 'ok', text: 'bad payload', usage: { inputTokens: 40, outputTokens: 10 } }] });
    const result = await call(harness);
    expect(result).toMatchObject({ status: 'OK', text: 'backup-valid' });
    expect(attemptOutcomes(result)).toEqual(['MALFORMED', 'OK']);
    const failed = makeHarness({ primary: [{ type: 'ok', text: 'bad payload', usage: { inputTokens: 40, outputTokens: 10 } }], backup: [{ type: 'ok', text: 'also bad', usage: { inputTokens: 40, outputTokens: 10 } }] });
    const degraded = await call(failed);
    expect(degraded).toMatchObject({ status: 'DEGRADED', text: null, notice: 'MODELS_UNAVAILABLE' });
    expect(degraded.attempts.every((attempt) => !attempt.outcome.includes('invalid'))).toBe(true);
  });

  it('AEG-TST-008 G6 refusal is terminal and does not call backup', async () => {
    const harness = makeHarness({ primary: [{ type: 'error', kind: 'REFUSAL' }] });
    const result = await call(harness);
    expect(result).toMatchObject({ status: 'REFUSED', text: null, notice: 'REFUSED' });
    expect(result.attempts).toHaveLength(1);
    expect(harness.backup?.calls).toHaveLength(0);
  });

  it('AEG-TST-008 G7 bad request is terminal without retry or backup', async () => {
    const harness = makeHarness({ primary: [{ type: 'error', kind: 'BAD_REQUEST' }] });
    const result = await call(harness);
    expect(result.status).toBe('DEGRADED');
    expect(result.attempts).toHaveLength(1);
    expect(harness.primary.calls).toHaveLength(1);
    expect(harness.backup?.calls).toHaveLength(0);
  });

  it('AEG-TST-008 G8 exhausted budget records denials without provider calls', async () => {
    const harness = makeHarness({ limits: 0 });
    const result = await call(harness);
    expect(result).toMatchObject({ status: 'DEGRADED', notice: 'BUDGET_EXHAUSTED' });
    expect(attemptOutcomes(result)).toEqual(['BUDGET_DENIED', 'BUDGET_DENIED']);
    expect(harness.primary.calls).toHaveLength(0);
    expect(harness.backup?.calls).toHaveLength(0);
  });

  it('AEG-TST-008 G9 does not start a retry after the deadline expires during backoff', async () => {
    const harness = makeHarness({ primary: [{ type: 'error', kind: 'TRANSIENT' }], deadlineMs: 100 });
    const result = await call(harness);
    expect(result.status).toBe('DEGRADED');
    expect(harness.sleeps).toEqual([200]);
    expect(harness.primary.calls).toHaveLength(1);
    expect(result.attempts).toHaveLength(1);
  });

  it('AEG-TST-008 G10 skips a backup provider disallowed for tenant-private data', async () => {
    const harness = makeHarness({ primary: [{ type: 'error', kind: 'TRANSIENT' }], reapiDataClasses: ['public'], maxPrimaryAttempts: 1, maxAttemptsTotal: 2 });
    const privateTask = { ...harness.task, dataClass: 'tenant_private' as const };
    const result = await harness.gateway.call('manager', privateTask, (text) => text.includes('valid'));
    expect(result.status).toBe('DEGRADED');
    expect(harness.primary.calls).toHaveLength(1);
    expect(harness.backup?.calls).toHaveLength(0);
  });

  it('AEG-TST-008 G11 trips after three failures and permits a single successful half-open probe', async () => {
    const harness = makeHarness({
      primary: [
        { type: 'error', kind: 'TRANSIENT' }, { type: 'error', kind: 'TRANSIENT' },
        { type: 'error', kind: 'TRANSIENT' }, { type: 'ok', text: 'valid', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      backup: null, maxPrimaryAttempts: 1, maxAttemptsTotal: 1, circuitThreshold: 3, circuitCooldownMs: 50,
    });
    for (let index = 0; index < 3; index += 1) expect((await call(harness)).status).toBe('DEGRADED');
    expect(await call(harness)).toMatchObject({ status: 'DEGRADED', attempts: [expect.objectContaining({ outcome: 'CIRCUIT_OPEN' })] });
    expect(harness.primary.calls).toHaveLength(3);
    harness.advance(50);
    expect((await call(harness)).status).toBe('OK');
    expect(harness.primary.calls).toHaveLength(4);
  });

  it('AEG-TST-008 G12 marks unknown usage cost as liability', async () => {
    const harness = makeHarness({ primary: [{ type: 'ok', text: 'valid', usage: null }] });
    const result = await call(harness);
    expect(result).toMatchObject({ status: 'OK', text: 'valid' });
    expect(result.attempts[0]?.costBasis).toBe('unknown');
    expect(reservations(harness.db)).toEqual([{ state: 'liability', amount_micro: 200, settled_micro: null }]);
  });

  it('AEG-TST-008 G13 concurrent connections allow one 600 micro reservation only', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aegis-g13-'));
    tempDirectories.push(directory);
    const dbPath = join(directory, 'gateway.sqlite');
    const db = openDb(dbPath);
    databases.push(db);
    migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    const ledger = new BudgetLedger(db, { accountMicro: 1000, dayMicro: 1000, taskMicro: 1000 });
    expect(ledger.totals()).toEqual({ committedMicro: 0 });
    db.close();
    databases.splice(databases.indexOf(db), 1);
    const results = await runConcurrentGatewayProcesses(dbPath);
    expect(results.filter((result) => result.status === 'OK')).toHaveLength(1);
    expect(results.filter((result) => result.notice === 'BUDGET_EXHAUSTED')).toHaveLength(1);
    expect(results.flatMap((result) => result.attempts.map((attempt) => attempt.outcome)).sort())
      .toEqual(['BUDGET_DENIED', 'OK']);
  });

  it('AEG-TST-009 model-disabled calls return immediately with zero attempts', async () => {
    const harness = makeHarness();
    harness.config.modelsEnabled = false;
    const result = await call(harness);
    expect(result).toEqual({ status: 'DEGRADED', text: null, notice: 'MODELS_DISABLED', attempts: [] });
    expect(modelRows(harness.db)).toHaveLength(0);
  });

  it('AEG-TST-009 task without tenant writes the model event to SYSTEM', async () => {
    const harness = makeHarness({ includeTenant: false, primary: [{ type: 'error', kind: 'BAD_REQUEST' }], backup: null });
    await call(harness);
    const events = loadChain(harness.db, { productId: 'AEG', tenantId: 'SYSTEM' });
    expect(events.map((event) => event.eventType)).toEqual(['model.attempted']);
  });

  it('AEG-TST-009 request aborts when the task deadline fires', async () => {
    const harness = makeHarness({ primary: [{ type: 'delay', ms: 100 }], backup: null, deadlineMs: 20, maxPrimaryAttempts: 1, maxAttemptsTotal: 1 });
    const result = await call(harness);
    expect(result.status).toBe('DEGRADED');
    expect(attemptOutcomes(result)).toEqual(['TIMEOUT']);
    expect(reservations(harness.db)[0]?.state).toBe('liability');
  });

  it('AEG-TST-008 FU-4 releases a reservation before provider start and leaves the circuit closed', async () => {
    const harness = makeHarness({
      primary: [{ type: 'ok', text: 'valid', usage: { inputTokens: 1, outputTokens: 1 } }],
      backup: null, deadlineMs: 100, maxPrimaryAttempts: 1, maxAttemptsTotal: 1,
      circuitThreshold: 1, monotonicReadings: [0, 0, 100, 100],
    });
    const aborted = await call(harness);
    expect(aborted.status).toBe('DEGRADED');
    expect(attemptOutcomes(aborted)).toEqual(['ABORTED']);
    expect(harness.primary.calls).toHaveLength(0);
    expect(reservations(harness.db)).toEqual([{ state: 'released', amount_micro: 200, settled_micro: null }]);
    expect(harness.ledger.totals()).toEqual({ committedMicro: 0 });

    const next = await call(harness);
    expect(next.status).toBe('OK');
    expect(harness.primary.calls).toHaveLength(1);
  });

  it('AEG-TST-009 circuit breaker exposes exactly one half-open probe', () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 10, () => now);
    breaker.recordFailure();
    expect(breaker.state()).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
    now = 10;
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.state()).toBe('half-open');
    expect(breaker.canAttempt()).toBe(false);
    breaker.recordSuccess();
    expect(breaker.state()).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });
});
