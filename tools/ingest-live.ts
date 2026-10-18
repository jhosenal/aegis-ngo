// One live ingestion run against the real USGS and GDACS feeds, into the configured database. For operators and checks.
// Run: node --env-file-if-exists=.env node_modules/tsx/dist/cli.mjs tools/ingest-live.ts
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/config.js';
import { openDb, projectRoot } from '../src/data/db.js';
import { migrate } from '../src/data/migrate.js';
import { SystemClock } from '../src/engine/clock.js';
import { RandomIdGen } from '../src/engine/ids.js';
import { runLiveIngest } from '../src/services/liveIngest.js';

const config = loadConfig(process.env);
const root = projectRoot();
const db = openDb(config.dbPath === ':memory:' ? config.dbPath : resolve(root, config.dbPath));
try {
  const clock = new SystemClock();
  migrate(db, resolve(root, 'migrations'), clock.now());
  const result = await runLiveIngest({ db, ids: new RandomIdGen(), clock });
  console.log(JSON.stringify(result, null, 1));
} finally {
  db.close();
}
