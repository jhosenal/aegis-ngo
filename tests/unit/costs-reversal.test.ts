import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { committed, readLedger } from '../../src/costs/ledger.js';
import { gate, recordActual, reverseActual, status, type Budget } from '../../src/costs/engine.js';
import { loadPriceBook } from '../../src/costs/pricebook.js';
import { ceilNano, usdToNano } from '../../src/costs/money.js';

const book = loadPriceBook();
const budget: Budget = { period: '2026-10', monthlyBudgetUsd: '10.00', autoApproveUsd: '0.50', capEnforced: false, funding: { GCP_CREDIT: { balanceUsd: '300.00', expires: '2026-12-17' }, GEMINI_PREPAY: { balanceUsd: '5.00', expires: '2027-12-31' }, OTHER: { balanceUsd: '2.00', expires: '2027-12-31' } } } as Budget;
let file = ''; let tick = 0;
const now = () => `2026-10-14T00:00:${String(tick++ % 60).padStart(2, '0')}Z`;
const deps = () => ({ book, budget, ledgerFile: file, now });
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'cost-')), 'ledger.jsonl'); tick = 0; });

describe('a wrong ACTUAL is cancelled by a reversing entry, never edited', () => {
  it('a period total entered without its estimate double counts; the reversal removes it from committed, unexplained and exposure, and both stay in the chain', () => {
    gate({ actionId: 'A1', agent: 'ops', purpose: 'test', lines: [{ formula: 'AEG.F.GCP-SCAN/1.0.0', args: { scans: '1' } }] }, deps());
    const before = status(deps());
    const wrong = recordActual({ refSeq: null, service: 'Cloud Run', usd: '4.32', period: '2026-10', source: 'csv-export', funding: 'GCP_CREDIT', creditUsd: '4.00', note: 'period total' }, deps()).actual;
    const doubled = status(deps());
    expect(doubled.committedNano).toBe(before.committedNano + ceilNano(usdToNano('4.32')));
    expect(doubled.unexplained.count).toBe(1); expect(doubled.cardExposureNano).toBeGreaterThan(0n);
    const rev = reverseActual({ seq: wrong.seq, by: 'snet-engineer', reason: 'Period total entered without --seq: double counts earlier render actuals.' }, deps());
    expect(rev.type).toBe('REVERSAL');
    const after = status(deps());
    expect(after.committedNano).toBe(before.committedNano);
    expect(after.unexplained.count).toBe(0); expect(after.cardExposureNano).toBe(0n);
    expect(readLedger(file)).toHaveLength(3);                                  // the estimate, the wrong actual and the reversal are all still there, and the chain verifies
    expect(committed(readLedger(file), '2026-10').counted.some((c) => c.seq === wrong.seq)).toBe(false);
  });
  it('only an ACTUAL can be reversed, and only once', () => {
    gate({ actionId: 'A1', agent: 'ops', purpose: 'test', lines: [{ formula: 'AEG.F.GCP-SCAN/1.0.0', args: { scans: '1' } }] }, deps());
    const a = recordActual({ refSeq: null, service: 'Cloud Run', usd: '1.00', period: '2026-10', source: 'manual', funding: 'GCP_CREDIT', note: '' }, deps()).actual;
    expect(() => reverseActual({ seq: 1, by: 'x', reason: 'not an actual at all, an estimate' }, deps())).toThrow(/not an actual/);
    reverseActual({ seq: a.seq, by: 'x', reason: 'recorded in error, reversed once' }, deps());
    expect(() => reverseActual({ seq: a.seq, by: 'x', reason: 'trying to reverse it twice' }, deps())).toThrow(/already reversed/);
  });
});
