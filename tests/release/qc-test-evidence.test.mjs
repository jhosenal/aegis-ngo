import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { summarizeTests } from '../../tools/qc-test-evidence.mjs';

test('skipped pricing assertions stay unverified even when the suite succeeds', () => {
  const root = process.cwd();
  const result = summarizeTests({ numTotalTests: 3, numPassedTests: 2, numFailedTests: 0, numPendingTests: 1, testResults: [
    { name: path.join(root, 'tests/unit/costs-formulas.test.ts'), assertionResults: [{ status: 'pending', fullName: 'saved price source quote' }, { status: 'passed', fullName: 'formula arithmetic' }] },
    { name: path.join(root, 'tests/integration/workflow.test.ts'), assertionResults: [{ status: 'passed', fullName: 'approval expiry' }] },
  ] }, root);
  assert.equal(result.unverified.length, 1);
  assert.equal(result.unverified[0].verification, 'UNVERIFIED');
  assert.equal(result.unverified[0].file, 'tests/unit/costs-formulas.test.ts');
  assert.deepEqual(result.groups.integration, { passed: 1, failed: 0, unverified: 0 });
  assert.deepEqual(result.groups.unit, { passed: 1, failed: 0, unverified: 1 });
  assert.equal(result.pricingEvidenceStatus, 'PARTIAL_UNVERIFIED');
});
test('missing structured test evidence cannot be summarized as a pass', () => {
  assert.throws(() => summarizeTests({}, process.cwd()));
});
