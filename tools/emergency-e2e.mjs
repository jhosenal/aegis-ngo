// End-to-end timing of the emergency pipeline against the running local server (AEG-NEWS-007).
// Five EXERCISES (drills), each built from the most recent matching record in content/history/hazard-history.json, never published:
//   draft (code) -> translate to Malay, Mandarin and Tamil (model + number and name check + back-translation) -> human gate (here a script clicks approve, standing in for the reviewer)
//   -> voice (Google Text-to-Speech, when switched on) -> warning card in four languages (SVG made by the server, rendered to PNG in Chrome).
// It reports SYSTEM time (what the machine does) and keeps the HUMAN gate separate. Run from E:\Aegis with the server on :8787:
//   node tools/emergency-e2e.mjs [--base http://127.0.0.1:8787] [--out records/e2e/2026-10-17_emergency]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:8787');
const out = arg('out', 'records/e2e/2026-10-17_emergency');
const LANGS = ['ms', 'zh', 'ta'];
const now = () => performance.now();
const ms = (t) => Math.round(t);
mkdirSync(out, { recursive: true });

const history = JSON.parse(readFileSync('content/history/hazard-history.json', 'utf8'));
const latest = (type) => history.cards.filter((c) => c.hazardType === type).sort((a, b) => String(b.eventStart ?? '').localeCompare(String(a.eventStart ?? '')))[0];
const sourceOf = (c) => (c.hazardType === 'HAZE' ? 'SRC.NEA.PSI.LIVE' : c.hazardType === 'EARTHQUAKE' ? 'SRC.USGS.LIVE' : 'SRC.GDACS.LIVE');
const CENTRE = { MYS: [4.2, 102], SGP: [1.35, 103.8], BRN: [4.5, 114.7], IDN: [-2, 118], THA: [15, 101], PHL: [12, 122] };
const pick = (hazard, type, place) => {
  const c = latest(type); const loc = c.location ?? {};
  const lat = Number(loc.lat ?? loc.latitude ?? CENTRE[(c.countries ?? [])[0]]?.[0] ?? place[0]); const lon = Number(loc.lon ?? loc.lng ?? loc.longitude ?? CENTRE[(c.countries ?? [])[0]]?.[1] ?? place[1]);
  return { set: hazard, record: c.id, domain: c.domain, drill: { hazardType: hazard, alertLevel: String(c.alertLevel?.value ?? c.rating?.value ?? 'ORANGE').toUpperCase().replace('VERY UNHEALTHY', 'RED').replace('GREEN', 'GREEN'), title: c.title, eventTime: c.eventStart ?? null, lat, lon, sourceId: sourceOf(c) } };
};
const SETS = [pick('EARTHQUAKE', 'EARTHQUAKE', [4, 117]), pick('FLOOD', 'FLOOD', [4, 102]), pick('STORM', 'STORM', [12, 125]), pick('WILDFIRE', 'HAZE', [1.35, 103.8]), pick('VOLCANO', 'VOLCANO', [10.4, 123.1])];
for (const s of SETS) if (!['RED', 'ORANGE', 'GREEN'].includes(s.drill.alertLevel)) s.drill.alertLevel = 'ORANGE';

