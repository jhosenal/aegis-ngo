import { resolve } from 'node:path';
import { loadConfig } from '../config/config.js';
import { openDb, projectRoot } from '../data/db.js';
import { migrate } from '../data/migrate.js';
import { FixedClock } from '../engine/clock.js';
import { RandomIdGen } from '../engine/ids.js';
import { fixedNowFromFixture, seedAll } from './seed.js';

function main(): void {
  const config = loadConfig(process.env);
  const root = projectRoot();
  const fixturesDir = resolve(root, 'fixtures');
  const dbPath = config.dbPath === ':memory:' ? ':memory:' : resolve(root, config.dbPath);
  const clock = new FixedClock(fixedNowFromFixture(fixturesDir));
  const db = openDb(dbPath);
  try {
    migrate(db, resolve(root, 'migrations'), clock.now());
    const result = seedAll(db, fixturesDir, clock, new RandomIdGen());
    console.log(JSON.stringify(result));
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
}
