import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate, canExecute, combine, compositionHash, dependencyClosure, effectivePermission, fid, ord, validateGraph, validId,
  type Graph, type GraphNode, type Grant, type InputState, type Port, type Status, type TrustedDefinition, type TrustedDefinitions, type UseRequest,
} from './graph.js';
import { format, make, mul, normalizeExternal } from './rational.js';

const hash = (c: string): string => c.repeat(64);
const req = (dimension: string): Port => ({ dimension, required: true });
const node = (nodeId: string, formulationId: string, inputs: Record<string, Port>, outputs: Record<string, string>): GraphNode =>
  ({ nodeId, formulationId, version: '1.0.0', kind: 'arithmetic', inputs, outputs, definitionHash: hash('a'), implementationHash: hash('b') });

// C1: node identity is a unique nodeId; population feeds demand; inventory feeds eligible-supply; BOTH demand and supply feed the shortfall.
const water: Graph = {
  graphId: 'water-scenario-1',
  nodes: [
    node('population', 'AEG.F.POPULATION-SCENARIO', {}, { persons: 'persons' }),
    node('demand', 'AEG.F.DEMAND-FLOW', { persons: req('persons') }, { litres: 'volume' }),
    node('inventory', 'AEG.F.ELIGIBLE-SUPPLY', {}, { litres: 'volume' }),
    node('gap', 'AEG.F.RESOURCE-SHORTFALL', { demand: req('volume'), usable: req('volume') }, { shortfall: 'volume' }),
    node('packs', 'AEG.F.PACK-REQUIREMENT', { shortfall: req('volume') }, { containers: 'count' }),
  ],
  edges: [
    { from: 'population', output: 'persons', to: 'demand', input: 'persons', dimension: 'persons' },
    { from: 'demand', output: 'litres', to: 'gap', input: 'demand', dimension: 'volume' },
    { from: 'inventory', output: 'litres', to: 'gap', input: 'usable', dimension: 'volume' },
    { from: 'gap', output: 'shortfall', to: 'packs', input: 'shortfall', dimension: 'volume' },
  ],
};

/** The trusted registry's view, with a NESTED dependency (the demand formulation depends on a rate table, which depends on a unit registry). */
function trustedFor(graph: Graph, extra: Record<string, Partial<TrustedDefinition>> = {}): TrustedDefinitions {
  const map = new Map<string, TrustedDefinition>();
  for (const n of graph.nodes) {
    map.set(fid(n), { definitionHash: n.definitionHash, implementationHash: n.implementationHash, dependencies: [], inputs: n.inputs, outputs: n.outputs, ...(extra[fid(n)] ?? {}) });
  }
  map.set('AEG.F.RATE-TABLE@1.0.0', { definitionHash: hash('c'), implementationHash: hash('d'), dependencies: ['AEG.F.UNIT-REGISTRY@1.0.0'], inputs: {}, outputs: {}, ...(extra['AEG.F.RATE-TABLE@1.0.0'] ?? {}) });
  map.set('AEG.F.UNIT-REGISTRY@1.0.0', { definitionHash: hash('e'), implementationHash: hash('f'), dependencies: [], inputs: {}, outputs: {}, ...(extra['AEG.F.UNIT-REGISTRY@1.0.0'] ?? {}) });
  return map;
}
const waterTrusted = (extra: Record<string, Partial<TrustedDefinition>> = {}): TrustedDefinitions =>
  trustedFor(water, { 'AEG.F.DEMAND-FLOW@1.0.0': { dependencies: ['AEG.F.RATE-TABLE@1.0.0'] }, ...extra });

