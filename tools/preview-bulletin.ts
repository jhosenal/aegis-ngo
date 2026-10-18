// Prints the bulletin the generator would write if a capture happened NOW (or at --at ISO), from the live database. Nothing is stored and no network call is made.
// Run: node node_modules/tsx/dist/cli.mjs tools/preview-bulletin.ts [--at 2026-10-16T13:00:00Z] [--db data/aegis.db]
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { latestPsiFetchedBy } from '../src/data/repos/airReadings.js';
import { listEvidence, listSourceStatuses } from '../src/data/repos/evidence.js';
import { latestSnapshotFetchedBy } from '../src/data/repos/officialSnapshots.js';
import { releasedPsiAdvice } from '../src/services/broadcast/advice.js';
import { buildFactSheet } from '../src/services/broadcast/factSheet.js';
import { latestCapture, loadSchedule, nextCapture } from '../src/services/broadcast/schedule.js';
import { buildScript, validateScript } from '../src/services/broadcast/script.js';
import type { ForecastPayload } from '../src/services/metMyIngest.js';
import { METMY_FORECAST_ID, METMY_WARNINGS_ID, type MetWarning } from '../src/sources/metMy.js';
import { PSI_SOURCE_ID } from '../src/sources/psi.js';

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const now = arg('at') ?? new Date().toISOString();
const db = new Database(resolve(arg('db') ?? 'data/aegis.db'), { readonly: true }) as never as import('../src/data/db.js').Db;
const schedule = loadSchedule();
const { slot, airAt } = latestCapture(schedule, now);
const captureAt = now;            // a preview: "as if the capture were now"
const following = nextCapture(schedule, new Date(Date.parse(now) + 1000).toISOString());
const cutoff = new Date(Date.parse(captureAt) + 5 * 60_000).toISOString();
const facts = buildFactSheet({
  schedule, slot, captureAt, airAt, evidence: listEvidence(db), statuses: listSourceStatuses(db),
  psi: latestPsiFetchedBy(db, PSI_SOURCE_ID, cutoff), adviceFor: (band) => releasedPsiAdvice(band),
  metMy: { warnings: latestSnapshotFetchedBy<MetWarning[]>(db, METMY_WARNINGS_ID, cutoff), forecast: latestSnapshotFetchedBy<ForecastPayload>(db, METMY_FORECAST_ID, cutoff) },
});
const b = buildScript({ schedule, facts, greeting: slot.greeting, nextAirLocal: following.slot.airLocal, generatedAt: now, bulletinId: 'PREVIEW' });
console.log(`PREVIEW as at ${captureAt}  (estimated ${b.estimatedSeconds} s)  problems: ${JSON.stringify(validateScript(b, facts, schedule))}\n`);
for (const s of b.segments) console.log(`--- ${s.id} [${s.durationSec}s]\n${s.text}\n    LT: ${s.lowerThird}\n`);
console.log(b.credits.lines.map((l) => `  ${l}`).join('\n'));
