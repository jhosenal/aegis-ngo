// Emergency bulletin (AEG-NEWS-007): a short, single-event bulletin an administrator starts from a current incident. Written by code from the incident record, then checked by the same validator as the daily
// script (no number or source the record does not support). It is an AEGIS summary of an official source, never an official warning, and it needs an administrator's approval like every bulletin.
import { createHash } from 'node:crypto';
import type { BroadcastSchedule } from './schedule.js';
import type { FactIncident, FactSheet } from './factSheet.js';
import { briefGuidance, resolveGuidance } from './guidance.js';
import { CREDITS_SECONDS, hhmm, incidentSentence, local, spokenSeconds, validateScript, type Bulletin, type Segment } from './script.js';

const LEVEL_RANK: Record<string, number> = { RED: 0, ORANGE: 1, GREEN: 2, UNRATED: 3 };

/** Singapore haze as a candidate: NEA's 24-hour PSI at Unhealthy or worse, in a reading from the capture hour or the one before. The facts are NEA's, nothing is added. */
export function psiCandidate(facts: FactSheet): FactIncident[] {
  const psi = facts.psi;
  if (!psi || !psi.freshAtCapture || psi.regions.length === 0 || psi.regions[0]!.psi < 101) return [];
  const top = psi.regions[0]!;
  return [{ evidenceId: `PSI-${psi.observedAt}`, incidentKey: 'haze-sg', hazardType: 'WILDFIRE', alertLevel: top.band === 'Unhealthy' ? 'ORANGE' : 'RED', title: `Haze in Singapore: 24-hour PSI up to ${top.psi} (${top.band})`, eventTime: psi.observedAt, lat: 1.35, lon: 103.8, sourceId: 'SRC.NEA.PSI.LIVE' }];
}

/** The incidents an emergency bulletin may be made from: current events in the three countries and major alerts elsewhere, most severe first, only from sources the bulletin may name. */
export function emergencyCandidates(facts: FactSheet, schedule: BroadcastSchedule): FactIncident[] {
  const narratable = new Set(schedule.narratedSources.map((s) => s.sourceId));
  const all = [...facts.countries.flatMap((c) => c.incidents), ...facts.majorElsewhere, ...psiCandidate(facts)];
  const seen = new Set<string>();
  return all.filter((i) => narratable.has(i.sourceId) && !seen.has(i.evidenceId) && (seen.add(i.evidenceId), true))
    .sort((a, b) => (LEVEL_RANK[a.alertLevel] ?? 3) - (LEVEL_RANK[b.alertLevel] ?? 3) || (b.eventTime ?? '').localeCompare(a.eventTime ?? ''));
}

export const EMERGENCY_GUIDANCE = 'This is an AEGIS summary of an official source, not an official warning. Follow the instructions of your local authority. In an emergency, call your local emergency number. Tap the marker on the map for the source and the time.';

/** The notice of the 15-second alert. */
export const EMERGENCY_NOTICE_BRIEF = 'Not an official warning. Follow your local authority.';