describe('C1: typed graph with unique node identity', () => {
  it('validates the corrected water graph: inventory is independent of demand, and both feed the shortfall', () => {
    const check = validateGraph(water, waterTrusted());
    assert.deepEqual(check.errors, []);
    const position = (id: string): number => check.order.indexOf(id);
    assert.ok(position('population') < position('demand') && position('demand') < position('gap') && position('inventory') < position('gap') && position('gap') < position('packs'));
    assert.ok(!water.edges.some((edge) => edge.from === 'demand' && edge.to === 'inventory'));
  });

  it('allows the same formulation twice under different node ids, and rejects a duplicate node id', () => {
    const twice: Graph = { ...water, nodes: [...water.nodes, node('demand_shelter', 'AEG.F.DEMAND-FLOW', { persons: { dimension: 'persons', required: false } }, { litres: 'volume' })] };
    const second = validateGraph({ ...twice, nodes: twice.nodes.map((n) => (n.nodeId === 'demand_shelter' ? { ...n, inputs: { persons: req('persons') } } : n)),
      edges: [...twice.edges, { from: 'population', output: 'persons', to: 'demand_shelter', input: 'persons', dimension: 'persons' }] });
    assert.deepEqual(second.errors, []);
    assert.ok(validateGraph({ ...water, nodes: [...water.nodes, node('demand', 'AEG.F.DEMAND-SPACE', {}, {})] }).errors.some((error) => error.startsWith('DUPLICATE_NODE_ID')));
  });

  it('rejects a cycle, a missing node, a missing output and a dimension mismatch', () => {
    const pureCycle: Graph = { graphId: 'c', nodes: [node('a', 'F', { x: req('volume') }, { y: 'volume' }), node('b', 'F', { x: req('volume') }, { y: 'volume' })], edges: [
      { from: 'a', output: 'y', to: 'b', input: 'x', dimension: 'volume' }, { from: 'b', output: 'y', to: 'a', input: 'x', dimension: 'volume' }] };
    assert.ok(validateGraph(pureCycle).errors.includes('CYCLE'));
    assert.ok(validateGraph({ ...water, edges: [{ from: 'ghost', output: 'x', to: 'demand', input: 'persons', dimension: 'persons' }] }).errors.some((e) => e.startsWith('EDGE_TARGET_MISSING')));
    assert.ok(validateGraph({ ...water, edges: [...water.edges.slice(0, 1), { from: 'demand', output: 'nothing', to: 'gap', input: 'demand', dimension: 'volume' }] }).errors.some((e) => e.startsWith('NO_SUCH_OUTPUT')));
    assert.ok(validateGraph({ ...water, edges: [...water.edges, { from: 'inventory', output: 'litres', to: 'packs', input: 'shortfall', dimension: 'mass' }] }).errors.some((e) => e.startsWith('DIMENSION_MISMATCH')));
  });
});

