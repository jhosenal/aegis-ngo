// The one-minute follow-up to an emergency alert, for Johor (AEG-NEWS-007). Written by code from the same incident and the current captured facts, checked by the same validator, approved by a person
// like every bulletin. It reuses the emergency segment ids (headline, actions, notice) so the warning card, the subtitles, the player and the edit rules work unchanged, and adds one Johor segment.
// What it may say about Johor: MetMalaysia's Johor Bahru forecast (if one is on file), NEA's southern PSI for a haze incident (Singapore's south borders Johor), the monitored Johor locations by NAME only
// (their Google air and weather values never go into a script), and the official guidance lines for Malaysia, quoted whole. Nothing else: no hotspot origin, no PM2.5 one-hour value, no forecast of its own.
import { createHash } from 'node:crypto';
import type { BroadcastSchedule } from './schedule.js';
import type { FactIncident, FactSheet } from './factSheet.js';
import { resolveGuidance } from './guidance.js';
import { EMERGENCY_NOTICE_BRIEF } from './emergency.js';
import { CREDITS_SECONDS, hhmm, incidentSentence, local, spokenSeconds, validateScript, type Bulletin, type Segment } from './script.js';

export const FOLLOWUP_AREAS = ['Johor'] as const;
export type FollowUpArea = typeof FOLLOWUP_AREAS[number];
/** About a minute of English, so Tamil (about 1.4 times longer) stays near 80 seconds. */
export const FOLLOWUP_MAX_WORDS = 150;

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const joinNames = (n: string[]): string => (n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);

