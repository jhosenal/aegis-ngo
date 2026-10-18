import { FixedClock } from '../../../src/engine/clock.js';
import type { IdGen } from '../../../src/engine/ids.js';
import { openDb } from '../../../src/data/db.js';
import { loadConfig } from '../../../src/config/config.js';
import { BudgetLedger } from '../../../src/providers/budget-ledger.js';
import { ModelGateway } from '../../../src/providers/gateway.js';
import type { ModelProvider, ModelRequest, ModelResponse, RoleBinding } from '../../../src/types/domain.js';
import type { PriceSnapshot } from '../../../src/providers/pricing.js';

const [dbPath, workerKey] = process.argv.slice(-2);
if (!dbPath || !workerKey) throw new Error('Gateway process requires a database path and worker key');

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

class WorkerIds implements IdGen {
  private counter = 0;
  next(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${workerKey}-${String(this.counter).padStart(6, '0')}`;
  }
}

class HeldProvider implements ModelProvider {
  readonly id = 'stub-google' as const;
  readonly isStub = true;

  async call(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, 80);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return { text: 'valid', reportedModel: request.model, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

const db = openDb(dbPath);
const config = loadConfig({
  AEGIS_ENV: 'test',
  AEGIS_DB_PATH: ':memory:',
  AEGIS_MODELS_ENABLED: 'true',
  AEGIS_PRICE_SNAPSHOT_ID: 'PRICE-TEST',
  AEGIS_BUDGET_ACCOUNT_MICRO: '1000',
  AEGIS_BUDGET_DAY_MICRO: '1000',
  AEGIS_BUDGET_TASK_MICRO: '1000',
});
const clock = new FixedClock('2026-10-13T01:00:00Z');
const ids = new WorkerIds();
const ledger = new BudgetLedger(db, { accountMicro: 1000, dayMicro: 1000, taskMicro: 1000 });
const provider = new HeldProvider();
const binding: RoleBinding = {
  roleId: 'manager', bindingVersion: 'TEST-1', primaryModel: 'model-test', backupModel: null,
  allowedDataClasses: ['public'], maxInputChars: 1000, maxOutputTokens: 250,
  totalDeadlineMs: 2000, maxAttemptsTotal: 1, maxCostPerTaskMicro: 1000, priceSnapshotId: 'PRICE-TEST',
};
const price: PriceSnapshot = {
  id: 'PRICE-TEST', capturedAt: '2026-10-13T00:00:00Z',
  inputMicroPerMTok: 1_000_000, outputMicroPerMTok: 2_000_000, source: 'test-vector',
};
const gateway = new ModelGateway({
  db, clock, ids, config, ledger, primary: provider, backup: null,
  binding: () => binding, price, sleep: async () => undefined, rng: () => 0.5, monotonicMs: () => 0,
});

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  if (!chunk.includes('start')) return;
  process.stdin.pause();
  process.stdin.removeAllListeners('data');
  process.stdin.destroy();
  void gateway.call('manager', {
    taskId: `TASK-${workerKey}`, tenantId: 'TENANT-A', system: 's'.repeat(100), user: '',
    responseSchemaId: 'test', dataClass: 'public',
  }, (text) => text === 'valid').then((result) => {
    send({ type: 'done', result });
    db.close();
  }, (error: unknown) => {
    send({ type: 'failed', message: error instanceof Error ? error.message : 'unknown error' });
    db.close();
  });
});
send({ type: 'ready' });
