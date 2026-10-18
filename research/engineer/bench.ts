// Measured budgets for the proofs of concept. Run: node --import tsx research/engineer/bench.ts
// It measures; it does not decide. The proposed limits in AEG-ADR-006 cite these numbers. Results depend on the machine; they are recorded with versions.
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { canonicalize } from '../../src/engine/canonical.js';
import { chainState, installLifecycle, parseInstant, transition, type Trust } from './lifecycle.js';
import { add, make, mul } from './rational.js';
import { validateGraph, type Graph, type GraphNode } from './graph.js';
import { interval, prove, type Table } from './decisiontable.js';

const migrations = fileURLToPath(new URL('../../migrations/', import.meta.url));
const T0 = '2026-10-13T00:00:00Z';
const time = <T,>(work: () => T): { ms: number; value: T } => { const start = performance.now(); const value = work(); return { ms: Math.round((performance.now() - start) * 100) / 100, value }; };
const results: Record<string, unknown> = { node: process.version, platform: process.platform, cpu: process.arch, when: new Date().toISOString() };

// 1. Lifecycle chain verification: a full walk happens on EVERY authorization, so its cost per event count matters.
{
  const bindings = { dependencyHash: 'd'.repeat(64), implementationHash: 'b'.repeat(64) };
  const trust: Trust = { clock: () => parseInstant(T0), resolveBindings: () => bindings, authority: () => true };
  const db = openDb(':memory:');
  migrate(db, migrations, T0);
  installLifecycle(db);
  const definition = canonicalize({ formulationId: 'F', semanticVersion: '1.0.0', title: 't', inputSchema: {}, outputSchema: {}, units: [], assumptions: [], preconditions: [], deterministicAlgorithmRef: 'r', algorithmHash: 'a'.repeat(64), roundingPolicy: 'x', examples: [], invalidCases: [], owner: 'o', status: 'candidate', effectiveFrom: T0 });
  const rows: Record<string, number> = {};
  const marks = [100, 500, 1000, 2000, 4000];
  let written = 0;
  const startedAt = performance.now();
  let index = 0;
  while (written < marks[marks.length - 1]!) {
    const id = `F${index}`;
    index += 1;
    db.prepare('INSERT INTO formulation_registry (formulation_id, version, state, algorithm_hash, spec_json, effective_from) VALUES (?, ?, ?, ?, ?, ?)').run(id, '1.0.0', 'candidate', 'a'.repeat(64), definition, T0);
    transition(db, { formulationId: id, version: '1.0.0', action: 'advance', approver: 'astra', evidenceRef: 'r' }, trust);
    transition(db, { formulationId: id, version: '1.0.0', action: 'suspend', approver: 'astra', evidenceRef: 'r' }, trust);
    written += 2;
    if (marks.includes(written)) { rows[String(written)] = time(() => chainState(db)).ms; rows[`elapsed to write ${written} events (each write verifies the whole chain)`] = Math.round(performance.now() - startedAt); }
  }
  results.chainVerifyMsByEvents = rows;
}

// 2. Exact rational arithmetic by operand size (operations per millisecond, 5,000 operations each).
{
  const sizes = [10, 40, 120];
  const out: Record<string, Record<string, number>> = {};
  for (const digits of sizes) {
    const a = make(BigInt('7'.repeat(digits)), BigInt(`${'3'.repeat(digits - 1)}1`));
    const b = make(BigInt('9'.repeat(digits)), BigInt(`${'1'.repeat(Math.max(1, digits - 1))}7`));
    const addMs = time(() => { for (let i = 0; i < 5000; i += 1) { try { add(a, b); } catch { /* size bound */ } } }).ms;
    const mulMs = time(() => { for (let i = 0; i < 5000; i += 1) { try { mul(a, b); } catch { /* size bound */ } } }).ms;
    out[String(digits)] = { addOpsPerMs: Math.round((5000 / Math.max(addMs, 0.01)) * 10) / 10, mulOpsPerMs: Math.round((5000 / Math.max(mulMs, 0.01)) * 10) / 10 };
  }
  results.rationalOpsPerMsByDigits = out;
  results.makeOpsPerMsSmall = Math.round(5000 / Math.max(time(() => { for (let i = 0; i < 5000; i += 1) make(BigInt(i + 1), 7n); }).ms, 0.01));
}

// 3. Graph validation by node count (a chain with one extra fan-in edge per node).
{
  const out: Record<string, number> = {};
  for (const n of [10, 100, 500, 1000, 5000]) {
    const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({
      nodeId: `n${i}`, formulationId: 'F', version: '1.0.0', kind: 'arithmetic', inputs: { x: { dimension: 'volume', required: i > 0 }, y: { dimension: 'volume', required: false } },
      outputs: { v: 'volume' }, definitionHash: 'a'.repeat(64), implementationHash: 'b'.repeat(64),
    }));
    const edges = nodes.flatMap((node, i) => (i === 0 ? [] : [{ from: `n${i - 1}`, output: 'v', to: node.nodeId, input: 'x', dimension: 'volume' }, ...(i > 1 ? [{ from: `n${i - 2}`, output: 'v', to: node.nodeId, input: 'y', dimension: 'volume' }] : [])]));
    const graph: Graph = { graphId: 'bench', nodes, edges };
    const { ms, value } = time(() => validateGraph(graph));
    if (!value.ok) throw new Error(`bench graph invalid: ${value.errors[0]}`);
    out[`${n} nodes / ${edges.length} edges`] = ms;
  }
  results.graphValidateMs = out;
}

// 4. Decision-table partition enumeration: cells per second and time for a given number of cells.
{
  const build = (fields: number, breakpoints: number): Table => ({
    id: 'bench', defaultOutcome: 'UNKNOWN',
    fields: Array.from({ length: fields }, (_, i) => ({ name: `f${i}`, type: 'numeric' as const })),
    rules: Array.from({ length: fields * breakpoints }, (_, r) => ({ id: `R${r}`, priority: 1, outcome: 'X', when: [interval(`f${r % fields}`, String(r), true, String(r + 1), false)] })),
  });
  const out: Record<string, number> = {};
  for (const [fields, breakpoints] of [[2, 5], [3, 6], [4, 5], [4, 7]] as const) {
    const table = build(fields, breakpoints);
    const { ms, value } = time(() => prove(table, 5_000_000));
    out[`${value.cells} cells (${fields} fields)`] = ms;
  }
  results.partitionMs = out;
}

const text = JSON.stringify(results, null, 2);
writeFileSync(fileURLToPath(new URL('./bench-results.json', import.meta.url)), text + '\n');
console.log(text);
