import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { sha256Hex } from '../../src/engine/canonical.js';
import { seedFormulations } from '../../src/registry/formulations.js';
import { adoptLegacy, definitionHash, installLifecycle, parseInstant, LegacyEntrySchema } from './lifecycle.js';
import { BINDINGS_VERIFIED_BY_TRUSTED_RESOLVER, LEGACY_ALLOWLIST } from './legacy-allowlist.js';

const T0 = '2026-10-13T00:00:00Z';
const root = new URL('../../', import.meta.url);
function seeded() {
  const db = openDb(':memory:');
  migrate(db, fileURLToPath(new URL('migrations/', root)), T0);
  seedFormulations(db, T0);
  installLifecycle(db);
  return db;
}

describe('the reviewed legacy allowlist: one exact, hash-bound entry, no expansion', () => {
  it('holds exactly one entry for the frozen shortfall row, valid against the schema, planning use only, no actions', () => {
    assert.equal(LEGACY_ALLOWLIST.length, 1);
    const entry = LegacyEntrySchema.parse(LEGACY_ALLOWLIST[0]);
    assert.equal(`${entry.formulationId}@${entry.version}`, 'AEG.F.RESOURCE-SHORTFALL@1.0.0');
    assert.equal(entry.use, 'PLANNING');
    assert.deepEqual(entry.scope.actions, []);
    assert.equal(Object.isFrozen(LEGACY_ALLOWLIST), true);
  });

  it('is bound to the real frozen definition, its source file and the lockfile', () => {
    const db = seeded();
    const row = db.prepare("SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = 'AEG.F.RESOURCE-SHORTFALL'").get() as Parameters<typeof definitionHash>[0];
    const [entry] = LEGACY_ALLOWLIST;
    assert.equal(definitionHash(row), entry.definitionHash);
    assert.equal(sha256Hex(readFileSync(new URL('src/registry/formulations/resource-shortfall.ts', root))), entry.implementationHash);
    assert.equal(sha256Hex(readFileSync(new URL('package-lock.json', root))), entry.dependencyHash);
  });

  it('adopts that one row, once, and refuses a changed definition', () => {
    const db = seeded();
    assert.equal(adoptLegacy(db, [...LEGACY_ALLOWLIST], { clock: () => parseInstant(T0) }), 1);
    const other = seeded();
    assert.throws(() => adoptLegacy(other, [{ ...LEGACY_ALLOWLIST[0], definitionHash: 'f'.repeat(64) }], { clock: () => parseInstant(T0) }), /NOT_ON_ALLOWLIST|differs/);
  });

  it('the proposed bindings are not treated as verified until a trusted resolver has confirmed them (Astra, 2026-10-14)', () => {
    assert.equal(BINDINGS_VERIFIED_BY_TRUSTED_RESOLVER, false);
  });
});
