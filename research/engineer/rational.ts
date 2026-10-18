// Isolated proof of concept (not wired into the application). Exact rational arithmetic over BigInt with a strict typed encoding.
// Never uses Number, parseFloat or floating point to reduce, compare or multiply.

export const LIMITS = {
  /** Digits allowed in each component of a value accepted from outside (an external adapter, a record, a table). Counted raw, before any normalization. */
  maxInputDigits: 40,
  /** Digits allowed in a reduced result that is persisted and replayed. */
  maxResultDigits: 120,
  /** Raw temporaries before reduction: the product of two result-sized operands is at most twice the result size. */
  maxTemporaryDigits: 240,
  frozenMax: 1_000_000_000n, // the frozen shortfall function accepts integer units 0..1e9
};

export type RationalErrorCode =
  | 'RAT_SYNTAX' | 'RAT_NOT_NORMALIZED' | 'RAT_DENOMINATOR_ZERO' | 'RAT_TOO_LARGE' | 'RAT_NEGATIVE' | 'NOT_REPRESENTABLE' | 'OUT_OF_RANGE' | 'BUDGET_EXCEEDED';
export class RationalError extends Error {
  constructor(public readonly code: RationalErrorCode, message?: string) { super(message ?? code); this.name = 'RationalError'; }
}

/** Always reduced, denominator above zero. A signed value carries its sign in n. */
export interface Rat { readonly n: bigint; readonly d: bigint }

const abs = (value: bigint): bigint => (value < 0n ? -value : value);
export function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) { [x, y] = [y, x % y]; }
  return x;
}
const digits = (value: bigint): number => abs(value).toString().length;

/** An operation budget. Every metered operation spends one unit; an exhausted budget refuses further work and never rounds or clips. */
export class Meter {
  private spent = 0;
  constructor(public readonly limit: number) {}
  tick(): void { this.spent += 1; if (this.spent > this.limit) throw new RationalError('BUDGET_EXCEEDED', `more than ${this.limit} operations`); }
  get used(): number { return this.spent; }
}

export function make(n: bigint, d: bigint, meter?: Meter): Rat {
  meter?.tick();
  if (d === 0n) throw new RationalError('RAT_DENOMINATOR_ZERO');
  if (digits(n) > LIMITS.maxTemporaryDigits || digits(d) > LIMITS.maxTemporaryDigits) throw new RationalError('RAT_TOO_LARGE', 'temporary exceeds the raw bound');
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d);
  const divisor = g === 0n ? 1n : g;
  const reduced = { n: (n * sign) / divisor, d: abs(d) / divisor };
  if (digits(reduced.n) > LIMITS.maxResultDigits || digits(reduced.d) > LIMITS.maxResultDigits) throw new RationalError('RAT_TOO_LARGE');
  return reduced;
}
export const fromInt = (value: bigint): Rat => make(value, 1n);
export const ZERO: Rat = fromInt(0n);

export const add = (a: Rat, b: Rat, m?: Meter): Rat => make(a.n * b.d + b.n * a.d, a.d * b.d, m);
export const sub = (a: Rat, b: Rat, m?: Meter): Rat => make(a.n * b.d - b.n * a.d, a.d * b.d, m);
export const mul = (a: Rat, b: Rat, m?: Meter): Rat => make(a.n * b.n, a.d * b.d, m);
export function div(a: Rat, b: Rat, m?: Meter): Rat {
  if (b.n === 0n) throw new RationalError('RAT_DENOMINATOR_ZERO', 'division by zero');
  return make(a.n * b.d, a.d * b.n, m);
}
export const cmp = (a: Rat, b: Rat): -1 | 0 | 1 => {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
};
export const isInteger = (a: Rat): boolean => a.d === 1n;
export const maxZero = (a: Rat): Rat => (a.n < 0n ? ZERO : a);

/** Euclidean division: floor for a positive denominator. */
export function floor(a: Rat): bigint {
  const q = a.n / a.d;
  return a.n < 0n && a.n % a.d !== 0n ? q - 1n : q;
}
export const ceil = (a: Rat): bigint => -floor(make(-a.n, a.d));

// ---------- typed encodings ----------
const NONNEG = /^(0|[1-9][0-9]*)\/([1-9][0-9]*)$/;
const SIGNED = /^(0|-?[1-9][0-9]*)\/([1-9][0-9]*)$/;

function checkLength(text: string, perComponent: number): void {
  if (typeof text !== 'string') throw new RationalError('RAT_SYNTAX', 'rational fields are strings');
  if (text.length > 2 * perComponent + 3) throw new RationalError('RAT_TOO_LARGE', 'rational text is too long');
}