describe('R4: every required input has exactly one binding, and nothing is bound twice', () => {
  it('Astra\'s probe: a node with a required input and no binding is rejected before scheduling', () => {
    const lonely: Graph = { graphId: 'review', nodes: [node('n', 'AEG.F.REVIEW', { required: req('volume') }, { value: 'volume' })], edges: [] };
    const result = validateGraph(lonely);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, ['UNBOUND_REQUIRED_INPUT n.required']);
  });

  it('an explicit constant or external input satisfies a required port; an optional port may stay unbound', () => {
    const bound: Graph = { graphId: 'review', nodes: [node('n', 'F', { a: req('volume'), b: { dimension: 'volume', required: false } }, { v: 'volume' })], edges: [],
      bindings: [{ nodeId: 'n', input: 'a', source: 'external', dimension: 'volume', ref: 'stock-snapshot-1' }] };
    assert.deepEqual(validateGraph(bound).errors, []);
    assert.ok(validateGraph({ ...bound, bindings: [{ nodeId: 'n', input: 'a', source: 'constant', dimension: 'mass', ref: 'k' }] }).errors.some((e) => e.startsWith('DIMENSION_MISMATCH')));
    assert.ok(validateGraph({ ...bound, bindings: [{ nodeId: 'n', input: 'zz', source: 'constant', dimension: 'volume', ref: 'k' }] }).errors.some((e) => e.startsWith('BINDING_TARGET_MISSING')));
  });

  it('multiple writers to one port (two edges, or an edge and an external binding) are rejected', () => {
    const doubled: Graph = { ...water, edges: [...water.edges, { from: 'inventory', output: 'litres', to: 'gap', input: 'demand', dimension: 'volume' }] };
    assert.ok(validateGraph(doubled).errors.includes('MULTIPLE_WRITERS gap.demand'));
    const mixed: Graph = { ...water, bindings: [{ nodeId: 'gap', input: 'demand', source: 'external', dimension: 'volume', ref: 'x' }] };
    assert.ok(validateGraph(mixed).errors.includes('MULTIPLE_WRITERS gap.demand'));
  });

  it('nested resolution is checked against the TRUSTED definitions: unknown formulations, hash and port mismatches are rejected', () => {
    assert.ok(validateGraph(water, new Map()).errors.some((e) => e.startsWith('UNTRUSTED_DEFINITION')));
    assert.ok(validateGraph(water, waterTrusted({ 'AEG.F.RESOURCE-SHORTFALL@1.0.0': { definitionHash: hash('9') } })).errors.includes('HASH_MISMATCH gap'));
    assert.ok(validateGraph(water, waterTrusted({ 'AEG.F.RESOURCE-SHORTFALL@1.0.0': { inputs: { demand: req('volume') } } })).errors.includes('PORT_MISMATCH gap'));
    assert.ok(validateGraph(water, waterTrusted({ 'AEG.F.RESOURCE-SHORTFALL@1.0.0': { inputs: { demand: req('volume'), usable: { dimension: 'volume', required: false } } } })).errors.includes('PORT_MISMATCH gap'));
  });

  it('identifiers outside the ASCII policy are rejected, not folded', () => {
    assert.equal(validId('AEG.F.DEMAND-FLOW@1.0.0'), true);
    for (const bad of ['', 'a b', 'é', 'a/b', 'x'.repeat(129), 'a\u0000b']) assert.equal(validId(bad), false, JSON.stringify(bad));
    assert.ok(validateGraph({ ...water, nodes: water.nodes.map((n) => (n.nodeId === 'demand' ? { ...n, nodeId: 'dém' } : n)) }).errors.some((e) => e.startsWith('BAD_IDENTIFIER')));
  });
});

describe('R3: authority cannot change without the composition identity changing', () => {
  const units = { demand: 'L', usable: 'L', containers: 'count' };
  it('Astra\'s probe: excluding a dependency changes the identity, because the exclusion policy and the resolved closure are bound into the envelope', () => {
    const trusted = waterTrusted();
    const base = compositionHash(water, 'AEG-NUM-1', units, trusted);
    const withExclusion: Graph = { ...water, exclusions: ['packs'] };                 // packs feeds nothing else, so excluding it is legal
    assert.deepEqual(validateGraph(withExclusion, trusted).errors, []);
    assert.notEqual(base, compositionHash(withExclusion, 'AEG-NUM-1', units, trusted));
  });

  it('an exclusion that removes a data-producing dependency of an executing node is rejected', () => {
    const bad: Graph = { ...water, exclusions: ['inventory'] };                      // inventory feeds the shortfall, which still runs
    assert.ok(validateGraph(bad, waterTrusted()).errors.includes('EXCLUSION_REMOVES_DEPENDENCY inventory feeds gap'));
    assert.ok(validateGraph({ ...water, exclusions: ['ghost'] }, waterTrusted()).errors.includes('EXCLUSION_UNKNOWN_NODE ghost'));
  });

  it('the closure includes NESTED dependencies taken from trusted definitions, and a caller cannot hide one', () => {
    const { closure, errors } = dependencyClosure(water, waterTrusted());
    assert.deepEqual(errors, []);
    assert.ok(closure.includes('AEG.F.RATE-TABLE@1.0.0') && closure.includes('AEG.F.UNIT-REGISTRY@1.0.0'));
    assert.equal(closure.length, 7);                                                 // five nodes plus two nested
    const excludedPacks = dependencyClosure({ ...water, exclusions: ['packs'] }, waterTrusted());
    assert.ok(!excludedPacks.closure.includes('AEG.F.PACK-REQUIREMENT@1.0.0'));
    assert.ok(dependencyClosure(water, waterTrusted({ 'AEG.F.UNIT-REGISTRY@1.0.0': { dependencies: ['AEG.F.RATE-TABLE@1.0.0'] } })).errors.some((e) => e.startsWith('DEPENDENCY_CYCLE')));
    assert.ok(dependencyClosure(water, new Map()).errors.some((e) => e.startsWith('UNTRUSTED_DEFINITION')));
  });

  it('a change deep in the nested closure changes the identity', () => {
    const base = compositionHash(water, 'AEG-NUM-1', units, waterTrusted());
    assert.notEqual(base, compositionHash(water, 'AEG-NUM-1', units, waterTrusted({ 'AEG.F.UNIT-REGISTRY@1.0.0': { definitionHash: hash('9') } })));
  });

  it('is stable for equivalent inputs and changes with any version, numeric policy, unit, binding or definition', () => {
    const trusted = waterTrusted();
    const base = compositionHash(water, 'AEG-NUM-1', units, trusted);
    assert.equal(base, compositionHash({ ...water, nodes: [...water.nodes].reverse(), edges: [...water.edges].reverse() }, 'AEG-NUM-1', units, trusted));
    assert.notEqual(base, compositionHash(water, 'AEG-NUM-2', units, trusted));
    assert.notEqual(base, compositionHash(water, 'AEG-NUM-1', { ...units, demand: 'mL' }, trusted));
    const withBinding: Graph = { ...water, nodes: water.nodes.map((n) => (n.nodeId === 'inventory' ? { ...n, inputs: { stock: { dimension: 'volume', required: false } } } : n)),
      bindings: [{ nodeId: 'inventory', input: 'stock', source: 'external', dimension: 'volume', ref: 'snapshot-1' }] };
    assert.notEqual(base, compositionHash(withBinding, 'AEG-NUM-1', units, trustedFor(withBinding, { 'AEG.F.DEMAND-FLOW@1.0.0': { dependencies: ['AEG.F.RATE-TABLE@1.0.0'] } })));
  });
});

