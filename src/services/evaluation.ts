import { AegisError } from '../engine/errors.js';
import type { IdGen } from '../engine/ids.js';
import type { Db } from '../data/db.js';

export interface Criteria { minAccuracyGain: number; allowRegressions: boolean; allowWrongRoute: boolean }
export interface HeldOutCase { utterance: string; expected: string | 'none' }
export interface EvaluationMetrics {
  accuracyBaselineBp: number;
  accuracyCandidateBp: number;
  regressions: number;
  wrongRoutes: number;
  passed: boolean;
}

export const BASELINE_LABEL = 'baseline';

interface CandidateRow { state: string; examples_json: string; metrics_json: string | null; target_id: string }

function loadCandidate(db: Db, candidateId: string): CandidateRow {
  const row = db.prepare('SELECT state, examples_json, metrics_json, target_id FROM eval_candidates WHERE candidate_id = ?')
    .get(candidateId) as CandidateRow | undefined;
  if (!row) throw new AegisError('E_NOT_FOUND', 'Unknown candidate');
  return row;
}

function accuracyBp(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct * 10_000) / total);
}

export function proposeCandidate(
  db: Db,
  p: { kind: 'route'; targetId: string; rationale: string; examples: unknown[]; criteria: Criteria },
  ids: IdGen,
  nowIso: string,
): string {
  if (p.targetId.trim() === '' || p.rationale.trim() === '') throw new AegisError('E_VALIDATION', 'Target and rationale are required');
  if (!Number.isInteger(p.criteria.minAccuracyGain)) throw new AegisError('E_VALIDATION', 'minAccuracyGain must be an integer in basis points');
  const candidateId = ids.next('CAND');
  db.prepare(
    'INSERT INTO eval_candidates (candidate_id, kind, target_id, rationale, examples_json, state, metrics_json, created_at, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)',
  ).run(candidateId, p.kind, p.targetId, p.rationale, JSON.stringify({ examples: p.examples, criteria: p.criteria }), 'candidate', nowIso);
  return candidateId;
}

function criteriaOf(row: CandidateRow): Criteria {
  const stored = JSON.parse(row.examples_json) as { criteria?: Criteria };
  if (!stored.criteria) throw new AegisError('E_VALIDATION', 'Candidate has no stored criteria');
  return stored.criteria;
}

export function evaluateCandidate(
  db: Db,
  candidateId: string,
  heldOut: HeldOutCase[],
  routerBaseline: (utterance: string) => string | 'none',
  routerCandidate: (utterance: string) => string | 'none',
): EvaluationMetrics {
  const row = loadCandidate(db, candidateId);
  if (row.state !== 'candidate') throw new AegisError('E_VALIDATION', 'Only a candidate in state candidate can be evaluated');
  const criteria = criteriaOf(row);
  let baselineCorrect = 0;
  let candidateCorrect = 0;
  let regressions = 0;
  let wrongRoutes = 0;
  for (const item of heldOut) {
    const base = routerBaseline(item.utterance);
    const cand = routerCandidate(item.utterance);
    if (base === item.expected) baselineCorrect += 1;
    if (cand === item.expected) candidateCorrect += 1;
    if (base === item.expected && cand !== item.expected) regressions += 1;
    if (cand !== 'none' && cand !== item.expected) wrongRoutes += 1;
  }
  const accuracyBaselineBp = accuracyBp(baselineCorrect, heldOut.length);
  const accuracyCandidateBp = accuracyBp(candidateCorrect, heldOut.length);
  const passed = accuracyCandidateBp >= accuracyBaselineBp + criteria.minAccuracyGain
    && (criteria.allowRegressions || regressions === 0)
    && (criteria.allowWrongRoute || wrongRoutes === 0);
  const metrics: EvaluationMetrics = { accuracyBaselineBp, accuracyCandidateBp, regressions, wrongRoutes, passed };
  db.prepare('UPDATE eval_candidates SET metrics_json = ?, state = ? WHERE candidate_id = ?')
    .run(JSON.stringify(metrics), passed ? 'tested' : 'rejected', candidateId);
  return metrics;
}

export function promoteCandidate(db: Db, candidateId: string, reviewedBy: string, reason: string, nowIso: string): void {
  if (reviewedBy.trim() === '') throw new AegisError('E_VALIDATION', 'reviewedBy is required');
  if (reason.trim() === '') throw new AegisError('E_VALIDATION', 'reason is required');
  const promote = db.transaction(() => {
    const row = loadCandidate(db, candidateId);
    if (row.state !== 'tested') throw new AegisError('E_VALIDATION', 'Only a tested candidate can be promoted');
    const metrics = row.metrics_json === null ? null : JSON.parse(row.metrics_json) as Partial<EvaluationMetrics>;
    if (metrics?.passed !== true) throw new AegisError('E_VALIDATION', 'Candidate did not pass its criteria');
    db.prepare('UPDATE eval_candidates SET state = ?, reviewed_by = ? WHERE candidate_id = ?').run('active', reviewedBy, candidateId);
    db.prepare(
      'INSERT INTO active_rules (target_id, candidate_id, version_label, activated_at, activated_by, reason) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(row.target_id, candidateId, candidateId, nowIso, reviewedBy, reason);
  });
  promote.immediate();
}

export function activeVersion(db: Db, targetId: string): string | null {
  const row = db.prepare('SELECT version_label FROM active_rules WHERE target_id = ? ORDER BY activation_id DESC LIMIT 1')
    .get(targetId) as { version_label: string } | undefined;
  return row?.version_label ?? null;
}

export function rollback(db: Db, targetId: string, toVersionLabel: string, by: string, reason: string, nowIso: string): void {
  if (by.trim() === '' || reason.trim() === '') throw new AegisError('E_VALIDATION', 'by and reason are required');
  const run = db.transaction(() => {
    const current = activeVersion(db, targetId);
    const prior = db.prepare('SELECT candidate_id FROM active_rules WHERE target_id = ? AND version_label = ? ORDER BY activation_id DESC LIMIT 1')
      .get(targetId, toVersionLabel) as { candidate_id: string | null } | undefined;
    if (!prior && toVersionLabel !== BASELINE_LABEL) throw new AegisError('E_VALIDATION', 'Unknown version label for this target');
    db.prepare(
      'INSERT INTO active_rules (target_id, candidate_id, version_label, activated_at, activated_by, reason) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(targetId, prior?.candidate_id ?? null, toVersionLabel, nowIso, by, reason);
    if (current !== null && current !== toVersionLabel) {
      db.prepare('UPDATE eval_candidates SET state = ? WHERE candidate_id = ? AND state = ?').run('deprecated', current, 'active');
    }
  });
  run.immediate();
}
