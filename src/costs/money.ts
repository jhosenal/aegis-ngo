// Exact money arithmetic for the cost-accounting engine (AEG-CON-004). No floating point anywhere: prices and quantities are exact
// rationals, results are whole nano-USD (1 USD = 1,000,000,000 nano-USD) rounded UP so that an estimate never understates a cost.
export interface Rat { n: bigint; d: bigint }   // d > 0n, always reduced

export const NANO_PER_USD = 1_000_000_000n;
const gcd = (a: bigint, b: bigint): bigint => { let x = a < 0n ? -a : a; let y = b < 0n ? -b : b; while (y !== 0n) { [x, y] = [y, x % y]; } return x; };

export class MoneyError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'MoneyError'; }
}

export function rat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new MoneyError('DIV_ZERO', 'zero denominator');
  const g = gcd(n, d) || 1n;
  const sign = d < 0n ? -1n : 1n;
  return { n: (sign * n) / g, d: (sign * d) / g };
}
export const ZERO: Rat = { n: 0n, d: 1n };
export const add = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
export const div = (a: Rat, b: Rat): Rat => rat(a.n * b.d, a.d * b.n);
export const cmp = (a: Rat, b: Rat): number => { const l = a.n * b.d; const r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; };
export const max0 = (a: Rat): Rat => (a.n < 0n ? ZERO : a);
export const minR = (a: Rat, b: Rat): Rat => (cmp(a, b) <= 0 ? a : b);
export const maxR = (a: Rat, b: Rat): Rat => (cmp(a, b) >= 0 ? a : b);

const DECIMAL = /^(0|[1-9]\d{0,17})(\.\d{1,18})?$/;

/** A non-negative decimal text (at most 18 integer digits and 18 fractional digits) as an exact rational. Anything else is refused. */
export function parseDecimal(text: string): Rat {
  if (typeof text !== 'string' || !DECIMAL.test(text)) throw new MoneyError('BAD_DECIMAL', `not an accepted non-negative decimal: ${String(text).slice(0, 40)}`);
  const [whole, frac = ''] = text.split('.');
  return rat(BigInt(whole + frac), 10n ** BigInt(frac.length));
}

/** A USD price or amount written as decimal USD, converted to exact nano-USD. */
export function usdToNano(text: string): Rat { return mul(parseDecimal(text), rat(NANO_PER_USD)); }

/** Round up to whole nano-USD. A negative or zero value is 0. */
export function ceilNano(value: Rat): bigint {
  if (value.n <= 0n) return 0n;
  return (value.n + value.d - 1n) / value.d;
}

/** Exact whole nano-USD back to a USD decimal text with at least 2 and at most 9 fractional digits. */
export function formatUsd(nano: bigint): string {
  const negative = nano < 0n;
  const abs = negative ? -nano : nano;
  const whole = abs / NANO_PER_USD;
  let frac = (abs % NANO_PER_USD).toString().padStart(9, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/** Whole nano-USD as an exact rational USD value (for comparisons against decision-table thresholds). */
export const nanoToUsdRat = (nano: bigint): Rat => rat(nano, NANO_PER_USD);
