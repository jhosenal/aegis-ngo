import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { interval, oneOf, prove, type Table } from './decisiontable.js';
import { RationalError } from './rational.js';

describe('R6 and R7: a table is validated before analysis, and acceptance is not the same as analysis', () => {
  const base = (): Table => ({
    id: 't', defaultOutcome: 'UNKNOWN',
    fields: [{ name: 'x', type: 'numeric' }, { name: 'level', type: 'enum', values: ['low', 'high'] }],
    rules: [{ id: 'A', priority: 1, outcome: 'WATCH', when: [interval('x', '1', true, null, false)] }, { id: 'B', priority: 1, outcome: 'NOMINAL', when: [oneOf('level', 'low')] }],
  });
  const refused = (table: Table, fragment: string): void => {
    const analysis = prove(table);
    assert.equal(analysis.status, 'INVALID_TABLE');
    assert.equal(analysis.analysisComplete, false);
    assert.equal(analysis.tableAccepted, false);
    assert.ok(analysis.validationErrors.some((error) => error.startsWith(fragment)), `${fragment} in ${analysis.validationErrors.join(' | ')}`);
  };
  const rule = (when: Table['rules'][number]['when'], over: Partial<Table['rules'][number]> = {}): Table['rules'][number] => ({ id: 'C', priority: 1, outcome: 'X', when, ...over });

  it('Astra probe: an enum with no values is refused, not "proven" with zero cells', () => {
    const analysis = prove({ id: 'empty-enum', fields: [{ name: 'x', type: 'enum', values: [] }], rules: [], defaultOutcome: null });
    assert.equal(analysis.status, 'INVALID_TABLE');
    assert.equal(analysis.tableAccepted, false);
    assert.ok(analysis.validationErrors.includes('EMPTY_ENUM_DOMAIN x'));
    assert.equal(analysis.cells, 0);
  });

  it('refuses malformed tables with an explicit reason and no exception', () => {
    refused({ ...base(), fields: [...base().fields, { name: 'x', type: 'numeric' }] }, 'DUPLICATE_FIELD');
    refused({ ...base(), rules: [...base().rules, rule([oneOf('level', 'low')], { id: 'A' })] }, 'DUPLICATE_RULE');
    refused({ ...base(), rules: [rule([oneOf('ghost', 'low')])] }, 'UNKNOWN_FIELD');
    refused({ ...base(), rules: [rule([interval('level', '1', true, null, false)])] }, 'TYPE_MISMATCH');
    refused({ ...base(), rules: [rule([oneOf('x', 'low')])] }, 'TYPE_MISMATCH');
    refused({ ...base(), rules: [rule([interval('x', '5', true, '1', true)])] }, 'EMPTY_INTERVAL');
    refused({ ...base(), rules: [rule([interval('x', '1', false, '1', true)])] }, 'EMPTY_INTERVAL');
    refused({ ...base(), rules: [rule([interval('x', null, false, null, false)])] }, 'UNBOUNDED_INTERVAL');
    refused({ ...base(), rules: [rule([oneOf('level', 'low')], { priority: 5000 })] }, 'BAD_PRIORITY');
    refused({ ...base(), rules: [rule([oneOf('level', 'low')], { priority: 1.5 })] }, 'BAD_PRIORITY');
    refused({ ...base(), rules: [rule([oneOf('level', 'low')], { outcome: 'AMBIGUOUS' })] }, 'BAD_OUTCOME');
    refused({ ...base(), rules: [rule([oneOf('level', 'medium')])] }, 'VALUE_OUTSIDE_DOMAIN');
    refused({ ...base(), rules: [rule([{ field: 'x', kind: 'regex' } as never])] }, 'UNSUPPORTED_OPERATOR');
    refused({ ...base(), rules: [] }, 'NO_RULES');
    refused({ ...base(), fields: [] }, 'NO_FIELDS');
  });

  it('Astra probe: no rules is refused, and a table with a gap and no default is not accepted, with the gap witness kept', () => {
    assert.equal(prove({ id: 'uncovered', fields: [{ name: 'x', type: 'numeric' }], rules: [], defaultOutcome: null }).status, 'INVALID_TABLE');
    const gap = prove({ id: 'gappy', fields: [{ name: 'x', type: 'numeric' }], rules: [{ id: 'A', priority: 1, outcome: 'WATCH', when: [interval('x', '5', true, null, false)] }], defaultOutcome: null });
    assert.equal(gap.analysisComplete, true);
    assert.equal(gap.tableAccepted, false);
    assert.equal(gap.status, 'REJECTED_COVERAGE');
    assert.ok(gap.gaps.length > 0);
  });

  it('a table is accepted only when valid, fully analysed, free of ties and completely covered', () => {
    const accepted = prove({ id: 'ok', defaultOutcome: 'UNKNOWN', fields: [{ name: 'x', type: 'numeric' }],
      rules: [{ id: 'LOW', priority: 1, outcome: 'NOMINAL', when: [interval('x', null, false, '5', false)] }, { id: 'HIGH', priority: 1, outcome: 'WATCH', when: [interval('x', '5', true, null, false)] }] });
    assert.deepEqual([accepted.analysisComplete, accepted.tableAccepted, accepted.status, accepted.gaps.length, accepted.ambiguities.length], [true, true, 'ACCEPTED', 0, 0]);
    const tie = prove({ id: 'tie', defaultOutcome: 'UNKNOWN', fields: [{ name: 'x', type: 'numeric' }],
      rules: [{ id: 'A', priority: 1, outcome: 'NOMINAL', when: [interval('x', null, false, '5', true)] }, { id: 'B', priority: 1, outcome: 'WATCH', when: [interval('x', '5', true, null, false)] }] });
    assert.equal(tie.status, 'REJECTED_AMBIGUITY');                                  // both rules match at exactly 5
    assert.ok(tie.ambiguities.length > 0);
    assert.equal(tie.tableAccepted, false);
  });

  it('R5 at the table entry point: interval endpoints obey the same 40-digit limit, counted raw', () => {
    assert.throws(() => interval('x', '9'.repeat(41), true, null, false), (error: unknown) => error instanceof RationalError && error.code === 'RAT_TOO_LARGE');
    assert.throws(() => interval('x', '1', true, `1/${'0'.repeat(40)}1`, false), (error: unknown) => error instanceof RationalError && error.code === 'RAT_TOO_LARGE');
    assert.doesNotThrow(() => interval('x', '9'.repeat(40), true, null, false));
  });
});
