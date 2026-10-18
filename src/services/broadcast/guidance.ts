// What the public should do (AEG-NEWS-007, AEG-GUIDE-001): the "what to do" part of an emergency bulletin and its warning card. Every line is a QUOTATION of an official page of Singapore, Malaysia or Brunei,
// from content/guidance/hazard-guidance.json (read 2026-10-17) or from the released Assist cards (Malaysian flood and haze, Singapore haze). Nothing is written by a model; where no official guidance was
// found the bulletin says so. English lines taken from official Malay text are our translation and are marked for the human reviewer.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { decideRelease, readReleaseRecord } from '../../assist/release.js';
import { loadAssistContent } from '../../assist/content.js';
import { coverageOf } from '../../domains/coverage.js';
import { releasedPsiAdvice } from './advice.js';

const Source = z.object({ title: z.string(), url: z.string().url(), sourceUpdated: z.string().nullable(), licence: z.string() }).strict();
const Line = z.object({ text: z.string().min(3), language: z.enum(['en', 'ms']), en: z.string().optional() }).strict();
const Entry = z.discriminatedUnion('status', [
  z.object({ status: z.literal('SOURCED'), agency: z.string(), agencyName: z.string(), sources: z.array(Source).min(1), lines: z.array(Line).min(1) }).strict(),
  z.object({ status: z.literal('UNSOURCED'), reason: z.string() }).strict(),
]);
const Schema = z.object({
  version: z.string(), checkedAt: z.string(), note: z.string(),
  emergencyNumbers: z.record(z.string(), z.object({ text: z.string(), numbers: z.array(z.string()), source: z.object({ name: z.string(), title: z.string(), url: z.string().url() }).strict() }).strict()),
  hazards: z.record(z.string(), z.record(z.string(), Entry)),
}).strict();
export type GuidanceFile = z.infer<typeof Schema>;
const file = fileURLToPath(new URL('../../../content/guidance/hazard-guidance.json', import.meta.url));
export const loadGuidance = (path = file): GuidanceFile => Schema.parse(JSON.parse(readFileSync(path, 'utf8')));

export const COUNTRY_NAME: Record<string, string> = { SGP: 'Singapore', MYS: 'Malaysia', BRN: 'Brunei', VNM: 'Vietnam', KHM: 'Cambodia', LAO: 'Laos', THA: 'Thailand', MMR: 'Myanmar', PHL: 'the Philippines', IDN: 'Indonesia', TLS: 'Timor-Leste' };
const ISO3: Record<string, string> = { SG: 'SGP', MY: 'MYS', BN: 'BRN' };
const MY_999 = { text: 'In Malaysia, call 999 for emergency help.', numbers: ['999'], source: 'Angkatan Pertahanan Awam Malaysia (Civil Defence), 999 emergency services' };

export interface CountryGuidance { iso3: string; country: string; status: 'SOURCED' | 'UNSOURCED'; agency: string | null; lines: string[]; sources: string[]; translatedFromMalay: boolean; reason: string | null }
export interface Guidance { text: string; countries: CountryGuidance[]; numbers: string[]; names: string[]; sourceLines: string[]; remarks: string[] }

const endSentence = (s: string): string => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** Assist-card guidance that was released by the owner's record: Malaysian flood (JPS), Malaysian and Singapore haze (MOH, NEA). Empty when not released. */
function assistLines(hazard: string, iso3: string, alertLevel: string): { agency: string; names: string[]; lines: string[]; sources: string[] } | null {
  try {
    const content = loadAssistContent({ draftMedical: false, allowFixture: false });
    if (!decideRelease(readReleaseRecord(), content.hash).released) return null;
    if (hazard === 'FLOOD' && iso3 === 'MYS') {
      const card = content.cards.find((c) => c.card.id === 'FLOOD-KL-SELANGOR-EN-01B')?.card; if (!card) return null;
      const lines = card.lines.filter((l) => l.kind !== 'contact').map((l) => l.text).slice(0, 5);
      return { agency: 'the Department of Irrigation and Drainage (JPS)', names: ['JPS', 'Department of Irrigation and Drainage'], lines, sources: [`${card.title} (released Assist card FLOOD-KL-SELANGOR-EN-01B, sources JPS and MetMalaysia)`] };
    }
    if (hazard === 'WILDFIRE' && iso3 === 'MYS') {
      const card = content.cards.find((c) => c.card.id === 'HAZE-MY-EN-01')?.card; if (!card) return null;
      return { agency: 'the Ministry of Health Malaysia', names: ['Ministry of Health'], lines: card.lines.filter((l) => l.kind !== 'contact' && !/^[A-Z ]+$/.test(l.text)).map((l) => l.text), sources: [`${card.title} (released Assist card HAZE-MY-EN-01)`] };
    }
    if (hazard === 'WILDFIRE' && iso3 === 'SGP') {
      const band = alertLevel === 'RED' ? 'Very Unhealthy' : alertLevel === 'ORANGE' ? 'Unhealthy' : 'Moderate';
      const advice = releasedPsiAdvice(band);
      if (advice.length === 0) return null;
      return { agency: 'NEA', names: ['NEA'], lines: advice.map((a) => `${a.group.charAt(0).toUpperCase()}${a.group.slice(1)}: ${a.advice}`), sources: ['NEA haze advice for the PSI band (released Assist card HAZE-SG-EN-01)'] };
    }
  } catch { /* not released or unreadable: no guidance rather than a guess */ }
  return null;
}

