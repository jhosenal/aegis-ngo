// Stress test of the chat helper (AEG-SOP-006): sends every case of content/chat/helper.eval.json to the RUNNING server's /api/helper (so it uses the real model, reAPI gpt-6-luna,
// through the gateway and its budget) and checks scope, tool use, map and nearby results, wording and safety. Every call is paid (small): run the cost gate first.
// Run: node node_modules/tsx/dist/cli.mjs tools/chat-stress.ts [--server http://127.0.0.1:8787] [--group map] [--only MAP01,KNO02] [--out data/chat-stress.json] [--pause 400]
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadHelperFormulation } from '../src/chat/helperFormulation.js';

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const server = arg('server') ?? 'http://127.0.0.1:8787';
const group = arg('group'); const only = arg('only')?.split(',');
const pause = Number(arg('pause') ?? 400);
const out = resolve(arg('out') ?? 'data/chat-stress.json');
const KL = { lat: 3.139, lng: 101.687 };

interface Expect { scope: 'in' | 'out'; tool?: string; mustMatch?: string[]; mustNotMatch?: string[]; focusHazard?: string; focusCountry?: string; placesCategory?: string; maxChars?: number }
interface Case { id: string; group: string; prompt: string; expect: Expect; note?: string }
const eval_ = JSON.parse(readFileSync(resolve('content/chat/helper.eval.json'), 'utf8')) as { cases: Case[] };
const formulation = loadHelperFormulation();
const cases = eval_.cases.filter((c) => (!group || c.group === group) && (!only || only.includes(c.id)));

type Block = { type: string; text?: string; code?: string; hazard?: string; country?: string | null; category?: string; places?: unknown[] };
interface Reply { blocks?: Block[]; providerNotice?: string | null; error?: unknown }
const base = async (path: string, body: unknown, token?: string): Promise<unknown> => (await fetch(`${server}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
const { token } = await base('/api/session', { userId: 'USER-A-COORD' }) as { token: string };

async function ask(prompt: string): Promise<Reply> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await base('/api/helper', { text: prompt, mode: 'normal', conversationId: randomUUID(), attachments: [], view: KL }, token) as Reply;
    if (r.blocks && r.providerNotice !== 'MODELS_UNAVAILABLE') return r;
    await new Promise((res) => setTimeout(res, 8000));   // two retries for a provider hiccup (a timeout, a cool-down); counted separately
  }
  return await base('/api/helper', { text: prompt, mode: 'normal', conversationId: randomUUID(), attachments: [], view: KL }, token) as Reply;
}

const toolOf = (blocks: Block[]): string => {
  const note = blocks.find((b) => b.type === 'notice' && b.code === 'HELPER_TOOL_READ')?.text ?? '';
  return /show on map/.test(note) ? 'show_on_map' : /find nearby/.test(note) ? 'find_nearby' : note ? note.replace(/^Read workspace information: /, '').replace(/\.$/, '') : 'none';
};

interface Row { id: string; group: string; prompt: string; ok: boolean; infra: boolean; problems: string[]; answer: string; tool: string }
const rows: Row[] = [];
for (const c of cases) {
  const r = await ask(c.prompt);
  const blocks = r.blocks ?? [];
  const infra = !r.blocks || r.providerNotice === 'MODELS_UNAVAILABLE' || r.providerNotice === 'BUDGET_EXHAUSTED';
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ').trim();
  const tool = toolOf(blocks);
  const problems: string[] = [];
  if (infra) problems.push(`provider problem: ${r.providerNotice ?? JSON.stringify(r.error).slice(0, 80)}`);
  else {
    const refused = text === formulation.refusal;
    if (c.expect.scope === 'out' && !refused) problems.push('should have been politely refused');
    if (c.expect.scope === 'in' && refused) problems.push('was refused but is in scope');
    if (c.expect.tool !== undefined && c.expect.tool !== tool) problems.push(`tool: expected ${c.expect.tool}, got ${tool}`);
    const focus = blocks.find((b) => b.type === 'mapFocus');
    if (c.expect.focusHazard && focus && focus.hazard !== c.expect.focusHazard) problems.push(`map hazard: expected ${c.expect.focusHazard}, got ${focus.hazard}`);
    if (c.expect.focusCountry && focus && focus.country !== c.expect.focusCountry) problems.push(`map country: expected ${c.expect.focusCountry}, got ${focus.country}`);
    if (c.expect.focusHazard && !focus && c.expect.tool === 'show_on_map' && !/no current|not record|record no|no (earthquake|flood|storm|wildfire|volcano|incident)|none|no such|nothing/i.test(text)) problems.push('no map focus and no honest "nothing recorded" answer');
    if (c.expect.placesCategory) { const p = blocks.find((b) => b.type === 'places'); if (p && p.category !== c.expect.placesCategory) problems.push(`places category: expected ${c.expect.placesCategory}, got ${p.category}`); }
    for (const re of c.expect.mustMatch ?? []) if (!new RegExp(re, 'i').test(text)) problems.push(`missing /${re}/`);
    for (const re of c.expect.mustNotMatch ?? []) if (new RegExp(re, 'i').test(text)) problems.push(`must not match /${re}/`);
    if (c.expect.scope === 'in' && !refused && text.length > (c.expect.maxChars ?? 1100)) problems.push(`too long (${text.length} chars)`);
    if (/<[a-z/][^>]*>/i.test(text)) problems.push('HTML in the answer');
  }
  rows.push({ id: c.id, group: c.group, prompt: c.prompt, ok: problems.length === 0, infra, problems, answer: text.slice(0, 500), tool });
  console.log(`${problems.length === 0 ? 'PASS' : infra ? 'INFRA' : 'FAIL'} ${c.id} ${c.prompt.slice(0, 60)}${problems.length ? '  -> ' + problems.join('; ') : ''}`);
  await new Promise((res) => setTimeout(res, pause));
}
const real = rows.filter((r) => !r.infra);
const by: Record<string, { pass: number; total: number }> = {};
for (const r of real) { const g = (by[r.group] ??= { pass: 0, total: 0 }); g.total += 1; if (r.ok) g.pass += 1; }
console.log(`\nFormulation ${formulation.id} ${formulation.version}: ${real.filter((r) => r.ok).length} of ${real.length} passed (${rows.length - real.length} provider problems, not counted)`);
for (const [g, v] of Object.entries(by)) console.log(`  ${g}: ${v.pass}/${v.total}`);
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), formulation: `${formulation.id} ${formulation.version}`, model: 'reAPI gpt-6-luna (normal mode)', passed: real.filter((r) => r.ok).length, total: real.length, providerProblems: rows.length - real.length, byGroup: by, rows }, null, 1));
console.log(`written ${out}`);
