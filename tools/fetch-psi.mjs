// Fetches one Singapore PSI reading per day (12:00 local) from data.gov.sg for 2016-01-01 to today, for haze-episode detection (AEG-HIST-002).
// Public, keyless v1 API: https://api.data.gov.sg/v1/environment/psi?date_time=YYYY-MM-DDT12:00:00
// Raw responses are saved unmodified, one file per month, and a manifest records every day's HTTP status and each month file's SHA-256.
// Resumable: a month file that exists is skipped. Run: node tools/fetch-psi.mjs [--out records/sources/psi-2016-2026]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const argOut = process.argv.indexOf('--out');
const outRel = argOut > -1 ? process.argv[argOut + 1] : 'records/sources/psi-2016-2026';
const outDir = `${root}${outRel}/`;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getDay(date) {
  const url = `https://api.data.gov.sg/v1/environment/psi?date_time=${date}T12:00:00`;
  for (let i = 0; i < 5; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Aegis history backfill)' }, signal: AbortSignal.timeout(60_000) });
      const text = await res.text();
      if (res.ok) return { date, url, httpStatus: res.status, body: JSON.parse(text) };
      if (res.status === 404 || res.status === 400) return { date, url, httpStatus: res.status, body: null };
    } catch { /* retry */ }
    await sleep(2000 * (i + 1));
  }
  return { date, url, httpStatus: 0, body: null };
}

const today = new Date().toISOString().slice(0, 10);
const months = [];
for (let y = 2016; y <= Number(today.slice(0, 4)); y += 1) for (let m = 1; m <= 12; m += 1) {
  const key = `${y}-${String(m).padStart(2, '0')}`;
  if (`${key}-01` <= today) months.push(key);
}
const manifest = { builtAt: null, source: 'data.gov.sg PSI v1', months: [] };
for (const key of months) {
  const file = `psi-${key}.json`;
  if (!existsSync(`${outDir}${file}`)) {
    const [y, m] = key.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const dates = [];
    for (let d = 1; d <= days; d += 1) { const ds = `${key}-${String(d).padStart(2, '0')}`; if (ds <= today) dates.push(ds); }
    const results = [];
    for (let i = 0; i < dates.length; i += 4) {                    // 4 at a time
      results.push(...await Promise.all(dates.slice(i, i + 4).map(getDay)));
      await sleep(250);
    }
    writeFileSync(`${outDir}${file}`, JSON.stringify({ month: key, retrievedAt: new Date().toISOString(), days: results }));
    console.log(`${key}: ${results.filter((r) => r.httpStatus === 200).length}/${results.length} days`);
  }
  const bytes = readFileSync(`${outDir}${file}`);
  const parsed = JSON.parse(bytes.toString('utf8'));
  manifest.months.push({
    month: key, file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, retrievedAt: parsed.retrievedAt,
    daysOk: parsed.days.filter((d) => d.httpStatus === 200).length, daysTotal: parsed.days.length,
    daysMissing: parsed.days.filter((d) => d.httpStatus !== 200).map((d) => `${d.date}:${d.httpStatus}`),
  });
}
manifest.builtAt = new Date().toISOString();
writeFileSync(`${outDir}manifest.json`, `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`done: ${manifest.months.length} months`);
