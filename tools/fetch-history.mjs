// Fetches the raw source data for the ten-year ASEAN history cards (AEG-HIST-001) and saves it unmodified with a manifest.
// Network + read-only public APIs, no keys. Run: node tools/fetch-history.mjs [--out records/sources/history-2016-2026]
// Output: one file per query, plus manifest.json with apiUrl, HTTP status, bytes, SHA-256 and retrievedAt for every query, empty or not.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const argOut = process.argv.indexOf('--out');
const outDir = `${root}${argOut > -1 ? process.argv[argOut + 1] : 'records/sources/history-2016-2026'}/`;
mkdirSync(outDir, { recursive: true });

const FIRST_YEAR = 2016;
const LAST = new Date().toISOString().slice(0, 10);
const LAST_YEAR = Number(LAST.slice(0, 4));
const BOX = 'minlatitude=-11.5&maxlatitude=21.5&minlongitude=92&maxlongitude=141.5';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 5) {
  let last = { status: 0, body: Buffer.alloc(0), error: null };
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Aegis history backfill)' }, signal: AbortSignal.timeout(120_000) });
      const body = Buffer.from(await res.arrayBuffer());
      last = { status: res.status, body, error: null };
      if (res.status === 204) return last;                       // GDACS answers 204 No Content when there are no events
      if (res.ok && body.length > 0) return last;
    } catch (e) {
      last = { status: 0, body: Buffer.alloc(0), error: String(e?.message ?? e).slice(0, 120) };
    }
    await sleep(3000 * (i + 1));
  }
  return last;
}

const queries = [];
for (let y = FIRST_YEAR; y <= LAST_YEAR; y += 1) {
  const to = y < LAST_YEAR ? `${y}-12-31` : LAST;
  for (const type of ['EQ', 'TC', 'FL', 'VO', 'WF']) {
    queries.push({
      id: `gdacs-${type.toLowerCase()}-${y}`, source: 'GDACS', type, year: y,
      url: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=${type}&fromdate=${y}-01-01&todate=${to}&alertlevel=Orange;Red`,
    });
  }
  queries.push({
    id: `usgs-m6.5-${y}`, source: 'USGS', type: 'EQ', year: y,
    url: `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${y}-01-01&endtime=${to}T23:59:59&minmagnitude=6.5&${BOX}&orderby=time-asc&limit=20000`,
  });
}

const files = [];
for (const q of queries) {
  const r = await get(q.url);
  const retrievedAt = new Date().toISOString();
  const name = `${q.id}.json`;
  let features = null;
  let outcome;
  if (r.body.length > 0) {
    writeFileSync(`${outDir}${name}`, r.body);
    try { features = JSON.parse(r.body.toString('utf8')).features?.length ?? null; outcome = 'DATA'; } catch { outcome = 'NOT_JSON'; }
  } else {
    outcome = r.status === 204 ? 'NO_EVENTS' : r.status === 200 ? 'EMPTY_BODY_200' : 'FAILED';
  }
  files.push({
    id: q.id, source: q.source, type: q.type, year: q.year, apiUrl: q.url, httpStatus: r.status, outcome, features,
    file: r.body.length > 0 ? name : null, bytes: r.body.length,
    sha256: r.body.length > 0 ? createHash('sha256').update(r.body).digest('hex') : null, retrievedAt, error: r.error,
  });
  console.log(`${q.id}: ${outcome} ${features ?? '-'} features`);
  await sleep(1200);
}
writeFileSync(`${outDir}manifest.json`, `${JSON.stringify({ builtAt: new Date().toISOString(), box: BOX, orangeRedOnly: true, files }, null, 1)}\n`);
const bad = files.filter((f) => f.outcome !== 'DATA');
console.log(`done: ${files.length} queries, ${files.length - bad.length} with data, ${bad.length} without: ${bad.map((f) => f.id).join(', ')}`);
