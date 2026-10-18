import { describe, expect, it } from 'vitest';
import { decide, policyRules, type PolicyInput } from '../../src/costs/policy.js';
import { usdToNano, ceilNano, rat, NANO_PER_USD } from '../../src/costs/money.js';
import { domain, evaluate, interval, oneOf, prove, type Field, type Table } from '../../research/engineer/decisiontable.js';

const config = { autoApprove: '0.50' };
const cfg = { autoApproveUsd: config.autoApprove };
const nano = (usd: string): bigint => ceilNano(usdToNano(usd));
const input = (over: Partial<PolicyInput>): PolicyInput => ({ kind: 'ESTIMATE', capEnforced: false, actionNano: nano('0.10'), remainingNano: nano('3.00'), ...over });

describe('the spending decision', () => {
  it('GO for an estimate within the 0.50 USD limit and within the remaining budget', () => {
    expect(decide(input({}), cfg)).toMatchObject({ decision: 'GO', ruleId: 'P-GO' });
  });

  it('the limit is inclusive: exactly 0.50 USD is GO, one nano-USD more asks the owner', () => {
    expect(decide(input({ actionNano: nano('0.50') }), cfg).decision).toBe('GO');
    expect(decide(input({ actionNano: nano('0.50') + 1n }), cfg)).toMatchObject({ decision: 'ASK_OWNER', ruleId: 'P-OVER-LIMIT' });
  });

  it('exactly using up the remaining budget is GO; one nano-USD beyond it is STOP', () => {
    expect(decide(input({ actionNano: nano('0.40'), remainingNano: nano('0.40') }), cfg)).toMatchObject({ decision: 'GO', headroomNano: 0n });
    expect(decide(input({ actionNano: nano('0.40'), remainingNano: nano('0.40') - 1n }), cfg)).toMatchObject({ decision: 'STOP', ruleId: 'P-OVER-BUDGET' });
  });

  it('an already overspent budget stops even a free action', () => {
    expect(decide(input({ actionNano: 0n, remainingNano: -1n }), cfg).decision).toBe('STOP');
  });

  it('an enforced spend cap stops everything, even a free estimate', () => {
    expect(decide(input({ capEnforced: true, actionNano: 0n }), cfg)).toMatchObject({ decision: 'STOP', ruleId: 'P-CAP' });
  });

  it('an UNKNOWN cost asks the owner and is never treated as free, even when the budget is huge', () => {
    expect(decide(input({ kind: 'UNPRICED', actionNano: 0n, remainingNano: nano('1000') }), cfg)).toMatchObject({ decision: 'ASK_OWNER', ruleId: 'P-UNKNOWN' });
  });

  it('priority order: cap beats unknown beats budget beats limit', () => {
    expect(decide(input({ capEnforced: true, kind: 'UNPRICED' }), cfg).ruleId).toBe('P-CAP');
    expect(decide(input({ kind: 'UNPRICED', actionNano: nano('9'), remainingNano: 0n }), cfg).ruleId).toBe('P-UNKNOWN');
    expect(decide(input({ actionNano: nano('9'), remainingNano: nano('1') }), cfg).ruleId).toBe('P-OVER-BUDGET');
    expect(decide(input({ actionNano: nano('0.51'), remainingNano: nano('3') }), cfg).ruleId).toBe('P-OVER-LIMIT');
  });

  it('refuses inputs outside the documented domain instead of clipping them', () => {
    expect(decide(input({ actionNano: -1n }), cfg)).toMatchObject({ decision: 'ASK_OWNER', ruleId: 'P-OUT-OF-DOMAIN' });
    expect(decide(input({ remainingNano: 2_000_000n * NANO_PER_USD }), cfg)).toMatchObject({ decision: 'ASK_OWNER', ruleId: 'P-OUT-OF-DOMAIN' });
    expect(decide(input({ remainingNano: -2_000_000n * NANO_PER_USD }), cfg).ruleId).toBe('P-OUT-OF-DOMAIN');
  });

  it('follows the owner limit it is given', () => {
    expect(decide(input({ actionNano: nano('0.80') }), { autoApproveUsd: '1.00' }).decision).toBe('GO');
    expect(decide(input({ actionNano: nano('0.80') }), { autoApproveUsd: '0.10' }).decision).toBe('ASK_OWNER');
  });
});

