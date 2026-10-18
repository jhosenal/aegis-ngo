// Translating an emergency or daily bulletin (AEG-NEWS-007). Order of trust: code writes the English facts and validates them; a model only TRANSLATES them; code then checks that every number,
// time and source name survived; a second, different model translates it back to English so the human reviewer can see what the translation says; a human who reads the language approves or rejects it.
// Nothing translated reaches the public without that human approval. Never a Google air or weather value in any of these texts.
// Speed: the text is cut into sentence-sized pieces and each piece is remembered (translation memory). The official guidance lines are the same in every bulletin of a hazard, so after the first
// time they come from memory instantly (and, once a reader approved them, they are already human-approved); only the new event sentence is translated live.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ModelGateway } from '../../providers/gateway.js';
import type { MachineTranslator } from '../translateGoogle.js';
import type { Bulletin } from './script.js';

/** The languages a bulletin can be translated into, from content/broadcast/translation-languages.json. `speech` is absent where Google Cloud Text-to-Speech has no voice for the language (Khmer, Hmong, Lao, Burmese ...): the text, card and subtitles work, the voice does not. */
export interface TranslationLanguage { name: string; code: string; speech?: { languageCode: string; voice: string } }
export const TRANSLATION_LANGUAGES: Record<string, TranslationLanguage> = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../content/broadcast/translation-languages.json', import.meta.url)), 'utf8')) as { languages: Record<string, TranslationLanguage> }).languages;

const NUMBER = /\d+(?:[.:]\d+)*/g;
/** Every number in the source must appear in the translation, and the translation may add none (same list, order ignored). Digits must stay ASCII: a translation that rewrote them cannot be checked. */
export function numberParity(source: string, translated: string): string[] {
  const a = (source.match(NUMBER) ?? []).sort(); const b = (translated.match(NUMBER) ?? []).sort();
  const problems: string[] = [];
  const left = [...b];
  for (const n of a) { const i = left.indexOf(n); if (i < 0) problems.push(`the number ${n} is missing`); else left.splice(i, 1); }
  for (const n of left) problems.push(`the number ${n} was added`);
  return problems;
}

const WORD_OF: Record<string, string> = { '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen', '20': 'twenty' };
/** For the English BACK-translation only: a number that came back spelled out ("nine" for 9) is not missing. The forward translation must still keep the digits. */
export function backNumberParity(source: string, back: string): string[] {
  return numberParity(source, back).filter((m) => { const n = /^the number (\S+) is missing$/.exec(m)?.[1]; const w = n ? WORD_OF[n] : undefined; return !(w && new RegExp(`\\b${w}\\b`, 'i').test(back)); });
}

/** Proper names that must stay as written (source acronyms, the product name). */
const KEEP = ['AEGIS', 'USGS', 'GDACS'];
export function keepsNames(source: string, translated: string): string[] {
  return KEEP.filter((k) => source.includes(k) && !translated.includes(k)).map((k) => `the name ${k} is missing`);
}

