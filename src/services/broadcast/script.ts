// Template script for one bulletin (AEG-NEWS-004). Every sentence is built from the fact sheet; nothing is invented. A model may later reword a
// segment, but validateScript() must still pass on the reworded text or the template text is used. Plain English, one idea per sentence.
import type { BroadcastSchedule } from './schedule.js';
import type { AdviceLine } from './advice.js';
import type { FactCountry, FactIncident, FactMetMy, FactPsi, FactSheet } from './factSheet.js';
import { METMY_SOURCE_ID } from '../../sources/metMy.js';
import { PSI_BANDS, PSI_SOURCE_ID } from '../../sources/psi.js';

export interface Segment {
  id: string;
  title: string;
  text: string;
  /** Where the map camera goes while this segment plays. A country centre is a camera focus, not an incident location. */
  focus: { lat: number; lon: number; label: string; kind: 'country' | 'incident' } | null;
  evidenceIds: string[];
  sourceIds: string[];
  /** The lower third for THIS segment: the sources it used (or, for a "nothing recorded" line, the feeds that were checked) and the capture time. */
  lowerThird: string;
  /** Estimated start and length in seconds, from the word count at 142 words a minute plus 0.7 s of rest (the Recast kit's measured rate). An estimate until audio exists, then replaced by the real duration. */
  startSec: number;
  durationSec: number;
}
export interface Bulletin {
  bulletinId: string;
  slotId: string;
  language: 'en';
  captureAt: string;
  airAt: string;
  generatedAt: string;
  scheduleVersion: string;
  factSheetHash: string;
  segments: Segment[];
  lowerThird: string;
  /** Sum of the segment estimates plus the end credits. */
  estimatedSeconds: number;
  timingBasis: string;
  credits: { lines: string[] };
  remarks: string[];
  /** Emergency bulletins only: the one incident they are made from (for the warning card). */
  incident?: { hazardType: string; alertLevel: string; title: string; eventTime: string | null; sourceName: string };
  /** A follow-up report only: the id of the alert it follows. */
  followUpOf?: string;
}

const CENTRES: Record<string, { lat: number; lon: number }> = {
  SGP: { lat: 1.3521, lon: 103.8198 }, MYS: { lat: 4.2105, lon: 101.9758 }, BRN: { lat: 4.5353, lon: 114.7277 },
};
const HAZARD_WORD: Record<string, string> = { EARTHQUAKE: 'earthquake', STORM: 'tropical cyclone', FLOOD: 'flood', VOLCANO: 'volcano', WILDFIRE: 'wildfire' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const WORDS_PER_MINUTE = 142;
const REST_SECONDS = 0.7;
export const CREDITS_SECONDS = 8;
export const spokenSeconds = (text: string): number => Math.round(((text.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE) * 60 + REST_SECONDS) * 10) / 10;
const sourceNamesOf = (schedule: BroadcastSchedule, ids: string[]): string => ids.map((id) => schedule.narratedSources.find((x) => x.sourceId === id)?.name ?? id).join(', ');

export const local = (iso: string, offsetHours: number): Date => new Date(Date.parse(iso) + offsetHours * 3_600_000);
export const hhmm = (d: Date): string => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
const dayText = (d: Date): string => `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

/** USGS titles read "M 4.8 - 12 km NE of X, Malaysia"; GDACS titles end with "(GDACS TC 123)". Speak the facts, drop the machine tags. */
function spoken(title: string): string {
  const quake = /^M\s*([0-9.]+)\s*-\s*(.+)$/.exec(title);
  if (quake) return `magnitude ${quake[1]}, ${quake[2]}`;
  return title.replace(/\s*\(GDACS [A-Z]{2} \d+\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

const joinList = (items: string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const BAND_RANGE: Record<string, string> = { Good: '0 to 50', Moderate: '51 to 100', Unhealthy: '101 to 200', 'Very Unhealthy': '201 to 300', Hazardous: 'above 300' };

/** NEA's 24-hour PSI by region, in plain words, using NEA's own band names and ranges. No advice is added here: guidance is released separately. */
export function psiText(psi: FactPsi, offset: number): string {
  const at = hhmm(local(psi.observedAt, offset));
  const name = (r: { region: string }): string => (r.region === 'central' ? 'central region' : r.region);
  const high = psi.regions[0]!; const low = psi.regions[psi.regions.length - 1]!;
  const values = psi.regions.length >= 3 ? `ranged from ${low.psi} in the ${name(low)} to ${high.psi} in the ${name(high)}` : `was ${joinList(psi.regions.map((r) => `${r.psi} in the ${name(r)}`))}`;
  const order = [...PSI_BANDS].reverse().map((b) => b.band).filter((b) => psi.regions.some((r) => r.band === b));
  const allSame = order.length === 1;
  const groups = order.map((band) => (allSame ? `All ${psi.regions.length} regions are in the ${band} band, ${BAND_RANGE[band]}` : `${joinList(psi.regions.filter((r) => r.band === band).map((r) => r.region))} ${psi.regions.filter((r) => r.band === band).length === 1 ? 'is' : 'are'} in the ${band} band, ${BAND_RANGE[band]}`));
  return `NEA's 24-hour PSI, the air quality index, at ${at} local time ${values}. ${groups.map((g) => g[0]!.toUpperCase() + g.slice(1)).join('. ')}.`;
}

