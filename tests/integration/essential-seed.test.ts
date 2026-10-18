import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { loadEssentialSeedIfEmpty } from '../../src/data/essentialSeed.js';
import { countByCategory } from '../../src/data/repos/essentialPlaces.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const place = (id: string, name: string) => ({ osmId: id, category: 'clinic', name, lat: 3.2, lng: 101.7, phone: null, website: null, address: null, operator: null });

describe('essential places seed', () => {
  it('fills an empty table once, leaves a filled one alone and ignores a missing file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'seed-'));
    try {
      const file = join(tmp, 'seed.json.gz');
      writeFileSync(file, gzipSync(Buffer.from(JSON.stringify({ fetchedAt: '2026-10-17T00:00:00Z', places: [place('node/1', 'A'), place('node/2', 'B')] }))));
      const db = openDb(':memory:'); migrate(db, dir, '2026-10-13T00:00:00Z');
      expect(loadEssentialSeedIfEmpty(db, join(tmp, 'missing.gz'), '2026-10-17T00:00:00Z')).toBe(0);
      expect(loadEssentialSeedIfEmpty(db, file, '2026-10-17T00:00:00Z')).toBe(2);
      expect(countByCategory(db)).toEqual({ clinic: 2 });
      expect(loadEssentialSeedIfEmpty(db, file, '2026-10-17T00:00:00Z')).toBe(0);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
