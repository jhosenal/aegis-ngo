// Fetches IDMC GIDD disaster displacement rows for ASEAN countries and writes data/idmc-overrides.json (git-ignored), keyed by history card id.
// Needs AEGIS_IDMC_CLIENT_ID (the key IDMC emails you after an access request; put it in the ignored .env, never on the command line).
// Run: node --env-file=.env node_modules/tsx/dist/cli.mjs tools/import-idmc.ts
// Then: node tools/build-history-extra.mjs --include-idmc   (opt-in: the data is CC BY-NC-SA 3.0 IGO; see src/sources/idmc.ts)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { displacementFigure, IDMC_CITATION, IDMC_LICENCE, matchIdmc, type IdmcDisaster, type IdmcPage } from '../src/sources/idmc.js';
import type { MatchCard } from '../src/sources/emdat.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const clientId = (process.env['AEGIS_IDMC_CLIENT_ID'] ?? '').trim();
if (!clientId) { console.error('AEGIS_IDMC_CLIENT_ID is not set. Request a key from ch.datainfo@idmc.ch (see docs/99-inbox/S0040_idmc-access-request-draft.md).'); process.exit(2); }

const ISO3 = 'IDN,PHL,MYS,THA,MMR,VNM,KHM,LAO,SGP,BRN,TLS';
const rows: IdmcDisaster[] = [];
const pages: { offset: number; sha256: string; bytes: number }[] = [];
const rawDir = `${root}records/sources/idmc-gidd`;
mkdirSync(rawDir, { recursive: true });
mkdirSync(`${root}data`, { recursive: true });
let offset = 0;
for (let guard = 0; guard < 200; guard += 1) {
  const url = new URL('https://helix-tools-api.idmcdb.org/external-api/gidd/disasters/');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('iso3__in', ISO3);
  url.searchParams.set('start_year', '2016');
  url.searchParams.set('limit', '200');
  url.searchParams.set('offset', String(offset));
  const res = await fetch(url, { headers: { 'user-agent': 'Aegis history backfill' }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) { console.error(`IDMC answered ${res.status}: ${(await res.text()).slice(0, 160)}`); process.exit(3); }
  const body = Buffer.from(await res.arrayBuffer());
  writeFileSync(`${rawDir}/disasters-offset-${String(offset).padStart(5, '0')}.json`, body);   // the key is never in the saved body
  pages.push({ offset, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length });
  const page = JSON.parse(body.toString('utf8')) as IdmcPage;
  rows.push(...page.results);
  if (!page.next || page.results.length === 0) break;
  offset += page.results.length;
}
const history = JSON.parse(readFileSync(`${root}content/history/hazard-history.json`, 'utf8')) as { cards: MatchCard[] };
const { report, byRecord } = matchIdmc(rows, history.cards);
const overrides: Record<string, unknown> = {};
for (const m of report.matched) {
  const row = byRecord.get(m.record);
  const figure = row ? displacementFigure(row) : null;
  if (!row || !figure) continue;
  overrides[m.cardId] = { source: 'IDMC Global Internal Displacement Database', basis: m.basis, eventName: row.event_name, year: row.year, figures: [figure], citation: IDMC_CITATION, licence: IDMC_LICENCE };
}
writeFileSync(`${root}data/idmc-overrides.json`, `${JSON.stringify({ importedAt: new Date().toISOString(), pages, rows: rows.length, overrides }, null, 1)}\n`);
console.log(JSON.stringify({ rows: rows.length, matched: report.matched.length, withFigure: Object.keys(overrides).length, ambiguous: report.ambiguous.length, unmatched: report.unmatched.length }, null, 1));
