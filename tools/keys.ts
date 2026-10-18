import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Key pairs: each provider has an active key and a spare (NAME and NAME_2). The two are swapped from time to time so no single key stays exposed
 * for long, and the old one is then rotated at the provider. This tool tests keys and performs the swap. It never prints a key: only a status and
 * a short fingerprint (the first 8 hex characters of a SHA-256) so you can tell which key is active.
 */
export type Provider = 'google' | 'reapi';
export const PAIRS: Record<Provider, { active: string; spare: string }> = {
  google: { active: 'AEGIS_GOOGLE_API_KEY', spare: 'AEGIS_GOOGLE_API_KEY_2' },
  reapi: { active: 'AEGIS_REAPI_API_KEY', spare: 'AEGIS_REAPI_API_KEY_2' },
};

export const fingerprint = (value: string): string => createHash('sha256').update(value.trim()).digest('hex').slice(0, 8);

export function readValue(text: string, name: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimStart();
    if (line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at > 0 && line.slice(0, at).trim() === name) return line.slice(at + 1).trim();
  }
  return null;
}

/** Swaps the values of two names and changes nothing else (comments, order, line endings and every other line stay as they were). */
export function swapPair(text: string, a: string, b: string): string {
  const valueA = readValue(text, a);
  const valueB = readValue(text, b);
  if (!valueA || !valueB) throw new Error(`both ${a} and ${b} must be set to swap them`);
  if (valueA === valueB) throw new Error(`${a} and ${b} hold the same key; there is nothing to swap`);
  return text.split(/(\r?\n)/).map((part) => {
    const line = part.trimStart();
    const at = line.indexOf('=');
    if (line.startsWith('#') || at <= 0) return part;
    const name = line.slice(0, at).trim();
    if (name === a) return `${a}=${valueB}`;
    if (name === b) return `${b}=${valueA}`;
    return part;
  }).join('');
}

export interface KeyTest { ok: boolean; detail: string }

export async function testGoogle(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyTest> {
  try {
    const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20_000) });
    return { ok: response.status === 200, detail: `HTTP ${response.status} (model list, no cost)` };
  } catch { return { ok: false, detail: 'network error' }; }
}

/** reAPI has no free key check, so this makes ONE tiny chat call (about $0.0001 on gpt-6-luna). */
export async function testReapi(key: string, baseUrl: string, model: string, fetchImpl: typeof fetch = fetch): Promise<KeyTest> {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return { ok: false, detail: 'bad base URL' }; }
  if (url.protocol !== 'https:' || url.hostname !== 'reapi.ai') return { ok: false, detail: 'refusing: base URL is not https://reapi.ai' };
  try {
    const response = await fetchImpl(`${url.origin}${url.pathname.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word ok' }], max_completion_tokens: 64, reasoning_effort: 'low' }),
      signal: AbortSignal.timeout(30_000),
    });
    return { ok: response.status === 200, detail: `HTTP ${response.status} (one tiny call)` };
  } catch { return { ok: false, detail: 'network error' }; }
}

async function testPair(env: string, provider: Provider): Promise<{ name: string; fp: string; result: KeyTest }[]> {
  const out: { name: string; fp: string; result: KeyTest }[] = [];
  for (const name of [PAIRS[provider].active, PAIRS[provider].spare]) {
    const value = readValue(env, name);
    if (!value) { out.push({ name, fp: '-', result: { ok: false, detail: 'not set' } }); continue; }
    const result = provider === 'google'
      ? await testGoogle(value)
      : await testReapi(value, readValue(env, 'AEGIS_REAPI_BASE_URL') ?? '', 'gpt-6-luna');
    out.push({ name, fp: fingerprint(value), result });
  }
  return out;
}

function printRows(rows: { name: string; fp: string; result: KeyTest }[]): void {
  for (const row of rows) console.log(`${row.name.padEnd(26)} id#${row.fp}  ${row.result.ok ? 'OK  ' : 'FAIL'}  ${row.result.detail}`);
}

async function main(): Promise<number> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const path = process.env.AEGIS_KEYS_ENV_FILE ?? join(root, '.env');   // an override lets the swap be rehearsed on a copy
  if (!existsSync(path)) { console.error('no .env file'); return 1; }
  const [command, target] = process.argv.slice(2);
  const providers: Provider[] = target === 'google' || target === 'reapi' ? [target] : ['google', 'reapi'];
  const env = readFileSync(path, 'utf8');

  if (command === 'test') {
    let allOk = true;
    for (const provider of providers) {
      console.log(`-- ${provider}`);
      const rows = await testPair(env, provider);
      printRows(rows);
      if (rows.some((row) => !row.result.ok)) allOk = false;
    }
    return allOk ? 0 : 1;
  }

  if (command === 'swap' && (target === 'google' || target === 'reapi')) {
    const pair = PAIRS[target];
    console.log(`-- before the swap (${target})`);
    const before = await testPair(env, target);
    printRows(before);
    if (before.some((row) => !row.result.ok)) { console.error('Refusing to swap: both keys must work first. Nothing was changed.'); return 1; }
    const swapped = swapPair(env, pair.active, pair.spare);
    const temp = `${path}.tmp`;
    writeFileSync(temp, swapped);
    renameSync(temp, path);                                   // atomic replace
    console.log(`-- after the swap (${target})`);
    const after = await testPair(swapped, target);
    printRows(after);
    if (after.some((row) => !row.result.ok)) {
      writeFileSync(temp, env);
      renameSync(temp, path);
      console.error('A key failed after the swap, so the original .env was restored.');
      return 1;
    }
    console.log(`Swapped. The old active key is now ${pair.spare}: rotate it at the provider, then paste the fresh key over that line.`);
    return 0;
  }

  console.error('usage: npm run keys:test [-- google|reapi]    npm run keys:swap -- google|reapi');
  return 2;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().then((code) => { process.exitCode = code; });
}
