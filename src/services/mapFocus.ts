// "Show me the worst flood" (AEG-CHAT-002): find the incident card the person means, from the signed-in workspace's current incidents, and say HOW it was ranked.
// Pure ranking over cards; code owns the choice, the model only words it. Unknown stays unknown: a missing size or alert is never guessed.
import { getCardRevision, listCards } from '../data/repos/cards.js';
import { listVisibleEvidence } from '../data/repos/evidence.js';
import { ASEAN_COUNTRIES } from '../domains/asean.js';
import { toEvidenceViews } from '../sources/evidenceView.js';
import type { CardRevision, Principal } from '../types/domain.js';
import { withCountry } from './incidentCountry.js';
import { withIncidentPeriod } from './incidentPeriod.js';

type Db = import('better-sqlite3').Database;
export const FOCUS_HAZARDS = ['FLOOD', 'EARTHQUAKE', 'STORM', 'WILDFIRE', 'VOLCANO'] as const;
export interface FocusQuery { hazard?: string; country?: string; rank?: string }
export interface FocusResult {
  found: boolean; reason: string | null; matching: number;
  cardId?: string; revision?: number; title?: string; hazard?: string; alertLevel?: string | null; country?: string | null; eventTime?: string | null; lat?: number | null; lng?: number | null; why?: string;
}

const HAZARD_WORDS: Record<string, string> = { flood: 'FLOOD', floods: 'FLOOD', flooding: 'FLOOD', earthquake: 'EARTHQUAKE', quake: 'EARTHQUAKE', storm: 'STORM', cyclone: 'STORM', typhoon: 'STORM', hurricane: 'STORM', wildfire: 'WILDFIRE', fire: 'WILDFIRE', 'forest fire': 'WILDFIRE', volcano: 'VOLCANO', eruption: 'VOLCANO' };
const ISO2: Record<string, string> = { SG: 'SGP', MY: 'MYS', BN: 'BRN', ID: 'IDN', PH: 'PHL', TH: 'THA', VN: 'VNM', KH: 'KHM', LA: 'LAO', MM: 'MMR', TL: 'TLS' };
// GDACS rates GREEN, ORANGE or RED; USGS PAGER adds YELLOW; a USGS quake without a PAGER alert is UNRATED and counts like GREEN, so size then decides.
const ALERT_RANK: Record<string, number> = { RED: 4, ORANGE: 3, YELLOW: 2, GREEN: 1, UNRATED: 1 };

export function normalizeHazard(word: string | undefined): string | null {
  if (!word) return null;
  const w = word.trim().toLowerCase();
  const direct = HAZARD_WORDS[w];
  if (direct) return direct;
  return (FOCUS_HAZARDS as readonly string[]).includes(w.toUpperCase()) ? w.toUpperCase() : null;
}
export function normalizeCountry(word: string | undefined): string | null {
  if (!word) return null;
  const w = word.trim();
  const iso3 = ISO2[w.toUpperCase()] ?? w.toUpperCase();
  const hit = ASEAN_COUNTRIES.find((c) => c.iso3 === iso3 || c.name.toLowerCase() === w.toLowerCase() || (c.name === 'Viet Nam' && /^viet\s?nam$/i.test(w)));
  return hit ? hit.name : null;
}

const fieldOf = (card: CardRevision, key: string): unknown => card.body.fields.find((f) => f.key === key)?.value ?? null;
function point(card: CardRevision): { lat: number; lng: number } | null {
  const raw = fieldOf(card, 'location');
  const m = typeof raw === 'string' ? /^(-?\d+),(-?\d+)$/.exec(raw) : null;
  if (!m) return null;
  const lat = Number(m[1]) / 1e6; const lng = Number(m[2]) / 1e6;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
const magnitudeOf = (card: CardRevision): number | null => { const m = /^M\s?(\d+(?:\.\d+)?)/.exec(card.title); return m ? Number(m[1]) : null; };

/** Ordering: alert level, then earthquake magnitude, then the affected-people estimate, then how recent. */
export function betterThan(a: CardRevision, b: CardRevision, rank: 'worst' | 'latest'): boolean {
  const time = (c: CardRevision): number => Date.parse(String(fieldOf(c, 'eventTime') ?? '')) || 0;
  if (rank === 'latest') return time(a) > time(b);
  const alert = (c: CardRevision): number => ALERT_RANK[String(fieldOf(c, 'alertLevel')).toUpperCase()] ?? 0;
  if (alert(a) !== alert(b)) return alert(a) > alert(b);
  const mag = (c: CardRevision): number => magnitudeOf(c) ?? -1;
  if (mag(a) !== mag(b)) return mag(a) > mag(b);
  const people = (c: CardRevision): number => { const v = fieldOf(c, 'affectedPeopleEstimate'); return typeof v === 'number' ? v : -1; };
  if (people(a) !== people(b)) return people(a) > people(b);
  return time(a) > time(b);
}

export function findIncident(db: Db, principal: Principal, nowIso: string, query: FocusQuery): FocusResult {
  const hazardWanted = query.hazard ? normalizeHazard(query.hazard) : null;
  if (query.hazard && !hazardWanted) return { found: false, matching: 0, reason: 'AEGIS does not show that hazard as incidents on the map (it shows floods, earthquakes, storms, wildfires and volcanoes).' };
  const countryWanted = query.country ? normalizeCountry(query.country) : null;
  if (query.country && !countryWanted) return { found: false, matching: 0, reason: 'That country is not in the ASEAN list AEGIS covers.' };
  const rank: 'worst' | 'latest' = query.rank === 'latest' ? 'latest' : 'worst';
  const views = toEvidenceViews(listVisibleEvidence(db, principal.tenantId), null, nowIso);
  let best: CardRevision | null = null; let matching = 0;
  for (const summary of listCards(db, principal.tenantId, 'incident')) {
    const raw = getCardRevision(db, principal.tenantId, summary.cardId, summary.revision);
    if (!raw) continue;
    const card = withCountry(withIncidentPeriod(raw, views));
    if (fieldOf(card, 'incidentPeriod') === 'historical') continue;
    if (card.body.synthetic) continue;
    if (hazardWanted && String(fieldOf(card, 'hazardType')).toUpperCase() !== hazardWanted) continue;
    if (countryWanted && fieldOf(card, 'country') !== countryWanted) continue;
    matching += 1;
    if (!best || betterThan(card, best, rank)) best = card;
  }
  if (!best) return { found: false, matching: 0, reason: `Our feeds record no current ${hazardWanted ? hazardWanted.toLowerCase() : 'incident'}${countryWanted ? ` in ${countryWanted}` : ''} right now. That is not a guarantee of safety.` };
  const p = point(best);
  const alert = fieldOf(best, 'alertLevel');
  const country = fieldOf(best, 'country');
  const when = fieldOf(best, 'eventTime');
  return {
    found: true, reason: null, matching, cardId: best.cardId, revision: best.revision, title: best.title, hazard: String(fieldOf(best, 'hazardType')), alertLevel: typeof alert === 'string' ? alert : null,
    country: typeof country === 'string' ? country : null, eventTime: typeof when === 'string' ? when : null, lat: p?.lat ?? null, lng: p?.lng ?? null,
    why: rank === 'latest' ? `newest event time among ${matching} matching current incident${matching === 1 ? '' : 's'}` : `highest alert level, then earthquake size, then affected-people estimate, then newest, among ${matching} matching current incident${matching === 1 ? '' : 's'}${p ? '' : '; its position is not recorded'}`,
  };
}
