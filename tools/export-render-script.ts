// Exports the narration text of a bulletin as at now for the GCP presenter render (AEG-RENDER-001), trimmed to a target length. Narrated sources only
// (USGS, GDACS, NEA PSI, MetMalaysia): Google air and weather never enter a bulletin, so they cannot enter the video. Nothing is stored and no provider is called.
// Run: node --env-file-if-exists=.env node_modules/tsx/dist/cli.mjs tools/export-render-script.ts [--max-seconds 185] [--out render/out/script.txt]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDb } from '../src/data/db.js';
import { SystemClock } from '../src/engine/clock.js';
import { buildDraftNow } from '../src/services/broadcast/generate.js';
import { loadSchedule } from '../src/services/broadcast/schedule.js';

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const maxSeconds = Number(arg('max-seconds') ?? 185);
const out = resolve(arg('out') ?? 'render/out/script.txt');
const base = loadSchedule();
const db = openDb(resolve('data/aegis.db'));
const clock = new SystemClock();

let chosen: ReturnType<typeof buildDraftNow> | null = null;
let kept = base.metMalaysia.keyLocations.length;
for (; kept >= 1; kept -= 1) {
  const schedule = { ...base, metMalaysia: { ...base.metMalaysia, keyLocations: base.metMalaysia.keyLocations.slice(0, kept) } };
  const draft = buildDraftNow({ db, clock, schedule });
  chosen = draft;
  if (draft.problems.length === 0 && draft.bulletin.estimatedSeconds <= maxSeconds) break;
}
if (!chosen) throw new Error('no draft');
const { bulletin, problems } = chosen;
const words = bulletin.segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
console.log(`draft as at ${bulletin.generatedAt}: ${bulletin.estimatedSeconds} s estimated, ${words} words, key locations kept ${Math.max(kept, 1)} of ${base.metMalaysia.keyLocations.length}, validator problems: ${problems.length === 0 ? 'none' : JSON.stringify(problems)}`);
if (problems.length > 0) { console.error('NOT written: the validator found problems'); process.exit(1); }
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${bulletin.segments.map((s) => s.text).join('\n\n')}\n`, 'utf8');
console.log(`written ${out}`);
db.close();
