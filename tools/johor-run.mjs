// Johor run (AEG-NEWS-007): the live Singapore haze reading as the incident, a 15-second alert for a Malaysian audience, then the one-minute Johor follow-up, each in English, Malay, Mandarin and Tamil:
// Google Cloud Translation -> code checks -> scripted approval (standing in for the readers) -> Google Text-to-Speech -> warning card + subtitle cues. Both are labelled EXERCISES (never public). Server on :8787.
//   node tools/johor-run.mjs [--out records/e2e/2026-10-17_johor] [--real]   (--real makes real bulletins that WAIT for approval instead of exercises)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = 'http://127.0.0.1:8787'; const out = arg('out', 'records/e2e/2026-10-17_johor'); const real = process.argv.includes('--real');
const LANGS = ['ms', 'zh', 'ta'];
mkdirSync(out, { recursive: true });
const api = async (method, path, body, token) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, json, text };
};
const { json: { token } } = await api('POST', '/api/session', { userId: 'DEV-ADMIN' });
const t0 = performance.now(); const log = {};
const cands = (await api('GET', '/api/admin/screening/emergency/candidates', undefined, token)).json.candidates;
const haze = cands.find((c) => c.sourceId === 'SRC.NEA.PSI.LIVE');
if (!haze) { console.log('no live haze candidate'); process.exit(1); }
log.incident = haze;
const alertBody = real ? { audience: 'MYS', evidenceId: haze.evidenceId } : { audience: 'MYS', drill: { hazardType: haze.hazardType, alertLevel: haze.alertLevel, title: haze.title, eventTime: haze.eventTime, lat: 1.5, lon: 103.7, sourceId: haze.sourceId } };
const a = await api('POST', '/api/admin/screening/emergency', alertBody, token);
if (a.status !== 200) { console.log('alert failed', a.text); process.exit(1); }
log.alertId = a.json.bulletinId; log.alertDraftMs = Math.round(performance.now() - t0);
const f = await api('POST', '/api/admin/screening/emergency', { followUpOf: a.json.bulletinId, area: 'Johor' }, token);
if (f.status !== 200) { console.log('follow-up failed', f.text); process.exit(1); }
log.followUpId = f.json.bulletinId; log.bothDraftedMs = Math.round(performance.now() - t0);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
for (const [name, id] of [['alert', log.alertId], ['followup', log.followUpId]]) {
  const t1 = performance.now(); const dir = `${out}/${name}`; mkdirSync(dir, { recursive: true });
  const tr = await api('POST', `/api/admin/screening/${id}/translate`, { languages: LANGS }, token);
  const res = {}; for (const r of tr.json?.results ?? []) res[r.language] = { ok: r.ok, problems: r.problems ?? null, error: r.error ?? null };
  for (const l of LANGS) if (res[l]?.ok && res[l].problems === 0) await api('POST', `/api/admin/screening/${id}/translation/${l}`, { action: 'approve', readsLanguage: true }, token);
  await api('POST', `/api/admin/screening/${id}`, { action: 'approve' }, token);
  const voice = {};
  for (const l of ['en', ...LANGS]) { const v = await api('POST', `/api/admin/screening/${id}/voice`, { language: l }, token); voice[l] = v.status === 200 ? 'ok' : v.text.slice(0, 120); }
  for (const l of ['en', ...LANGS]) {
    const c = await api('GET', `/api/admin/screening/${id}/card?lang=${l}`, undefined, token); if (c.status !== 200) continue;
    writeFileSync(`${dir}/${l}.svg`, c.text); await page.setContent(`<body style="margin:0">${c.text}</body>`); await page.screenshot({ path: `${dir}/${l}.png` });
    const q = await api('GET', `/api/admin/screening/${id}/cues?lang=${l}`, undefined, token); if (q.status === 200) writeFileSync(`${dir}/${l}.cues.json`, JSON.stringify(q.json, null, 1));
  }
  const room = (await api('GET', '/api/admin/screening', undefined, token)).json; const item = room.stored.find((s) => s.bulletinId === id);
  writeFileSync(`${dir}/bulletin.json`, JSON.stringify({ id, segments: item.bulletin.segments, translations: item.translations.map((x) => ({ language: x.language, status: x.status, problems: x.problems, texts: x.texts, back: x.back })) }, null, 1));
  log[name] = { translations: res, voice, ms: Math.round(performance.now() - t1) };
}
await browser.close();
log.systemMs = Math.round(performance.now() - t0);
writeFileSync(`${out}/results.json`, JSON.stringify(log, null, 1));
console.log(JSON.stringify({ alertId: log.alertId, followUpId: log.followUpId, bothDraftedMs: log.bothDraftedMs, systemMs: log.systemMs, alert: log.alert, followup: log.followup }, null, 1));
