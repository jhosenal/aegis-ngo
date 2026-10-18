// Documentation verifier only. Does not run application code, access providers or register OAG seals.
// It reports three separate things: files that MATCH the snapshot, files that differ but are DECLARED working changes
// (a logged record bound to this snapshot), and UNEXPLAINED DRIFT. A declared change never counts as a snapshot match.
import { readFileSync, existsSync, readdirSync } from 'node:fs';

/** The newest snapshot manifest (highest AEG-BAS number) unless --manifest says otherwise. */
export const latestManifest = (root) => { const dir = resolve(root, 'records/baselines'); const names = existsSync(dir) ? readdirSync(dir).filter((n) => /^AEG-BAS-\d{3}_.*_manifest\.json$/.test(n)).sort() : []; return resolve(dir, names[names.length - 1] ?? 'AEG-BAS-002_2026-10-13_manifest.json'); };
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(value).digest('hex');

const isSafePath = (path) => typeof path === 'string' && !path.includes('\\') && !isAbsolute(path)
  && !path.split('/').some((part) => part === '..' || part === '.' || part === '');

/** The declared-change record must be bound to THIS snapshot, with unique manifest paths, exact hashes, a reason and review evidence. */
export function validateExpected(record, manifest) {
  const problems = [];
  if (!record) return problems;
  if (record.schemaVersion !== 1) problems.push('Expected-change record: unsupported schemaVersion');
  if (record.forSnapshot !== manifest.documentId) problems.push('Expected-change record is for ' + record.forSnapshot + ', not ' + manifest.documentId);
  const inManifest = new Set(manifest.files.map((entry) => entry.path));
  const seen = new Set();
  for (const change of Array.isArray(record.changes) ? record.changes : []) {
    if (seen.has(change.path)) problems.push('Expected-change record: duplicate path ' + change.path);
    seen.add(change.path);
    if (!inManifest.has(change.path)) problems.push('Expected-change record: path not in the snapshot: ' + change.path);
    if (!/^[0-9a-f]{64}$/.test(change.sha256 ?? '')) problems.push('Expected-change record: bad sha256 for ' + change.path);
    if (typeof change.reason !== 'string' || !change.reason.trim()) problems.push('Expected-change record: missing reason for ' + change.path);
    if (typeof change.evidence !== 'string' || !change.evidence.trim()) problems.push('Expected-change record: missing review evidence for ' + change.path);
  }
  return problems;
}

export function verifyManifest(root, manifest, expectedRecord = null) {
  const errors = [];
  const baselineMatches = [];
  const expectedWorkingChanges = [];
  const unexplainedDrift = [];
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length)
    return { errors: ['Invalid or empty manifest'], baselineMatches, expectedWorkingChanges, unexplainedDrift };
  errors.push(...validateExpected(expectedRecord, manifest));
  const expected = new Map((expectedRecord?.changes ?? []).map((change) => [change.path, change]));
  const seen = new Set();
  const paths = manifest.files.map((entry) => entry.path);
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) errors.push('Paths are not in ordinal order');
  for (const entry of manifest.files) {
    if (!isSafePath(entry.path)) { errors.push('Unsafe manifest path'); continue; }
    if (seen.has(entry.path)) errors.push('Duplicate path: ' + entry.path);
    seen.add(entry.path);
    const target = resolve(root, entry.path);
    if (relative(root, target).startsWith('..') || !existsSync(target)) {
      unexplainedDrift.push({ path: entry.path, why: 'missing' }); continue;
    }
    const bytes = readFileSync(target);
    if (bytes.length === entry.bytes && digest(bytes) === entry.sha256) { baselineMatches.push(entry.path); continue; }
    const declared = expected.get(entry.path);
    if (declared && declared.sha256 === digest(bytes)) expectedWorkingChanges.push({ path: entry.path, reason: declared.reason, evidence: declared.evidence });
    else unexplainedDrift.push({ path: entry.path, why: declared ? 'changed again after it was declared' : 'bytes differ' });
  }
  const combined = '0x' + digest(manifest.files.map((entry) => entry.sha256).join(''));
  const bound = '0x' + digest(manifest.files.map((entry) => entry.path + '\t' + entry.bytes + '\t' + entry.sha256 + '\n').join(''));
  if (combined !== manifest.combinedDnaRoot) errors.push('Combined root mismatch');
  if (bound !== manifest.pathBoundRoot) errors.push('Path-bound root mismatch');
  return { errors, baselineMatches, expectedWorkingChanges, unexplainedDrift };
}

