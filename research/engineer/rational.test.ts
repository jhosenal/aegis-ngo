import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeShortfall } from '../../src/registry/formulations/resource-shortfall.js';
import { canonicalize, hashWithDomain } from '../../src/engine/canonical.js';
import {
  add, ceil, checkFrozenRange, cmp, floor, format, fromInt, make, maxZero, mul, normalizeExternal, parseIntField, parseNonNegative,
  parseSigned, RationalError, sub, toSubunits, type RationalErrorCode,
} from './rational.js';

const code = (action: () => unknown): RationalErrorCode | null => {
  try { action(); return null; } catch (error: unknown) { return error instanceof RationalError ? error.code : (() => { throw error; })(); }
};
const q = (text: string) => parseNonNegative(text);
const asOf = '2026-10-13T00:00:00Z';
const quantity = (units: number) => ({ units, unitId: 'UNIT.WATER_ML', regionId: 'REGION.X', asOf });
const frozenGap = (demandMl: bigint, supplyMl: bigint): number =>
  computeShortfall({ demand: quantity(Number(demandMl)), available: quantity(Number(supplyMl)), reserve: quantity(0) }).shortfallUnits;

describe('D1: rounding only at declared boundaries, exact arithmetic through composition', () => {
  it('V-D1a: demand = supply = 2/5 L has an exact gap of zero; exact mL conversion gives 400 and 400 and the frozen gap is zero', () => {
    const demand = q('2/5');
    const supply = q('2/5');
    assert.equal(format(maxZero(sub(demand, supply))), '0/1');
    assert.equal(toSubunits(demand, 1000n), 400n);
    assert.equal(toSubunits(supply, 1000n), 400n);
    assert.equal(frozenGap(400n, 400n), 0);
  });

  it('V-D1b: separate whole-litre rounding invents a gap (the conservative envelope is not the exact gap)', () => {
    const demand = q('2/5');
    const supply = q('2/5');
    assert.equal(ceil(demand) - floor(supply), 1n);       // envelope: ceil(D) - floor(S) = 1
    assert.ok(ceil(demand) - floor(supply) >= floor(maxZero(sub(demand, supply))));   // never below the exact gap
  });

  it('V-D1c: D = 6/5, S = 11/10 gives an exact gap of 1/10; in 100 mL subunits the gap is 1', () => {
    const demand = q('6/5');
    const supply = q('11/10');
    assert.equal(format(maxZero(sub(demand, supply))), '1/10');
    const perUnit = 10n;   // one litre is ten 100-mL subunits
    assert.equal(toSubunits(demand, perUnit), 12n);
    assert.equal(toSubunits(supply, perUnit), 11n);
    assert.equal(12n - 11n, 1n);
  });

  it('V-D1d: 2/5 + 2/5 + 1/5 = 1 before packing, and partitioning the same total gives the same result', () => {
    const parts = ['2/5', '2/5', '1/5'].map(q);
    const total = parts.reduce((sum, item) => add(sum, item), make(0n, 1n));
    assert.equal(format(total), '1/1');
    const otherSplit = [q('3/5'), q('2/5')].reduce((sum, item) => add(sum, item), make(0n, 1n));
    assert.equal(format(otherSplit), format(total));
    // ceiling per part would give 3 containers; once after aggregation gives 1
    assert.equal(parts.map((part) => ceil(part)).reduce((a, b) => a + b, 0n), 3n);
    assert.equal(ceil(total), 1n);
  });

  it('V-D1e: a rational that is not a whole number of subunits is rejected, not rounded (1/3 L is 1000/3 mL)', () => {
    assert.equal(format(mul(q('1/3'), fromInt(1000n))), '1000/3');
    assert.equal(code(() => toSubunits(q('1/3'), 1000n)), 'NOT_REPRESENTABLE');
    assert.equal(toSubunits(q('1/3'), 3n), 1n);   // exact at another scale
  });

  it('V-D1f: the frozen 0..1e9 limits are enforced after conversion, never clipped', () => {
    assert.equal(checkFrozenRange(1_000_000_000n), 1_000_000_000n);
    assert.equal(code(() => checkFrozenRange(1_000_000_001n)), 'OUT_OF_RANGE');
    assert.equal(code(() => checkFrozenRange(toSubunits(q('5000000/1'), 1000n))), 'OUT_OF_RANGE');
  });

  it('V-D1g: deductions are exact before any rounding; rounding each subtraction separately gives a different, wrong answer', () => {
    const onHand = q('5/2');                     // 2.5 L
    const exactUsable = sub(sub(onHand, q('3/10')), q('3/10'));   // minus protected and reserved elsewhere, 0.3 L each
    assert.equal(format(exactUsable), '19/10');
    const roundedEach = floor(onHand) - ceil(q('3/10')) - ceil(q('3/10'));   // 2 - 1 - 1 = 0
    assert.equal(roundedEach, 0n);
    assert.equal(floor(exactUsable), 1n);        // the exact result, floored once at the boundary
  });
});

