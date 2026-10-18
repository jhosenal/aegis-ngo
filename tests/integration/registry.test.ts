import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../src/engine/canonical.js';
import { AegisError } from '../../src/engine/errors.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { getActiveFormulation, seedFormulations, type FormulationDef } from '../../src/registry/formulations.js';

describe('formulation registry', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db, fileURLToPath(new URL('../../migrations/', import.meta.url)), '2026-10-13T01:00:00Z');
  });

  afterEach(() => {
    db.close();
  });

  it('seed is idempotent and stores the golden hash', () => {
    seedFormulations(db, '2026-10-13T01:00:00Z');
    seedFormulations(db, '2026-10-14T01:00:00Z');

    const rows = db.prepare('SELECT algorithm_hash, spec_json, effective_from FROM formulation_registry').all() as Array<{
      algorithm_hash: string;
      spec_json: string;
      effective_from: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.algorithm_hash).toBe('1fd27b8a48713b2d7583d8df4f4a3b902d2573900b2eb4713c9f95dcc3ac2ef6');
    expect(rows[0]!.effective_from).toBe('2026-10-13T01:00:00Z');
    expect(rows[0]!.spec_json).toBe(canonicalize(JSON.parse(rows[0]!.spec_json) as unknown));

    const definition = getActiveFormulation(db, 'AEG.F.RESOURCE-SHORTFALL');
    expect(definition).toMatchObject({
      formulationId: 'AEG.F.RESOURCE-SHORTFALL',
      semanticVersion: '1.0.0',
      status: 'active',
      effectiveFrom: '2026-10-13T01:00:00Z',
      algorithmHash: '1fd27b8a48713b2d7583d8df4f4a3b902d2573900b2eb4713c9f95dcc3ac2ef6',
    });
    expect(definition.inputSchema).toMatchObject({ type: 'object', required: ['demand', 'available', 'reserve'] });
    expect(definition.outputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['shortfallUnits', 'surplusUnits']) });
    expect(definition.deterministicAlgorithmRef).toBe('src/registry/formulations/resource-shortfall.ts#computeShortfall');
  });

  it('unknown version refused', () => {
    seedFormulations(db, '2026-10-13T01:00:00Z');
    expect(() => getActiveFormulation(db, 'AEG.F.RESOURCE-SHORTFALL', '9.9.9'))
      .toThrowError(expect.objectContaining({ code: 'E_FORMULATION_UNKNOWN' }));
  });

  it('candidate is not executable', () => {
    seedFormulations(db, '2026-10-13T01:00:00Z');
    const active = getActiveFormulation(db, 'AEG.F.RESOURCE-SHORTFALL');
    const candidate: FormulationDef = {
      ...active,
      formulationId: 'AEG.F.CANDIDATE',
      semanticVersion: '0.1.0',
      status: 'candidate',
    };
    db.prepare(
      'INSERT INTO formulation_registry (formulation_id, version, state, algorithm_hash, spec_json, effective_from) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(candidate.formulationId, candidate.semanticVersion, candidate.status, candidate.algorithmHash, canonicalize(candidate), candidate.effectiveFrom);

    expect(() => getActiveFormulation(db, 'AEG.F.CANDIDATE', '0.1.0'))
      .toThrowError(expect.objectContaining({ code: 'E_FORMULATION_NOT_ACTIVE' }));
  });

  it('active version cannot be rewritten', () => {
    seedFormulations(db, '2026-10-13T01:00:00Z');
    expect(() => db.prepare(
      'UPDATE formulation_registry SET algorithm_hash = ? WHERE formulation_id = ? AND version = ?',
    ).run('changed', 'AEG.F.RESOURCE-SHORTFALL', '1.0.0')).toThrow();
  });
});
