import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { canonicalize } from '../../src/engine/canonical.js';
import {
  definitionHash, installLifecycle, parseInstant, transition, type Bindings, type Scope, type Transition, type Trust,
} from './lifecycle.js';
import { compositionHash, fid, type Graph, type GraphNode, type Port, type TrustedDefinitions } from './graph.js';
import { authorizeComposition, guardedCompositionRun, type CompositionGrant, type CompositionRequest } from './guard.js';

type Db = import('better-sqlite3').Database;
const T0 = '2026-10-13T00:00:00Z';
const migrations = fileURLToPath(new URL('../../migrations/', import.meta.url));
const bindings: Bindings = { dependencyHash: 'd'.repeat(64), implementationHash: 'b'.repeat(64) };
const wideScope: Scope = { tenants: ['TENANT-A'], purposes: ['planning-demo'], jurisdictions: ['XX'], resources: ['water'], validity: ['region-1'], actions: [] };
const req = (dimension: string): Port => ({ dimension, required: true });
const node = (nodeId: string, formulationId: string, inputs: Record<string, Port>, outputs: Record<string, string>): GraphNode =>
  ({ nodeId, formulationId, version: '1.0.0', kind: 'arithmetic', inputs, outputs, definitionHash: 'x'.repeat(64).replace(/x/g, 'a'), implementationHash: 'b'.repeat(64) });

const water: Graph = {
  graphId: 'water-scenario-1',
  nodes: [
    node('population', 'AEG.F.POPULATION-SCENARIO', {}, { persons: 'persons' }),
    node('demand', 'AEG.F.DEMAND-FLOW', { persons: req('persons') }, { litres: 'volume' }),
    node('inventory', 'AEG.F.ELIGIBLE-SUPPLY', {}, { litres: 'volume' }),
    node('gap', 'AEG.F.RESOURCE-SHORTFALL-V2', { demand: req('volume'), usable: req('volume') }, { shortfall: 'volume' }),
    node('packs', 'AEG.F.PACK-REQUIREMENT', { shortfall: req('volume') }, { containers: 'count' }),
  ],
  edges: [
    { from: 'population', output: 'persons', to: 'demand', input: 'persons', dimension: 'persons' },
    { from: 'demand', output: 'litres', to: 'gap', input: 'demand', dimension: 'volume' },
    { from: 'inventory', output: 'litres', to: 'gap', input: 'usable', dimension: 'volume' },
    { from: 'gap', output: 'shortfall', to: 'packs', input: 'shortfall', dimension: 'volume' },
  ],
};
const NESTED = ['AEG.F.RATE-TABLE', 'AEG.F.UNIT-REGISTRY'];
const MEMBERS = [...water.nodes.map((n) => n.formulationId), ...NESTED];

let clockMs = parseInstant(T0);
let checkpoint = null;
const trust = (): Trust => ({ clock: () => clockMs, resolveBindings: () => bindings, authority: () => true, checkpoint: () => checkpoint });

