// Measures the decision-table prover AT the proposed budget of 1,000,000 cells (AEG-PLN-001 / S0007 B6), not by extrapolation.
// Run: node --import tsx research/engineer/bench-partition-limit.ts
// Two shapes: "clean" (no overlaps, the cheap case) and "all ambiguous" (every cell is an unresolved tie, the expensive case that
// records a witness for every cell). Each is run three times; elapsed time and the peak heap growth are reported. Single machine.
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { interval, prove, type Table } from './decisiontable.js';

const build = (fields: number, breakpoints: number, allAmbiguous: boolean): Table => {
  const rules: Table['rules'] = Array.from({ length: fields * breakpoints }, (_, r) => ({
    id: `R${r}`, priority: 1, outcome: 'X', when: [interval(`f${r % fields}`, String(r), true, String(r + 1), false)],
  }));
  if (allAmbiguous) {
    // two catch-all rules with different outcomes and equal priority: every cell matches both, so every cell is an ambiguity
    rules.push({ id: 'ALL_A', priority: 1, outcome: 'A', when: [interval('f0', '-1000000', true, '1000000', false)] });
    rules.push({ id: 'ALL_B', priority: 1, outcome: 'B', when: [interval('f0', '-1000000', true, '1000000', false)] });
  }
  return { id: 'bench-limit', defaultOutcome: 'UNKNOWN', fields: Array.from({ length: fields }, (_, i) => ({ name: `f${i}`, type: 'numeric' as const })), rules };
};

const out: Record<string, unknown> = { node: process.version, platform: process.platform, cpu: process.arch, when: new Date().toISOString(), runs: [] };
for (const [label, fields, breakpoints, allAmbiguous] of [
  // cells = (4n + 1)^fields, because each rule adds two breakpoints: 997^2 = 994,009; 97^3 = 912,673; 29^4 = 707,281
  ['clean, 2 fields', 2, 249, false], ['clean, 3 fields', 3, 24, false], ['clean, 4 fields', 4, 7, false],
  ['all ambiguous, 2 fields', 2, 249, true], ['all ambiguous, 3 fields', 3, 24, true], ['all ambiguous, 4 fields', 4, 7, true],
] as const) {
  for (let run = 1; run <= 3; run += 1) {
    const table = build(fields, breakpoints, allAmbiguous);
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const analysis = prove(table, 1_000_000);
    const ms = Math.round(performance.now() - t0);
    const heapMb = Math.round((process.memoryUsage().heapUsed - heapBefore) / 1e6);
    (out.runs as unknown[]).push({ label, run, cells: analysis.cells, status: analysis.status, analysisComplete: analysis.analysisComplete, ms, heapGrowthMb: heapMb, ambiguities: analysis.ambiguities.length, gaps: analysis.gaps.length });
  }
}
const file = fileURLToPath(new URL('./bench-partition-limit.json', import.meta.url));
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