function parseStrict(text: string, pattern: RegExp, allowNegative: boolean, perComponent: number): Rat {
  checkLength(text, perComponent);
  const match = pattern.exec(text);
  if (!match) {
    if (/^-/.test(text) && !allowNegative) throw new RationalError('RAT_NEGATIVE');
    if (/^[-0-9]+\/0+$/.test(text)) throw new RationalError('RAT_DENOMINATOR_ZERO');
    throw new RationalError('RAT_SYNTAX', 'no plus sign, leading zeros, whitespace, exponent or negative zero');
  }
  const nText = match[1] as string;
  const dText = match[2] as string;
  // Lexical limit BEFORE any BigInt conversion.
  if (nText.replace('-', '').length > perComponent || dText.length > perComponent) throw new RationalError('RAT_TOO_LARGE');
  const n = BigInt(nText);
  const d = BigInt(dText);
  if (gcd(n, d) !== 1n && !(n === 0n && d === 1n)) throw new RationalError('RAT_NOT_NORMALIZED', `${text} is not in lowest terms`);
  return { n, d };
}

/** The canonical internal form of a nonnegative rational field: "n/d", lowest terms, zero is exactly "0/1", whole numbers are "n/1". At most 40 digits per component. */
export const parseNonNegative = (text: string): Rat => parseStrict(text, NONNEG, false, LIMITS.maxInputDigits);
/** A separately declared signed type for values that may be negative. */
export const parseSigned = (text: string): Rat => parseStrict(text, SIGNED, true, LIMITS.maxInputDigits);
/** Persisted-result validators: the same strict grammar, with the larger bound that reduced results may reach (up to 120 digits per component). Used only for replay of stored results. */
export const parsePersistedNonNegative = (text: string): Rat => parseStrict(text, NONNEG, false, LIMITS.maxResultDigits);
export const parsePersistedSigned = (text: string): Rat => parseStrict(text, SIGNED, true, LIMITS.maxResultDigits);
export const format = (a: Rat): string => `${a.n}/${a.d}`;

/**
 * External adapters may accept equivalent spellings and normalize them: non-reduced fractions ("2/4"), whole numbers ("3") and plain decimals ("0.4").
 * ONE limit applies at every entry point: at most 40 digits per component of a fraction, and at most 40 digits in total (integer part plus fractional
 * part) of a decimal. Counted raw, before BigInt conversion. No exponent, no whitespace, no plus sign, no floats.
 */
export function normalizeExternal(text: string): Rat {
  checkLength(text, LIMITS.maxInputDigits);
  let match = /^(-?)(0|[1-9][0-9]*)\/(0*[1-9][0-9]*|0+)$/.exec(text);
  if (match) {
    const nText = match[2] as string;
    const dText = match[3] as string;
    if (nText.length > LIMITS.maxInputDigits || dText.length > LIMITS.maxInputDigits) throw new RationalError('RAT_TOO_LARGE');
    const d = BigInt(dText);
    if (d === 0n) throw new RationalError('RAT_DENOMINATOR_ZERO');
    const n = BigInt(nText);
    if (match[1] === '-' && n === 0n) throw new RationalError('RAT_SYNTAX', 'negative zero');
    return make(match[1] === '-' ? -n : n, d);
  }
  match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(text);
  if (match) {
    const fraction = match[3] ?? '';
    if ((match[2] as string).length + fraction.length > LIMITS.maxInputDigits) throw new RationalError('RAT_TOO_LARGE', 'decimal digits (integer plus fraction) exceed the limit');
    const n = BigInt(`${match[2]}${fraction}`);
    if (match[1] === '-' && n === 0n) throw new RationalError('RAT_SYNTAX', 'negative zero');
    return make(match[1] === '-' ? -n : n, 10n ** BigInt(fraction.length));
  }
  throw new RationalError('RAT_SYNTAX', 'unrecognized external number');
}

// ---------- integer fields: one encoding per field type ----------
/** A safe JSON integer. A caller may not pass "1" or "1/1" to an integer field. */
export function parseIntField(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new RationalError('RAT_SYNTAX', 'integer fields are safe JSON integers');
  if (value < min || value > max) throw new RationalError('OUT_OF_RANGE');
  return value;
}

// ---------- unit conversion and the frozen adapter range ----------
/** Exact conversion is always possible; representability in integer subunits is a separate check. */
export function toSubunits(quantity: Rat, subunitsPerUnit: bigint): bigint {
  if (subunitsPerUnit <= 0n) throw new RationalError('RAT_SYNTAX', 'conversion factor must be positive');
  const exact = mul(quantity, fromInt(subunitsPerUnit));
  if (!isInteger(exact)) throw new RationalError('NOT_REPRESENTABLE', `${format(exact)} subunits is not a whole number`);
  return exact.n;
}
export function checkFrozenRange(value: bigint): bigint {
  if (value < 0n || value > LIMITS.frozenMax) throw new RationalError('OUT_OF_RANGE', 'outside 0..1,000,000,000');
  return value;
}
