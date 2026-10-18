import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reports whether the local provider settings are usable and whether a secret has leaked into the tracked example file.
 * It never prints a value: only whether a name is set and how long it is.
 */
export interface EnvReport { ok: boolean; lines: string[] }

const SECRET_NAME = /(API_KEY|SECRET|PASSWORD|(^|_)TOKEN$)/;   // not AEGIS_REAPI_TOKEN_PARAM or *_MICRO_PER_MTOK
const SECRET_SHAPES = [/AIza[0-9A-Za-z_-]{20,}/, /\bAQ\.[0-9A-Za-z_-]{20,}/, /\bsk-[0-9A-Za-z_-]{20,}/];

export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return values;
}

/** Names in the example file that hold a value, plus any line that merely looks like a pasted key. */
export function exampleLeaks(exampleText: string): string[] {
  const problems: string[] = [];
  const values = parseEnv(exampleText);
  for (const [name, value] of Object.entries(values)) {
    if (SECRET_NAME.test(name) && value !== '') problems.push(`${name} has a value in .env.example`);
  }
  exampleText.split(/\r?\n/).forEach((line, index) => {
    if (SECRET_SHAPES.some((shape) => shape.test(line))) problems.push(`line ${index + 1} of .env.example looks like a pasted key`);
  });
  return problems;
}

export function checkEnv(env: Record<string, string>, exampleText: string, envIgnored: boolean | null): EnvReport {
  const lines: string[] = [];
  let ok = true;
  const say = (text: string): void => { lines.push(text); };
  const state = (name: string): string => (env[name] ? `set (${env[name]?.length} characters)` : 'not set');

  for (const problem of exampleLeaks(exampleText)) { say(`FAIL  ${problem}. Move it to .env and restore the example file.`); ok = false; }
  if (envIgnored === false) { say('FAIL  .env is not ignored by git.'); ok = false; }
  else if (envIgnored === null) say('WARN  could not check whether .env is ignored by git.');

  say(`Google key:   ${state('AEGIS_GOOGLE_API_KEY')}`);
  say(`Google model: ${env.AEGIS_GOOGLE_MODEL || 'not set'}${/^gemini-2\.5/.test(env.AEGIS_GOOGLE_MODEL ?? '') ? '  (legacy: use gemini-3.8-flash or gemini-3.5-flash-lite)' : ''}`);
  say(`reAPI key:    ${state('AEGIS_REAPI_API_KEY')}`);
  try {
    const base = new URL(env.AEGIS_REAPI_BASE_URL ?? '');
    const fine = base.protocol === 'https:' && base.hostname === 'reapi.ai';
    say(`reAPI URL:    ${base.origin}${base.pathname}${fine ? '' : '  FAIL: must be https://reapi.ai'}`);
    if (!fine) ok = false;
  } catch {
    say('reAPI URL:    not set or not a URL');
  }
  const others = Object.keys(env).filter((name) => /KEY/.test(name) && !['AEGIS_GOOGLE_API_KEY', 'AEGIS_REAPI_API_KEY'].includes(name) && env[name]);
  for (const name of others.sort()) {
    say(`Extra key:    ${name} ${state(name)}${/OLD|REVOKE/.test(name) ? '  WARN: marked old; revoke it at the provider and delete the line' : '  (not read by the app)'}`);
  }
  say(`Provider mode: ${env.AEGIS_PROVIDER_MODE || 'stub'}, models enabled: ${env.AEGIS_MODELS_ENABLED || 'false'}`);
  return { ok, lines };
}

function isIgnored(root: string): boolean | null {
  try {
    execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch (error: unknown) {
    return (error as { status?: number }).status === 1 ? false : null;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const envPath = join(root, '.env');
  const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
  if (!existsSync(envPath)) console.log('WARN  no .env file yet');
  const report = checkEnv(env, readFileSync(join(root, '.env.example'), 'utf8'), isIgnored(root));
  for (const line of report.lines) console.log(line);
  process.exit(report.ok ? 0 : 1);
}