describe('C2: candidate graphs are stored and linted without approvals; sandbox needs explicit authority; approved execution needs lifecycle checks', () => {
  it('lint always works, sandbox needs authority, approved needs every executing node authorized', () => {
    const now = '2026-10-13T00:00:00Z';
    assert.deepEqual(canExecute('lint', water, { now }), { allowed: true, reasons: [] });
    assert.equal(canExecute('sandbox', water, { now }).allowed, false);
    assert.equal(canExecute('sandbox', water, { now, sandbox: { grantedBy: 'astra', expiresAt: '2026-10-12T00:00:00Z' } }).allowed, false);
    assert.equal(canExecute('sandbox', water, { now, sandbox: { grantedBy: 'astra', expiresAt: '2026-12-01T00:00:00Z' } }).allowed, true);
    assert.equal(canExecute('approved', water, { now }).allowed, false);
    const partly = canExecute('approved', water, { now, authorizeNode: (id) => (id === 'gap' ? { authorized: false, reasons: ['STAGE_CANDIDATE'] } : { authorized: true, reasons: [] }) });
    assert.deepEqual(partly.reasons, ['gap:STAGE_CANDIDATE']);
    assert.equal(canExecute('approved', water, { now, authorizeNode: () => ({ authorized: true, reasons: [] }) }).allowed, true);
    assert.equal(canExecute('approved', { ...water, exclusions: ['packs'] }, { now, authorizeNode: (id) => ({ authorized: id !== 'packs', reasons: ['X'] }) }).allowed, true);   // an excluded node is not executed
    assert.equal(canExecute('lint', { ...water, edges: [], nodes: [...water.nodes, node('demand', 'X', {}, {})] }, { now }).allowed, false);
  });
});

