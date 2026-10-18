import Database from 'better-sqlite3';
import { BudgetLedger } from '../../../src/providers/budget-ledger.js';
const [dbPath, attemptId, amount] = process.argv.slice(2) as [string, string, string];
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');
const ledger = new BudgetLedger(db, { accountMicro: 100, dayMicro: 100, taskMicro: 100 });
const r = ledger.reserve({ reservationId: 'R-' + attemptId, taskId: 'T-' + attemptId, attemptId, dayKey: '2026-10-13', maxMicro: Number(amount), priceSnapshotId: 'PRICE-TEST', now: '2026-10-13T00:00:00Z' });
process.stdout.write(JSON.stringify(r));
