#!/usr/bin/env node
// Secret scan for the repository. It NEVER prints a secret value: findings show only the file, line number, rule name and a short
// 8-hex fingerprint of the matched text.
//
//   node tools/scan-secrets.mjs                 scan every tracked file with the pattern rules (works in CI, needs no .env)
//   node tools/scan-secrets.mjs --env           also look for the local .env secret values (and 20-character fragments of them)
//                                               in tracked files AND in the full git history
// Exit code: 0 clean, 1 findings, 2 usage/error.
// A line may carry the marker "secret-scan:allow" (with a reason) to accept a reviewed fake value.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fingerprint = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);

export const RULES = [
  { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/g },
  // not preceded by a letter, digit or hyphen (so a URL slug such as "...-sk-plasma-..." is ignored) and must contain a digit, as real keys do
  { name: 'openai-style-key', re: /(?<![A-Za-z0-9_-])sk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'bearer-token-literal', re: /Bearer\s+[A-Za-z0-9_\-.=]{32,}/g },
  // NAME = long-looking-value, for names that mean "secret"; placeholders and obvious fakes are skipped below
  { name: 'secret-assignment', re: /\b[A-Z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*\s*[=:]\s*["']?([A-Za-z0-9_\-./+=]{24,})["']?/g, group: 1 },
];
const PLACEHOLDER = /^(?:x+|\*+|0+|a+|f+|<[^>]*>|\$\{?[A-Z_]+\}?|REDACTED|CHANGEME|changeme|your[-_a-z]*|example[-_a-z]*|test[-_a-z0-9]*|fake[-_a-z0-9]*|synthetic[-_a-z0-9]*|[0-9a-f]{64})$/i;

/** Pure scan of one text; returns [{line, rule, fp}]. */
export function scanText(text, name = '') {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes('secret-scan:allow')) continue;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      for (let m = rule.re.exec(line); m !== null; m = rule.re.exec(line)) {
        const value = rule.group ? m[rule.group] : m[0];
        if (rule.group && PLACEHOLDER.test(value)) continue;
        if (rule.name === 'bearer-token-literal' && (/\$\{|\$\(|\{\{|<|\bTOKEN\b|identity-token/i.test(m[0]) || PLACEHOLDER.test(m[0].replace(/^Bearer\s+/, '')))) continue;
        findings.push({ file: name, line: i + 1, rule: rule.name, fp: fingerprint(value) });
      }
    }
  }
  return findings;
}

const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function trackedFiles() {
  const r = git(['ls-files', '-z']);
  if (r.status !== 0) throw new Error('git ls-files failed');
  return r.stdout.split('\0').filter(Boolean);
}
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|mhtml|woff2?|ttf|db|sqlite|zip|gz|lockb?)$/i;

function localSecretFragments() {
  const file = resolve(root, '.env');
  if (!existsSync(file)) return [];
  const out = [];
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m || !/(KEY|TOKEN|SECRET|PASSWORD)/.test(m[1])) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (value.length < 20 || PLACEHOLDER.test(value)) continue;
    out.push({ name: m[1], fragments: [...new Set([value, value.slice(0, 20), value.slice(-20)])] });
  }
  return out;
}

export function main(argv) {
  const useEnv = argv.includes('--env');
  const unknown = argv.filter((a) => a !== '--env');
  if (unknown.length) { console.error(`scan-secrets: unknown argument ${unknown[0]}`); return 2; }
  const findings = [];
  for (const file of trackedFiles()) {
    if (BINARY.test(file) || file.startsWith('node_modules/')) continue;
    // Saved copies of other organisations' public web pages (R00xx / X00xx evidence files) legitimately contain THEIR public keys, for example
    // Google's own site-search key inside its documentation HTML. The pattern scan skips them; the --env scan below still searches them for OUR values.
    if (/^docs\/99-inbox\/[RX]\d{4}[_A-Za-z ].*\.(html|htm|mhtml)$/i.test(file)) continue;
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    findings.push(...scanText(text, file));
  }
  if (useEnv) {
    for (const { name, fragments } of localSecretFragments()) {
      for (const fragment of fragments) {
        const tracked = git(['grep', '-I', '-l', '-F', '-e', fragment, 'HEAD', '--']);
        for (const hit of (tracked.stdout ?? '').split('\n').filter(Boolean)) findings.push({ file: hit.replace(/^HEAD:/, ''), line: 0, rule: `env-value:${name}`, fp: fingerprint(fragment) });
        const history = git(['log', '--all', '--format=%h', '-S', fragment, '--']);
        for (const commit of (history.stdout ?? '').split('\n').filter(Boolean)) findings.push({ file: `commit ${commit}`, line: 0, rule: `env-value-in-history:${name}`, fp: fingerprint(fragment) });
      }
    }
  }
  const unique = [...new Map(findings.map((f) => [`${f.file}|${f.line}|${f.rule}|${f.fp}`, f])).values()];
  for (const f of unique) console.log(`FOUND  ${f.file}${f.line ? ':' + f.line : ''}  ${f.rule}  [fp ${f.fp}]`);
  console.log(unique.length === 0 ? `scan-secrets: clean${useEnv ? ' (including local .env values and history)' : ''}` : `scan-secrets: ${unique.length} finding(s); values are not shown`);
  return unique.length === 0 ? 0 : 1;
}

if (process.argv[1] && /scan-secrets\.mjs$/.test(process.argv[1])) process.exit(main(process.argv.slice(2)));
