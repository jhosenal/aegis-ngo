import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AegisError } from '../engine/errors.js';
import type { Db } from './db.js';

export function migrate(db: Db, dir: string, nowIso: string): { applied: string[]; skipped: string[] } {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  const names = new Set(files);
  const migrationTableExists = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get('schema_migrations') !== undefined;
  const appliedIds = migrationTableExists
    ? new Set(db.prepare('SELECT id FROM schema_migrations').all().map((row) => String((row as { id: unknown }).id)))
    : new Set<string>();

  for (const id of appliedIds) {
    if (!names.has(id)) throw new AegisError('E_INTERNAL', `Applied migration file is missing: ${id}`);
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (appliedIds.has(file)) {
      skipped.push(file);
      continue;
    }

    const sql = readFileSync(join(dir, file), 'utf8');
    const applyFile = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(file, nowIso);
    });
    applyFile();
    applied.push(file);
  }

  return { applied, skipped };
}