/** Sentence-sized pieces (up to about 240 characters): the unit of translation and of memory. */
export function chunkText(text: string, max = 240): string[] {
  const out: string[] = []; let cur = '';
  for (const s of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
    if (cur && `${cur} ${s}`.length > max) { out.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}
export const memoryKey = (language: string, source: string): string => createHash('sha256').update(`${language}|${source}`).digest('hex').slice(0, 32);

const SYSTEM = (target: string): string => `You translate short public hazard-information texts into ${target}. Rules: translate faithfully and nothing else; do not add, remove or soften any fact; keep every number, time and date exactly as written with ASCII digits; keep the names AEGIS, USGS and GDACS and all place names and storm names as written (a place name may be followed by its usual local spelling in brackets); keep the register plain and calm, as a public information service would; do not add advice, warnings or greetings. Answer ONLY with JSON: {"texts": ["..."]} with exactly one translated text per input text, in the same order.`;
const BACK = `You translate texts into English for a reviewer who does not read the source language. Translate literally and faithfully; do not improve, add or remove anything; keep numbers exactly. Answer ONLY with JSON: {"texts": ["..."]} with exactly one English text per input text, in the same order.`;

/** At most 8 model requests at once for translation (the provider times out when far more arrive together). */
let running = 0; const waiting: (() => void)[] = [];
async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= 8) await new Promise<void>((r) => waiting.push(r));
  running += 1;
  try { return await job(); } finally { running -= 1; waiting.shift()?.(); }
}
let seq = 0;
type Outcome = { status: string; text: string | null; notice: string | null; attempts: { costMicro?: number }[] };
async function askOnce(gateway: ModelGateway, role: 'specialist' | 'reviewer', taskId: string, tenantId: string, system: string, texts: string[], limits: { tries: number; deadlineMs: number } = { tries: 3, deadlineMs: 30_000 }): Promise<string[]> {
  // The provider usually answers in 5 to 20 seconds but now and then hangs: each try gets 30 seconds, and a hung one is tried again (up to 3 tries) instead of waiting a full minute.
  let last = 'no answer';
  for (let attempt = 1; attempt <= limits.tries; attempt += 1) {
    const r = await gateway.call(role, { taskId: `${taskId}-${++seq}`, tenantId, system, user: JSON.stringify({ texts }), responseSchemaId: 'translation-v1', dataClass: 'tenant_private' }, (t) => {
      try { const j = JSON.parse(t) as { texts?: unknown }; return Array.isArray(j.texts) && j.texts.length === texts.length && j.texts.every((x) => typeof x === 'string' && x.trim().length > 0); } catch { return false; }
    }, { deadlineMs: limits.deadlineMs }) as Outcome;
    if (r.status === 'OK' && r.text !== null) return (JSON.parse(r.text) as { texts: string[] }).texts;
    last = r.notice ?? r.status;
    if (r.status === 'REFUSED' || r.status === 'CANCELLED') break;
  }
  throw new Error(`The model could not translate (${last}).`);
}
/** Texts translated in groups of up to about 450 characters per request, all groups at once within the limit. */
async function askMany(gateway: ModelGateway, role: 'specialist' | 'reviewer', taskId: string, tenantId: string, system: string, texts: string[], limits?: { tries: number; deadlineMs: number }): Promise<string[]> {
  const groups: string[][] = []; let cur: string[] = []; let len = 0;
  for (const t of texts) { if (cur.length && len + t.length > 450) { groups.push(cur); cur = []; len = 0; } cur.push(t); len += t.length; }
  if (cur.length) groups.push(cur);
  return (await Promise.all(groups.map((g) => limited(() => askOnce(gateway, role, taskId, tenantId, system, g, limits))))).flat();
}

export interface MemoryEntry { target: string; back: string; status: 'MACHINE' | 'APPROVED' | 'REJECTED'; modelTranslate: string; modelBack: string }
export interface TranslationMemory { get(language: string, hash: string): MemoryEntry | null }
export interface MemoryUse { hash: string; source: string; target: string; back: string; origin: 'approved' | 'machine' | 'fresh' }
export interface TranslationResult { language: string; texts: string[]; back: string[]; problems: string[]; models: { translate: string; back: string }; memory: MemoryUse[]; counts: { approved: number; machine: number; fresh: number } }

