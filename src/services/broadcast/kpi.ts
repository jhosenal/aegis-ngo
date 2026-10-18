// How fast the news pipeline is, against targets (AEG-NEWS-007). Pure: the timeline in, the rows out.
import type { Output, Scenario, Step } from '../../data/repos/bulletinPipeline.js';
import type { ReviewLogEntry } from '../../data/repos/broadcast.js';

const MIN = 60_000;
/** Owner targets, 2026-10-17. Daily: a script within 2 minutes of the capture, approved at least 15 minutes before air time, voice within 5 minutes of approval, presenter ready by air time.
 * Emergency: a draft within 1 minute of the trigger, approval within 2 minutes of the draft, and voice on air within 5 minutes of the trigger; the presenter is an optional follow-up. */
export const KPI_TARGETS = {
  daily: { draftMs: 2 * MIN, approveBeforeAirMs: 15 * MIN, voiceAfterApprovalMs: 5 * MIN },
  emergency: { draftMs: 1 * MIN, approveAfterDraftMs: 2 * MIN, voiceFromTriggerMs: 5 * MIN },
} as const;

export interface Timeline {
  triggerAt: string; draftedAt: string; airAt: string;
  approvedAt: string | null; voiceReadyAt: string | null; presenterRequestedAt: string | null; presenterReadyAt: string | null;
}
export type KpiStatus = 'ok' | 'late' | 'pending' | 'at_risk' | 'not_applicable';
export interface KpiRow { id: string; label: string; target: string; dueAt: string | null; doneAt: string | null; actualMs: number | null; status: KpiStatus }

/** The timeline of a bulletin from its stored facts: the bulletin itself, the review log (the approval counts only while the bulletin is still approved) and the production steps. */
export function buildTimeline(b: { captureAt: string; generatedAt: string; airAt: string }, review: { decision: 'APPROVED' | 'HELD' } | null, log: ReviewLogEntry[], steps: Step[]): Timeline {
  const lastApprove = [...log].reverse().find((e) => e.action === 'APPROVE');
  const first = (name: Step['step']): string | null => steps.find((s) => s.step === name)?.at ?? null;
  return { triggerAt: b.captureAt, draftedAt: b.generatedAt, airAt: b.airAt, approvedAt: review?.decision === 'APPROVED' && lastApprove ? lastApprove.at : null,
    voiceReadyAt: first('VOICE_READY'), presenterRequestedAt: first('PRESENTER_REQUESTED'), presenterReadyAt: first('PRESENTER_READY') };
}

const ms = (a: string, b: string): number => Date.parse(b) - Date.parse(a);
const sec = (n: number): string => (n % MIN === 0 ? `${n / MIN} min` : `${Math.round(n / 1000)} s`);

interface RowIn { startIso: string | null; doneIso: string | null; limitMs: number; dueIso?: string | null }
/** One row: a step finished (compare with its limit), or not yet (pending, at risk in the last quarter of the allowance, or late once the limit passed). */
function row(id: string, label: string, target: string, r: RowIn, nowIso: string): KpiRow {
  const due = r.dueIso ?? (r.startIso ? new Date(Date.parse(r.startIso) + r.limitMs).toISOString() : null);
  const actualMs = r.startIso && r.doneIso ? ms(r.startIso, r.doneIso) : null;
  if (r.doneIso && due) return { id, label, target, dueAt: due, doneAt: r.doneIso, actualMs, status: Date.parse(r.doneIso) <= Date.parse(due) ? 'ok' : 'late' };
  if (!due) return { id, label, target, dueAt: null, doneAt: null, actualMs: null, status: 'pending' };
  const left = Date.parse(due) - Date.parse(nowIso);
  return { id, label, target, dueAt: due, doneAt: null, actualMs: null, status: left < 0 ? 'late' : left <= Math.min(r.limitMs / 4 || 5 * MIN, 5 * MIN) ? 'at_risk' : 'pending' };
}
const na = (id: string, label: string, target: string): KpiRow => ({ id, label, target, dueAt: null, doneAt: null, actualMs: null, status: 'not_applicable' });

export function evaluateKpi(scenario: Scenario, output: Output, t: Timeline, nowIso: string): KpiRow[] {
  if (scenario === 'daily') {
    const k = KPI_TARGETS.daily; const due = new Date(Date.parse(t.airAt) - k.approveBeforeAirMs).toISOString();
    return [
      row('draft', 'Script drafted and checked', `within ${sec(k.draftMs)} of the capture`, { startIso: t.triggerAt, doneIso: t.draftedAt, limitMs: k.draftMs }, nowIso),
      row('approval', 'Approved by an administrator', `at least ${sec(k.approveBeforeAirMs)} before air time`, { startIso: null, doneIso: t.approvedAt, limitMs: k.approveBeforeAirMs, dueIso: due }, nowIso),
      row('voice', 'Voice ready', `within ${sec(k.voiceAfterApprovalMs)} of approval`, { startIso: t.approvedAt, doneIso: t.voiceReadyAt, limitMs: k.voiceAfterApprovalMs }, nowIso),
      output === 'voice_presenter' ? row('presenter', 'Presenter ready', 'by air time', { startIso: null, doneIso: t.presenterReadyAt, limitMs: 0, dueIso: t.airAt }, nowIso) : na('presenter', 'Presenter ready', 'not chosen for this bulletin'),
    ];
  }
  const k = KPI_TARGETS.emergency;
  return [
    row('draft', 'Draft made and checked', `within ${sec(k.draftMs)} of the trigger`, { startIso: t.triggerAt, doneIso: t.draftedAt, limitMs: k.draftMs }, nowIso),
    row('approval', 'Approved by an administrator', `within ${sec(k.approveAfterDraftMs)} of the draft`, { startIso: t.draftedAt, doneIso: t.approvedAt, limitMs: k.approveAfterDraftMs }, nowIso),
    row('voice', 'Voice on air', `within ${sec(k.voiceFromTriggerMs)} of the trigger`, { startIso: t.triggerAt, doneIso: t.voiceReadyAt, limitMs: k.voiceFromTriggerMs }, nowIso),
    output === 'voice_presenter'
      ? { id: 'presenter', label: 'Presenter follow-up', target: 'optional, never delays the voice', dueAt: null, doneAt: t.presenterReadyAt, actualMs: t.presenterReadyAt ? ms(t.triggerAt, t.presenterReadyAt) : null, status: t.presenterReadyAt ? 'ok' : 'pending' }
      : na('presenter', 'Presenter follow-up', 'not chosen for this bulletin'),
  ];
}
