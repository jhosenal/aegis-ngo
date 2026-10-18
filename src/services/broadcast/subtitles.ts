// Subtitles for the spoken emergency bulletin (AEG-NEWS-007): the texts of a bulletin, in one language, cut into short captions that follow the voice. The real length of the audio is only known
// in the browser, so the cues are FRACTIONS of the whole (weighted by the length of each caption); the player multiplies them by the audio's duration. No timing is invented per word.
export interface Cue { start: number; end: number; text: string; segmentId: string }

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
/** Short enough to read at a glance: about 90 characters in Latin or Tamil script, 40 in Chinese. */
const maxLen = (text: string): number => (CJK.test(text) ? 40 : 90);

function pieces(sentence: string): string[] {
  const limit = maxLen(sentence);
  if (sentence.length <= limit) return [sentence];
  const out: string[] = []; let cur = '';
  for (const part of sentence.split(/(?<=[,;:，；、：])\s*/)) {
    if ((cur + part).length > limit && cur) { out.push(cur.trim()); cur = part; } else cur += (cur && !CJK.test(part) ? ' ' : '') + part;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap((o) => { if (o.length <= limit * 1.4) return [o]; const words = o.split(/(\s+)/); const r: string[] = []; let c = ''; for (const w of words) { if ((c + w).length > limit && c.trim()) { r.push(c.trim()); c = w.trimStart(); } else c += w; } if (c.trim()) r.push(c.trim()); return r; });
}

/** Cues for the texts of a bulletin (one per segment), as fractions 0 to 1 of the whole speech, weighted by caption length. */
export function buildCues(texts: string[], segmentIds: string[]): Cue[] {
  const caps: { text: string; segmentId: string }[] = [];
  texts.forEach((t, i) => { for (const s of t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?。！？])\s*/)) for (const p of pieces(s)) if (p.trim()) caps.push({ text: p.trim(), segmentId: segmentIds[i] ?? `segment-${i + 1}` }); });
  const total = caps.reduce((n, c) => n + Math.max(8, c.text.length), 0) || 1;
  let at = 0;
  return caps.map((c) => { const w = Math.max(8, c.text.length) / total; const cue = { start: Math.round(at * 10000) / 10000, end: Math.round((at + w) * 10000) / 10000, text: c.text, segmentId: c.segmentId }; at += w; return cue; });
}

const stamp = (s: number): string => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3_600_000); const m = Math.floor((ms % 3_600_000) / 60_000); const sec = Math.floor((ms % 60_000) / 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
/** WebVTT for a known total length in seconds (an estimate until the audio's own length is known). */
export function toVtt(cues: Cue[], totalSeconds: number): string {
  return `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.start * totalSeconds)} --> ${stamp(c.end * totalSeconds)}\n${c.text}\n`).join('\n')}`;
}