/** The spoken texts of a bulletin (one per segment) in a language, a back-translation, and every problem the code found. Problems do not stop the draft: the reviewer sees them. */
export async function translateBulletin(p: { gateway?: ModelGateway; machine?: MachineTranslator; bulletin: Bulletin; language: string; tenantId: string; taskId: string; models: { translate: string; back: string }; memory?: TranslationMemory }): Promise<TranslationResult> {
  if (!p.gateway && !p.machine) throw new Error('No translator is switched on (neither the models nor Google Cloud Translation).');
  const lang = TRANSLATION_LANGUAGES[p.language];
  if (!lang) throw new Error(`${p.language} is a locked stub: no translation prompt or reviewed voice exists for it yet.`);
  const source = p.bulletin.segments.map((s) => s.text);
  const joiner = p.language === 'zh' ? '' : ' ';
  const perSeg = source.map((t) => chunkText(t));
  const uniq = [...new Set(perSeg.flat())];
  const known = new Map<string, MemoryUse>();
  const models = { ...p.models };
  for (const s of uniq) { const hash = memoryKey(p.language, s); const m = p.memory?.get(p.language, hash); if (m && m.status !== 'REJECTED') known.set(s, { hash, source: s, target: m.target, back: m.back, origin: m.status === 'APPROVED' ? 'approved' : 'machine' }); }
  const fresh = uniq.filter((s) => !known.has(s));
  if (fresh.length > 0) {
    // Fast path: Google Cloud Translation does the first pass (about a second); otherwise the specialist model does. If Google fails and a model exists, the model takes over.
    let targets: string[];
    let usedMachine = false;
    if (p.machine) { try { targets = await p.machine.translate(fresh, lang.code); usedMachine = true; } catch (error) { if (!p.gateway) throw error; targets = await askMany(p.gateway, 'specialist', `${p.taskId}-t`, p.tenantId, SYSTEM(lang.name), fresh); } }
    else targets = await askMany(p.gateway!, 'specialist', `${p.taskId}-t`, p.tenantId, SYSTEM(lang.name), fresh);
    if (usedMachine) models.translate = p.machine!.name;
    const flaw = (s: string, t: string): number => numberParity(s, t).length + keepsNames(s, t).length;
    // Self-repair, once, only for the pieces that lost a number or a name; the better answer is kept per piece. A person still reviews the result.
    const bad = fresh.map((s, i) => (flaw(s, targets[i]!) > 0 ? i : -1)).filter((i) => i >= 0);
    if (bad.length > 0 && p.gateway) {
      const note = bad.slice(0, 6).map((i) => [...numberParity(fresh[i]!, targets[i]!), ...keepsNames(fresh[i]!, targets[i]!)].join(', ')).join('; ');
      const again = await askMany(p.gateway!, 'specialist', `${p.taskId}-r`, p.tenantId, `${SYSTEM(lang.name)} Your previous answer was rejected by a checker: ${note}. Fix exactly that: copy every number, date and time character for character (never a date in words) and keep the names.`, bad.map((i) => fresh[i]!)).catch(() => null);
      if (again) bad.forEach((i, k) => { if (flaw(fresh[i]!, again[k]!) < flaw(fresh[i]!, targets[i]!)) targets[i] = again[k]!; });
    }
    // The back-translation comes from a DIFFERENT engine than the forward pass when we can: a model after Google, Google after a model.
    // On the fast path the model gets ONE try of 10 s for the back-translation; if it is slow, Google translates back so the alert is not held up (the reviewer sees which engine did it).
    let backs: string[];
    if (usedMachine && p.gateway) { try { backs = await askMany(p.gateway, 'reviewer', `${p.taskId}-b`, p.tenantId, BACK, targets, { tries: 1, deadlineMs: 10_000 }); } catch { backs = await p.machine!.translate(targets, 'en', lang.code); models.back = `${p.machine!.name} (the model was slow)`; } }
    else if (p.gateway) backs = await askMany(p.gateway, 'reviewer', `${p.taskId}-b`, p.tenantId, BACK, targets);
    else { backs = await p.machine!.translate(targets, 'en', lang.code); models.back = p.machine!.name; }
    fresh.forEach((s, i) => known.set(s, { hash: memoryKey(p.language, s), source: s, target: targets[i]!, back: backs[i]!, origin: 'fresh' }));
  }
  const texts = perSeg.map((cs) => cs.map((c) => known.get(c)!.target).join(joiner));
  const back = perSeg.map((cs) => cs.map((c) => known.get(c)!.back).join(' '));
  const problems: string[] = [];
  source.forEach((s, i) => {
    for (const m of numberParity(s, texts[i]!)) problems.push(`segment ${i + 1}: ${m} in the ${lang.name.split(' ')[0]} text`);
    for (const m of keepsNames(s, texts[i]!)) problems.push(`segment ${i + 1}: ${m}`);
    for (const m of backNumberParity(s, back[i]!)) problems.push(`segment ${i + 1}: back-translation: ${m}`);
  });
  const memory = uniq.map((s) => known.get(s)!);
  const counts = { approved: memory.filter((m) => m.origin === 'approved').length, machine: memory.filter((m) => m.origin === 'machine').length, fresh: memory.filter((m) => m.origin === 'fresh').length };
  return { language: p.language, texts, back, problems, models, memory, counts };
}