/** MetMalaysia warnings, key district forecasts and the haze note, in plain words. Empty when no MetMalaysia data was available at capture. */
export function metMyText(m: FactMetMy, offset: number): string {
  const parts: string[] = [];
  if (m.warningsKnown) {
    parts.push(m.warnings.length === 0
      ? 'MetMalaysia has no active weather warning.'
      : `MetMalaysia has ${m.warnings.length === 1 ? 'one active weather warning' : `${m.warnings.length} active weather warnings`}: ${m.warnings.map((w) => `${w.title}, valid until ${hhmm(local(w.validTo, offset)) === '00:00' ? 'midnight' : hhmm(local(w.validTo, offset))}`).join('; ')}.`);
  }
  if (m.forecastLabel && m.key.length > 0) {
    parts.push(`MetMalaysia's forecast for ${m.forecastLabel}. ${m.key.slice(0, 2).map((k) => `For ${k.location}, ${k.text}${k.minTemp !== null && k.maxTemp !== null ? `, ${k.minTemp} to ${k.maxTemp} degrees` : ''}`).join('. ')}.${m.key.length > 2 ? ' Forecasts for other cities are on the MetMalaysia site.' : ''}`);
  }
  if (m.forecastLabel && m.hazeCount > 0) {
    parts.push(`The forecast for ${m.forecastLabel} includes haze in ${m.hazeCount === 1 ? 'one district' : `${m.hazeCount} districts`}, ${m.hazeCount > Math.min(3, m.hazeLocations.length) ? 'including ' : ''}${joinList(m.hazeLocations.slice(0, 3))}.`);
  }
  return parts.join(' ');
}

const SHORT_SOURCE: Record<string, string> = { 'SRC.USGS.LIVE': 'USGS', 'SRC.GDACS.LIVE': 'GDACS', 'SRC.NEA.PSI.LIVE': 'NEA' };

export function incidentSentence(i: FactIncident, offset: number, brief = false): string {
  const word = HAZARD_WORD[i.hazardType.toUpperCase()] ?? i.hazardType.toLowerCase();
  const says = spoken(i.title);
  // Do not say "A tropical cyclone: Tropical Cyclone X" or "A volcano: Eruption Y": the title already names the kind.
  const lead = says.toLowerCase().startsWith(word) || (word === 'volcano' && /^eruption/i.test(says)) || (word === 'wildfire' && /^haze/i.test(says)) ? '' : `${/^[aeiou]/i.test(word) ? 'An' : 'A'} ${word}: `;
  const src = SHORT_SOURCE[i.sourceId] ?? 'the source';
  const level = i.alertLevel && i.alertLevel !== 'UNRATED' ? ` ${src} rates it ${i.alertLevel.toLowerCase()}.` : '';
  // A quake has an occurrence time; a GDACS event has the time of its latest report, which is not when the event began.
  const when = i.eventTime && !brief ? (i.sourceId === 'SRC.USGS.LIVE' ? ` It occurred at ${hhmm(local(i.eventTime, offset))} local time.` : ` The latest ${src} report is dated ${hhmm(local(i.eventTime, offset))} local time.`) : '';
  return `${lead}${says}.${level}${when}`;
}

const isg = (isSg: boolean, psi: FactPsi | null): boolean => isSg && psi !== null;