/** The 15-second version of the guidance: the FIRST official line of each sourced country (a whole quoted line, never cut), at most about 24 words; where nothing is sourced it says so and points to the local authority. */
export function briefGuidance(g: Guidance, hazardType = ''): string {
  const sourced = g.countries.filter((c) => c.status === 'SOURCED' && c.lines.length > 0);
  if (sourced.length === 0) return 'No official guidance on file. Follow your local authority.';
  const words = (s: string): number => s.split(/\s+/).length;
  const one = (c: CountryGuidance, lines = 1): string => `In ${c.country}: ${c.lines.slice(0, lines).map(endSentence).join(' ')}`;
  // Haze advice is group-specific (healthy people, then the elderly, pregnant women and children), so the brief alert reads the first TWO official lines when they fit about 36 words.
  if (hazardType.toUpperCase() === 'WILDFIRE') { const two = one(sourced[0]!, 2); if (words(two) <= 36) return two; }
  const all = sourced.map((c) => one(c)).join(' ');
  return words(all) <= 24 ? all : one(sourced[0]!);
}

/** The guidance for an incident: the country it is in, or the three countries when it is elsewhere in ASEAN (so a quake in Indonesia still tells people in Singapore and Malaysia what to do if they feel it). */
/** `audience` (an ISO3 code such as VNM) says WHO the alert is for. Without it the audience is the country the event is in (Singapore, Malaysia, Brunei) or, for an event elsewhere, the three pilot countries. A country outside the pilot has no official guidance on file, so its alert says so. */
export function resolveGuidance(p: { hazardType: string; alertLevel: string; lat: number | null; lon: number | null; audience?: string }, file: GuidanceFile = loadGuidance()): Guidance {
  const hazard = p.hazardType.toUpperCase();
  const here = p.lat !== null && p.lon !== null ? coverageOf(p.lat, p.lon) : null;
  const audience = p.audience && COUNTRY_NAME[p.audience] ? p.audience : null;
  const isos = audience ? [audience] : here ? [ISO3[here]!] : ['SGP', 'MYS', 'BRN'];
  const countries: CountryGuidance[] = []; const parts: string[] = []; const numbers = new Set<string>(); const names = new Set<string>(); const sourceLines: string[] = []; const remarks: string[] = [];
  for (const iso3 of isos) {
    const country = COUNTRY_NAME[iso3]!;
    const fromAssist = assistLines(hazard, iso3, p.alertLevel);
    const entry = file.hazards[hazard]?.[iso3];
    if (fromAssist && fromAssist.lines.length > 0) {
      countries.push({ iso3, country, status: 'SOURCED', agency: fromAssist.agency, lines: fromAssist.lines, sources: fromAssist.sources, translatedFromMalay: false, reason: null });
      parts.push(`In ${country}, ${fromAssist.agency} advises: ${fromAssist.lines.map(endSentence).join(' ')}`);
      fromAssist.names.forEach((n) => names.add(n)); fromAssist.sources.forEach((s) => sourceLines.push(`${country}: ${s}`));
    } else if (entry?.status === 'SOURCED') {
      const fromMalay = entry.lines.some((l) => l.language === 'ms');
      const lines = entry.lines.map((l) => (l.language === 'ms' ? l.en ?? l.text : l.text));
      countries.push({ iso3, country, status: 'SOURCED', agency: entry.agencyName, lines, sources: entry.sources.map((s) => `${s.title} (${s.url})`), translatedFromMalay: fromMalay, reason: null });
      parts.push(`In ${country}, ${entry.agency === 'PUB' ? 'PUB' : entry.agency} advises: ${lines.map(endSentence).join(' ')}`);
      names.add(entry.agency); names.add(entry.agencyName);
      entry.sources.forEach((s) => sourceLines.push(`${country}: ${s.title}, ${s.url}, source updated ${s.sourceUpdated ?? 'date not shown'}, licence ${s.licence}`));
      if (fromMalay) remarks.push(`${country}: the English lines are AEGIS's translation of the official Malay text; a reader of Malay should compare them with the original lines in hazard-guidance.json.`);
    } else {
      countries.push({ iso3, country, status: 'UNSOURCED', agency: null, lines: [], sources: [], translatedFromMalay: false, reason: entry?.status === 'UNSOURCED' ? entry.reason : 'No official public guidance on file for this hazard.' });
    }
  }
  const sourcedSomewhere = countries.some((c) => c.status === 'SOURCED');
  const contacts: string[] = [];
  for (const iso3 of isos) {
    const c = iso3 === 'MYS' ? MY_999 : file.emergencyNumbers[iso3];
    if (!c) continue;
    contacts.push(c.text); c.numbers.forEach((n) => numbers.add(n));
    sourceLines.push(`${COUNTRY_NAME[iso3]} emergency numbers: ${'source' in c && typeof c.source === 'object' ? `${c.source.name}, ${c.source.url}` : (c as typeof MY_999).source}`);
  }
  const unsourced = countries.filter((c) => c.status === 'UNSOURCED').map((c) => c.country);
  const gap = !sourcedSomewhere ? 'AEGIS has no official public guidance on file for this hazard. Follow the instructions of your local authority.'
    : unsourced.length ? `For ${unsourced.join(' and ')}, AEGIS has no official guidance on file for this hazard: follow the instructions of your local authority.` : '';
  const text = [...parts, gap, ...contacts].filter(Boolean).join(' ');
  if (unsourced.length) remarks.push(`No official guidance found for: ${unsourced.join(', ')} (${countries.filter((c) => c.status === 'UNSOURCED').map((c) => c.reason).join(' ')})`);
  return { text, countries, numbers: [...numbers], names: [...names], sourceLines, remarks };
}
