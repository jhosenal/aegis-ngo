import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySpendLimitChange } from '../../src/costs/budgetEdit.js';
import { DEFAULT_BUDGET, loadBudget } from '../../src/costs/engine.js';

/** Every test works on a COPY of the real budget file, never the real one. */
// The tests start from a fixed copy (10.00 and 0.50, no change history), never from the live owner values: the owner changes the real limits in the Admin Desk.
const copy = (): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'aegis-budget-')), 'budget.json');
  const base = JSON.parse(readFileSync(DEFAULT_BUDGET, 'utf8')) as Record<string, unknown>;
  base['monthlyBudgetUsd'] = '10.00'; base['autoApproveUsd'] = '0.50'; delete base['changes'];
  writeFileSync(file, `${JSON.stringify(base, null, 2)}
`);
  return file;
};
const AT = '2026-10-18T05:00:00.000Z';

describe('the owner changes the two spend limits from the Admin Desk', () => {
  it('changes the monthly budget and the per-action limit with a reason, keeps every other field, and records who, when, from, to and why', () => {
    const file = copy(); const before = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const next = applySpendLimitChange({ monthlyBudgetUsd: '12', autoApproveUsd: '0.75', reason: 'More render trials for the judging window' }, 'DEV-ADMIN', AT, file);
    expect(next.monthlyBudgetUsd).toBe('12.00'); expect(next.autoApproveUsd).toBe('0.75');
    const after = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { changes: { field: string; from: string; to: string; by: string; at: string; reason: string }[] };
    expect(after['funding']).toEqual(before['funding']); expect(after['capEnforced']).toBe(before['capEnforced']); expect(after['note']).toBe(before['note']); expect(after['period']).toBe(before['period']);
    expect(after.changes).toEqual([
      { at: AT, by: 'DEV-ADMIN', field: 'monthlyBudgetUsd', from: before['monthlyBudgetUsd'], to: '12.00', reason: 'More render trials for the judging window' },
      { at: AT, by: 'DEV-ADMIN', field: 'autoApproveUsd', from: before['autoApproveUsd'], to: '0.75', reason: 'More render trials for the judging window' },
    ]);
    expect(loadBudget(file).monthlyBudgetUsd).toBe('12.00');   // the cost engine reads the new value
  });
  it('changes one limit alone, and appends to the list instead of replacing it', () => {
    const file = copy();
    applySpendLimitChange({ autoApproveUsd: '0.40', reason: 'Tighter per action' }, 'DEV-ADMIN', AT, file);
    applySpendLimitChange({ autoApproveUsd: '0.30', reason: 'Tighter again' }, 'DEV-ADMIN', AT, file);
    const budget = loadBudget(file);
    expect(budget.autoApproveUsd).toBe('0.30'); expect(budget.changes).toHaveLength(2);
  });
  it('refuses a missing or short reason, a number that is not an amount, nothing changed, and values outside the guard rails', () => {
    const file = copy(); const current = loadBudget(file);
    const refuse = (change: Record<string, unknown>, message: RegExp): void => { expect(() => applySpendLimitChange(change, 'DEV-ADMIN', AT, file)).toThrow(message); };
    refuse({ monthlyBudgetUsd: '12' }, /reason/);
    refuse({ monthlyBudgetUsd: '12', reason: 'abc' }, /reason/);
    refuse({ monthlyBudgetUsd: 'ten', reason: 'Valid reason here' }, /amount in USD/);
    refuse({ monthlyBudgetUsd: '-5', reason: 'Valid reason here' }, /amount in USD/);
    refuse({ monthlyBudgetUsd: '12.345', reason: 'Valid reason here' }, /at most 2 decimals/);
    refuse({ monthlyBudgetUsd: String(Number(current.monthlyBudgetUsd)), autoApproveUsd: String(Number(current.autoApproveUsd)), reason: 'Valid reason here' }, /Nothing changed/);
    refuse({ monthlyBudgetUsd: '0.50', reason: 'Valid reason here' }, /between 1\.00 and 50\.00/);
    refuse({ monthlyBudgetUsd: '60', reason: 'Valid reason here' }, /between 1\.00 and 50\.00/);
    refuse({ autoApproveUsd: '99', reason: 'Valid reason here' }, /between 0\.01 USD and the monthly budget/);
    refuse({ monthlyBudgetUsd: '5', autoApproveUsd: '6', reason: 'Valid reason here' }, /between 0\.01 USD and the monthly budget/);
    expect(loadBudget(file).changes).toBeUndefined();   // nothing was written by any refused change
  });
  it('says plainly when the budget file is not on this server', () => {
    expect(() => applySpendLimitChange({ monthlyBudgetUsd: '12', reason: 'Valid reason here' }, 'DEV-ADMIN', AT, join(tmpdir(), 'no-such-dir', 'budget.json'))).toThrow(/not on this server/);
  });
});
