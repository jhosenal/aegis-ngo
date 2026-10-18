import { AegisError } from '../engine/errors.js';
import { canonicalize } from '../engine/canonical.js';
import type { Db } from '../data/db.js';
import { ALGORITHM_HASH, FORMULATION_ID, FORMULATION_VERSION } from './formulations/resource-shortfall.js';

export interface FormulationDef {
  formulationId: string;
  semanticVersion: string;
  title: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  units: string[];
  assumptions: string[];
  preconditions: string[];
  deterministicAlgorithmRef: string;
  algorithmHash: string;
  roundingPolicy: string;
  examples: unknown[];
  invalidCases: unknown[];
  owner: string;
  status: 'candidate' | 'tested' | 'active' | 'deprecated';
  effectiveFrom: string;
}

interface FormulationRow {
  formulation_id: string;
  version: string;
  state: FormulationDef['status'];
  algorithm_hash: string;
  spec_json: string;
}

const RESOURCE_SHORTFALL: Omit<FormulationDef, 'effectiveFrom'> = {
  formulationId: FORMULATION_ID,
  semanticVersion: FORMULATION_VERSION,
  title: 'Resource shortfall assessment',
  inputSchema: {
    type: 'object',
    required: ['demand', 'available', 'reserve'],
    additionalProperties: false,
    properties: {
      demand: { type: 'object', required: ['units', 'unitId', 'regionId', 'asOf'], additionalProperties: false, properties: {
        units: { type: 'integer', minimum: 0, maximum: 1_000_000_000 }, unitId: { type: 'string', minLength: 1 }, regionId: { type: 'string', minLength: 1 }, asOf: { type: 'string' },
      } },
      available: { type: 'object', required: ['units', 'unitId', 'regionId', 'asOf'], additionalProperties: false, properties: {
        units: { type: 'integer', minimum: 0, maximum: 1_000_000_000 }, unitId: { type: 'string', minLength: 1 }, regionId: { type: 'string', minLength: 1 }, asOf: { type: 'string' },
      } },
      reserve: { type: 'object', required: ['units', 'unitId', 'regionId', 'asOf'], additionalProperties: false, properties: {
        units: { type: 'integer', minimum: 0, maximum: 1_000_000_000 }, unitId: { type: 'string', minLength: 1 }, regionId: { type: 'string', minLength: 1 }, asOf: { type: 'string' },
      } },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['formulationId', 'formulationVersion', 'algorithmHash', 'canonicalInputHash', 'unitId', 'regionId', 'asOf', 'demandUnits', 'availableUnits', 'reserveUnits', 'usableUnits', 'shortfallUnits', 'surplusUnits'],
    additionalProperties: false,
    properties: {
      formulationId: { type: 'string' }, formulationVersion: { type: 'string' }, algorithmHash: { type: 'string' }, canonicalInputHash: { type: 'string' },
      unitId: { type: 'string' }, regionId: { type: 'string' }, asOf: { type: 'string' }, demandUnits: { type: 'integer' }, availableUnits: { type: 'integer' },
      reserveUnits: { type: 'integer' }, usableUnits: { type: 'integer' }, shortfallUnits: { type: 'integer' }, surplusUnits: { type: 'integer' },
    },
  },
  units: ['resource units'],
  assumptions: ['Demand, available, and reserve values use the same unit, region, and as-of time.'],
  preconditions: ['Inputs are known nonnegative integers.', 'Reserve units do not exceed available units.'],
  deterministicAlgorithmRef: 'src/registry/formulations/resource-shortfall.ts#computeShortfall',
  algorithmHash: ALGORITHM_HASH,
  roundingPolicy: 'Integer quantities are used; no rounding is performed.',
  examples: [],
  invalidCases: [],
  owner: 'Owner',
  status: 'active',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseDefinition(json: string): FormulationDef {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new AegisError('E_INTERNAL', 'Stored formulation is invalid JSON');
  }
  if (!isRecord(value)
    || typeof value.formulationId !== 'string'
    || typeof value.semanticVersion !== 'string'
    || typeof value.title !== 'string'
    || !isRecord(value.inputSchema)
    || !isRecord(value.outputSchema)
    || !isStringArray(value.units)
    || !isStringArray(value.assumptions)
    || !isStringArray(value.preconditions)
    || typeof value.deterministicAlgorithmRef !== 'string'
    || typeof value.algorithmHash !== 'string'
    || typeof value.roundingPolicy !== 'string'
    || !Array.isArray(value.examples)
    || !Array.isArray(value.invalidCases)
    || typeof value.owner !== 'string'
    || !['candidate', 'tested', 'active', 'deprecated'].includes(String(value.status))
    || typeof value.effectiveFrom !== 'string') {
    throw new AegisError('E_INTERNAL', 'Stored formulation is missing required contract fields');
  }
  return value as unknown as FormulationDef;
}

function fromRow(row: FormulationRow): FormulationDef {
  const definition = parseDefinition(row.spec_json);
  if (definition.formulationId !== row.formulation_id
    || definition.semanticVersion !== row.version
    || definition.status !== row.state
    || definition.algorithmHash !== row.algorithm_hash) {
    throw new AegisError('E_INTERNAL', 'Stored formulation metadata does not match its registry row');
  }
  return definition;
}

export function seedFormulations(db: Db, nowIso: string): void {
  const existing = db.prepare(
    'SELECT formulation_id FROM formulation_registry WHERE formulation_id = ? AND version = ?',
  ).get(FORMULATION_ID, FORMULATION_VERSION);
  if (existing) return;

  const definition: FormulationDef = { ...RESOURCE_SHORTFALL, effectiveFrom: nowIso };
  db.prepare(
    'INSERT INTO formulation_registry (formulation_id, version, state, algorithm_hash, spec_json, effective_from) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(definition.formulationId, definition.semanticVersion, definition.status, definition.algorithmHash, canonicalize(definition), definition.effectiveFrom);
}

export function getActiveFormulation(db: Db, id: string, version?: string): FormulationDef {
  if (version !== undefined) {
    const row = db.prepare(
      'SELECT formulation_id, version, state, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = ? AND version = ?',
    ).get(id, version) as FormulationRow | undefined;
    if (!row) throw new AegisError('E_FORMULATION_UNKNOWN');
    if (row.state !== 'active') throw new AegisError('E_FORMULATION_NOT_ACTIVE');
    return fromRow(row);
  }

  const activeRows = db.prepare(
    'SELECT formulation_id, version, state, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = ? AND state = ? ORDER BY version',
  ).all(id, 'active') as FormulationRow[];
  if (activeRows.length > 1) throw new AegisError('E_INTERNAL', 'More than one active formulation version exists');
  if (activeRows.length === 1) return fromRow(activeRows[0]!);

  const existing = db.prepare('SELECT formulation_id FROM formulation_registry WHERE formulation_id = ?').get(id);
  if (existing) throw new AegisError('E_FORMULATION_NOT_ACTIVE');
  throw new AegisError('E_FORMULATION_UNKNOWN');
}
