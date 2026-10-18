// Gate runner: executes the commands listed for a task in tools/gates.json, records REAL exit codes/output.
// Usage: npm run gate -- TSK-005        (never hand-write an evidence record; this tool writes it)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const taskId = process.argv[2];
if (!taskId) { console.error('Usage: npm run gate -- <TSK-NNN>'); process.exit(2); }
const gates = JSON.parse(readFileSync(resolve(root, 'tools/gates.json'), 'utf8'));
const gate = gates[taskId];
if (!gate) { console.error(`No gate defined for ${taskId}`); process.exit(2); }

const run = (cmd) => {
  const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = ((r.stdout ?? '') + (r.stderr ?? '')).trim().split('\n');
  return { cmd, exitCode: r.status ?? -1, tail: out.slice(-25).join('\n') };
};
const git = (a) => { const r = spawnSync('git ' + a, { cwd: root, shell: true, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : 'n/a'; };

const startedAt = new Date().toISOString();
const results = gate.commands.map(run);
const missing = (gate.requiredFiles ?? []).filter((f) => !existsSync(resolve(root, f)));
const passed = results.every((r) => r.exitCode === 0) && missing.length === 0;
const pkgLock = existsSync(resolve(root, 'package-lock.json')) ? createHash('sha256').update(readFileSync(resolve(root, 'package-lock.json'))).digest('hex') : 'n/a';

const stamp = startedAt.replace(/[-:]/g, '').replace(/\..*/, 'Z');
const md = [
  `# EVD ${taskId} ${stamp}`, '',
  `| Field | Value |`, `|---|---|`,
  `| Task | ${taskId} |`, `| Tool | tools/run-gate.mjs (executed, not hand-written) |`, `| Started | ${startedAt} |`,
  `| Node | ${process.version} |`, `| Platform | ${process.platform} |`,
  `| Git HEAD | ${git('rev-parse HEAD')} |`, `| Git dirty files | ${git('status --porcelain').split('\n').filter(Boolean).length} |`,
  `| package-lock sha256 | ${pkgLock} |`, `| Result | **${passed ? 'PASS' : 'FAIL'}** |`, '',
  `Requires files: ${(gate.requiredFiles ?? []).join(', ') || '-'}  Missing: ${missing.join(', ') || 'none'}`, '',
  ...results.flatMap((r) => [`## \`${r.cmd}\``, `exit code: ${r.exitCode}`, '```', r.tail, '```', '']),
  `Limitations: ${gate.limitations ?? 'none recorded'}`, '',
].join('\n');
mkdirSync(resolve(root, 'records/evidence'), { recursive: true });
const file = resolve(root, `records/evidence/AEG-EVD-${taskId}_${stamp}.md`);
writeFileSync(file, md);
console.log(md);
console.log(`\nEvidence written: ${file}\nGATE ${taskId}: ${passed ? 'PASS' : 'FAIL'}`);
process.exit(passed ? 0 : 1);
