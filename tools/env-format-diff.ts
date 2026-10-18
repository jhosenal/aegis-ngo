// Compares ONE real scanned pin (from the running server) with the sample (demo) reading, field by field, so the sample can be corrected to Google's real format. Read-only; prints structure, not values.
// 1) scan one pin (Admin Desk > Data control, tick Google, refresh that pin)   2) node --env-file-if-exists=.env node_modules/tsx/dist/cli.mjs tools/env-format-diff.ts --pin my-41 [--base http://127.0.0.1:8787]
import { demoReadings } from '../src/api/routes/adminPins.js';
import type { EnvPin } from '../src/sources/pinRegistry.js';

const arg = (n: string, d: string): string => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1]! : d; };
const base = arg('base', 'http://127.0.0.1:8787'); const pinId = arg('pin', 'my-41');
type Json = unknown;
const kind = (v: Json): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
/** path -> type, arrays described by their first element (path[]). */
function shape(v: Json, path = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (Array.isArray(v)) { out.set(path || '$', 'array'); if (v.length > 0) shape(v[0], `${path}[]`, out); return out; }
  if (v !== null && typeof v === 'object') { out.set(path || '$', 'object'); for (const [k, x] of Object.entries(v as Record<string, Json>)) shape(x, path ? `${path}.${k}` : k, out); return out; }
  out.set(path || '$', kind(v)); return out;
}
const IGNORE = [/^demo$/, /healthRecommendations/, /currentConditionsHistory/];
const keep = (m: Map<string, string>): Map<string, string> => new Map([...m].filter(([p]) => !IGNORE.some((r) => r.test(p))));

const res = await fetch(`${base}/public/environment`);
const fail = (m: string): never => { console.error(m); process.exit(1); };
if (!res.ok) fail(`HTTP ${res.status} from ${base}`);
const env = await res.json() as { pins: { pinId: string; country: 'SG' | 'MY' | 'BN'; name: string; lat: number; lng: number; readingState: string; air: { data: Record<string, Json> } | null; weather: { current: { data: Record<string, Json> } | null } }[] };
const pin = env.pins.find((p) => p.pinId === pinId);
if (!pin) fail(`no pin ${pinId}`);
if (pin!.readingState !== 'fresh') fail(`pin ${pinId} has readingState "${pin!.readingState}": scan it with Google first (a demo or empty pin cannot be compared)`);
const sample = demoReadings({ pinId, country: pin!.country, name: pin!.name, lat: pin!.lat, lng: pin!.lng, needs: ['air', 'weather'] } as unknown as EnvPin, new Date().toISOString());
const parts: [string, Json, Json][] = [['AIR_CURRENT', pin!.air?.data, sample.find((r) => r.kind === 'AIR_CURRENT')?.data], ['WEATHER_CURRENT', pin!.weather.current?.data, sample.find((r) => r.kind === 'WEATHER_CURRENT')?.data]];
let problems = 0;
for (const [name, live, demo] of parts) {
  if (!live) { console.log(`${name}: no live data on this pin`); continue; }
  const a = keep(shape(live)); const b = keep(shape(demo));
  const missing = [...a].filter(([p]) => !b.has(p)).map(([p, t]) => `${p} (${t})`);
  const extra = [...b].filter(([p]) => !a.has(p)).map(([p, t]) => `${p} (${t})`);
  const type = [...a].filter(([p, t]) => b.has(p) && b.get(p) !== t && t !== 'null' && b.get(p) !== 'null').map(([p, t]) => `${p}: live ${t}, sample ${b.get(p)}`);
  problems += missing.length + extra.length + type.length;
  console.log(`${name}: ${a.size} live fields, ${b.size} sample fields`);
  console.log(`  live has, sample lacks: ${missing.join(', ') || 'none'}`);
  console.log(`  sample has, live lacks: ${extra.join(', ') || 'none'}`);
  console.log(`  type differences: ${type.join('; ') || 'none'}`);
}
console.log(problems === 0 ? 'FORMAT MATCHES' : `${problems} difference(s): adjust demoReadings in src/api/routes/adminPins.ts`);