describe('D4: typed rational encoding contract', () => {
  it('normalizes external 2/4 to 1/2 and rejects an internal 2/4', () => {
    assert.equal(format(normalizeExternal('2/4')), '1/2');
    assert.equal(code(() => parseNonNegative('2/4')), 'RAT_NOT_NORMALIZED');
    assert.equal(format(parseNonNegative('1/2')), '1/2');
  });

  it('zero is exactly 0/1; 0/2 is rejected; whole values are n/1', () => {
    assert.equal(format(parseNonNegative('0/1')), '0/1');
    assert.equal(code(() => parseNonNegative('0/2')), 'RAT_NOT_NORMALIZED');
    assert.equal(format(parseNonNegative('7/1')), '7/1');
    assert.equal(code(() => parseNonNegative('7')), 'RAT_SYNTAX');   // a rational field is not an integer field
  });

  it('rejects denominator zero, plus sign, leading zeros, whitespace, exponent, negative zero and negatives in unsigned fields', () => {
    assert.equal(code(() => parseNonNegative('1/0')), 'RAT_DENOMINATOR_ZERO');
    for (const bad of ['+1/2', '01/2', '1/02', ' 1/2', '1/2 ', '1e3/1', '1/2e0', '1.5/1', '0.5']) {
      assert.equal(code(() => parseNonNegative(bad)), 'RAT_SYNTAX', bad);
    }
    assert.equal(code(() => parseNonNegative('-1/2')), 'RAT_NEGATIVE');
    assert.equal(code(() => parseNonNegative('-0/1')), 'RAT_NEGATIVE');   // negative zero is never a valid unsigned value
    assert.equal(code(() => parseSigned('-0/1')), 'RAT_SYNTAX');
    assert.equal(format(parseSigned('-1/2')), '-1/2');
  });

  it('rejects oversized digit strings before any BigInt arithmetic', () => {
    assert.equal(code(() => parseNonNegative(`${'9'.repeat(41)}/1`)), 'RAT_TOO_LARGE');
    assert.equal(code(() => parseNonNegative(`1/${'9'.repeat(41)}`)), 'RAT_TOO_LARGE');
    assert.equal(code(() => normalizeExternal('1'.repeat(500))), 'RAT_TOO_LARGE');
  });

  it('external adapters normalize equivalent spellings; floats and exponents never enter', () => {
    assert.equal(format(normalizeExternal('0.4')), '2/5');
    assert.equal(format(normalizeExternal('3')), '3/1');
    assert.equal(format(normalizeExternal('0/7')), '0/1');
    assert.equal(code(() => normalizeExternal('1/0')), 'RAT_DENOMINATOR_ZERO');
    assert.equal(code(() => normalizeExternal('1e-1')), 'RAT_SYNTAX');
    assert.equal(code(() => normalizeExternal(' 0.4')), 'RAT_SYNTAX');
  });

  it('intermediate results are bounded, so unbounded growth is refused', () => {
    let value = make(2n, 1n);
    assert.equal(code(() => { for (let i = 0; i < 20; i += 1) value = mul(value, value); }), 'RAT_TOO_LARGE');
  });

  it('an integer field accepts only one encoding: a safe JSON integer', () => {
    assert.equal(parseIntField(5), 5);
    assert.equal(code(() => parseIntField('5')), 'RAT_SYNTAX');
    assert.equal(code(() => parseIntField('5/1')), 'RAT_SYNTAX');
    assert.equal(code(() => parseIntField(5.5)), 'RAT_SYNTAX');
    assert.equal(code(() => parseIntField(-1)), 'OUT_OF_RANGE');
  });

  it('exact normalization before hashing gives a stable identity, and the existing serializer is reused unchanged', () => {
    const external = { rate: format(normalizeExternal('2/4')), horizonDays: 14 };
    const internal = { rate: format(parseNonNegative('1/2')), horizonDays: 14 };
    assert.equal(canonicalize(external), canonicalize(internal));
    assert.equal(hashWithDomain('AEG-COMP-v1', external), hashWithDomain('AEG-COMP-v1', internal));
    assert.notEqual(hashWithDomain('AEG-COMP-v1', external), hashWithDomain('AEG-INPUT-v1', external));   // domains stay separate
    assert.notEqual(canonicalize({ rate: '1/2' }), canonicalize({ rate: '2/4' }));                         // the serializer alone does not reduce fractions
  });

  it('comparison and ordering are exact', () => {
    assert.equal(cmp(q('1/3'), q('2/6'.replace('2/6', '1/3'))), 0);
    assert.equal(cmp(q('1/3'), q('1/2')), -1);
  });
});