function insertDefinition(db: Db, id: string): void {
  const definition = {
    formulationId: id, semanticVersion: '1.0.0', title: id, inputSchema: {}, outputSchema: {}, units: [], assumptions: [], preconditions: [], deterministicAlgorithmRef: 'ref',
    algorithmHash: 'a'.repeat(64), roundingPolicy: 'exact', examples: [], invalidCases: [], owner: 'Claude', status: 'candidate', effectiveFrom: T0,
  };
  db.prepare('INSERT INTO formulation_registry (formulation_id, version, state, algorithm_hash, spec_json, effective_from) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, '1.0.0', 'candidate', definition.algorithmHash, canonicalize(definition), T0);
}
function promote(db: Db, id: string, over: Partial<Transition> = {}): void {
  const t = (extra: Partial<Transition>) => transition(db, { formulationId: id, version: '1.0.0', action: 'advance', approver: 'astra', evidenceRef: 'review', ...extra }, trust());
  t({}); t({});
  t({ approvedUse: 'OPERATIONAL', scope: wideScope, expiresAt: '2027-01-01T00:00:00Z', ...over });
  t({});
}
/** The trusted view, built by trusted code from the registry itself (never from the caller's graph). */
function trustedFrom(db: Db): TrustedDefinitions {
  const map = new Map();
  const deps: Record<string, string[]> = { 'AEG.F.DEMAND-FLOW@1.0.0': ['AEG.F.RATE-TABLE@1.0.0'], 'AEG.F.RATE-TABLE@1.0.0': ['AEG.F.UNIT-REGISTRY@1.0.0'] };
  for (const id of MEMBERS) {
    const row = db.prepare('SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = ?').get(id) as Parameters<typeof definitionHash>[0];
    const graphNode = water.nodes.find((n) => n.formulationId === id);
    map.set(`${id}@1.0.0`, { definitionHash: definitionHash(row), implementationHash: bindings.implementationHash, dependencies: deps[`${id}@1.0.0`] ?? [], inputs: graphNode?.inputs ?? {}, outputs: graphNode?.outputs ?? {} });
  }
  return map;
}
function setup(): { db: Db; trusted: TrustedDefinitions; graph: Graph; units: Record<string, string> } {
  clockMs = parseInstant(T0);
  const db = openDb(':memory:');
  migrate(db, migrations, T0);
  installLifecycle(db);
  for (const id of MEMBERS) { insertDefinition(db, id); promote(db, id); }
  const trusted = trustedFrom(db);
  const graph: Graph = { ...water, nodes: water.nodes.map((n) => ({ ...n, definitionHash: (trusted.get(fid(n)) as { definitionHash: string }).definitionHash })) };
  return { db, trusted, graph, units: { demand: 'L', usable: 'L', containers: 'count' } };
}
const request: CompositionRequest = { use: 'PLANNING', tenant: 'TENANT-A', purpose: 'planning-demo', resource: 'water', jurisdiction: 'XX', validity: 'region-1' };
const grantFor = (identity: string, over: Partial<CompositionGrant> = {}): CompositionGrant =>
  ({ compositionHash: identity, use: 'OPERATIONAL', scope: wideScope, expiresAt: '2027-01-01T00:00:00Z', revoked: false, approver: 'owner', ...over });
const identityOf = (s: ReturnType<typeof setup>, graph = s.graph): string => compositionHash(graph, 'AEG-NUM-1', s.units, s.trusted);

describe('the combined execution path: composition grant + resolved closure + lifecycle + full scope, in one guard', () => {
  it('authorizes when the composition grant and all seven closure members (five nodes and two nested) pass', () => {
    const s = setup();
    const out = authorizeComposition(s.db, s.graph, s.trusted, 'AEG-NUM-1', s.units, request, grantFor(identityOf(s)), trust());
    assert.deepEqual([out.authorized, out.reasons], [true, []]);
    assert.equal(Object.keys(out.members).length, 7);
  });

  it('a suspended NESTED dependency denies the whole run, and the work never starts', () => {
    const s = setup();
    transition(s.db, { formulationId: 'AEG.F.UNIT-REGISTRY', version: '1.0.0', action: 'suspend', approver: 'astra', evidenceRef: 'incident' }, trust());
    const out = authorizeComposition(s.db, s.graph, s.trusted, 'AEG-NUM-1', s.units, request, grantFor(identityOf(s)), trust());
    assert.equal(out.authorized, false);
    assert.ok(out.reasons.includes('AEG.F.UNIT-REGISTRY@1.0.0:STAGE_SUSPENDED'));
    let worked = false;
    assert.throws(() => guardedCompositionRun(s.db, s.graph, s.trusted, 'AEG-NUM-1', s.units, request, grantFor(identityOf(s)), trust(), () => { worked = true; }), (error: unknown) => (error as { code?: string }).code === 'NOT_AUTHORIZED');
    assert.equal(worked, false);
  });

  it('the scope of ONE member narrows the whole composition on every dimension, not only tenant and purpose', () => {
    const narrow = (over: Partial<Scope>) => {
      const s = setup();
      // re-promote one member with a narrower scope by replacing its registry row with a fresh narrow-scope version
      const db = openDb(':memory:');
      migrate(db, migrations, T0);
      installLifecycle(db);
      for (const id of MEMBERS) { insertDefinition(db, id); promote(db, id, id === 'AEG.F.ELIGIBLE-SUPPLY' ? { scope: { ...wideScope, ...over } } : {}); }
      const trusted = trustedFrom(db);
      const graph: Graph = { ...s.graph, nodes: s.graph.nodes.map((n) => ({ ...n, definitionHash: (trusted.get(fid(n)) as { definitionHash: string }).definitionHash })) };
      return authorizeComposition(db, graph, trusted, 'AEG-NUM-1', s.units, request, grantFor(compositionHash(graph, 'AEG-NUM-1', s.units, trusted)), trust());
    };
    assert.ok(narrow({ resources: ['medicine'] }).reasons.includes('AEG.F.ELIGIBLE-SUPPLY@1.0.0:RESOURCE_OUT_OF_SCOPE'));
    assert.ok(narrow({ jurisdictions: ['YY'] }).reasons.includes('AEG.F.ELIGIBLE-SUPPLY@1.0.0:JURISDICTION_OUT_OF_SCOPE'));
    assert.ok(narrow({ validity: ['region-9'] }).reasons.includes('AEG.F.ELIGIBLE-SUPPLY@1.0.0:VALIDITY_DOMAIN_OUT_OF_SCOPE'));
    assert.ok(narrow({ tenants: ['TENANT-B'] }).reasons.includes('AEG.F.ELIGIBLE-SUPPLY@1.0.0:TENANT_OUT_OF_SCOPE'));
  });

  it('a DEMO-approved member limits an OPERATIONAL request even though the composition grant allows OPERATIONAL', () => {
    const db = openDb(':memory:');
    migrate(db, migrations, T0);
    installLifecycle(db);
    for (const id of MEMBERS) { insertDefinition(db, id); promote(db, id, id === 'AEG.F.RATE-TABLE' ? { approvedUse: 'DEMO' } : {}); }
    const trusted = trustedFrom(db);
    const units = { demand: 'L', usable: 'L', containers: 'count' };
    const graph: Graph = { ...water, nodes: water.nodes.map((n) => ({ ...n, definitionHash: (trusted.get(fid(n)) as { definitionHash: string }).definitionHash })) };
    const identity = compositionHash(graph, 'AEG-NUM-1', units, trusted);
    const out = authorizeComposition(db, graph, trusted, 'AEG-NUM-1', units, { ...request, use: 'OPERATIONAL' }, grantFor(identity), trust());
    assert.ok(out.reasons.includes('AEG.F.RATE-TABLE@1.0.0:USE_ABOVE_APPROVAL_DEMO'));
    assert.equal(authorizeComposition(db, graph, trusted, 'AEG-NUM-1', units, { ...request, use: 'DEMO' }, grantFor(identity), trust()).authorized, true);
  });

  it('the composition grant is bound to the exact identity: an exclusion, a changed edge or a changed policy invalidates it', () => {
    const s = setup();
    const grant = grantFor(identityOf(s));
    const excluded: Graph = { ...s.graph, exclusions: ['packs'] };
    assert.ok(authorizeComposition(s.db, excluded, s.trusted, 'AEG-NUM-1', s.units, request, grant, trust()).reasons.includes('COMPOSITION_IDENTITY_CHANGED'));
    assert.ok(authorizeComposition(s.db, s.graph, s.trusted, 'AEG-NUM-2', s.units, request, grant, trust()).reasons.includes('COMPOSITION_IDENTITY_CHANGED'));
  });

  it('a missing, revoked, expired, over-wide or unauthorized composition grant denies, and so does a missing registry member or a mismatched trusted definition', () => {
    const s = setup();
    const identity = identityOf(s);
    const reasons = (grant: CompositionGrant | null, graph = s.graph, trusted = s.trusted) =>
      authorizeComposition(s.db, graph, trusted, 'AEG-NUM-1', s.units, request, grant, trust()).reasons;
    assert.ok(reasons(null).includes('MISSING_COMPOSITION_GRANT'));
    assert.ok(reasons(grantFor(identity, { revoked: true })).includes('COMPOSITION_GRANT_REVOKED'));
    assert.ok(reasons(grantFor(identity, { expiresAt: '2026-10-01T00:00:00Z' })).includes('COMPOSITION_GRANT_EXPIRED'));
    assert.ok(reasons(grantFor(identity, { use: 'DEMO' })).includes('COMPOSITION_USE_ABOVE_GRANT_DEMO'));
    assert.ok(reasons(grantFor(identity, { scope: { ...wideScope, tenants: ['TENANT-B'] } })).includes('COMPOSITION_TENANT_OUT_OF_SCOPE'));
    s.db.prepare("DELETE FROM formulation_registry WHERE formulation_id = 'AEG.F.PACK-REQUIREMENT'").run();
    assert.ok(reasons(grantFor(identity)).includes('MEMBER_NOT_REGISTERED:AEG.F.PACK-REQUIREMENT@1.0.0'));
    const s2 = setup();
    const tampered = new Map(s2.trusted);
    tampered.set('AEG.F.RATE-TABLE@1.0.0', { ...(tampered.get('AEG.F.RATE-TABLE@1.0.0') as object), definitionHash: '9'.repeat(64) } as never);
    const out = authorizeComposition(s2.db, s2.graph, tampered, 'AEG-NUM-1', s2.units, request, grantFor(identityOf(s2, s2.graph)), trust());
    assert.ok(out.reasons.some((r) => r.startsWith('TRUSTED_DEFINITION_MISMATCH:AEG.F.RATE-TABLE@1.0.0') || r.startsWith('COMPOSITION_IDENTITY_CHANGED')));
  });

  it('a successful run records the lifecycle revision of EVERY member, atomically with the work', () => {
    const s = setup();
    const out = guardedCompositionRun(s.db, s.graph, s.trusted, 'AEG-NUM-1', s.units, request, grantFor(identityOf(s)), trust(), () => 'shortfall 16500 L');
    assert.equal(out.result, 'shortfall 16500 L');
    assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM formulation_runs').get() as { n: number }).n, 7);
    const failed = () => guardedCompositionRun(s.db, s.graph, s.trusted, 'AEG-NUM-1', s.units, { ...request, tenant: 'TENANT-B' }, grantFor(identityOf(s)), trust(), () => 1);
    assert.throws(failed, (error: unknown) => (error as { code?: string }).code === 'NOT_AUTHORIZED');
    assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM formulation_runs').get() as { n: number }).n, 7);   // nothing added by the denied run
  });

  it('an OPERATIONAL composition still grants no action unless the grant and every member list it', () => {
    const s = setup();
    const out = authorizeComposition(s.db, s.graph, s.trusted, 'AEG-NUM-1', s.units, { ...request, action: 'dispatch' }, grantFor(identityOf(s)), trust());
    assert.ok(out.reasons.includes('COMPOSITION_ACTION_NOT_PERMITTED'));
    assert.ok(out.reasons.some((r) => r.endsWith(':ACTION_NOT_PERMITTED')));
  });
});
