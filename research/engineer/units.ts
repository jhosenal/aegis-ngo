// Isolated proof of concept: dimensions are not unit labels. A formula is checked by carrying dimension vectors through it.
import { fromInt, make, mul, type Rat } from './rational.js';

/** Exponents of [length, mass, time, count]. */
export type Dim = readonly [number, number, number, number];
export const DIMENSIONLESS: Dim = [0, 0, 0, 0];

export interface UnitDef { id: string; dim: Dim; /** how many of the dimension's base unit one of this unit is, as an exact rational */ toBase: Rat; family: string }

const def = (id: string, dim: Dim, toBase: Rat, family: string): UnitDef => ({ id, dim, toBase, family });
export const UNITS: Readonly<Record<string, UnitDef>> = Object.fromEntries([
  def('persons', [0, 0, 0, 1], fromInt(1n), 'count'),
  def('day', [0, 0, 1, 0], fromInt(86400n), 'time'),
  def('s', [0, 0, 1, 0], fromInt(1n), 'time'),
  def('m', [1, 0, 0, 0], fromInt(1n), 'length'),
  def('mm', [1, 0, 0, 0], make(1n, 1000n), 'length'),
  def('m2', [2, 0, 0, 0], fromInt(1n), 'area'),
  def('m3', [3, 0, 0, 0], fromInt(1n), 'volume'),
  def('L', [3, 0, 0, 0], make(1n, 1000n), 'volume'),        // a litre is a unit of VOLUME: litres and m3 convert, litres and m2 never do
  def('kg', [0, 1, 0, 0], fromInt(1n), 'mass'),
  def('kg/m2', [-2, 1, 0, 0], fromInt(1n), 'areal mass'),
  def('kg/m3', [-3, 1, 0, 0], fromInt(1n), 'density'),
  def('Pa', [-1, 1, -2, 0], fromInt(1n), 'pressure'),
  def('m/s', [1, 0, -1, 0], fromInt(1n), 'speed'),
].map((unit) => [unit.id, unit]));

export const mulDim = (a: Dim, b: Dim): Dim => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
export const divDim = (a: Dim, b: Dim): Dim => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
export const powDim = (a: Dim, n: number): Dim => [a[0] * n, a[1] * n, a[2] * n, a[3] * n];
export const sameDim = (a: Dim, b: Dim): boolean => a.every((value, index) => value === b[index]);
export const dimOf = (unit: string): Dim => (UNITS[unit] ?? (() => { throw new Error(`UNREGISTERED_UNIT ${unit}`); })()).dim;

/** Exact conversion between two units of the SAME dimension. */
export function conversionFactor(from: string, to: string): Rat {
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b) throw new Error('UNREGISTERED_UNIT');
  if (!sameDim(a.dim, b.dim)) throw new Error(`DIMENSION_MISMATCH ${from} -> ${to}`);
  return make(mul(a.toBase, make(b.toBase.d, b.toBase.n)).n, mul(a.toBase, make(b.toBase.d, b.toBase.n)).d);
}

/** Addition and subtraction need equal dimensions. */
export function addDims(a: Dim, b: Dim): Dim {
  if (!sameDim(a, b)) throw new Error(`DIMENSION_MISMATCH cannot add ${a.join(',')} and ${b.join(',')}`);
  return a;
}
