import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addDims, conversionFactor, divDim, dimOf, mulDim, powDim, sameDim, UNITS } from './units.js';
import { effectiveOutcome, evaluate, interval, oneOf, prove, type Table } from './decisiontable.js';
import { format, fromInt, make } from './rational.js';

const throwsMessage = (action: () => unknown): string => { try { action(); return ''; } catch (error: unknown) { return (error as Error).message; } };

describe('C5: dimensions are checked, not just labelled', () => {
  it('litres and m3 are units of volume, m2 is area, kg/m2 is areal mass, Pa is pressure; they are distinct dimensions', () => {
    assert.ok(sameDim(dimOf('L'), dimOf('m3')));
    assert.ok(!sameDim(dimOf('L'), dimOf('m2')));
    assert.ok(!sameDim(dimOf('kg/m2'), dimOf('kg')));
    assert.ok(!sameDim(dimOf('Pa'), dimOf('kg/m2')));
    assert.equal(format(conversionFactor('L', 'm3')), '1/1000');
    assert.equal(format(conversionFactor('m3', 'L')), '1000/1');
    assert.equal(format(conversionFactor('mm', 'm')), '1/1000');
    assert.match(throwsMessage(() => conversionFactor('L', 'm2')), /DIMENSION_MISMATCH/);
  });

  it('water demand Q = P * r * T is a volume only when the rate is per person per day', () => {
    const perPersonPerDay = divDim(dimOf('L'), mulDim(dimOf('persons'), dimOf('day')));
    const volume = mulDim(mulDim(dimOf('persons'), perPersonPerDay), dimOf('day'));
    assert.ok(sameDim(volume, dimOf('L')));
    // F01: the same product without a horizon is a flow, not a quantity, and cannot be added to a stock
    const flow = mulDim(dimOf('persons'), perPersonPerDay);
    assert.ok(!sameDim(flow, dimOf('L')));
    assert.match(throwsMessage(() => addDims(flow, dimOf('L'))), /DIMENSION_MISMATCH/);
  });

  it('shelter area A = P * a has no time factor; multiplying by days gives area-days, which is not an area', () => {
    const perPerson = divDim(dimOf('m2'), dimOf('persons'));
    assert.ok(sameDim(mulDim(dimOf('persons'), perPerson), dimOf('m2')));
    assert.ok(!sameDim(mulDim(mulDim(dimOf('persons'), perPerson), dimOf('day')), dimOf('m2')));
  });

  it('ash mass per area = thickness (m) * density (kg/m3) is kg/m2, and dynamic pressure = 1/2 * kg/m3 * (m/s)^2 is Pa', () => {
    assert.ok(sameDim(mulDim(dimOf('m'), dimOf('kg/m3')), dimOf('kg/m2')));
    assert.ok(sameDim(mulDim(dimOf('kg/m3'), powDim(dimOf('m/s'), 2)), dimOf('Pa')));
    assert.match(throwsMessage(() => addDims(dimOf('kg/m2'), dimOf('Pa'))), /DIMENSION_MISMATCH/);   // adding a mass load to a pressure is refused
  });

  it('every registered unit has a dimension and a positive exact base factor, and an unregistered unit is an error', () => {
    for (const unit of Object.values(UNITS)) assert.ok(unit.toBase.n > 0n && unit.toBase.d > 0n, unit.id);
    assert.match(throwsMessage(() => dimOf('furlongs')), /UNREGISTERED_UNIT/);
    assert.ok(sameDim(dimOf('s'), dimOf('day')));
    assert.equal(format(conversionFactor('day', 's')), '86400/1');
  });
});

// A synthetic table in the shape of the proposals' flood SOP (F19): this is NOT the proposal's real table.
const flood = (priorityNominal: number, priorityCritical: number, withDefault: boolean): Table => ({
  id: 'flood-synthetic',
  fields: [{ name: 'depth', type: 'numeric' }, { name: 'velocity', type: 'numeric' }],
  defaultOutcome: withDefault ? 'UNKNOWN' : null,
  rules: [
    { id: 'R-NOMINAL', priority: priorityNominal, outcome: 'NOMINAL', when: [interval('depth', null, false, '3/10', false)] },                   // depth < 0.3
    { id: 'R-WATCH', priority: 2, outcome: 'WATCH', when: [interval('depth', '3/10', true, '1', false)] },                                         // 0.3 <= depth < 1
    { id: 'R-CRITICAL', priority: priorityCritical, outcome: 'CRITICAL', when: [interval('velocity', '2', true, null, false)] },                   // velocity >= 2
  ],
});

