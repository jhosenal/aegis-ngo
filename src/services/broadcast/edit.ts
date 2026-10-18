// Editing a bulletin script before approval (AEG-NEWS-007, AEG-SOP-003). The administrator may reword the English; code still owns the facts, so an edit is refused when it adds a number or an
// acronym (USGS, NEA, PSI ...) that the original segment did not contain, when it drops the exercise wording of a drill, or when it touches the official guidance and notice segments.
import { CREDITS_SECONDS, spokenSeconds, type Bulletin } from './script.js';

/** Quoted official guidance and the "not an official warning" notice are never edited here: change the guidance file or the notice in code, with its source. */
export const PROTECTED_SEGMENTS = ['emergency-actions', 'emergency-notice'];
const NUMBER = /\d+(?:[.:]\d+)*/g;
const ACRONYM = /\b[A-Z]{2,}[A-Z0-9-]*\b/g;

export interface ScriptEdit { id: string; text: string }
export interface EditResult { bulletin: Bulletin; changes: { segmentId: string; before: string; after: string }[]; problems: string[] }

export function applyScriptEdits(bulletin: Bulletin, edits: ScriptEdit[]): EditResult {
  const problems: string[] = [];
  const changes: EditResult['changes'] = [];
  const byId = new Map(edits.map((e) => [e.id, e.text.replace(/\s+/g, ' ').trim()]));
  for (const id of byId.keys()) if (!bulletin.segments.some((s) => s.id === id)) problems.push(`There is no segment "${id}".`);
  const segments = bulletin.segments.map((seg) => {
    const text = byId.get(seg.id);
    if (text === undefined || text === seg.text) return seg;
    if (PROTECTED_SEGMENTS.includes(seg.id)) { problems.push(`${seg.title}: this is official guidance or the fixed notice and cannot be edited here.`); return seg; }
    if (text.length < 10 || text.length > 1500) { problems.push(`${seg.title}: the text must be 10 to 1500 characters.`); return seg; }
    const known = `${seg.text} ${seg.lowerThird}`;
    const knownNumbers = new Set(known.match(NUMBER) ?? []);
    const knownAcronyms = new Set(known.match(ACRONYM) ?? []);
    for (const n of new Set(text.match(NUMBER) ?? [])) if (!knownNumbers.has(n)) problems.push(`${seg.title}: the number ${n} is not in the original text. Numbers come from the facts, so an edit cannot add one.`);
    for (const a of new Set(text.match(ACRONYM) ?? [])) if (!knownAcronyms.has(a)) problems.push(`${seg.title}: the name ${a} is not in the original text.`);
    if (bulletin.slotId === 'drill' && seg.id === 'emergency-headline' && !/exercise/i.test(text)) problems.push(`${seg.title}: an exercise must keep saying it is an exercise.`);
    changes.push({ segmentId: seg.id, before: seg.text, after: text });
    return { ...seg, text };
  });
  let at = 0;
  const timed = segments.map((seg) => { const durationSec = spokenSeconds(seg.text); const out = { ...seg, startSec: Math.round(at * 10) / 10, durationSec }; at += durationSec; return out; });
  return { bulletin: { ...bulletin, segments: timed, estimatedSeconds: Math.round((at + CREDITS_SECONDS) * 10) / 10 }, changes, problems };
}
