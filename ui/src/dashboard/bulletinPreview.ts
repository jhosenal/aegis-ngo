import { ApiError, apiRequest } from '../api/client.js';
import type { CameraView, SubtitleLanguage } from './newsContent.js';

export interface PreviewSegment { id: string; text: string; lowerThird: string; durationSec: number; startSec?: number }
export interface PreviewBulletin { bulletinId: string; slotId: string; captureAt: string; airAt: string; estimatedSeconds: number; segments: PreviewSegment[]; credits: { lines: string[] }; reviewLabel?: string }
export interface PreviewCue { start: number; end: number; text: Record<SubtitleLanguage, string>; lowerThird: string }

const sentences = (text: string): string[] => text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];

/** Subtitle cues for a bulletin: each sentence gets a share of its segment's estimated length by word count. English only: other languages stay locked until reviewed translations exist. */
export function bulletinCues(b: PreviewBulletin): PreviewCue[] {
  let at = 0;
  return b.segments.flatMap((seg) => {
    const parts = sentences(seg.text); const words = parts.map((p) => p.split(/\s+/).length); const total = words.reduce((a, c) => a + c, 0) || 1;
    const start = seg.startSec ?? at; at = start + seg.durationSec; let cursor = start;
    return parts.map((p, i) => { const d = seg.durationSec * words[i]! / total; const cue = { start: cursor, end: cursor + d, text: { en: p, zh: p, ms: p, ta: p }, lowerThird: seg.lowerThird }; cursor += d; return cue; });
  });
}

/** Reads one bulletin (or the unsaved DRAFT) through the administrator endpoint, using the session of this browser tab. */
export async function loadPreviewBulletin(id: string): Promise<PreviewBulletin> {
  let token: string | null = null;
  try { token = sessionStorage.getItem('aegis.session'); } catch { token = null; }
  if (!token) throw new Error('Sign in as an administrator in this browser tab to preview.');
  try {
    const r = await apiRequest<{ bulletin: PreviewBulletin; review: { decision: string } | null }>(`/api/admin/screening/bulletin/${encodeURIComponent(id)}`, { token });
    return { ...r.bulletin, ...(r.review ? { reviewLabel: r.review.decision } : {}) };
  } catch (e) {
    throw new Error(e instanceof ApiError ? `${e.code}: ${e.message}` : 'The preview could not be loaded.');
  }
}

const COUNTRY_SEGMENTS = new Set(['country-sgp', 'country-mys', 'country-brn']);

/** One mention for the whole country block of a bulletin: from the start of the first country segment to the end of the last. The map goes to the Malaysia frame once (it holds Singapore and Brunei) and back once. */
export function bulletinMentions(b: PreviewBulletin): { view: CameraView; at: number; end: number }[] {
  let at = 0; let first: number | null = null; let last = 0;
  for (const seg of b.segments) { const start = seg.startSec ?? at; at = start + seg.durationSec; if (COUNTRY_SEGMENTS.has(seg.id)) { first ??= start; last = start + seg.durationSec; } }
  return first === null ? [] : [{ view: 'mys', at: first, end: last }];
}