describe('C6: coverage proof for a restricted rule language, with explicit priority resolution', () => {
  it('finds the overlap of two rules at the same priority (nominal and critical), a real ambiguity', () => {
    const proof = prove(flood(1, 1, true));
    assert.equal(proof.analysisComplete, true);
    assert.equal(proof.status, 'REJECTED_AMBIGUITY');
    assert.equal(proof.tableAccepted, false);
    assert.ok(proof.ambiguities.length > 0);
    assert.ok(proof.ambiguities.every((item) => item.rules.includes('R-NOMINAL') && item.rules.includes('R-CRITICAL')));
    assert.deepEqual(effectiveOutcome(flood(1, 1, true), { depth: make(1n, 10n), velocity: fromInt(2n) }).outcome, 'AMBIGUOUS');
  });

  it('a permitted overlap needs a unique priority: with CRITICAL above NOMINAL there is one effective outcome in every cell', () => {
    const proof = prove(flood(1, 3, true));
    assert.equal(proof.ambiguities.length, 0);
    assert.ok(proof.resolvedOverlaps > 0);
    assert.equal(effectiveOutcome(flood(1, 3, true), { depth: make(1n, 10n), velocity: fromInt(2n) }).outcome, 'CRITICAL');
  });

  it('finds gaps: depth 1 or more with velocity below 2 matches nothing, so without an explicit default the table is incomplete', () => {
    const noDefault = prove(flood(1, 3, false));
    assert.ok(noDefault.gaps.length > 0);
    assert.ok(noDefault.gaps.every((cell) => /^[0-9]+\/[0-9]+$/.test(cell.depth as string) && !cell.depth?.startsWith('-')));
    const withDefault = prove(flood(1, 3, true));
    assert.equal(withDefault.gaps.length, 0);
    assert.ok(withDefault.defaultCells > 0);               // those cells fall through to an explicit UNKNOWN, never to nominal
    assert.equal(effectiveOutcome(flood(1, 3, true), { depth: fromInt(2n), velocity: fromInt(0n) }).outcome, 'UNKNOWN');
  });

  it('checks the boundaries themselves: equality at 0.3 and at velocity 2 is in the partition, not skipped', () => {
    const proof = prove(flood(1, 3, true));
    assert.ok(proof.cells >= 11);                            // 3 breakpoints on depth and 1 on velocity, each with its gaps
    assert.equal(effectiveOutcome(flood(1, 3, true), { depth: make(3n, 10n), velocity: fromInt(0n) }).outcome, 'WATCH');
    assert.equal(effectiveOutcome(flood(1, 3, true), { depth: make(29n, 100n), velocity: fromInt(0n) }).outcome, 'NOMINAL');
  });

  it('works with enumerated fields, and detects a missing combination', () => {
    const table: Table = {
      id: 'enum-synthetic', defaultOutcome: null,
      fields: [{ name: 'level', type: 'enum', values: ['low', 'mid', 'high'] }, { name: 're', type: 'numeric' }],
      rules: [
        { id: 'A', priority: 1, outcome: 'WATCH', when: [oneOf('level', 'mid', 'high'), interval('re', '1', false, null, false)] },     // re > 1
        { id: 'B', priority: 1, outcome: 'NOMINAL', when: [oneOf('level', 'low')] },
      ],
    };
    const proof = prove(table);
    assert.ok(proof.gaps.length > 0);                       // level mid or high with re <= 1 is covered by no rule
    const fixed: Table = { ...table, rules: [...table.rules, { id: 'C', priority: 0, outcome: 'NOMINAL', when: [oneOf('level', 'mid', 'high'), interval('re', null, false, '1', true)] }] };
    assert.equal(prove(fixed).gaps.length, 0);
    assert.equal(prove(fixed).ambiguities.length, 0);
  });

  it('refuses to call a table proven when the partition is too large: that is tested coverage only', () => {
    const wide: Table = {
      id: 'wide', defaultOutcome: 'UNKNOWN',
      fields: Array.from({ length: 12 }, (_, i) => ({ name: `f${i}`, type: 'numeric' as const })),
      rules: Array.from({ length: 12 }, (_, i) => ({ id: `R${i}`, priority: 1, outcome: 'X', when: [interval(`f${i}`, '1', true, '5', false)] })),
    };
    const proof = prove(wide, 100_000);
    assert.equal(proof.analysisComplete, false);
    assert.equal(proof.tableAccepted, false);
    assert.equal(proof.status, 'NOT_PROVEN');
    assert.match(proof.reason ?? '', /exceeds the budget/);
    assert.equal(proof.testedCoverage?.cells, 10_000);       // a retained, reproducible sample, labelled as tested coverage, not a proof
    assert.deepEqual(prove(wide, 100_000).testedCoverage, proof.testedCoverage);
  });

  it('runtime handling remains: an unknown input, an ambiguity or no match yields UNKNOWN, never nominal', () => {
    const ambiguous = flood(1, 1, true);
    assert.deepEqual(evaluate(flood(1, 3, true), { depth: 'UNKNOWN', velocity: fromInt(0n) }), { outcome: 'UNKNOWN', reason: 'INPUT_UNKNOWN:depth' });
    assert.deepEqual(evaluate(ambiguous, { depth: make(1n, 10n), velocity: fromInt(3n) }), { outcome: 'UNKNOWN', reason: 'AMBIGUOUS_RULES' });
    assert.deepEqual(evaluate(flood(1, 3, false), { depth: fromInt(5n), velocity: fromInt(0n) }), { outcome: 'UNKNOWN', reason: 'NO_RULE_MATCHED' });
    assert.deepEqual(evaluate(flood(1, 3, true), { depth: make(1n, 10n), velocity: fromInt(0n) }), { outcome: 'NOMINAL', reason: null });
  });

  it('V10 asks for ONE EFFECTIVE OUTCOME per cell, not exactly one raw predicate: resolved overlaps are allowed, ties are not', () => {
    const resolved = prove(flood(1, 3, true));
    assert.equal(resolved.ambiguities.length, 0);
    assert.ok(resolved.resolvedOverlaps > 0);
    assert.ok(prove(flood(1, 1, true)).ambiguities.length > 0);
  });
});
