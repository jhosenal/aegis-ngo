// Writes a new baseline snapshot record (AEG-BAS-nnn): the manifest of every project file (path, bytes, SHA-256), the two roots the verifier checks, the receipt, and an empty declared-changes record bound to it.
// It never rewrites an earlier snapshot. It is a documentation and evidence snapshot: NOT an OAG seal, NOT signed, NOT product acceptance. Run from the project root:
//   node tools/make-snapshot.mjs --id AEG-BAS-003 --predecessor AEG-BAS-002 --date 2026-10-17 --scope "text" [--remarks-file file.json]
// Files come from `git ls-files -co --exclude-standard` (tracked and untracked but not ignored), so secrets in .gitignore and the database never enter it. Verify with: node tools/verify-handover.mjs --manifest <manifest> --strict
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const id = arg('id'); const predecessor = arg('predecessor'); const date = arg('date'); const scope = arg('scope');
if (!id || !/^AEG-BAS-\d{3}$/.test(id) || !predecessor || !date || !scope) { console.error('usage: --id AEG-BAS-nnn --predecessor AEG-BAS-nnn --date YYYY-MM-DD --scope "text" [--remarks-file file.json]'); process.exit(2); }
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Folders and files that are generated, bulky evidence, local data or build output. They are listed in the manifest so the snapshot says exactly what it leaves out. */
const EXCLUDED_PREFIXES = ['data/', 'node_modules/', 'ui/dist/', 'ui/node_modules/', 'runtime/', 'coverage/', 'dist/', 'research/', 'export/', 'import/', 'render/out/', 'render/local/', 'records/e2e/', 'records/reviews/', 'records/screenshots/', 'records/snapshots/'];
const EXCLUDED_FILES = ['sodl.html', 'map-default-check.png'];
const baseName = `${id}_${date}`;
const selfPaths = new Set([`records/baselines/${baseName}_manifest.json`, `records/baselines/${baseName}_manifest.sha256`, `records/baselines/${baseName}_expected-changes.json`]);

const listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);
const safe = (p) => !p.includes('\\') && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').some((x) => x === '..' || x === '.' || x === '');
const files = []; const skipped = { excluded: 0, unsafe: [], missing: 0 };
for (const p of [...new Set(listed)].sort()) {
  if (selfPaths.has(p)) continue;
  if (EXCLUDED_FILES.includes(p) || EXCLUDED_PREFIXES.some((x) => p.startsWith(x))) { skipped.excluded += 1; continue; }
  if (!safe(p)) { skipped.unsafe.push(p); continue; }
  const full = resolve(root, p); if (!existsSync(full)) { skipped.missing += 1; continue; }
  const bytes = readFileSync(full); files.push({ path: p, bytes: bytes.length, sha256: sha(bytes) });
}
files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const combinedDnaRoot = '0x' + sha(files.map((f) => f.sha256).join(''));
const pathBoundRoot = '0x' + sha(files.map((f) => `${f.path}\t${f.bytes}\t${f.sha256}\n`).join(''));
const remarks = arg('remarks-file') ? JSON.parse(readFileSync(resolve(root, arg('remarks-file')), 'utf8')) : [];
const manifest = { schemaVersion: 1, documentId: id, revision: '0.1', date, status: 'PRODUCT_AND_EVIDENCE_SNAPSHOT', scope, hashAlgorithm: 'SHA-256', ordering: 'ordinal relative path ascending', combinedDnaRoot, pathBoundRoot,
  exclusions: [...EXCLUDED_PREFIXES.map((x) => `${x}*`), ...EXCLUDED_FILES, 'every file ignored by .gitignore (secrets, the database, .env)', `${baseName} manifest, receipt and declared-changes record (they describe this snapshot)`],
  excludedFileCount: skipped.excluded, files, supersedes: predecessor, openRemarks: remarks };
const out = resolve(root, 'records/baselines');
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
writeFileSync(resolve(out, `${baseName}_manifest.json`), manifestBytes);
writeFileSync(resolve(out, `${baseName}_manifest.sha256`), `${sha(manifestBytes)}  ${baseName}_manifest.json\n`);
writeFileSync(resolve(out, `${baseName}_expected-changes.json`), JSON.stringify({ schemaVersion: 1, forSnapshot: id, status: 'WORKING_CHANGES_PENDING_NEXT_SNAPSHOT',
  rule: 'A file listed here may differ from the snapshot only while its CURRENT sha256 equals the one recorded here. It still does NOT match the snapshot. Strict verification ignores this record. A further edit makes the file unexplained drift until the record is updated and logged.',
  howToUpdate: 'Edit the file, record its new sha256 with a reason and review evidence, and add an entry to the work log. A new snapshot (next unused AEG-BAS id, with a predecessor reference) replaces this list.', changes: [] }, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ id, files: files.length, excluded: skipped.excluded, unsafe: skipped.unsafe, combinedDnaRoot, pathBoundRoot, manifestSha256: sha(manifestBytes) }, null, 1));