export function buildFollowUp(p: { schedule: BroadcastSchedule; parent: Bulletin; incident: FactIncident; facts: FactSheet; area: FollowUpArea; areaPins: string[]; now: string; bulletinId: string; drill?: boolean }): { bulletin: Bulletin; problems: string[] } {
  const { schedule, incident, facts, parent } = p; const offset = schedule.timezone.utcOffsetHours;
  const source = schedule.narratedSources.find((s) => s.sourceId === incident.sourceId);
  const sourceName = source?.name ?? incident.sourceId;
  const issued = hhmm(local(parent.captureAt, offset)); const now = hhmm(local(p.now, offset));
  const lead = incidentSentence(incident, offset).split(/(?<=[.!?])\s+/)[0] ?? '';
  // 1. update
  const south = incident.sourceId === 'SRC.NEA.PSI.LIVE' ? facts.psi?.regions.find((r) => r.region === 'south') : undefined;
  const update = `${p.drill ? 'This is an exercise. ' : ''}Here is the follow-up to the alert issued at ${issued}. ${lead}${south ? ` In the south of Singapore, next to ${p.area}, the 24-hour PSI was ${south.psi}, in the ${south.band} band.` : ''}`;
  // 2. Johor: only what is on file
  const forecast = facts.metMy?.forecastLabel ? facts.metMy.key.find((k) => /johor/i.test(k.location)) : undefined;
  const lines: string[] = [];
  if (forecast) lines.push(`MetMalaysia's forecast for ${facts.metMy!.forecastLabel} in ${forecast.location}: ${forecast.text}${forecast.minTemp !== null && forecast.maxTemp !== null ? `, ${forecast.minTemp} to ${forecast.maxTemp} degrees` : ''}.`);
  lines.push('For weather warnings that apply to Johor, check MetMalaysia.');
  if (p.areaPins.length > 0) lines.push(`${p.areaPins.length} monitored locations in ${p.area} are on the AEGIS map, including ${joinNames(p.areaPins.slice(0, 3))}.`);
  let areaText = `In ${p.area}: ${lines.join(' ')}`;
  const areaNoPins = `In ${p.area}: ${lines.filter((l) => !/monitored locations/.test(l)).join(' ')}`;
  // 3. what to do: the official lines for Malaysia, up to four, each quoted whole
  const guide = resolveGuidance({ hazardType: incident.hazardType, alertLevel: incident.alertLevel, lat: 1.5, lon: 103.7, audience: 'MYS' });
  const my = guide.countries.find((c) => c.status === 'SOURCED' && c.lines.length > 0);
  const endS = (s: string): string => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
  let take = my ? Math.min(4, my.lines.length) : 0;
  const actions = (n: number): string => (my ? `In Malaysia, ${my.agency} advises: ${my.lines.slice(0, n).map(endS).join(' ')}` : 'No official guidance on file. Follow your local authority.');
  // Budget: official advice matters most. Trim in this order: down to 3 guidance lines, then the map-pins sentence, then (only if still too long) further guidance lines.
  const total = (): number => words([update, areaText, EMERGENCY_NOTICE_BRIEF, 'We will update this when new readings are published.', actions(take)].join(' '));
  const keep = my ? Math.min(3, my.lines.length) : 0;
  while (total() > FOLLOWUP_MAX_WORDS && take > keep) take -= 1;
  if (total() > FOLLOWUP_MAX_WORDS) areaText = areaNoPins;
  while (total() > FOLLOWUP_MAX_WORDS && take > 1) take -= 1;
  const segText: [string, string, string, string][] = [['emergency-headline', 'Follow-up', update, 'update'], ['followup-johor', `${p.area} now`, areaText, 'area'], ['emergency-actions', 'What to do', actions(take), 'actions'], ['emergency-notice', 'Notice', `We will update this when new readings are published. ${EMERGENCY_NOTICE_BRIEF}`, 'notice']];
  const focus = incident.lat !== null && incident.lon !== null ? { lat: incident.lat, lon: incident.lon, label: incident.title, kind: 'incident' as const } : null;
  const raw: Segment[] = segText.map(([id, title, text, kind]) => ({ id, title, text, focus: kind === 'update' ? focus : null, evidenceIds: kind === 'update' ? [incident.evidenceId] : [], sourceIds: kind === 'update' ? [incident.sourceId] : [],
    lowerThird: kind === 'update' ? `Source: ${sourceName} · Follow-up ${now} MYT` : kind === 'area' ? `Source: MetMalaysia forecast · ${p.area}` : kind === 'actions' ? `Official guidance: ${my ? `Malaysia (${my.agency})` : 'none on file'}` : 'Informational summary, not an official warning', startSec: 0, durationSec: 0 }));
  let at = 0;
  const segments = raw.map((seg) => { const durationSec = spokenSeconds(seg.text); const out = { ...seg, startSec: Math.round(at * 10) / 10, durationSec }; at += durationSec; return out; });
  const bulletin: Bulletin = {
    bulletinId: p.bulletinId, slotId: p.drill ? 'drill' : 'emergency', language: 'en', captureAt: p.now, airAt: p.now, generatedAt: p.now, scheduleVersion: schedule.version,
    factSheetHash: createHash('sha256').update(JSON.stringify({ incident, area: p.area, hash: facts.hash })).digest('hex'), segments, estimatedSeconds: Math.round((at + CREDITS_SECONDS) * 10) / 10,
    timingBasis: 'estimated from the word count; replaced by real audio durations when audio exists',
    lowerThird: `Follow-up ${now} MYT · Source: ${sourceName}`,
    credits: { lines: [...(source ? [source.credit] : []), ...(forecast ? ['MetMalaysia forecast via api.data.gov.my'] : []), ...guide.sourceLines.map((l) => `Guidance: ${l}`), `${schedule.disclosure.voice}.`, schedule.disclosure.pilot] },
    incident: { hazardType: incident.hazardType, alertLevel: incident.alertLevel, title: incident.title, eventTime: incident.eventTime, sourceName },
    remarks: [`Follow-up to ${parent.bulletinId} for ${p.area}. Made by code from the incident, the captured MetMalaysia and NEA facts and the quoted official guidance; it is an AEGIS summary, not an official warning.`, 'The monitored locations are named only; their Google air and weather values are never part of a script.', 'No hotspot origin and no PM2.5 one-hour value: not on file.', ...guide.remarks],
    followUpOf: parent.bulletinId,
  };
  const extraNumbers = [...guide.numbers, ...(guide.text.match(/\d+(?:\.\d+)?/g) ?? []), ...issued.split(':'), ...now.split(':'), String(p.areaPins.length), String(south?.psi ?? ''), ...(forecast ? [String(forecast.minTemp ?? ''), String(forecast.maxTemp ?? '')] : [])].filter(Boolean);
  const onFacts = { ...facts, majorElsewhere: [...facts.majorElsewhere, incident] } as FactSheet;
  const problems = source ? validateScript(bulletin, onFacts, schedule, { numbers: extraNumbers, names: [...guide.names, 'MetMalaysia'] }) : [`the source ${incident.sourceId} is not one the bulletin may name`];
  return { bulletin, problems };
}
