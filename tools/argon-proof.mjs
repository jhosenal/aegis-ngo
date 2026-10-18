// Proof that Gemini 4 Argon runs on Vertex AI for the script review, with the real cost measured (AEG-NEWS-007). It runs the script review on real segments through the running server (so every call is a job
// card), records the token counts and latency the API returned, the cost at Vertex rates, and whether the proposal passed the fact checks, and writes a results file. It accepts nothing: no script is changed.
//   node tools/argon-proof.mjs [--out records/e2e/2026-10-17_argon] [--max 8]   (server on :8787 with AEGIS_VERTEX_PROJECT set; the cost gate entry for it must exist)
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = 'http://127.0.0.1:8787'; const out = arg('out', 'records/e2e/2026-10-17_argon'); const max = Number(arg('max', '8'));
mkdirSync(out, { recursive: true });
const api = async (method, path, body, token) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, json, text };
};
const { json: { token } } = await api('POST', '/api/session', { userId: 'DEV-ADMIN' });
// Real segments: the latest stored daily bulletin (several long segments) plus a fresh exercise alert and Johor follow-up.
const room = (await api('GET', '/api/admin/screening', undefined, token)).json;
const daily = room.stored.find((s) => s.slotId !== 'drill' && s.slotId !== 'emergency' && s.bulletin?.segments?.length > 3);
const cases = [];
if (daily) for (const seg of daily.bulletin.segments) if (!['emergency-actions', 'emergency-notice'].includes(seg.id)) cases.push({ bulletinId: daily.bulletinId, segmentId: seg.id, label: `daily ${daily.slotId}: ${seg.title}` });
const cands = (await api('GET', '/api/admin/screening/emergency/candidates', undefined, token)).json.candidates; const haze = cands.find((c) => c.sourceId === 'SRC.NEA.PSI.LIVE');
if (haze) {
  const a = await api('POST', '/api/admin/screening/emergency', { audience: 'MYS', drill: { hazardType: haze.hazardType, alertLevel: haze.alertLevel, title: haze.title, eventTime: haze.eventTime, lat: 1.5, lon: 103.7, sourceId: haze.sourceId } }, token);
  const f = await api('POST', '/api/admin/screening/emergency', { followUpOf: a.json.bulletinId, area: 'Johor' }, token);
  cases.push({ bulletinId: a.json.bulletinId, segmentId: 'emergency-headline', label: 'alert (exercise): headline' }, { bulletinId: f.json.bulletinId, segmentId: 'followup-johor', label: 'Johor follow-up (exercise): Johor now' });
}
const results = [];
for (const c of cases.slice(0, max)) {
  const t0 = performance.now();
  const r = await api('POST', `/api/admin/screening/${c.bulletinId}/script-review`, { segmentId: c.segmentId }, token);
  const row = { ...c, status: r.status, wallMs: Math.round(performance.now() - t0) };
  if (r.status === 200) Object.assign(row, { ok: r.json.ok, unchanged: r.json.unchanged, problems: r.json.problems, usage: r.json.usage, latencyMs: r.json.latencyMs, costUsd: Number(r.json.costUsd), jobId: r.json.jobId, model: r.json.model, original: r.json.original, proposal: r.json.proposal });
  else row.error = (r.json?.error?.message ?? r.text).slice(0, 200);
  results.push(row);
  console.log(`${row.label.padEnd(46)} ${r.status === 200 ? `${row.usage.promptTokens} in / ${row.usage.outputTokens} out / ${row.usage.thoughtsTokens} think | ${row.latencyMs} ms | ${row.costUsd.toFixed(6)} USD | ${row.ok ? (row.unchanged ? 'unchanged' : 'PASSED the checks') : 'REJECTED: ' + row.problems[0]}` : 'HTTP ' + r.status + ' ' + row.error}`);
}
const good = results.filter((r) => r.status === 200);
const sum = (k) => good.reduce((n, r) => n + k(r), 0);
const summary = { at: new Date().toISOString(), model: good[0]?.model ?? null, calls: results.length, succeeded: good.length, passedChecks: good.filter((r) => r.ok).length, unchanged: good.filter((r) => r.unchanged).length,
  tokens: { prompt: sum((r) => r.usage.promptTokens), output: sum((r) => r.usage.outputTokens), thinking: sum((r) => r.usage.thoughtsTokens) }, totalCostUsd: Number(sum((r) => r.costUsd).toFixed(6)),
  avgCostUsd: good.length ? Number((sum((r) => r.costUsd) / good.length).toFixed(6)) : null, avgLatencyMs: good.length ? Math.round(sum((r) => r.latencyMs) / good.length) : null, maxLatencyMs: good.length ? Math.max(...good.map((r) => r.latencyMs)) : null };
writeFileSync(`${out}/results.json`, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
