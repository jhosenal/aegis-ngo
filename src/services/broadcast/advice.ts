// Released health advice for the bulletin (AEG-ADVICE-001). When the Assist guidance cards are RELEASED (records/releases/assist-release.json APPROVED for the exact
// content hash), the Singapore haze segment may quote NEA's own advice for the PSI band that is current, word for word, naming its source. Until then this returns
// nothing and the bulletin says only "follow your local authority". Nothing here is written by us or by a model: every line is a saved quotation from NEA's pages.
import { decideRelease, readReleaseRecord } from '../../assist/release.js';
import { loadAssistContent } from '../../assist/content.js';
import type { PsiBand } from '../../sources/psi.js';

export interface AdviceLine { band: PsiBand; group: string; advice: string; sourceId: string }

const GROUPS: Record<string, string> = { 'SRC-SG-PSI-HEALTHY': 'healthy persons', 'SRC-SG-PSI-VULNERABLE': 'the elderly, pregnant women and children', 'SRC-SG-PSI-CHRONIC': 'people with chronic lung or heart disease' };

/** The card line reads "PSI 201-300 (Very Unhealthy), healthy persons: Avoid prolonged or strenuous outdoor physical exertion". Returns the band and the advice after the colon. */
export function parsePsiAdviceLine(text: string): { band: string; advice: string } | null {
  const m = /^PSI\s+\S+\s+\(([A-Za-z ]+)\),\s*[^:]+:\s*(.+)$/.exec(text.trim());
  return m ? { band: m[1]!.trim(), advice: m[2]!.trim().replace(/\.$/, '') } : null;
}

/** Advice for the given band from the released Singapore haze card, or [] when guidance is not released (or the content cannot be read). */
export function releasedPsiAdvice(band: PsiBand, deps: { content?: ReturnType<typeof loadAssistContent>; record?: ReturnType<typeof readReleaseRecord> } = {}): AdviceLine[] {
  try {
    const content = deps.content ?? loadAssistContent({ draftMedical: false, allowFixture: false });
    const decision = decideRelease(deps.record === undefined ? readReleaseRecord() : deps.record, content.hash);
    if (!decision.released) return [];
    const card = content.cards.find((c) => c.card.id === 'HAZE-SG-EN-01')?.card;
    if (!card) return [];
    const out: AdviceLine[] = [];
    for (const line of card.lines) {
      const group = GROUPS[line.sourceId];
      const parsed = group ? parsePsiAdviceLine(line.text) : null;
      if (group && parsed && parsed.band === band) out.push({ band, group, advice: parsed.advice, sourceId: line.sourceId });
    }
    // NEA's 4 September 2026 release (saved as R0230) tells the public to drink plenty of water during an Unhealthy or worse haze; it is quoted only for those bands.
    if (band === 'Unhealthy' || band === 'Very Unhealthy' || band === 'Hazardous') {
      const water = card.lines.find((l) => l.sourceId === 'SRC-SG-HYDRATION');
      if (water) out.push({ band, group: 'the public', advice: water.text.replace(/\.$/, ''), sourceId: water.sourceId });
    }
    return out;
  } catch { return []; }
}
