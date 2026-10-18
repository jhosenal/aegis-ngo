// GOLDEN (frozen by ADR-003). Pure: no clock, no network, no model.
import { AegisError } from '../../engine/errors.js';
import { hashWithDomain, sha256Hex } from '../../engine/canonical.js';

export const FORMULATION_ID = 'AEG.F.RESOURCE-SHORTFALL';
export const FORMULATION_VERSION = '1.0.0';
export const MAX_UNITS = 1_000_000_000;

export interface Quantity { units: number | null; unitId: string; regionId: string; asOf: string }
export interface ShortfallInput { demand: Quantity; available: Quantity; reserve: Quantity }
export interface ShortfallOutput {
  formulationId: string; formulationVersion: string; algorithmHash: string; canonicalInputHash: string;
  unitId: string; regionId: string; asOf: string;
  demandUnits: number; availableUnits: number; reserveUnits: number;
  usableUnits: number; shortfallUnits: number; surplusUnits: number;
}

export const ALGORITHM_SPEC =
  'AEG.F.RESOURCE-SHORTFALL/1.0.0|ints 0..1e9|same unitId,regionId,asOf across demand,available,reserve|reserve<=available|' +
  'usable=available-reserve|shortfall=max(0,demand-usable)|surplus=max(0,usable-demand)|null is rejected not zero';
export const ALGORITHM_HASH = sha256Hex(ALGORITHM_SPEC);

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function checkQty(name: string, q: Quantity): number {
  if (q === null || typeof q !== 'object') throw new AegisError('E_INPUT_MISSING', `${name} missing`);
  if (q.units === null || q.units === undefined) throw new AegisError('E_INPUT_NULL', `${name}.units is unknown (null); unknown is never treated as zero`, { field: name });
  if (!Number.isSafeInteger(q.units) || q.units < 0 || q.units > MAX_UNITS) throw new AegisError('E_INPUT_NOT_NONNEG_INT', `${name}.units must be integer 0..${MAX_UNITS}`, { field: name });
  if (typeof q.unitId !== 'string' || !q.unitId) throw new AegisError('E_UNIT_MISSING', `${name}.unitId required`, { field: name });
  if (typeof q.regionId !== 'string' || !q.regionId) throw new AegisError('E_REGION_MISSING', `${name}.regionId required`, { field: name });
  if (typeof q.asOf !== 'string' || !ISO_Z.test(q.asOf) || Number.isNaN(Date.parse(q.asOf))) throw new AegisError('E_ASOF_INVALID', `${name}.asOf must be ISO-8601 UTC with Z`, { field: name });
  return q.units;
}

export function computeShortfall(input: ShortfallInput): ShortfallOutput {
  const demandUnits = checkQty('demand', input?.demand);
  const availableUnits = checkQty('available', input?.available);
  const reserveUnits = checkQty('reserve', input?.reserve);
  const { demand, available, reserve } = input;
  if (demand.unitId !== available.unitId || demand.unitId !== reserve.unitId) throw new AegisError('E_UNIT_MISMATCH');
  if (demand.regionId !== available.regionId || demand.regionId !== reserve.regionId) throw new AegisError('E_REGION_MISMATCH');
  if (demand.asOf !== available.asOf || demand.asOf !== reserve.asOf) throw new AegisError('E_ASOF_MISMATCH');
  if (reserveUnits > availableUnits) throw new AegisError('E_RESERVE_EXCEEDS_AVAILABLE');
  const usableUnits = availableUnits - reserveUnits;
  return {
    formulationId: FORMULATION_ID, formulationVersion: FORMULATION_VERSION, algorithmHash: ALGORITHM_HASH,
    canonicalInputHash: hashWithDomain('AEG-INPUT-v1', input),
    unitId: demand.unitId, regionId: demand.regionId, asOf: demand.asOf,
    demandUnits, availableUnits, reserveUnits, usableUnits,
    shortfallUnits: Math.max(0, demandUnits - usableUnits),
    surplusUnits: Math.max(0, usableUnits - demandUnits),
  };
}
