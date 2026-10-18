import { type PreviewCue } from './bulletinPreview.js';
import type { CameraView } from './newsContent.js';

/** The latest news clip the "Latest news" button plays: a rendered presenter video with beat-timed captions (media/news-latest.json, written by the render step). */
export interface LatestNews { id: string; label: string; seconds: number; video: string; cues: PreviewCue[]; mentions: { view: CameraView; at: number; end: number }[]; machineTranslated?: boolean }
interface LatestFile { id: string; label: string; seconds: number; cues: { start: number; end: number; text: string | PreviewCue['text'] }[]; mentions?: { view: CameraView; at: number; end: number }[]; translation?: { review?: string } }

const MAX_WORDS = 7;
/** Splits a long caption into short phrases (at commas first, then by word count) so it fits the two-line band; time is shared by word count. */
function shorten(cue: PreviewCue): PreviewCue[] {
  const words = cue.text.en.split(/\s+/);
  if (words.length <= MAX_WORDS) return [cue];
  const pieces: string[] = []; let line = '';
  for (const part of cue.text.en.replace(/U\.S\./g,'U_S_').split(/(?<=[,.!?])\s+/).map(text=>text.replace(/U_S_/g,'U.S.'))) {
    const next = line ? `${line} ${part}` : part;
    if (line && next.split(/\s+/).length > MAX_WORDS) { pieces.push(line); line = part; } else line = next;
  }
  if (line) pieces.push(line);
  const out: string[] = [];
  for (const piece of pieces) {
    const w = piece.split(/\s+/); const n = Math.ceil(w.length / MAX_WORDS); const size = Math.ceil(w.length / n);
    for (let i = 0; i < w.length; i += size) out.push(w.slice(i, i + size).join(' '));
  }
  const total = out.reduce((a, t) => a + t.split(/\s+/).length, 0); let at = cue.start;
  return out.map((t) => { const d = (cue.end - cue.start) * t.split(/\s+/).length / total; const c = { ...cue, start: at, end: at + d, text: { en: t, zh: t, ms: t, ta: t } }; at += d; return c; });
}

let cached: Promise<LatestNews> | null = null;

/** Loads the clip description once. Each caption beat is split into sentences by word count, like a bulletin. English only. */
export function loadLatestNews(): Promise<LatestNews> {
  cached ??= fetch('/media/news-latest.json', { cache: 'no-cache' }).then(async (res) => {
    // A missing file can come back as the HTML app page with status 200, so check the type and the shape too.
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('No news bulletin is available yet.');
    const file = await res.json().catch(() => null) as LatestFile | null;
    if (!file || !Array.isArray(file.cues)) throw new Error('No news bulletin is available yet.');
    // Rendered beat timestamps are authoritative. Avoid re-splitting abbreviations
    // through the estimated-bulletin sentence parser (which can drop "U." in "U.S.").
    const cues = file.cues.flatMap(cue => typeof cue.text === 'string'
      ? shorten({ start: cue.start, end: cue.end, text: { en: cue.text, zh: cue.text, ms: cue.text, ta: cue.text }, lowerThird: '' })
      : [{ start: cue.start, end: cue.end, text: cue.text, lowerThird: '' }]);
    return { id: file.id, label: file.label, seconds: file.seconds, video: '/media/news-latest.webm?v=transparent-2', cues, mentions: file.mentions ?? [], machineTranslated: file.translation?.review === 'machine-generated, not human-reviewed' };
  }).catch((e: unknown) => { cached = null; throw e instanceof Error ? e : new Error('No news bulletin is available yet.'); });
  return cached;
}