describe('C3: deterministic aggregation with an ordinal comparator', () => {
  const inputs: InputState[] = [
    { input: 'population', status: 'UNKNOWN', code: 'NO_COUNT' },
    { input: 'stock', status: 'STALE', code: 'OLDER_THAN_POLICY' },
    { input: 'sourceA', status: 'CONFLICT' },
    { input: 'units', status: 'INVALID', code: 'UNIT_MISMATCH' },
    { input: 'rate', status: 'VALID' },
  ];
  const permutations = <T,>(list: T[]): T[][] => list.length <= 1 ? [list] : list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]));

  it('summary precedence is INVALID, CONFLICT, STALE, UNKNOWN, VALID and every reason is kept', () => {
    const result = aggregate(inputs);
    assert.equal(result.status, 'INVALID');
    assert.deepEqual(result.reasons.map((reason) => `${reason.status}:${reason.input}`), ['INVALID:units', 'CONFLICT:sourceA', 'STALE:stock', 'UNKNOWN:population']);
    for (const status of ['CONFLICT', 'STALE', 'UNKNOWN', 'VALID'] as Status[]) {
      assert.equal(aggregate(inputs.filter((item) => item.status === status || item.status === 'VALID')).status, status);
    }
  });

  it('the result is identical for all 120 orders in which the inputs are visited', () => {
    const reference = JSON.stringify(aggregate(inputs));
    const all = permutations(inputs);
    assert.equal(all.length, 120);
    for (const order of all) assert.equal(JSON.stringify(aggregate(order)), reference);
  });

  it('ordering is ordinal and locale-independent: uppercase sorts before lowercase, digits before letters, and this never depends on the runtime locale', () => {
    assert.ok(ord('Zeta', 'alpha') < 0);
    assert.ok(ord('a10', 'a2') < 0);
    assert.equal(ord('same', 'same'), 0);
    const result = aggregate([{ input: 'beta', status: 'UNKNOWN' }, { input: 'Zeta', status: 'UNKNOWN' }, { input: 'alpha', status: 'UNKNOWN' }]);
    assert.deepEqual(result.reasons.map((r) => r.input), ['Zeta', 'alpha', 'beta']);
  });

  it('input names and codes outside the identifier policy are rejected', () => {
    assert.throws(() => aggregate([{ input: 'sto ck', status: 'UNKNOWN' }]), /BAD_IDENTIFIER/);
    assert.throws(() => aggregate([{ input: 'stock', status: 'UNKNOWN', code: 'é' }]), /BAD_IDENTIFIER/);
  });
});

describe('C4: UNKNOWN may expose a typed known partial, never a complete total', () => {
  it('a VALID result carries a value; an UNKNOWN result carries a partial marked incomplete and no value', () => {
    const valid = combine([{ input: 'a', status: 'VALID' }], () => 21000);
    assert.deepEqual([valid.status, valid.value, valid.partial], ['VALID', 21000, undefined]);
    const unknown = combine([{ input: 'population', status: 'UNKNOWN' }, { input: 'stock', status: 'VALID' }], () => 21000, () => 4500);
    assert.equal(unknown.status, 'UNKNOWN');
    assert.equal(unknown.value, undefined);
    assert.deepEqual(unknown.partial, { value: 4500, complete: false, missing: ['population'] });
    const invalid = combine([{ input: 'units', status: 'INVALID' }, { input: 'population', status: 'UNKNOWN' }], () => 1, () => 2);
    assert.equal(invalid.partial, undefined);
    assert.equal(invalid.value, undefined);
  });

  it('NOT_APPLICABLE and ZERO_DURATION are metadata, not new statuses', () => {
    const zero = { ...combine([{ input: 'horizon', status: 'VALID' }], () => 0), reasonCode: 'ZERO_DURATION' };
    assert.equal(zero.status, 'VALID');
    assert.equal(zero.reasonCode, 'ZERO_DURATION');
    const notApplicable = { ...combine([{ input: 'population', status: 'VALID' }], () => null), applicability: 'NOT_APPLICABLE' as const, reasonCode: 'ZERO_POPULATION' };
    assert.deepEqual([notApplicable.status, notApplicable.applicability], ['VALID', 'NOT_APPLICABLE']);
  });
});

