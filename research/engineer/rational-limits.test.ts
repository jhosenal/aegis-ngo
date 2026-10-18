import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { add, format, LIMITS, make, Meter, mul, normalizeExternal, parseNonNegative, parsePersistedNonNegative, parsePersistedSigned, RationalError, type RationalErrorCode } from './rational.js';

const code = (action: () => unknown): RationalErrorCode | null => {
  try { action(); return null; } catch (error: unknown) { return error instanceof RationalError ? error.code : (() => { throw error; })(); }
};

describe('R5: one lexical limit at every entry point, counted raw before BigInt', () => {
  it('Astra probe: a 41-digit external numerator is refused', () => {
    assert.equal(code(() => normalizeExternal(`${'9'.repeat(41)}/1`)), 'RAT_TOO_LARGE');
    assert.equal(code(() => normalizeExternal(`${'9'.repeat(40)}/1`)), null);
    assert.equal(code(() => normalizeExternal(`1/${'9'.repeat(41)}`)), 'RAT_TOO_LARGE');
  });

  it('leading zeros count: a denominator padded to 41 raw digits is refused even though its value is small', () => {
    assert.equal(code(() => normalizeExternal(`1/${'0'.repeat(40)}1`)), 'RAT_TOO_LARGE');
    assert.equal(code(() => normalizeExternal(`1/${'0'.repeat(39)}1`)), null);
  });

  it('the decimal rule is stated and enforced: integer digits plus fractional digits together, at most 40', () => {
    assert.equal(code(() => normalizeExternal(`${'1'.repeat(21)}.${'1'.repeat(19)}`)), null);            // 40 digits in total
    assert.equal(code(() => normalizeExternal(`${'1'.repeat(21)}.${'1'.repeat(20)}`)), 'RAT_TOO_LARGE'); // 41 in total
    assert.equal(code(() => normalizeExternal(`0.${'0'.repeat(40)}1`)), 'RAT_TOO_LARGE');                // 1 + 41 digits
    assert.equal(code(() => normalizeExternal(`0.${'0'.repeat(38)}1`)), null);
  });

  it('the strict internal parser has the same per-component limit, so no entry point is looser', () => {
    assert.equal(code(() => parseNonNegative(`${'9'.repeat(41)}/1`)), 'RAT_TOO_LARGE');
    assert.equal(code(() => parseNonNegative(`${'9'.repeat(40)}/1`)), null);
  });
});

describe('persisted results: reduced values up to 120 digits can be replayed by a distinct validator', () => {
  const big = `${'1'.repeat(100)}/1`;

  it('the 40-digit parser cannot read a permitted large result, the persisted validator can, and the round trip is exact', () => {
    const product = mul(parseNonNegative(`${'3'.repeat(40)}/1`), parseNonNegative(`${'7'.repeat(40)}/1`));
    const text = format(product);
    assert.ok(text.length > 40);
    assert.equal(code(() => parseNonNegative(text)), 'RAT_TOO_LARGE');
    assert.equal(format(parsePersistedNonNegative(text)), text);
    assert.equal(format(parsePersistedNonNegative(big)), big);
    assert.equal(format(parsePersistedSigned(`-${big}`)), `-${big}`);
  });

  it('the persisted validator keeps the same strict grammar and its own limit', () => {
    assert.equal(code(() => parsePersistedNonNegative('2/4')), 'RAT_NOT_NORMALIZED');
    assert.equal(code(() => parsePersistedNonNegative('+1/2')), 'RAT_SYNTAX');
    assert.equal(code(() => parsePersistedNonNegative(`${'9'.repeat(121)}/1`)), 'RAT_TOO_LARGE');
  });
});

describe('raw temporaries and the operation budget', () => {
  it('two result-sized operands may need a 240-digit temporary; a result that does not reduce below 120 digits is refused', () => {
    const a = parsePersistedNonNegative(`${'9'.repeat(120)}/1`);
    assert.equal(code(() => mul(a, a)), 'RAT_TOO_LARGE');
    const left = parsePersistedNonNegative(`${'9'.repeat(120)}/1`);
    const right = make(1n, 10n ** 119n);
    assert.equal(code(() => mul(left, right)), null);
    assert.equal(LIMITS.maxTemporaryDigits, 2 * LIMITS.maxResultDigits);
    assert.equal(code(() => make(10n ** 250n, 7n)), 'RAT_TOO_LARGE');
  });

  it('an operation budget refuses further work and never rounds or clips', () => {
    const meter = new Meter(5);
    let value = make(1n, 2n);
    assert.equal(code(() => { for (let i = 0; i < 4; i += 1) value = add(value, make(1n, 3n), meter); }), null);
    assert.equal(meter.used, 4);
    assert.equal(code(() => { for (let i = 0; i < 5; i += 1) value = add(value, make(1n, 3n), meter); }), 'BUDGET_EXCEEDED');
  });
});