/** detail 'brief' (the default) is the 15-second alert: what happened, the one key official action, the notice. 'full' is the longer bulletin with every guidance line. */
export function buildEmergencyBulletin(p: { schedule: BroadcastSchedule; incident: FactIncident; now: string; bulletinId: string; drill?: boolean; detail?: 'brief' | 'full'; audience?: string }): { bulletin: Bulletin; problems: string[] } {
  const { schedule, incident } = p; const offset = schedule.timezone.utcOffsetHours;
  const source = schedule.narratedSources.find((s) => s.sourceId === incident.sourceId);
  const trigger = hhmm(local(p.now, offset));
  const sourceName = source?.name ?? incident.sourceId;
  const focus = incident.lat !== null && incident.lon !== null ? { lat: incident.lat, lon: incident.lon, label: incident.title, kind: 'incident' as const } : null;
  // What to do: quoted from the official guidance of the country (or the three countries) and nothing else (guidance.ts).
  const guide = resolveGuidance({ hazardType: incident.hazardType, alertLevel: incident.alertLevel, lat: incident.lat, lon: incident.lon, ...(p.audience ? { audience: p.audience } : {}) });
  const brief = p.detail !== 'full';
  const firstSentence = (s: string): string => s.split(/(?<=[.!?])\s+/)[0] ?? s;
  const headlineText = brief
    ? `${p.drill ? 'This is an exercise. ' : ''}${firstSentence(incidentSentence(incident, offset))} Issued ${trigger}.`
    : `${p.drill ? 'This is an exercise, not a real event. ' : ''}This is an AEGIS emergency information bulletin, issued at ${trigger} Malaysia and Singapore time. ${incidentSentence(incident, offset)}`;
  const raw: Segment[] = [
    { id: 'emergency-headline', title: 'Emergency information', text: headlineText, focus,
      evidenceIds: [incident.evidenceId], sourceIds: [incident.sourceId], lowerThird: `Source: ${sourceName} · Issued ${trigger} MYT`, startSec: 0, durationSec: 0 },
    { id: 'emergency-actions', title: 'What to do', text: brief ? briefGuidance(guide, incident.hazardType) : guide.text, focus: null, evidenceIds: [], sourceIds: [], lowerThird: `Official guidance: ${guide.countries.filter((c) => c.status === 'SOURCED').map((c) => `${c.country} (${c.agency})`).join(', ') || 'none on file'}`, startSec: 0, durationSec: 0 },
    { id: 'emergency-notice', title: 'Notice', text: brief ? EMERGENCY_NOTICE_BRIEF : EMERGENCY_GUIDANCE, focus: null, evidenceIds: [], sourceIds: [], lowerThird: 'Informational summary, not an official warning', startSec: 0, durationSec: 0 },
  ];
  let at = 0;
  const segments = raw.map((seg) => { const durationSec = spokenSeconds(seg.text); const out = { ...seg, startSec: Math.round(at * 10) / 10, durationSec }; at += durationSec; return out; });
  const bulletin: Bulletin = {
    bulletinId: p.bulletinId, slotId: p.drill ? 'drill' : 'emergency', language: 'en', captureAt: p.now, airAt: p.now, generatedAt: p.now, scheduleVersion: schedule.version,
    factSheetHash: createHash('sha256').update(JSON.stringify(incident)).digest('hex'), segments, estimatedSeconds: Math.round((at + CREDITS_SECONDS) * 10) / 10,
    timingBasis: 'estimated from the word count; replaced by real audio durations when audio exists',
    lowerThird: `Issued ${trigger} MYT · Source: ${sourceName}`,
    credits: { lines: [...(source ? [source.credit] : []), ...guide.sourceLines.map((l) => `Guidance: ${l}`), `${schedule.disclosure.voice}.`, schedule.disclosure.pilot] },
    incident: { hazardType: incident.hazardType, alertLevel: incident.alertLevel, title: incident.title, eventTime: incident.eventTime, sourceName },
    remarks: ['Emergency information bulletin made from one current incident record by an administrator. It is an AEGIS summary of an official source, not an official warning.', 'No casualty or people-affected figure is stated: the live feeds give none.', 'The "what to do" lines are quotations of official guidance (see the credits); AEGIS wrote none of them. They are not clinically reviewed.', ...guide.remarks],
  };
  // The daily validator, with the single incident as the fact base.
  const facts = { slotId: 'emergency', captureAt: p.now, airAt: p.now, scheduleVersion: schedule.version, feeds: [], countries: [], elsewhereCount: 0, majorElsewhere: [incident], psi: null, advice: [], metMy: null, hash: bulletin.factSheetHash } as unknown as FactSheet;
  const problems = source ? validateScript(bulletin, facts, schedule, { numbers: [...guide.numbers, ...(guide.text.match(/\d+(?:\.\d+)?/g) ?? [])], names: guide.names }) : [`the source ${incident.sourceId} is not one the bulletin may name`];
  return { bulletin, problems };
}