/** The same rules as a table for the exhaustive coverage prover (restricted rule language). */
function proverTable(): Table {
  const fields: Field[] = [
    { name: 'kind', type: 'enum', values: ['ESTIMATE', 'UNPRICED'] },
    { name: 'capEnforced', type: 'enum', values: ['false', 'true'] },
    { name: 'actionUsd', type: 'numeric', domain: domain('0', true, null, false, 'a cost cannot be negative; the engine refuses a negative action cost') },
    { name: 'headroomUsd', type: 'numeric', domain: domain('-1000000', true, '1000000', true, 'the engine refuses a headroom larger than 1,000,000 USD in either direction') },
  ];
  const rules: Table['rules'] = policyRules(cfg).map((r) => ({
    id: r.id, priority: r.priority, outcome: r.outcome,
    when: [
      ...(r.when.kind ? [oneOf('kind', ...r.when.kind)] : []),
      ...(r.when.capEnforced ? [oneOf('capEnforced', ...r.when.capEnforced.map(String))] : []),
      ...(r.when.actionUsd ? [interval('actionUsd', r.when.actionUsd.lo, r.when.actionUsd.loIncl, r.when.actionUsd.hi, r.when.actionUsd.hiIncl)] : []),
      ...(r.when.headroomUsd ? [interval('headroomUsd', r.when.headroomUsd.lo, r.when.headroomUsd.loIncl, r.when.headroomUsd.hi, r.when.headroomUsd.hiIncl)] : []),
    ],
  }));
  return { id: 'COST-POLICY', fields, rules, defaultOutcome: null };
}

describe('the decision table is proved, not just tested', () => {
  it('the exhaustive prover accepts it: every valid input has exactly one effective outcome and no gap', () => {
    const analysis = prove(proverTable());
    expect(analysis.validationErrors).toEqual([]);
    expect(analysis.analysisComplete).toBe(true);
    expect(analysis.gaps).toEqual([]);
    expect(analysis.ambiguities).toEqual([]);
    expect(analysis.status).toBe('ACCEPTED');
    expect(analysis.tableAccepted).toBe(true);
    expect(analysis.cells).toBeGreaterThan(20);
  });

  it('the engine evaluator and the prover evaluator agree on every boundary combination', () => {
    const table = proverTable();
    const rationalOf = (usd: bigint) => rat(usd, NANO_PER_USD);
    const actions = [0n, 1n, nano('0.49'), nano('0.50'), nano('0.50') + 1n, nano('0.51'), nano('3'), nano('999')];
    const remaining = [-nano('1'), -1n, 0n, 1n, nano('0.50'), nano('2.99'), nano('3'), nano('500000')];
    let compared = 0;
    for (const kind of ['ESTIMATE', 'UNPRICED'] as const) for (const cap of [false, true]) for (const a of actions) for (const rem of remaining) {
      const headroom = rem - a;
      const engine = decide({ kind, capEnforced: cap, actionNano: a, remainingNano: rem }, cfg);
      const proverResult = evaluate(table, { kind, capEnforced: String(cap), actionUsd: rationalOf(a), headroomUsd: rationalOf(headroom) });
      expect(proverResult.outcome, `${kind} cap=${cap} action=${a} remaining=${rem}`).toBe(engine.decision);
      compared += 1;
    }
    expect(compared).toBe(2 * 2 * actions.length * remaining.length);
  });

  it('a table with a deliberate gap would be rejected by the same prover (the proof is not vacuous)', () => {
    const table = proverTable();
    table.rules = table.rules.filter((r) => r.id !== 'P-GO');
    const analysis = prove(table);
    expect(analysis.status).toBe('REJECTED_COVERAGE');
    expect(analysis.gaps.length).toBeGreaterThan(0);
  });
});
