import { resolve } from 'node:path';
import { loadConfig } from '../config/config.js';
import { SystemClock } from '../engine/clock.js';
import { openDb, projectRoot } from './db.js';
import { migrate } from './migrate.js';

function main(): void {
  const config = loadConfig(process.env);
  const dbPath = config.dbPath === ':memory:' ? ':memory:' : resolve(projectRoot(), config.dbPath);
  const db = openDb(dbPath);
  try {
    const result = migrate(db, resolve(projectRoot(), 'migrations'), new SystemClock().now());
    for (const file of result.applied) console.log(file);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
}
