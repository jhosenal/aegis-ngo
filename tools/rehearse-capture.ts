// Dry rehearsal of a bulletin capture (AEG-NEWS-004). Copies the live database to a temporary file, runs the SAME polls a capture does (USGS, GDACS, NEA PSI, MetMalaysia)
// against the copy, builds the bulletin as at now, and prints what it would say with preflight checks. The live database and the live server are not touched.
// Run: node --env-file-if-exists=.env node_modules/tsx/dist/cli.mjs tools/rehearse-capture.ts [--out data/rehearsal.txt]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { decideRelease, readReleaseRecord } from '../src/assist/release.js';
import { loadAssistContent } from '../src/assist/content.js';
import { openDb } from '../src/data/db.js';
import { latestPsiFetchedBy } from '../src/data/repos/airReadings.js';
import { listEvidence, listSourceStatuses } from '../src/data/repos/evidence.js';
import { latestSnapshotFetchedBy } from '../src/data/repos/officialSnapshots.js';
import { SystemClock } from '../src/engine/clock.js';
import { RandomIdGen } from '../src/engine/ids.js';
import { releasedPsiAdvice } from '../src/services/broadcast/advice.js';
import { buildFactSheet } from '../src/services/broadcast/factSheet.js';
import { latestCapture, loadSchedule, nextCapture } from '../src/services/broadcast/schedule.js';
import { buildScript, validateScript } from '../src/services/broadcast/script.js';
import { runLiveIngest } from '../src/services/liveIngest.js';
import { runMetMyIngest, type ForecastPayload } from '../src/services/metMyIngest.js';
import { runPsiIngest } from '../src/services/psiIngest.js';
import { METMY_FORECAST_ID, METMY_WARNINGS_ID, type MetWarning } from '../src/sources/metMy.js';
import { PSI_SOURCE_ID } from '../src/sources/psi.js';

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const lines: string[] = [];
const say = (s = ''): void => { lines.push(s); console.log(s); };

const clock = new SystemClock();
const schedule = loadSchedule();
const started = clock.now();
const dir = mkdtempSync(join(tmpdir(), 'aegis-rehearsal-'));
const copy = join(dir, 'aegis.db');
try {
  const live = new Database(resolve('data/aegis.db'), { readonly: true });
  await live.backup(copy);
  live.close();
  const db = openDb(copy);

  say(`REHEARSAL at ${started} (${new Date(Date.parse(started) + 8 * 3_600_000).toISOString().slice(11, 16)} MYT)`);
  const next = nextCapture(schedule, started);
  const due = latestCapture(schedule, started);
  say(`next capture: ${next.slot.id} at ${next.captureAt} for air ${next.airAt} | latest capture was ${due.slot.id} at ${due.captureAt}`);

  // --- preflight: the live server and the guidance release ---
  try {
    const h = await fetch('http://127.0.0.1:8787/api/health', { signal: AbortSignal.timeout(5000) });
    say(`server :8787 health: HTTP ${h.status}`);
  } catch { say('server :8787 health: NOT REACHABLE'); }
  const content = loadAssistContent({ draftMedical: false, allowFixture: false });
  const rel = decideRelease(readReleaseRecord(), content.hash);
  say(`guidance release: ${rel.released ? 'RELEASED' : 'HELD'} (${rel.reason}); content hash ${content.hash.slice(0, 12)}`);

  // --- the same polls a capture makes, into the COPY ---
  const live1 = await runLiveIngest({ db, ids: new RandomIdGen(), clock });
  const psi = await runPsiIngest({ db, clock });
  const my = await runMetMyIngest({ db, clock });
  say(`polls into the copy: usgs=${live1.usgs.outcome}(${live1.usgs.kept} kept) gdacs=${live1.gdacs.outcome}(${live1.gdacs.kept} kept) psi=${psi.outcome}${psi.observedAt ? ` observed ${psi.observedAt}` : ''} metmy warnings=${my.warnings.outcome}(${my.warnings.count}) forecast=${my.forecast.outcome}`);
  for (const s of listSourceStatuses(db)) if (/LIVE$/.test(s.sourceId)) say(`  source ${s.sourceId}: ${s.state}, last ok ${s.lastOkAt ?? 'never'}`);

  // --- the bulletin as at now ---
  const now = clock.now();
  const cutoff = new Date(Date.parse(now) + 5 * 60_000).toISOString();
  const facts = buildFactSheet({
    schedule, slot: next.slot, captureAt: now, airAt: next.airAt, evidence: listEvidence(db), statuses: listSourceStatuses(db),
    psi: latestPsiFetchedBy(db, PSI_SOURCE_ID, cutoff), adviceFor: (band) => releasedPsiAdvice(band),
    metMy: { warnings: latestSnapshotFetchedBy<MetWarning[]>(db, METMY_WARNINGS_ID, cutoff), forecast: latestSnapshotFetchedBy<ForecastPayload>(db, METMY_FORECAST_ID, cutoff) },
  });
  const bulletin = buildScript({ schedule, facts, greeting: next.slot.greeting, nextAirLocal: nextCapture(schedule, new Date(Date.parse(next.captureAt) + 1000).toISOString()).slot.airLocal, generatedAt: now, bulletinId: 'REHEARSAL' });
  const problems = validateScript(bulletin, facts, schedule);
  say(`validator problems: ${problems.length === 0 ? 'none' : JSON.stringify(problems)}`);
  say(`estimated length: ${bulletin.estimatedSeconds} s | segments: ${bulletin.segments.map((s) => s.id).join(', ')}`);
  say(`facts: events in SG/MY/BN ${facts.countries.reduce((n, c) => n + c.incidents.length, 0)}, major elsewhere ${facts.majorElsewhere.length}, PSI ${facts.psi ? `${facts.psi.topBand} (highest ${facts.psi.regions[0]!.psi})` : 'none'}, advice lines ${facts.advice.length}, MetMalaysia warnings ${facts.metMy?.warnings.length ?? 'n/a'}, haze districts ${facts.metMy?.hazeCount ?? 'n/a'}`);
  say('');
  for (const s of bulletin.segments) { say(`--- ${s.id} [${s.durationSec}s]`); say(s.text); say(`    LT: ${s.lowerThird}`); say(''); }
  for (const l of bulletin.credits.lines) say(`  ${l}`);
  say('');
  say(rel.released ? 'Guidance is released: the advice lines above are included.' : 'Guidance is HELD: no NEA advice or hydration line is in this text. Releasing before the real capture adds them.');
  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const out = arg('out');
if (out) writeFileSync(resolve(out), `${lines.join('\n')}\n`, 'utf8');
