// Fetches WHO Disease Outbreak News items published since 2016-01-01 from WHO's public news API (AEG-HIST-002), saved unmodified in pages.
// Run: node tools/fetch-who-don.mjs  -> records/sources/who-don-2016-2026/page-NNN.json + manifest.json
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = `${root}records/sources/who-don-2016-2026/`;
mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = 100;
const files = [];
for (let page = 0; page < 40; page += 1) {
  const url = `https://www.who.int/api/news/diseaseoutbreaknews?$filter=${encodeURIComponent('PublicationDate ge 2016-01-01T00:00:00Z')}&$orderby=${encodeURIComponent('PublicationDate asc')}&$top=${PAGE}&$skip=${page * PAGE}`;
  let body = null; let status = 0; let err = null;
  for (let i = 0; i < 5 && body === null; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Aegis history backfill)' }, signal: AbortSignal.timeout(120_000) });
      status = res.status;
      if (res.ok) body = Buffer.from(await res.arrayBuffer());
    } catch (e) { err = String(e?.message ?? e).slice(0, 100); }
    if (body === null) await sleep(3000 * (i + 1));
  }
  if (!body) { files.push({ page, apiUrl: url, httpStatus: status, file: null, error: err }); break; }
  const items = JSON.parse(body.toString('utf8')).value ?? [];
  const name = `page-${String(page).padStart(3, '0')}.json`;
  writeFileSync(`${dir}${name}`, body);
  files.push({ page, apiUrl: url, httpStatus: status, file: name, items: items.length, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), retrievedAt: new Date().toISOString() });
  console.log(`page ${page}: ${items.length} items`);
  if (items.length < PAGE) break;
  await sleep(800);
}
writeFileSync(`${dir}manifest.json`, `${JSON.stringify({ builtAt: new Date().toISOString(), files }, null, 1)}\n`);
console.log(`done: ${files.length} pages, ${files.reduce((n, f) => n + (f.items ?? 0), 0)} items`);
