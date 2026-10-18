// Vietnam test of the emergency pipeline (AEG-NEWS-007): the most recent Vietnam incident in our history file, as a labelled EXERCISE (never public), translated to Vietnamese, Khmer and Hmong,
// approved by script (standing in for the readers), voiced where Google has a voice (Vietnamese only), and drawn as a warning card per language. Run with the server on :8787:
//   node tools/vietnam-test.mjs [--out records/e2e/2026-10-17_vietnam]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = 'http://127.0.0.1:8787'; const out = arg('out', 'records/e2e/2026-10-17_vietnam');
mkdirSync(out, { recursive: true });
const api = async (method, path, body, token) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, json, text };
};
const history = JSON.parse(readFileSync('content/history/hazard-history.json', 'utf8'));
const vn = history.cards.filter((c) => (c.countries ?? []).some((x) => x === 'Viet Nam' || x === 'Vietnam')).sort((a, b) => String(b.eventStart).localeCompare(String(a.eventStart)))[0];
const LANGS = ['vi', 'km', 'hmn'];
const t0 = performance.now(); const stage = {};
const { json: { token } } = await api('POST', '/api/session', { userId: 'DEV-ADMIN' });
const lvl = String(vn.alertLevel?.value ?? 'ORANGE').toUpperCase();
const made = await api('POST', '/api/admin/screening/emergency', { audience: 'VNM', drill: { hazardType: vn.hazardType, alertLevel: lvl, title: vn.title, eventTime: vn.eventStart, lat: 16.0, lon: 107.5, sourceId: 'SRC.GDACS.LIVE' } }, token);
if (made.status !== 200) { console.log('create failed', made.text); process.exit(1); }
const id = made.json.bulletinId; stage.draftMs = Math.round(performance.now() - t0);
let t = performance.now();
const tr = await api('POST', `/api/admin/screening/${id}/translate`, { languages: LANGS }, token);
stage.translateMs = Math.round(performance.now() - t);
const results = {};
for (const r of tr.json?.results ?? []) results[r.language] = { ok: r.ok, problems: r.problems ?? null, error: r.error ?? null, ms: r.ms };
t = performance.now();
for (const l of LANGS) if (results[l]?.ok) await api('POST', `/api/admin/screening/${id}/translation/${l}`, { action: 'approve', readsLanguage: true }, token);
await api('POST', `/api/admin/screening/${id}`, { action: 'approve' }, token);
stage.gateMs = Math.round(performance.now() - t);
t = performance.now();
const voice = {};
for (const l of ['en', ...LANGS]) { const v = await api('POST', `/api/admin/screening/${id}/voice`, { language: l }, token); voice[l] = v.status === 200 ? 'ok' : (v.json?.error?.message ?? v.json?.message ?? v.text).slice(0, 160); }
stage.voiceMs = Math.round(performance.now() - t);
const room = (await api('GET', '/api/admin/screening', undefined, token)).json;
const item = room.stored.find((s) => s.bulletinId === id);
writeFileSync(`${out}/bulletin.json`, JSON.stringify({ title: vn.title, record: vn.id, item: { segments: item.bulletin.segments, translations: item.translations }, voice }, null, 1));
t = performance.now();
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
for (const l of ['en', ...LANGS]) {
  const c = await api('GET', `/api/admin/screening/${id}/card?lang=${l}`, undefined, token);
  if (c.status !== 200) { results[l] = { ...(results[l] ?? {}), card: `HTTP ${c.status}` }; continue; }
  writeFileSync(`${out}/${l}.svg`, c.text);
  await page.setContent(`<body style="margin:0">${c.text}</body>`); await page.screenshot({ path: `${out}/${l}.png` });
}
await browser.close(); stage.cardMs = Math.round(performance.now() - t);
const system = Math.round(performance.now() - t0);
writeFileSync(`${out}/results.json`, JSON.stringify({ at: new Date().toISOString(), incident: { title: vn.title, level: lvl, record: vn.id }, bulletinId: id, stage, systemMs: system, results, voice }, null, 1));
console.log(JSON.stringify({ incident: vn.title, level: lvl, stage, systemMs: system, results, voice }, null, 1));
console.log('action:', item.bulletin.segments[1].text);
for (const x of item.translations) console.log(x.language, '|', x.texts.join(' ').slice(0, 260));
