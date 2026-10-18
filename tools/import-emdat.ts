// Reads an EM-DAT CSV export, matches it to the history cards and writes data/emdat-overrides.json (git-ignored).
// Run: node node_modules/tsx/dist/cli.mjs tools/import-emdat.ts <emdat-export.csv>
// Then build the history with the figures merged: node tools/build-history-extra.mjs --include-emdat
// Read src/sources/emdat.ts first: the column mapping has not been run on a real export, and EM-DAT's licence is non-commercial.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figuresOf, matchRecords, parseCsv, readRecords, type MatchCard } from '../src/sources/emdat.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = process.argv[2];
if (!file) { console.error('Usage: import-emdat.ts <emdat-export.csv>'); process.exit(2); }
const bytes = readFileSync(file);
const { records, unmapped, missingRequired } = readRecords(parseCsv(bytes.toString('utf8')));
if (missingRequired.length > 0) { console.error(`Cannot map required columns: ${missingRequired.join(', ')}. Unmapped headers: ${unmapped.join(' | ')}`); process.exit(3); }
const history = JSON.parse(readFileSync(`${root}content/history/hazard-history.json`, 'utf8')) as { cards: (MatchCard & { glide?: string | null })[] };
const report = matchRecords(records, history.cards);
const overrides = Object.fromEntries(report.matched.map((m) => [m.cardId, {
  source: 'EM-DAT, CRED / UCLouvain', basis: m.basis, disNo: m.record.disNo, figures: figuresOf(m.record),
  note: 'Figures from the EM-DAT export supplied by the owner (non-commercial licence; cite EM-DAT, CRED / UCLouvain, Brussels).',
}]));
mkdirSync(`${root}data`, { recursive: true });
writeFileSync(`${root}data/emdat-overrides.json`, `${JSON.stringify({
  importedAt: new Date().toISOString(), file: file.split(/[\\/]/).pop(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  fileModified: statSync(file).mtime.toISOString(), overrides,
}, null, 1)}\n`);
console.log(JSON.stringify({ records: records.length, matched: report.matched.length, byGlide: report.matched.filter((m) => m.basis === 'glide').length,
  ambiguous: report.ambiguous.length, unmatched: report.unmatched.length, unmappedColumns: unmapped }, null, 1));