const SIGNPOST = ['First, ', 'Now ', 'Finally, '];
function countrySegment(c: FactCountry, offset: number, feedsFresh: boolean, schedule: BroadcastSchedule, captured: string, psi: FactPsi | null, advice: AdviceLine[] = [], metMy: FactMetMy | null = null, position = 0): Segment {
  const isSg = c.iso3 === 'SGP';
  const isMy = c.iso3 === 'MYS' && metMy !== null;
  const used = [...new Set([...c.incidents.map((i) => i.sourceId), ...(isg(isSg, psi) ? [PSI_SOURCE_ID] : []), ...(isMy ? [METMY_SOURCE_ID] : [])])];
  const checked = used.length > 0 ? used : schedule.narratedSources.map((x) => x.sourceId).filter((id) => id === 'SRC.USGS.LIVE' || id === 'SRC.GDACS.LIVE');
  const base = { id: `country-${c.iso3.toLowerCase()}`, title: c.name, evidenceIds: c.incidents.map((i) => i.evidenceId), sourceIds: used, lowerThird: `${used.length > 0 ? 'Source' : 'Feeds checked, nothing recorded'}: ${sourceNamesOf(schedule, checked)} \u00b7 Data captured ${captured} MYT`, startSec: 0, durationSec: 0 };
  const first = c.incidents.find((i) => i.lat !== null && i.lon !== null);
  const centre = CENTRES[c.iso3];
  const focus = first ? { lat: first.lat as number, lon: first.lon as number, label: spoken(first.title), kind: 'incident' as const } : centre ? { ...centre, label: c.name, kind: 'country' as const } : null;
  // The advice lines are NEA's own words, quoted whole; only the connecting label changes ("NEA advises" once, then "For ...").
  const adviceText = isg(isSg, psi) && advice.length > 0 ? ` ${advice.map((a, i) => (i === 0 ? `NEA advises ${a.group}: ${a.advice}` : `For ${a.group}: ${a.advice}`)).join('. ')}.` : '';
  const metText = isMy ? metMyText(metMy as FactMetMy, offset) : '';
  const air0 = isg(isSg, psi) ? `${psiText(psi as FactPsi, offset)}${adviceText} ` : isSg ? 'An air quality (PSI) reading from the National Environment Agency was not available at capture. ' : '';
  const air = isMy && metText ? `${air0}${metText} ` : air0;
  if (c.incidents.length === 0) {
    const caveat = feedsFresh ? '' : ' One of our event feeds had not updated in the hour before capture, so this may be incomplete.';
    const sign = `${SIGNPOST[Math.min(position, SIGNPOST.length - 1)]}${position === 0 ? c.name : c.name}.`;
    if (!air) return { ...base, focus, text: `${sign} Our feeds record nothing for ${c.name} right now.${caveat}` };
    return { ...base, focus, text: `${sign} ${air.trim()}${caveat}` };
  }
  const shown = c.incidents.slice(0, 3);
  const more = c.incidents.length > shown.length ? ` ${c.incidents.length - shown.length} more are on the map.` : '';
  const count = c.incidents.length === 1 ? 'one current event' : `${c.incidents.length} current events`;
  return { ...base, focus, text: `${SIGNPOST[Math.min(position, SIGNPOST.length - 1)]}${c.name}. ${air}Our feeds record ${count}. ${shown.map((i) => incidentSentence(i, offset)).join(' ')}${more}` };
}

