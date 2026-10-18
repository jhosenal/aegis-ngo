// ASEAN test of the emergency pipeline (AEG-NEWS-007): for each of the 11 ASEAN countries, the most recent incident in our history file (or a labelled exercise scenario where the file has none),
// run as an EXERCISE (never public) in the country's top three languages: Google Cloud Translation -> code checks numbers and names -> scripted approval (standing in for the reader) -> Google Text-to-Speech
// where Google has a voice -> warning card. A language Google cannot translate is recorded as UNSUPPORTED, never skipped silently. Run with the server on :8787:
//   node tools/asean-test.mjs [--out records/e2e/2026-10-17_asean]
// The top-three lists are OUR compilation from general knowledge of the main languages by number of speakers (ranking approximate; no census table is saved yet): cite a source before the slide says "top 3".
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = 'http://127.0.0.1:8787'; const out = arg('out', 'records/e2e/2026-10-17_asean');
mkdirSync(out, { recursive: true });
const table = JSON.parse(readFileSync('content/broadcast/translation-languages.json', 'utf8')).languages;
// [code, name]; code 'en' is the source language. Codes that are not keys of translation-languages.json are not supported by Google Translation.
const COUNTRIES = [
  { iso: 'BN', iso3: 'BRN', name: 'Brunei', names: ['Brunei Darussalam'], centre: [4.5, 114.7], top3: [['ms', 'Malay'], ['en', 'English'], ['zh', 'Chinese (Mandarin)']] },
  { iso: 'KH', iso3: 'KHM', name: 'Cambodia', names: ['Cambodia'], centre: [12.6, 104.9], top3: [['km', 'Khmer'], ['vi', 'Vietnamese'], ['cjm', 'Cham']] },
  { iso: 'ID', iso3: 'IDN', name: 'Indonesia', names: ['Indonesia'], centre: [-6.2, 106.8], top3: [['id', 'Indonesian'], ['jv', 'Javanese'], ['su', 'Sundanese']] },
  { iso: 'LA', iso3: 'LAO', name: 'Laos', names: ['Laos', 'Lao PDR'], centre: [18.2, 103.9], top3: [['lo', 'Lao'], ['kmu', 'Khmu'], ['hmn', 'Hmong']] },
  { iso: 'MY', iso3: 'MYS', name: 'Malaysia', names: ['Malaysia'], centre: [3.14, 101.69], top3: [['ms', 'Malay'], ['zh', 'Chinese (Mandarin)'], ['ta', 'Tamil']] },
  { iso: 'MM', iso3: 'MMR', name: 'Myanmar', names: ['Myanmar'], centre: [19.7, 96.1], top3: [['my', 'Burmese'], ['shn', 'Shan'], ['kar', 'Karen']] },
  { iso: 'PH', iso3: 'PHL', name: 'Philippines', names: ['Philippines'], centre: [12.9, 122.8], top3: [['tl', 'Filipino (Tagalog)'], ['ceb', 'Cebuano'], ['ilo', 'Ilocano']] },
  { iso: 'SG', iso3: 'SGP', name: 'Singapore', names: ['Singapore'], centre: [1.35, 103.8], top3: [['en', 'English'], ['zh', 'Chinese (Mandarin)'], ['ms', 'Malay']] },
  { iso: 'TH', iso3: 'THA', name: 'Thailand', names: ['Thailand'], centre: [15.0, 101.0], top3: [['th', 'Thai'], ['isan', 'Isan'], ['nod', 'Northern Thai']] },
  { iso: 'TL', iso3: 'TLS', name: 'Timor-Leste', names: ['Timor-Leste', 'Timor Leste'], centre: [-8.8, 125.7], top3: [['tet', 'Tetum'], ['pt', 'Portuguese'], ['id', 'Indonesian']] },
  { iso: 'VN', iso3: 'VNM', name: 'Vietnam', names: ['Viet Nam', 'Vietnam'], centre: [16.0, 107.5], top3: [['vi', 'Vietnamese'], ['tyz', 'Tay'], ['thaivn', 'Thai (Vietnam)']] },
];
const history = JSON.parse(readFileSync('content/history/hazard-history.json', 'utf8'));
const api = async (method, path, body, token) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, json, text };
};
const { json: { token } } = await api('POST', '/api/session', { userId: 'DEV-ADMIN' });
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
const rows = []; const wall0 = performance.now();
for (const c of COUNTRIES) {
  const t0 = performance.now();
  const rec = history.cards.filter((x) => (x.countries ?? []).some((n) => c.names.includes(n)) && ['EARTHQUAKE', 'FLOOD', 'STORM', 'VOLCANO'].includes(x.hazardType)).sort((a, b) => String(b.eventStart).localeCompare(String(a.eventStart)))[0];
  const hazard = rec?.hazardType ?? 'FLOOD';
  const title = rec?.title ?? `Flood in ${c.name} (exercise scenario)`;
  const level = String(rec?.alertLevel?.value ?? 'ORANGE').toUpperCase();
  const sourceId = hazard === 'EARTHQUAKE' ? 'SRC.USGS.LIVE' : 'SRC.GDACS.LIVE';
  const tested = c.top3.map(([code]) => code).filter((code) => code !== 'en' && table[code]);
  const row = { country: c.name, iso: c.iso, incident: title, record: rec?.id ?? null, level, top3: c.top3.map(([code, name]) => ({ code, name, translate: code === 'en' ? 'SOURCE' : table[code] ? 'YES' : 'UNSUPPORTED', voice: code === 'en' ? 'YES' : table[code]?.speech ? 'YES' : 'NO' })), languages: {} };
  const dir = `${out}/${c.iso}`; mkdirSync(dir, { recursive: true });
  const made = await api('POST', '/api/admin/screening/emergency', { audience: c.iso3, drill: { hazardType: hazard, alertLevel: level === 'GREEN' || level === 'RED' || level === 'ORANGE' ? level : 'ORANGE', title, eventTime: rec?.eventStart ?? new Date().toISOString(), lat: c.centre[0], lon: c.centre[1], sourceId } }, token);
  if (made.status !== 200) { row.error = made.text.slice(0, 200); rows.push(row); continue; }
  const id = made.json.bulletinId; row.bulletinId = id;
  let t = performance.now();
  const tr = tested.length ? await api('POST', `/api/admin/screening/${id}/translate`, { languages: tested }, token) : { json: { results: [] } };
  row.translateMs = Math.round(performance.now() - t);
  for (const r of tr.json?.results ?? []) row.languages[r.language] = { translated: r.ok, flagged: r.problems ?? null, error: r.error ?? null };
  t = performance.now();
  for (const l of tested) if (row.languages[l]?.translated && row.languages[l].flagged === 0) { const a = await api('POST', `/api/admin/screening/${id}/translation/${l}`, { action: 'approve', readsLanguage: true }, token); row.languages[l].approvedByScript = a.status === 200; }
  await api('POST', `/api/admin/screening/${id}`, { action: 'approve' }, token);
  const voiced = ['en', ...tested.filter((l) => row.languages[l]?.approvedByScript && table[l]?.speech)];
  for (const l of voiced) { const v = await api('POST', `/api/admin/screening/${id}/voice`, { language: l }, token); if (l !== 'en') row.languages[l].voice = v.status === 200 ? 'ok' : v.text.slice(0, 120); else row.englishVoice = v.status === 200 ? 'ok' : v.text.slice(0, 120); }
  row.voiceMs = Math.round(performance.now() - t);
  t = performance.now();
  for (const l of ['en', ...tested]) {
    if (l !== 'en' && !row.languages[l]?.approvedByScript) continue;
    const cd = await api('GET', `/api/admin/screening/${id}/card?lang=${l}`, undefined, token);
    if (cd.status !== 200) { if (l !== 'en') row.languages[l].card = `HTTP ${cd.status}`; continue; }
    writeFileSync(`${dir}/${l}.svg`, cd.text); await page.setContent(`<body style="margin:0">${cd.text}</body>`); await page.screenshot({ path: `${dir}/${l}.png` });
    if (l !== 'en') row.languages[l].card = 'ok';
  }
  row.cardMs = Math.round(performance.now() - t); row.systemMs = Math.round(performance.now() - t0);
  const room = (await api('GET', '/api/admin/screening', undefined, token)).json; const item = room.stored.find((s) => s.bulletinId === id);
  writeFileSync(`${dir}/bulletin.json`, JSON.stringify({ incident: title, segments: item.bulletin.segments.map((s) => s.text), translations: item.translations.map((x) => ({ language: x.language, status: x.status, problems: x.problems, texts: x.texts, back: x.back })) }, null, 1));
  rows.push(row);
  console.log(`${c.iso} ${c.name}: ${row.systemMs} ms | ${c.top3.map(([code]) => code + ':' + (code === 'en' ? 'src' : row.languages[code] ? (row.languages[code].flagged ? 'FLAGGED' : row.languages[code].voice === 'ok' ? 'text+voice' : 'text') : 'UNSUPPORTED')).join(' ')}`);
}
await browser.close();
writeFileSync(`${out}/results.json`, JSON.stringify({ at: new Date().toISOString(), wallMs: Math.round(performance.now() - wall0), rows }, null, 1));
console.log('done: wall', Math.round(performance.now() - wall0) / 1000, 's, results in', `${out}/results.json`);
