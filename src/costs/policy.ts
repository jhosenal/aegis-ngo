// The spending decision (AEG-CON-004 / AEG-SOP-002) as a decision table in the restricted rule language used by the Aegis table prover:
// every rule is a conjunction of interval or value-set conditions over a few named inputs, highest priority wins, no rule ties. The engine
// computes the derived inputs (headroom) first, so the table never compares one field with another. The table is data, so the test suite
// can hand the SAME table to the exhaustive coverage prover and cross-check this evaluator against it.
import { cmp, nanoToUsdRat, parseDecimal, rat, type Rat, NANO_PER_USD } from './money.js';

export type Decision = 'GO' | 'ASK_OWNER' | 'STOP';
/** UNPRICED means the estimate is UNKNOWN. The word UNKNOWN is avoided here because the table prover reserves it as its marker for an unknown input. */
export type EstimateKind = 'ESTIMATE' | 'UNPRICED';

export interface PolicyInput {
  kind: EstimateKind;
  capEnforced: boolean;
  /** Estimated cost of the action in whole nano-USD (0 when kind is UNKNOWN). */
  actionNano: bigint;
  /** Budget remaining before this action, in whole nano-USD; may be negative when already overspent. */
  remainingNano: bigint;
}

export interface PolicyConfig { autoApproveUsd: string }   // the owner's per-action limit, for example "0.50"

export interface PolicyRule {
  id: string;
  priority: number;
  outcome: Decision;
  reason: string;
  /** Conditions on the named inputs; a missing input name means "any". */
  when: {
    kind?: EstimateKind[];
    capEnforced?: boolean[];
    actionUsd?: { lo: string | null; loIncl: boolean; hi: string | null; hiIncl: boolean };
    headroomUsd?: { lo: string | null; loIncl: boolean; hi: string | null; hiIncl: boolean };
  };
}

export const POLICY_VERSION = '1.0.0';

/** The whole policy. Documented domains: actionUsd >= 0 (a cost cannot be negative); headroomUsd within +/-1,000,000 USD (larger values are refused). */
export function policyRules(config: PolicyConfig): PolicyRule[] {
  return [
    { id: 'P-CAP', priority: 100, outcome: 'STOP', reason: 'a spend cap is enforced for this service', when: { capEnforced: [true] } },
    { id: 'P-UNKNOWN', priority: 90, outcome: 'ASK_OWNER', reason: 'the cost is UNKNOWN (a price or a region is missing); unknown is never treated as free', when: { kind: ['UNPRICED'] } },
    { id: 'P-OVER-BUDGET', priority: 80, outcome: 'STOP', reason: 'the action would exceed the remaining budget', when: { headroomUsd: { lo: null, loIncl: false, hi: '0', hiIncl: false } } },
    { id: 'P-OVER-LIMIT', priority: 70, outcome: 'ASK_OWNER', reason: `the estimated cost is above the owner's per-action limit of ${config.autoApproveUsd} USD`, when: { actionUsd: { lo: config.autoApproveUsd, loIncl: false, hi: null, hiIncl: false } } },
    { id: 'P-GO', priority: 10, outcome: 'GO', reason: 'an estimate within the per-action limit and within the remaining budget, with no cap enforced', when: { kind: ['ESTIMATE'], capEnforced: [false], actionUsd: { lo: '0', loIncl: true, hi: config.autoApproveUsd, hiIncl: true }, headroomUsd: { lo: '0', loIncl: true, hi: null, hiIncl: false } } },
  ];
}

export const POLICY_DOMAIN = { actionUsd: { lo: '0', hi: null as string | null }, headroomUsd: { lo: '-1000000', hi: '1000000' } } as const;

const MAX_ABS_NANO = 1_000_000n * NANO_PER_USD;

/** A decimal USD text, optionally negative, as an exact rational USD value. */
function usdRat(text: string): Rat {
  const negative = text.startsWith('-');
  const value = parseDecimal(negative ? text.slice(1) : text);
  return negative ? rat(-value.n, value.d) : value;
}

function holdsInterval(value: Rat, c: { lo: string | null; loIncl: boolean; hi: string | null; hiIncl: boolean }): boolean {
  if (c.lo !== null) { const k = cmp(value, usdRat(c.lo)); if (k < 0 || (k === 0 && !c.loIncl)) return false; }
  if (c.hi !== null) { const k = cmp(value, usdRat(c.hi)); if (k > 0 || (k === 0 && !c.hiIncl)) return false; }
  return true;
}

export interface PolicyResult { decision: Decision; ruleId: string; reason: string; headroomNano: bigint }

/** Evaluates the table. Inputs outside the documented domain, or no matching rule, give ASK_OWNER (fail closed), never GO. */
export function decide(input: PolicyInput, config: PolicyConfig): PolicyResult {
  const headroom = input.remainingNano - input.actionNano;
  const outside = input.actionNano < 0n || (headroom < -MAX_ABS_NANO || headroom > MAX_ABS_NANO);
  if (outside) return { decision: 'ASK_OWNER', ruleId: 'P-OUT-OF-DOMAIN', reason: 'an input is outside the documented domain; refused, not clipped', headroomNano: headroom };
  const action = nanoToUsdRat(input.actionNano);
  const head = nanoToUsdRat(headroom);
  const matches = policyRules(config).filter((r) => {
    const w = r.when;
    if (w.kind && !w.kind.includes(input.kind)) return false;
    if (w.capEnforced && !w.capEnforced.includes(input.capEnforced)) return false;
    if (w.actionUsd && !holdsInterval(action, w.actionUsd)) return false;
    if (w.headroomUsd && !holdsInterval(head, w.headroomUsd)) return false;
    return true;
  });
  if (matches.length === 0) return { decision: 'ASK_OWNER', ruleId: 'P-NO-MATCH', reason: 'no rule matched; refused', headroomNano: headroom };
  const top = Math.max(...matches.map((m) => m.priority));
  const winners = matches.filter((m) => m.priority === top);
  const winner = winners[0] as PolicyRule;
  if (new Set(winners.map((w) => w.outcome)).size > 1) return { decision: 'ASK_OWNER', ruleId: 'P-TIE', reason: 'rules tied; refused', headroomNano: headroom };
  return { decision: winner.outcome, ruleId: winner.id, reason: winner.reason, headroomNano: headroom };
}

