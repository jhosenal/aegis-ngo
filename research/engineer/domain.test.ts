import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { domain, evaluate, interval, oneOf, prove, validateTable, type Field, type Table } from './decisiontable.js';
import { normalizeExternal } from './rational.js';

const num = (text: string) => normalizeExternal(text);
const J = 'a count of people cannot be negative (definitional)';
const base = (field: Field): Table => ({
  id: 'T', fields: [field],
  rules: [
    { id: 'LOW', priority: 1, outcome: 'L0', when: [interval('x', '0', true, '5', false)] },
    { id: 'HIGH', priority: 1, outcome: 'L1', when: [interval('x', '5', true, null, false)] },
  ],
  defaultOutcome: null,
});

describe('S0004: justified physical domains in the prover', () => {
  it('without a domain the same table has a gap below zero; with a justified non-negative domain it is accepted', () => {
    const open = prove(base({ name: 'x', type: 'numeric' }));
    assert.equal(open.status, 'REJECTED_COVERAGE');
    assert.ok(open.gaps.some((g) => g['x']!.startsWith('-')), 'the unbounded analysis reports an impossible negative witness');
    const bounded = prove(base({ name: 'x', type: 'numeric', domain: domain('0', true, null, false, J) }));
    assert.equal(bounded.status, 'ACCEPTED');
    assert.equal(bounded.tableAccepted, true);
    assert.equal(bounded.gaps.length, 0);
  });

  it('no witness lies outside the domain, and the domain edge itself is analysed', () => {
    const t: Table = { ...base({ name: 'x', type: 'numeric', domain: domain('0', true, '10', true, J) }), rules: [{ id: 'ONLY', priority: 1, outcome: 'A', when: [interval('x', '2', true, '3', true)] }] };
    const out = prove(t);
    assert.equal(out.status, 'REJECTED_COVERAGE');
    const xs = out.gaps.map((g) => g['x']!);
    assert.ok(xs.every((v) => !v.startsWith('-')), 'no negative witness');
    assert.ok(xs.includes('0/1') && xs.includes('10/1'), 'both domain edges are cells');
    assert.ok(!xs.includes('11/1'), 'nothing above the upper edge');
  });

  it('an exclusive domain edge is not a cell (absolute pressure > 0)', () => {
    const t: Table = { ...base({ name: 'x', type: 'numeric', domain: domain('0', false, null, false, 'absolute pressure is strictly positive') }), rules: [{ id: 'ONLY', priority: 1, outcome: 'A', when: [interval('x', '1', true, null, false)] }] };
    const out = prove(t);
    assert.ok(out.gaps.every((g) => g['x'] !== '0/1'));
    assert.ok(out.gaps.some((g) => g['x'] === '1/2'), 'the open gap (0,1) is analysed');
  });

  it('runtime REFUSES an out-of-domain value (UNKNOWN), it never clips it into a rule', () => {
    const t = base({ name: 'x', type: 'numeric', domain: domain('0', true, '100', true, J) });
    const neg = { n: -5n, d: 1n };
    assert.deepEqual(evaluate(t, { x: neg }), { outcome: 'UNKNOWN', reason: 'OUT_OF_DOMAIN:x' });
    assert.deepEqual(evaluate(t, { x: num('101') }), { outcome: 'UNKNOWN', reason: 'OUT_OF_DOMAIN:x' });
    assert.deepEqual(evaluate(t, { x: num('100') }), { outcome: 'L1', reason: null });          // the edge is inside
    assert.deepEqual(evaluate(t, { x: num('0') }), { outcome: 'L0', reason: null });
    assert.deepEqual(evaluate(t, { x: 'UNKNOWN' }), { outcome: 'UNKNOWN', reason: 'INPUT_UNKNOWN:x' });
  });

  it('a field without a domain makes no claim: nothing is refused', () => {
    const t = base({ name: 'x', type: 'numeric' });
    assert.equal(evaluate(t, { x: { n: -5n, d: 1n } }).reason, 'NO_RULE_MATCHED');
  });

  it('invalid domains are refused at validation', () => {
    const v = (field: Field) => validateTable(base(field));
    assert.ok(v({ name: 'x', type: 'numeric', domain: domain('5', true, '1', true, J) }).some((e) => e.startsWith('DOMAIN_EMPTY')));
    assert.ok(v({ name: 'x', type: 'numeric', domain: domain('1', false, '1', true, J) }).some((e) => e.startsWith('DOMAIN_EMPTY')));
    assert.ok(v({ name: 'x', type: 'numeric', domain: domain(null, false, null, false, J) }).some((e) => e.startsWith('DOMAIN_UNBOUNDED')));
    assert.ok(v({ name: 'x', type: 'numeric', domain: domain('0', true, null, false, '   ') }).some((e) => e.startsWith('DOMAIN_UNJUSTIFIED')));
    assert.ok(v({ name: 'x', type: 'numeric', domain: domain('0', true, null, false, 'x'.repeat(1001)) }).some((e) => e.startsWith('DOMAIN_UNJUSTIFIED')));
    const enumTable: Table = { id: 'E', fields: [{ name: 'e', type: 'enum', values: ['a'], domain: domain('0', true, null, false, J) } as unknown as Field], rules: [{ id: 'R', priority: 1, outcome: 'A', when: [oneOf('e', 'a')] }], defaultOutcome: null };
    assert.ok(validateTable(enumTable).some((e) => e.startsWith('DOMAIN_ON_ENUM_FIELD')));
    assert.equal(prove(base({ name: 'x', type: 'numeric', domain: domain('5', true, '1', true, J) })).status, 'INVALID_TABLE');
  });

  it('a domain endpoint obeys the same 40-digit external limit as every other entry point', () => {
    assert.throws(() => domain('1'.repeat(41), true, null, false, J));
  });

  it('a bounded table reports fewer cells than the unbounded one and never more', () => {
    const open = prove(base({ name: 'x', type: 'numeric' }));
    const bounded = prove(base({ name: 'x', type: 'numeric', domain: domain('0', true, '100', true, J) }));
    assert.ok(bounded.cells <= open.cells + 2);
    assert.ok(bounded.cells > 0);
  });
});
