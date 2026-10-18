// Fetches the USGS event detail for every USGS-sourced history card and saves it unmodified (AEG-HIST-002), so published impact statements
// ("impact-text" product) can be quoted on the card with their source. Run: node tools/fetch-eq-impact.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = `${root}records/sources/history-2016-2026/usgs-detail/`;
mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hist = JSON.parse(readFileSync(`${root}content/history/hazard-history.json`, 'utf8'));
const ids = [...new Set(hist.cards.filter((c) => c.provenance.sourceId === 'SRC.USGS.FDSN').map((c) => c.provenance.sourceRecordId))];
const files = [];
for (const id of ids) {
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${encodeURIComponent(id)}&format=geojson`;
  let status = 0; let body = null; let err = null;
  for (let i = 0; i < 4 && body === null; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Aegis history backfill)' }, signal: AbortSignal.timeout(60_000) });
      status = res.status;
      if (res.ok) body = Buffer.from(await res.arrayBuffer());
      else if (res.status === 404 || res.status === 204) break;
    } catch (e) { err = String(e?.message ?? e).slice(0, 100); }
    if (body === null) await sleep(2000 * (i + 1));
  }
  const retrievedAt = new Date().toISOString();
  if (body) writeFileSync(`${dir}${id}.json`, body);
  files.push({ eventId: id, apiUrl: url, httpStatus: status, file: body ? `${id}.json` : null, bytes: body?.length ?? 0, sha256: body ? createHash('sha256').update(body).digest('hex') : null, retrievedAt, error: err });
  await sleep(300);
}
writeFileSync(`${dir}manifest.json`, `${JSON.stringify({ builtAt: new Date().toISOString(), files }, null, 1)}\n`);
console.log(`done: ${files.length} events, ${files.filter((f) => f.file).length} saved`);