export function checkLinks(root) {
  const errors = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    if (['.git', 'node_modules', 'data', 'runtime', 'dist', 'coverage'].includes(item.name)) return [];
    const p = resolve(dir, item.name);
    return item.isDirectory() ? walk(p) : item.name.endsWith('.md') ? [p] : [];
  });
  for (const path of walk(root)) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!link || /^(https?:|mailto:|[A-Za-z]:\/)/.test(link)) continue;
      if (!existsSync(resolve(dirname(path), decodeURIComponent(link))))
        errors.push('Broken link in ' + relative(root, path) + ': ' + link);
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const structureOnly = process.argv.includes('--structure-only');
  const strict = process.argv.includes('--strict');   // release or snapshot verification: no difference at all is accepted
  const asJson = process.argv.includes('--json');
  const linkErrors = checkLinks(root);
  const result = { mode: structureOnly ? 'structure-only' : strict ? 'strict-snapshot' : 'working-tree', snapshot: null, files: 0, errors: [...linkErrors],
    baselineMatches: [], expectedWorkingChanges: [], unexplainedDrift: [] };
  if (!structureOnly) {
    const i = process.argv.indexOf('--manifest');
    const manifestPath = i >= 0 ? resolve(root, process.argv[i + 1] || '') :
      latestManifest(root);
    if (!existsSync(manifestPath)) result.errors.push('Manifest missing: ' + manifestPath);
    else {
      const bytes = readFileSync(manifestPath);
      const manifest = JSON.parse(bytes);
      result.snapshot = manifest.documentId;
      result.files = manifest.files?.length ?? 0;
      const expectedPath = manifestPath.replace(/_manifest\.json$/, '_expected-changes.json');
      // Strict verification ignores the editable record: it is not independent release evidence.
      const record = !strict && existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, 'utf8')) : null;
      const checked = verifyManifest(root, manifest, record);
      result.errors.push(...checked.errors);
      result.baselineMatches = checked.baselineMatches;
      result.expectedWorkingChanges = checked.expectedWorkingChanges;
      result.unexplainedDrift = checked.unexplainedDrift;
      const receiptPath = manifestPath.replace(/\.json$/, '.sha256');
      if (!existsSync(receiptPath) || readFileSync(receiptPath, 'utf8').trim().split(/\s+/)[0] !== digest(bytes))
        result.errors.push('Manifest receipt missing or mismatched');
    }
  }
  const failed = result.errors.length > 0 || result.unexplainedDrift.length > 0;
  if (failed) process.exitCode = 1;
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else if (structureOnly) { if (failed) console.error(result.errors.join('\n')); else console.log('PASS: internal Markdown file links resolve.'); }
  else {
    const lines = [result.snapshot + ': ' + result.baselineMatches.length + ' of ' + result.files + ' files match the snapshot exactly; '
      + result.expectedWorkingChanges.length + ' differ as declared working changes; ' + result.unexplainedDrift.length + ' unexplained drift.'];
    for (const item of result.expectedWorkingChanges) lines.push('  DECLARED (bytes differ from the snapshot): ' + item.path + ' — ' + item.reason + ' [' + item.evidence + ']');
    for (const item of result.unexplainedDrift) lines.push('  UNEXPLAINED: ' + item.path + ' (' + item.why + ')');
    for (const error of result.errors) lines.push('  ERROR: ' + error);
    (failed ? console.error : console.log)(lines.join('\n'));
    if (!failed) console.log(strict
      ? 'PASS (strict snapshot): every file matches the snapshot. Not an OAG seal or product acceptance.'
      : 'PASS (working tree): no unexplained drift' + (result.expectedWorkingChanges.length ? '; this is NOT a baseline match for the declared files above' : '') + '. Not an OAG seal or product acceptance.');
  }
}
