// Generates and stores the bulletin for a slot capture (AEG-NEWS-004). Idempotent: one bulletin per slot capture and language. A script that fails
// validateScript is NOT published; the failure is returned so the caller can log it. No model and no provider call is made here.
import type { Clock } from '../../engine/clock.js';
import type { IdGen } from '../../engine/ids.js';
import type { Db } from '../../data/db.js';
import { listEvidence, listSourceStatuses } from '../../data/repos/evidence.js';
import { findBulletin, insertBulletin } from '../../data/repos/broadcast.js';
import { latestPsiFetchedBy } from '../../data/repos/airReadings.js';
import { PSI_SOURCE_ID } from '../../sources/psi.js';
import { CAPTURE_GRACE_MS } from './factSheet.js';
import { releasedPsiAdvice } from './advice.js';
import { latestSnapshotFetchedBy } from '../../data/repos/officialSnapshots.js';
import { METMY_FORECAST_ID, METMY_WARNINGS_ID, type MetWarning } from '../../sources/metMy.js';
import type { ForecastPayload } from '../metMyIngest.js';
import { buildFactSheet } from './factSheet.js';
import { latestCapture, nextCapture, type BroadcastSchedule } from './schedule.js';
import { buildScript, validateScript, type Bulletin } from './script.js';

export type GenerateResult =
  | { ok: true; created: boolean; bulletin: Bulletin }
  | { ok: false; slotId: string; captureAt: string; problems: string[] };

export function generateLatestBulletin(p: { db: Db; clock: Clock; ids: IdGen; schedule: BroadcastSchedule }): GenerateResult {
  const now = p.clock.now();
  const { slot, captureAt, airAt } = latestCapture(p.schedule, now);
  const existing = findBulletin(p.db, slot.id, captureAt, 'en');
  if (existing) return { ok: true, created: false, bulletin: existing };
  const facts = buildFactSheet({ schedule: p.schedule, slot, captureAt, airAt, evidence: listEvidence(p.db), statuses: listSourceStatuses(p.db),
    adviceFor: (band) => releasedPsiAdvice(band),
    metMy: {
      warnings: latestSnapshotFetchedBy<MetWarning[]>(p.db, METMY_WARNINGS_ID, new Date(Date.parse(captureAt) + CAPTURE_GRACE_MS).toISOString()),
      forecast: latestSnapshotFetchedBy<ForecastPayload>(p.db, METMY_FORECAST_ID, new Date(Date.parse(captureAt) + CAPTURE_GRACE_MS).toISOString()),
    },
    psi: latestPsiFetchedBy(p.db, PSI_SOURCE_ID, new Date(Date.parse(captureAt) + CAPTURE_GRACE_MS).toISOString()) });
  // The slot after this one, in local time, for "our next briefing airs at".
  const following = nextCapture(p.schedule, new Date(Date.parse(captureAt) + 1000).toISOString());
  const bulletin = buildScript({ schedule: p.schedule, facts, greeting: slot.greeting, nextAirLocal: following.slot.airLocal, generatedAt: now, bulletinId: p.ids.next('BULL') });
  const problems = validateScript(bulletin, facts, p.schedule);
  if (problems.length > 0) return { ok: false, slotId: slot.id, captureAt, problems };
  return { ok: true, created: insertBulletin(p.db, bulletin), bulletin };
}

/** The fact sheet as at now, from what is stored right now (the base of the draft and of an emergency bulletin). */
export function factsNow(p: { db: Db; clock: Clock; schedule: BroadcastSchedule }): import('./factSheet.js').FactSheet {
  const now = p.clock.now(); const next = nextCapture(p.schedule, now); const cutoff = new Date(Date.parse(now) + CAPTURE_GRACE_MS).toISOString();
  return buildFactSheet({ schedule: p.schedule, slot: next.slot, captureAt: now, airAt: next.airAt, evidence: listEvidence(p.db), statuses: listSourceStatuses(p.db),
    adviceFor: (band) => releasedPsiAdvice(band), psi: latestPsiFetchedBy(p.db, PSI_SOURCE_ID, cutoff),
    metMy: { warnings: latestSnapshotFetchedBy<MetWarning[]>(p.db, METMY_WARNINGS_ID, cutoff), forecast: latestSnapshotFetchedBy<ForecastPayload>(p.db, METMY_FORECAST_ID, cutoff) } });
}

/** The draft as at `now`, built from what is stored right now and NOT saved (the screening room's "what would it say if captured now"). */
export function buildDraftNow(p: { db: Db; clock: Clock; schedule: BroadcastSchedule }): { bulletin: Bulletin; problems: string[] } {
  const now = p.clock.now();
  const next = nextCapture(p.schedule, now);
  const cutoff = new Date(Date.parse(now) + CAPTURE_GRACE_MS).toISOString();
  const facts = buildFactSheet({ schedule: p.schedule, slot: next.slot, captureAt: now, airAt: next.airAt, evidence: listEvidence(p.db), statuses: listSourceStatuses(p.db),
    adviceFor: (band) => releasedPsiAdvice(band), psi: latestPsiFetchedBy(p.db, PSI_SOURCE_ID, cutoff),
    metMy: { warnings: latestSnapshotFetchedBy<MetWarning[]>(p.db, METMY_WARNINGS_ID, cutoff), forecast: latestSnapshotFetchedBy<ForecastPayload>(p.db, METMY_FORECAST_ID, cutoff) } });
  const following = nextCapture(p.schedule, new Date(Date.parse(next.captureAt) + 1000).toISOString());
  const bulletin = buildScript({ schedule: p.schedule, facts, greeting: next.slot.greeting, nextAirLocal: following.slot.airLocal, generatedAt: now, bulletinId: 'DRAFT' });
  return { bulletin, problems: validateScript(bulletin, facts, p.schedule) };
}
