import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { AegisError } from '../../src/engine/errors.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { parseLocalCommand } from '../../src/chat/router.js';
import {
  activeVersion, evaluateCandidate, promoteCandidate, proposeCandidate, rollback, type Criteria, type HeldOutCase,
} from '../../src/services/evaluation.js';

type Db = import('better-sqlite3').Database;
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const databases: Db[] = [];
const NOW = '2026-10-13T09:30:00Z';
const TARGET = 'I_aegis_incident_list';
const criteria: Criteria = { minAccuracyGain: 3000, allowRegressions: false, allowWrongRoute: false };
const heldOut: HeldOutCase[] = [
  { utterance: 'show incidents', expected: 'I_aegis_incident_list' },
  { utterance: 'incidents', expected: 'I_aegis_incident_list' },
  { utterance: 'what incidents are there', expected: 'I_aegis_incident_list' },
  { utterance: 'help me', expected: 'none' },
  { utterance: 'show cards', expected: 'none' },
  { utterance: 'verify audit', expected: 'I_aegis_audit_verify' },
];

const baseline = (utterance: string): string => parseLocalCommand(utterance).routeId ?? 'none';
const ALIASES = new Set(['show incidents', 'incidents', 'what incidents are there']);
const candidate = (utterance: string): string => ALIASES.has(utterance.trim().toLowerCase()) ? TARGET : baseline(utterance);
const overbroad = (utterance: string): string => utterance.includes('show') ? TARGET : baseline(utterance);

function makeDb(): { db: Db; ids: SeqIdGen } {
  const db = openDb(':memory:');
  databases.push(db);
  migrate(db, migrationDirectory, NOW);
  return { db, ids: new SeqIdGen() };
}

function propose(db: Db, ids: SeqIdGen, overrides: Partial<Criteria> = {}): string {
  return proposeCandidate(db, {
    kind: 'route', targetId: TARGET, rationale: 'Add local aliases',
    examples: ['show incidents', 'incidents', 'what incidents are there'], criteria: { ...criteria, ...overrides },
  }, ids, NOW);
}

function code(action: () => void): string | null {
  try { action(); return null; } catch (error: unknown) { return error instanceof AegisError ? error.code : 'OTHER'; }
}

afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe('TSK-017 evaluation and learning boundary', () => {
  it('AEG-TST-014 scores baseline 5000 bp and candidate 10000 bp and passes', () => {
    const { db, ids } = makeDb();
    const id = propose(db, ids);
    const metrics = evaluateCandidate(db, id, heldOut, baseline, candidate);
    expect(metrics).toEqual({ accuracyBaselineBp: 5000, accuracyCandidateBp: 10000, regressions: 0, wrongRoutes: 0, passed: true });
    const row = db.prepare('SELECT state, metrics_json FROM eval_candidates WHERE candidate_id = ?').get(id) as { state: string; metrics_json: string };
    expect(row.state).toBe('tested');
    expect(JSON.parse(row.metrics_json)).toEqual(metrics);
  });

  it('AEG-TST-014 a candidate has no effect until promoted', () => {
    const { db, ids } = makeDb();
    const id = propose(db, ids);
    evaluateCandidate(db, id, heldOut, baseline, candidate);
    expect(activeVersion(db, TARGET)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM active_rules').get()).toEqual({ n: 0 });
  });

  it('AEG-TST-014 a failing candidate is rejected and cannot be promoted', () => {
    const { db, ids } = makeDb();
    const id = propose(db, ids);
    const metrics = evaluateCandidate(db, id, heldOut, baseline, overbroad);
    expect(metrics.passed).toBe(false);
    expect(metrics.wrongRoutes).toBe(1);
    const row = db.prepare('SELECT state FROM eval_candidates WHERE candidate_id = ?').get(id) as { state: string };
    expect(row.state).toBe('rejected');
    expect(code(() => promoteCandidate(db, id, 'USER-REVIEWER', 'try anyway', NOW))).toBe('E_VALIDATION');
    expect(activeVersion(db, TARGET)).toBeNull();
  });

  it('AEG-TST-014 promotion without reviewedBy or for an untested candidate fails', () => {
    const { db, ids } = makeDb();
    const untested = propose(db, ids);
    expect(code(() => promoteCandidate(db, untested, 'USER-REVIEWER', 'not evaluated', NOW))).toBe('E_VALIDATION');
    evaluateCandidate(db, untested, heldOut, baseline, candidate);
    expect(code(() => promoteCandidate(db, untested, '  ', 'no reviewer', NOW))).toBe('E_VALIDATION');
    expect(code(() => promoteCandidate(db, untested, '', 'no reviewer', NOW))).toBe('E_VALIDATION');
    expect(activeVersion(db, TARGET)).toBeNull();
  });

  it('AEG-TST-014 promotes a tested candidate and records the reviewer', () => {
    const { db, ids } = makeDb();
    const id = propose(db, ids);
    evaluateCandidate(db, id, heldOut, baseline, candidate);
    promoteCandidate(db, id, 'USER-REVIEWER', 'Reviewed held-out results', NOW);
    expect(activeVersion(db, TARGET)).toBe(id);
    const row = db.prepare('SELECT state, reviewed_by FROM eval_candidates WHERE candidate_id = ?').get(id) as { state: string; reviewed_by: string };
    expect(row).toEqual({ state: 'active', reviewed_by: 'USER-REVIEWER' });
  });

  it('AEG-TST-014 an evaluated candidate cannot be evaluated again to flip its verdict', () => {
    const { db, ids } = makeDb();
    const id = propose(db, ids);
    evaluateCandidate(db, id, heldOut, baseline, overbroad);
    expect(code(() => evaluateCandidate(db, id, heldOut, baseline, candidate))).toBe('E_VALIDATION');
  });

  it('AEG-TST-014 rollback restores the previous version label and history is kept', () => {
    const { db, ids } = makeDb();
    const first = propose(db, ids);
    evaluateCandidate(db, first, heldOut, baseline, candidate);
    promoteCandidate(db, first, 'USER-REVIEWER', 'first', NOW);
    const second = propose(db, ids);
    evaluateCandidate(db, second, heldOut, baseline, candidate);
    promoteCandidate(db, second, 'USER-REVIEWER', 'second', NOW);
    expect(activeVersion(db, TARGET)).toBe(second);
    rollback(db, TARGET, first, 'USER-REVIEWER', 'second misbehaved', NOW);
    expect(activeVersion(db, TARGET)).toBe(first);
    expect(code(() => rollback(db, TARGET, 'NO-SUCH-VERSION', 'USER-REVIEWER', 'bad label', NOW))).toBe('E_VALIDATION');
    rollback(db, TARGET, 'baseline', 'USER-REVIEWER', 'back to code defaults', NOW);
    expect(activeVersion(db, TARGET)).toBe('baseline');
    const history = db.prepare('SELECT version_label FROM active_rules WHERE target_id = ? ORDER BY activation_id').all(TARGET) as Array<{ version_label: string }>;
    expect(history.map((row) => row.version_label)).toEqual([first, second, first, 'baseline']);
    const secondState = db.prepare('SELECT state FROM eval_candidates WHERE candidate_id = ?').get(second) as { state: string };
    expect(secondState.state).toBe('deprecated');
  });
});
