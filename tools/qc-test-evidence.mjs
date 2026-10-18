import path from 'node:path';

// A successful suite does not verify skipped assertions or missing private evidence.
export function summarizeTests(report, root) {
  if (!Array.isArray(report.testResults)) throw Error('Missing structured test results');
  const unverified = [];
  const groups = { integration: { passed: 0, failed: 0, unverified: 0 }, unit: { passed: 0, failed: 0, unverified: 0 } };
  for (const suite of report.testResults) {
    const file = path.relative(root, suite.name).replaceAll('\\', '/');
    const group = file.startsWith('tests/integration/') ? groups.integration : file.startsWith('tests/unit/') ? groups.unit : null;
    for (const item of suite.assertionResults ?? []) {
      const status = item.status;
      const key = status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'unverified';
      if (group) group[key]++;
      if (key === 'unverified') unverified.push({ file, test: item.fullName || item.title, runnerStatus: status, verification: 'UNVERIFIED', reason: 'Skipped or not executed; this test provides no verification evidence.' });
    }
  }
  return { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests,
    skipped: report.numPendingTests, todo: report.numTodoTests ?? 0, groups, unverified,
    pricingEvidenceStatus: 'PARTIAL_UNVERIFIED',
    limitation: 'Skipped price-page tests and absent private source pages are UNVERIFIED. A passing application suite does not validate the missing pricing evidence.' };
}
