import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRows, newestEvidence, renderReport, run, validateMap, type TraceMap } from '../../tools/trace.js';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aegis-trace-'));
  roots.push(root);
  mkdirSync(join(root, 'records', 'evidence'), { recursive: true });
  return root;
}

function evidence(root: string, gate: string, stamp: string, result: 'PASS' | 'FAIL'): void {
  writeFileSync(
    join(root, 'records', 'evidence', `AEG-EVD-${gate}_${stamp}.md`),
    `# EVD ${gate}\n\n| Field | Value |\n|---|---|\n| Result | **${result}** |\n`,
  );
}

const map: TraceMap = { 'AEG-REQ-900': { implementation: [], tests: [], gateTasks: ['TSK-900'] } };

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('trace tool', () => {
  it('AEG-TST-017 a missing evidence file is pending', () => {
    const root = makeRoot();
    const [row] = buildRows(map, join(root, 'records', 'evidence'));
    expect(row?.status).toBe('pending');
    expect(row?.gates[0]?.result).toBe('MISSING');
  });

  it('AEG-TST-017 a FAIL evidence file is pending', () => {
    const root = makeRoot();
    evidence(root, 'TSK-900', '20261013T080000Z', 'FAIL');
    expect(buildRows(map, join(root, 'records', 'evidence'))[0]?.status).toBe('pending');
  });

  it('AEG-TST-017 a PASS evidence file is fixture-tested, never live', () => {
    const root = makeRoot();
    evidence(root, 'TSK-900', '20261013T080000Z', 'PASS');
    expect(buildRows(map, join(root, 'records', 'evidence'))[0]?.status).toBe('fixture-tested');
  });

  it('AEG-TST-017 only the newest evidence per gate counts', () => {
    const root = makeRoot();
    evidence(root, 'TSK-900', '20261013T080000Z', 'PASS');
    evidence(root, 'TSK-900', '20261013T090000Z', 'FAIL');
    const newest = newestEvidence(join(root, 'records', 'evidence'), 'TSK-900');
    expect(newest).toEqual({ result: 'FAIL', evidence: 'AEG-EVD-TSK-900_20261013T090000Z.md' });
  });

  it('AEG-TST-017 a requirement is pending unless every gate passes', () => {
    const root = makeRoot();
    evidence(root, 'TSK-900', '20261013T080000Z', 'PASS');
    const two: TraceMap = { 'AEG-REQ-901': { implementation: [], tests: [], gateTasks: ['TSK-900', 'TSK-901'] } };
    expect(buildRows(two, join(root, 'records', 'evidence'))[0]?.status).toBe('pending');
    const none: TraceMap = { 'AEG-REQ-902': { implementation: [], tests: [], gateTasks: [] } };
    expect(buildRows(none, join(root, 'records', 'evidence'))[0]?.status).toBe('pending');
  });

  it('AEG-TST-017 an unknown file or gate in the map is reported (the tool exits 1)', () => {
    const root = makeRoot();
    const bad: TraceMap = { 'AEG-REQ-903': { implementation: ['src/nope.ts'], tests: [], gateTasks: ['TSK-777'] } };
    const problems = validateMap(bad, root, ['TSK-900']);
    expect(problems).toEqual(['AEG-REQ-903: unknown file src/nope.ts', 'AEG-REQ-903: unknown gate TSK-777']);
  });

  it('AEG-TST-017 the report lists the honest limitations', () => {
    const report = renderReport([]);
    expect(report).toContain('Stub providers are not live');
    expect(report).toContain('not a Merkle proof');
    expect(report).toContain('not an accessibility audit');
  });
  it('AEG-TST-017 run returns exit code 1 when the map names an unknown file', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'tools'));
    writeFileSync(join(root, 'tools', 'gates.json'), JSON.stringify({ 'TSK-900': {} }));
    writeFileSync(join(root, 'tools', 'trace-map.json'), JSON.stringify({ 'AEG-REQ-904': { implementation: ['src/nope.ts'], tests: [], gateTasks: ['TSK-900'] } }));
    expect(run(root)).toBe(1);
    writeFileSync(join(root, 'tools', 'trace-map.json'), JSON.stringify({ 'AEG-REQ-904': { implementation: [], tests: [], gateTasks: ['TSK-900'] } }));
    expect(run(root)).toBe(0);
  });
});