export function buildScript(p: { schedule: BroadcastSchedule; facts: FactSheet; greeting: string; nextAirLocal: string; generatedAt: string; bulletinId: string }): Bulletin {
  const { schedule, facts } = p;
  const offset = schedule.timezone.utcOffsetHours;
  const capture = local(facts.captureAt, offset);
  const air = local(facts.airAt, offset);
  const psi = facts.psi;
  const usedSources = schedule.narratedSources.filter((x) => (x.sourceId !== PSI_SOURCE_ID || psi !== null) && (x.sourceId !== METMY_SOURCE_ID || facts.metMy !== null));   // never credit a source that gave nothing
  const names = usedSources.map((x) => x.name);
  const inCovered = facts.countries.reduce((n, c) => n + c.incidents.length, 0);
  const feedsFresh = facts.feeds.filter((f) => f.sourceId === 'SRC.USGS.LIVE' || f.sourceId === 'SRC.GDACS.LIVE').every((f) => f.freshAtCapture);   // only the event feeds; the PSI and MetMalaysia have their own sentences
  const places = facts.countries.map((c) => c.name);
  const placeList = `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
  // The main story, then the rest in one calm breath. Sources are named briefly inside each country part; the full list is on screen (lower third and credits), not in the spoken text.
  const unhealthy = psi !== null && psi.topBand !== 'Good' && psi.topBand !== 'Moderate';
  const topCount = psi ? psi.regions.filter((r) => r.band === psi.topBand).length : 0;
  const story = unhealthy
    ? `The main story: air quality in Singapore is in the ${psi!.topBand} band, in ${topCount === psi!.regions.length ? `all ${topCount} regions` : `${topCount} of ${psi!.regions.length} regions`}.`
    : inCovered > 0 ? `The main story: ${inCovered === 1 ? 'one current event is' : `${inCovered} current events are`} recorded in ${placeList}.`
    : facts.metMy && facts.metMy.warnings.length > 0 ? `The main story: MetMalaysia has ${facts.metMy.warnings.length === 1 ? 'one active weather warning' : `${facts.metMy.warnings.length} active weather warnings`}.`
    : facts.metMy && facts.metMy.hazeCount > 0 ? `The main story: MetMalaysia's forecast includes haze in ${facts.metMy.hazeCount === 1 ? 'one district' : `${facts.metMy.hazeCount} districts`}.` : '';
  const quiet = inCovered === 0 ? ` Our feeds record no earthquake, storm, flood, volcano or wildfire in ${placeList}.` : '';
  const elsewhere = facts.elsewhereCount === 0 ? '' : ` Elsewhere in ASEAN, ${facts.elsewhereCount} other events are on the map.`;
  const feedNote = feedsFresh ? '' : ' One of our feeds had not updated in the last hour, so this briefing may be incomplete.';
  const headline: Segment = {
    id: 'headline', title: 'Headlines', focus: { lat: 3.0, lon: 107.0, label: 'Singapore, Malaysia and Brunei', kind: 'country' }, evidenceIds: [], sourceIds: usedSources.map((x) => x.sourceId), lowerThird: `Source: ${sourceNamesOf(schedule, usedSources.map((x) => x.sourceId))} \u00b7 Data captured ${hhmm(capture)} MYT`, startSec: 0, durationSec: 0,
    text: `${p.greeting}. This is the Aegis ${hhmm(air)} briefing for ${dayText(air)}, with data as of ${hhmm(capture)} local time.${story ? ` ${story}` : ''}${quiet}${elsewhere}${feedNote} Here's the detail.`,
  };
  const closing: Segment = {
    id: 'closing', title: 'Closing', focus: null, evidenceIds: [], sourceIds: [], lowerThird: `Data captured ${hhmm(capture)} MYT \u00b7 Next briefing ${p.nextAirLocal}`, startSec: 0, durationSec: 0,
    text: `That is the picture at ${hhmm(capture)}, and conditions may have changed. Our feeds cover only earthquakes, storms, floods, volcanoes and wildfires, so a quiet feed is not a guarantee of safety. Tap any marker on the map for its source and time. For health and safety advice, follow your local authority. Our next briefing is at ${p.nextAirLocal}. Stay safe.`,
  };
  const major = facts.majorElsewhere;
  const firstMajor = major.find((i) => i.lat !== null && i.lon !== null);
  const majorSegment: Segment[] = major.length === 0 ? [] : [{
    id: 'region-alerts', title: 'Major alerts elsewhere in ASEAN',
    text: `Elsewhere in ASEAN, ${major.length === 1 ? 'one major alert' : `${major.length} major alerts`}. ${major.map((i) => incidentSentence(i, offset, true)).join(' ')}`,
    focus: firstMajor ? { lat: firstMajor.lat as number, lon: firstMajor.lon as number, label: spoken(firstMajor.title), kind: 'incident' } : null,
    evidenceIds: major.map((i) => i.evidenceId), sourceIds: [...new Set(major.map((i) => i.sourceId))],
    lowerThird: `Source: ${sourceNamesOf(schedule, [...new Set(major.map((i) => i.sourceId))])} \u00b7 Data captured ${hhmm(capture)} MYT`, startSec: 0, durationSec: 0,
  }];
  const raw = [headline, ...facts.countries.map((c, n) => countrySegment(c, offset, feedsFresh, schedule, hhmm(capture), psi, facts.advice, facts.metMy, n)), ...majorSegment, closing];
  let at = 0;
  const segments = raw.map((seg) => { const durationSec = spokenSeconds(seg.text); const out = { ...seg, startSec: Math.round(at * 10) / 10, durationSec }; at += durationSec; return out; });
  const estimatedSeconds = Math.round((at + CREDITS_SECONDS) * 10) / 10;
  return {
    bulletinId: p.bulletinId, slotId: facts.slotId, language: 'en', captureAt: facts.captureAt, airAt: facts.airAt, generatedAt: p.generatedAt,
    scheduleVersion: facts.scheduleVersion, factSheetHash: facts.hash, segments, estimatedSeconds,
    timingBasis: `estimated: ${WORDS_PER_MINUTE} words a minute plus ${REST_SECONDS} s of rest per segment, plus ${CREDITS_SECONDS} s of end credits; replaced by real audio durations when audio exists`,
    lowerThird: `Data captured ${hhmm(capture)} MYT · Source: ${names.join(', ')}`,
    credits: {
      lines: [
        ...usedSources.map((x) => x.credit),
        `${schedule.disclosure.presenter}. ${schedule.disclosure.voice}.`,
        `Data captured at ${hhmm(capture)} Malaysia and Singapore time. Next briefing at ${p.nextAirLocal}.`,
        schedule.disclosure.pilot,
      ],
    },
    remarks: [
      'Narration uses only the sources listed. Google air quality and weather are shown on screen only and are never spoken or used to write this script.',
      'No people-affected or casualty figure is stated: the live feeds give none.',
    ],
  };
}

