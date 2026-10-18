// Opt-in live canary for the Google Environment adapter (AEG-ENV-001). Makes one call per kind (4) on ONE pin, through the quota gate.
// Run: node node_modules/tsx/dist/cli.mjs tools/env-canary.ts --authorized-canary [--pin my-41]
// Only shapes are printed: raw Google values are never written to disk (Maps Platform terms, one-hour limit). Keys are never printed.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EnvQuotaGate, ownerEnvQuotaConfig } from '../src/costs/envQuota.js';
import { loadPriceBook } from '../src/costs/pricebook.js';
import { EnvCallError, GoogleEnvClient, googleEnvKeysFromEnv, type EnvKind } from '../src/sources/googleEnv.js';
import { loadPinRegistry } from '../src/sources/pinRegistry.js';

if (!process.argv.includes('--authorized-canary')) {
  console.error('Refusing: this tool makes real Google calls. Re-run with --authorized-canary.');
  process.exit(2);
}
const pinArg = process.argv.indexOf('--pin');
const pinId = pinArg > -1 ? process.argv[pinArg + 1] : 'my-41';

function loadDotEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m?.[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function shape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.length === 0 ? [] : [shape(value[0], depth + 1), `(${value.length} items)`];
  if (typeof value === 'object' && value !== null) {
    if (depth >= 3) return '{...}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]));
  }
  return typeof value;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const env = loadDotEnv(`${root}.env`);
const keys = googleEnvKeysFromEnv(env);
const book = loadPriceBook();
const registry = loadPinRegistry();
const pin = registry.pins.find((p) => p.pinId === pinId);
if (!pin) { console.error(`Unknown pin ${pinId}`); process.exit(2); }

const gate = new EnvQuotaGate(new Database(':memory:'), book, ownerEnvQuotaConfig(book));
const client = new GoogleEnvClient({ apiKeys: keys, gate, now: () => new Date().toISOString(), timeoutMs: 15_000 });
const kinds: EnvKind[] = ['AIR_CURRENT', 'WEATHER_CURRENT', 'WEATHER_HOURLY', 'WEATHER_ALERTS'];
const samples: Record<string, unknown> = {};
console.log(`canary pin ${pin.pinId} ${pin.name} (${pin.lat}, ${pin.lng})`);
for (const kind of kinds) {
  const t0 = Date.now();
  try {
    const reading = await client.fetchKind(pin, kind);
    samples[kind] = reading;
    console.log(`${kind}: OK ${Date.now() - t0} ms`);
    console.log('  shape:', JSON.stringify(shape(reading.data)));
  } catch (error: unknown) {
    const e = error instanceof EnvCallError ? error : null;
    samples[kind] = { error: e ? { code: e.code, message: e.message } : { code: 'UNKNOWN' } };
    console.log(`${kind}: FAILED ${e?.code ?? 'UNKNOWN'} ${e?.message ?? ''} (${Date.now() - t0} ms)`);
  }
}
const now = new Date().toISOString();
console.log('usage:', JSON.stringify({ air: gate.snapshot('AIR_QUALITY', now).monthUsed, weather: gate.snapshot('WEATHER', now).monthUsed }));
console.log('no samples saved: Google values are not kept on disk');