const login = await (await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'DEV-ADMIN' }) })).json();
const H = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
const api = async (method, path, body) => {
  const t = now(); const r = await fetch(`${base}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* svg or audio */ }
  return { status: r.status, ok: r.ok, json, text, ms: ms(now() - t) };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
const rows = []; const wall0 = now();
for (const set of SETS) {
  const dir = `${out}/${set.set.toLowerCase()}`; mkdirSync(dir, { recursive: true });
  const row = { set: set.set, record: set.record, title: set.drill.title, level: set.drill.alertLevel, stages: {}, languages: {}, notes: [] };
  const t0 = now();
  const made = await api('POST', '/api/admin/screening/emergency', { drill: set.drill, output: 'voice' });
  row.stages.draftMs = made.ms;
  if (!made.ok) { row.notes.push(`draft failed: ${made.json?.error?.message ?? made.status}`); rows.push(row); continue; }
  const id = made.json.bulletinId; row.bulletinId = id;
  await api('POST', `/api/admin/screening/${id}/plan`, { languages: LANGS });
  const tr = await api('POST', `/api/admin/screening/${id}/translate`, {});
  row.stages.translateMs = tr.ms;   // the three languages run in parallel: this is the slowest of them
  for (const r of tr.json?.results ?? []) row.languages[r.language] = { translateMs: r.ms, ok: r.ok, flagged: r.problems ?? null, error: r.error ?? null };
  const stored = (await api('GET', '/api/admin/screening')).json.stored.find((b) => b.bulletinId === id);
  for (const t of stored.translations) { row.languages[t.language] = { ...row.languages[t.language], problems: t.problems, text: t.texts[0], back: t.back[0] }; }
  writeFileSync(`${dir}/bulletin.json`, JSON.stringify({ bulletin: stored.bulletin, translations: stored.translations }, null, 2));
  // The human gate (a script stands in for the reviewer here: the clicks cost no time, the real review time is separate).
  const tGate = now(); const gate = { approved: [], blocked: [] };
  for (const l of LANGS) { const r = await api('POST', `/api/admin/screening/${id}/translation/${l}`, { action: 'approve', readsLanguage: true, note: 'E2E exercise: approved by the test script, not by a reader' }); (r.ok ? gate.approved : gate.blocked).push(l); if (!r.ok) row.languages[l].blocked = r.json?.error?.message ?? r.status; }
  const appr = await api('POST', `/api/admin/screening/${id}`, { action: 'approve', note: 'E2E exercise' });
  row.stages.gateScriptMs = ms(now() - tGate); row.gate = { ...gate, bulletinApproved: appr.ok };
  // Voice: the English bulletin and each approved language.
  const tVoice = now();
  const v = await api('POST', `/api/admin/screening/${id}/voice`, {});
  row.voice = { en: v.ok ? (v.json?.mode ?? 'ok') : `failed: ${v.json?.error?.message ?? v.status}` };
  const vl = await Promise.all(gate.approved.map(async (l) => { const r = await api('POST', `/api/admin/screening/${id}/voice`, { language: l }); return [l, r.ok ? 'ok' : `skipped: ${(r.json?.error?.message ?? r.status).toString().slice(0, 90)}`, r.ms]; }));
  for (const [l, s, t] of vl) row.voice[l] = s;
  row.stages.voiceMs = ms(now() - tVoice);
  // Subtitles: the cues per language (fractions of the speech; the player multiplies them by the audio length).
  row.cues = {}; row.guidance = stored.bulletin.segments.find((x) => x.id === 'emergency-actions')?.text ?? '';
  for (const l of ['en', ...LANGS]) { const c = await api('GET', `/api/admin/screening/${id}/cues?lang=${l}`); row.cues[l] = c.ok ? c.json.cues.length : `failed ${c.status}`; if (c.ok) writeFileSync(`${dir}/${l}.cues.json`, JSON.stringify(c.json, null, 1)); }
  // Cards: the server makes the SVG, Chrome renders the PNG.
  const tCard = now(); row.stages.cardServerMs = 0; row.stages.cardRenderMs = 0; row.cards = {};
  for (const l of ['en', ...LANGS]) {
    const svg = await api('GET', `/api/admin/screening/${id}/card?lang=${l}`);
    row.stages.cardServerMs += svg.ms;
    if (!svg.ok) { row.cards[l] = `failed ${svg.status}`; continue; }
    writeFileSync(`${dir}/${l}.svg`, svg.text);
    const r0 = now();
    await page.setContent(`<html><body style="margin:0;background:#000">${svg.text}</body></html>`);
    await page.waitForTimeout(150);   // let the embedded picture and fonts settle
    await page.screenshot({ path: `${dir}/${l}.png`, clip: { x: 0, y: 0, width: 1200, height: 675 } });
    row.stages.cardRenderMs += ms(now() - r0); row.cards[l] = `${l}.png`;
  }
  row.stages.cardMs = ms(now() - tCard);
  const sys = ms(now() - t0) - row.stages.gateScriptMs;
  row.systemMs = sys;
  rows.push(row);
  console.log(`${set.set}: system ${(sys / 1000).toFixed(1)} s (draft ${row.stages.draftMs} ms, translate ${row.stages.translateMs} ms, voice ${row.stages.voiceMs} ms, cards ${row.stages.cardMs} ms); approved ${gate.approved.join(',') || '-'}; blocked ${gate.blocked.join(',') || '-'}`);
}
await browser.close();
const wall = ms(now() - wall0);
writeFileSync(`${out}/results.json`, JSON.stringify({ at: new Date().toISOString(), base, wallMs: wall, rows }, null, 2));
console.log(`done: ${rows.length} sets, wall ${(wall / 1000).toFixed(1)} s, results in ${out}/results.json`);