// ---------- the check that rejects anything the fact sheet does not support ----------
const NUMBER = /\d+(?:\.\d+)?/g;
const FORBIDDEN_NAMES = ['Google', 'NADMA', 'MetMalaysia', 'MET Malaysia', 'NEA', 'PUB', 'FIRMS', 'NASA', 'Department of Environment', 'radar', 'sensor'];

/** `extra`: numbers (emergency phone numbers) and agency names (the bodies whose guidance is quoted) that are allowed because the guidance library, not the fact sheet, supplies them. */
export function validateScript(bulletin: Bulletin, facts: FactSheet, schedule: BroadcastSchedule, extra: { numbers?: string[]; names?: string[] } = {}): string[] {
  const problems: string[] = [];
  const offset = schedule.timezone.utcOffsetHours;
  const allowed = new Set<string>(extra.numbers ?? []);
  const addNumbers = (text: string): void => { for (const m of text.matchAll(NUMBER)) allowed.add(m[0]); };
  for (const c of facts.countries) for (const i of c.incidents) { addNumbers(i.title); if (i.eventTime) addNumbers(hhmm(local(i.eventTime, offset))); }
  for (const t of [facts.captureAt, facts.airAt]) { const d = local(t, offset); addNumbers(hhmm(d)); allowed.add(String(d.getUTCDate())); }
  allowed.add(String(facts.countries.reduce((n, c) => n + c.incidents.length, 0)));
  allowed.add(String(facts.elsewhereCount));
  allowed.add(String(facts.majorElsewhere.length));
  for (const i of facts.majorElsewhere) { addNumbers(i.title); if (i.eventTime) addNumbers(hhmm(local(i.eventTime, offset))); }
  if (facts.psi) {
    for (const r of facts.psi.regions) allowed.add(String(r.psi));
    addNumbers(hhmm(local(facts.psi.observedAt, offset)));
    for (const b of PSI_BANDS) { allowed.add(String(b.from)); if (b.to !== null) allowed.add(String(b.to)); }
    allowed.add('5');    // "of 5 regions"
    allowed.add('24');   // the fixed wording "24-hour PSI"
    allowed.add(String(facts.psi.regions.filter((r) => r.band === facts.psi!.topBand).length));
  }
  for (const c of facts.countries) { allowed.add(String(c.incidents.length)); allowed.add(String(Math.max(0, c.incidents.length - 3))); }
  for (const s of schedule.slots) addNumbers(s.airLocal);
  if (facts.metMy) {
    allowed.add(String(facts.metMy.warnings.length)); allowed.add(String(facts.metMy.hazeCount));
    for (const w of facts.metMy.warnings) addNumbers(hhmm(local(w.validTo, offset)));
    for (const k of facts.metMy.key) { if (k.minTemp !== null) allowed.add(String(k.minTemp)); if (k.maxTemp !== null) allowed.add(String(k.maxTemp)); }
  }
  const sourceNames = schedule.narratedSources.filter((x) => bulletin.segments.some((seg) => seg.sourceIds.includes(x.sourceId))).map((x) => x.name).join(' ');   // only sources this bulletin used
  for (const seg of bulletin.segments) {
    for (const m of seg.lowerThird.matchAll(NUMBER)) if (!allowed.has(m[0])) problems.push(`segment ${seg.id}: lower third number ${m[0]} is not in the fact sheet`);
    for (const m of seg.text.matchAll(NUMBER)) if (!allowed.has(m[0])) problems.push(`segment ${seg.id}: number ${m[0]} is not in the fact sheet`);
    for (const name of FORBIDDEN_NAMES) if (new RegExp(`\\b${name}\\b`).test(seg.text) && !sourceNames.includes(name) && !(extra.names ?? []).includes(name)) problems.push(`segment ${seg.id}: names "${name}", which is not a narratable source`);
    for (const id of seg.evidenceIds) if (!facts.countries.some((c) => c.incidents.some((i) => i.evidenceId === id)) && !facts.majorElsewhere.some((i) => i.evidenceId === id)) problems.push(`segment ${seg.id}: cites evidence ${id} that is not in the fact sheet`);
  }
  return problems;
}