describe('D3: allowed use is a ceiling intersected with scope, over the RESOLVED closure', () => {
  const g = (id: string, over: Partial<Grant> = {}): Grant => ({
    id, use: 'OPERATIONAL', tenants: ['*'], resources: ['*'], purposes: ['*'], jurisdictions: ['*'], validity: ['*'], actions: [], expiresAt: '2027-01-01T00:00:00Z', revoked: false, ...over,
  });
  const request: UseRequest = { use: 'OPERATIONAL', tenant: 'TENANT-A', resource: 'water', purpose: 'planning', jurisdiction: 'XX', validity: 'region-1', now: '2026-10-13T00:00:00Z' };
  const required = dependencyClosure(water, waterTrusted()).closure;
  const allGrants = (over: Record<string, Partial<Grant>> = {}): Map<string, Grant> => new Map([...required, 'composition'].map((id) => [id, g(id, over[id] ?? {})]));

  it('an OPERATIONAL graph is authorized only when every closure member and the composition allow it', () => {
    assert.deepEqual(effectivePermission(required, allGrants(), 'composition', request), { authorized: true, ceiling: 'OPERATIONAL', reasons: [] });
  });

  it('a DEMO nested dependency limits an otherwise OPERATIONAL graph', () => {
    const result = effectivePermission(required, allGrants({ 'AEG.F.UNIT-REGISTRY@1.0.0': { use: 'DEMO' } }), 'composition', request);
    assert.equal(result.authorized, false);
    assert.equal(result.ceiling, 'DEMO');
    assert.ok(result.reasons.includes('USE_ABOVE_CEILING_DEMO'));
  });

  it('conflicting scopes deny; expired, revoked and missing approvals deny, including the composition\'s own', () => {
    const conflicting = effectivePermission(required, allGrants({ 'AEG.F.DEMAND-FLOW@1.0.0': { tenants: ['TENANT-B'] }, 'AEG.F.ELIGIBLE-SUPPLY@1.0.0': { jurisdictions: ['YY'] } }), 'composition', request);
    assert.deepEqual(conflicting.reasons, ['JURISDICTION_OUT_OF_SCOPE:AEG.F.ELIGIBLE-SUPPLY@1.0.0', 'TENANT_OUT_OF_SCOPE:AEG.F.DEMAND-FLOW@1.0.0']);
    assert.ok(effectivePermission(required, allGrants({ 'AEG.F.RESOURCE-SHORTFALL@1.0.0': { expiresAt: '2026-10-01T00:00:00Z' } }), 'composition', request).reasons.includes('EXPIRED:AEG.F.RESOURCE-SHORTFALL@1.0.0'));
    assert.ok(effectivePermission(required, allGrants({ 'AEG.F.PACK-REQUIREMENT@1.0.0': { revoked: true } }), 'composition', request).reasons.includes('REVOKED:AEG.F.PACK-REQUIREMENT@1.0.0'));
    const noOwn = allGrants();
    noOwn.delete('composition');
    assert.ok(effectivePermission(required, noOwn, 'composition', request).reasons.includes('MISSING_APPROVAL:composition'));
    const noNested = allGrants();
    noNested.delete('AEG.F.UNIT-REGISTRY@1.0.0');
    assert.ok(effectivePermission(required, noNested, 'composition', request).reasons.includes('MISSING_APPROVAL:AEG.F.UNIT-REGISTRY@1.0.0'));
  });

  it('an OPERATIONAL label grants no action: dispatch, clinical or spending authority is separate', () => {
    assert.ok(effectivePermission(required, allGrants(), 'composition', { ...request, action: 'dispatch' }).reasons.some((r) => r.startsWith('ACTION_NOT_PERMITTED')));
    const withAction = allGrants();
    for (const [id, grant] of withAction) withAction.set(id, { ...grant, actions: ['dispatch'] });
    assert.equal(effectivePermission(required, withAction, 'composition', { ...request, action: 'dispatch' }).authorized, true);
  });
});

describe('D4: exact normalization before hashing', () => {
  it('equivalent external rationals give one identity', () => {
    const rate = (text: string): Record<string, string> => ({ perPersonPerDay: format(normalizeExternal(text)) });
    assert.deepEqual(rate('2/4'), rate('0.5'));
    assert.equal(format(mul(normalizeExternal('0.5'), make(2n, 1n))), '1/1');
  });
});
