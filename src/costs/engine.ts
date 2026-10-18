// The cost-control gate and its bookkeeping (AEG-CON-004, AEG-SOP-002). Agents propose an action with formula lines; the engine estimates it
// from the price book, applies the decision table to the TIGHTEST remaining balance (the monthly budget and every funding source the
// action draws on), and records everything in the ledger. Nothing here spends money or calls a cloud API: the owner or the operations
// agent acts only after reading the decision.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { creditLastDay, loadCreditTerms } from './credit.js';
import { estimateAction, FUNDINGS, type ActionEstimate, type ActionLine, type Funding } from './formulas.js';
import { appendEntry, committed, DEFAULT_LEDGER, LedgerError, readLedger, reversedSeqs, type LedgerEntry } from './ledger.js';
import { ceilNano, formatUsd, usdToNano } from './money.js';
import { decide, POLICY_VERSION, type Decision, type PolicyResult } from './policy.js';
import { loadPriceBook, type PriceBook } from './pricebook.js';

export const DEFAULT_BUDGET = fileURLToPath(new URL('../../records/costs/budget.json', import.meta.url));

const usdText = z.string().regex(/^(0|[1-9]\d{0,9})(\.\d{1,9})?$/);
const FundingBalance = z.object({
  /** Balance the owner states is available from this source for this engine (read from the console), in USD. */
  balanceUsd: usdText,
  /** After this date (YYYY-MM-DD) the source counts as 0. */
  expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** The credit's start date as the console shows it. For GCP_CREDIT the engine also applies Google's own 90-day rule (credit-terms.json) and uses the earlier end date. */
  starts: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(900).optional(),
}).strict();

export const BudgetSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  monthlyBudgetUsd: usdText,
  autoApproveUsd: usdText,
  /** Set by the owner after reading the console: true while a spend cap is enforced for a service this engine covers. */
  capEnforced: z.boolean(),
  /** Balances per funding source. A source with no entry has a balance of 0, so spending from it is STOP until the owner funds it. */
  funding: z.object({ GCP_CREDIT: FundingBalance.optional(), GEMINI_PREPAY: FundingBalance.optional(), OTHER: FundingBalance.optional() }).strict().optional(),
  note: z.string().max(600).optional(),
  /** Changes made to the two limits from the Admin Desk (newest last): who, when, from, to and why. */
  changes: z.array(z.object({ at: z.string(), by: z.string(), field: z.enum(['monthlyBudgetUsd', 'autoApproveUsd']), from: z.string(), to: z.string(), reason: z.string() }).strict()).max(50).optional(),
}).strict();
export type Budget = z.infer<typeof BudgetSchema>;
export const loadBudget = (file: string = DEFAULT_BUDGET): Budget => BudgetSchema.parse(JSON.parse(readFileSync(file, 'utf8')));

/** Reconciliation tolerance: flagged when the actual differs from the estimate by more than the larger of 0.05 USD and 25 percent of the estimate. */
export const TOLERANCE = { absoluteUsd: '0.05', percentOfEstimate: 25 };

export interface EngineDeps { book?: PriceBook; budget?: Budget; ledgerFile?: string; now?: () => string }
const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const budgetNano = (b: Budget): bigint => ceilNano(usdToNano(b.monthlyBudgetUsd));

/** Balance of a funding source on a date (YYYY-MM-DD): 0 when it is not configured or has expired. */
export function fundingBalanceNano(budget: Budget, funding: Funding, onDate: string): bigint {
  const f = budget.funding?.[funding];
  if (!f) return 0n;
  const lastDay = funding === 'GCP_CREDIT' ? creditLastDay(f.starts, f.expires, loadCreditTerms().creditValidDays) : f.expires;
  if (lastDay !== undefined && onDate > lastDay) return 0n;
  return ceilNano(usdToNano(f.balanceUsd));
}

export interface GateRequest { actionId: string; agent: string; purpose: string; lines: ActionLine[] }
export interface GateResult {
  decision: Decision; exitCode: number; policy: PolicyResult; estimate: ActionEstimate; entry: LedgerEntry;
  committedNano: bigint; remainingNano: bigint; unknownCommitted: number; limitedBy: string | null;
  funding: { source: Funding; actionNano: bigint; remainingNano: bigint }[];
}
export const EXIT = { GO: 0, ASK_OWNER: 10, STOP: 11 } as const;

/** Estimates and decides, then records the estimate and the decision in the ledger. Does not execute anything. */
export function gate(request: GateRequest, deps: EngineDeps = {}): GateResult {
  const book = deps.book ?? loadPriceBook();
  const budget = deps.budget ?? loadBudget();
  const file = deps.ledgerFile ?? DEFAULT_LEDGER;
  const now = deps.now ?? nowIso;
  const entries = readLedger(file);
  const estimate = estimateAction(request.lines, book);
  const spent = committed(entries, budget.period);
  const today = now().slice(0, 10);
  const action = estimate.nano ?? 0n;
  const overallRemaining = budgetNano(budget) - spent.nano;

  // The tightest limit decides: the monthly budget, and every funding source this action draws on.
  let tightestHeadroom = overallRemaining - action;
  let limitedBy: string | null = null;
  const funding: GateResult['funding'] = [];
  for (const source of FUNDINGS) {
    const part = estimate.byFunding[source];
    if (part <= 0n) continue;
    const remaining = fundingBalanceNano(budget, source, today) - (spent.byFunding[source] ?? 0n);
    funding.push({ source, actionNano: part, remainingNano: remaining });
    const headroom = remaining - part;
    if (headroom < tightestHeadroom) { tightestHeadroom = headroom; limitedBy = source; }
  }
  const policy = decide({ kind: estimate.status === 'ESTIMATE' ? 'ESTIMATE' : 'UNPRICED', capEnforced: budget.capEnforced, actionNano: action, remainingNano: tightestHeadroom + action }, { autoApproveUsd: budget.autoApproveUsd });
  const reason = policy.ruleId === 'P-OVER-BUDGET' && limitedBy ? `${policy.reason} (the tightest limit is the ${limitedBy} balance)` : policy.reason;
  const stored = appendEntry({
    type: 'ESTIMATE', actionId: request.actionId, agent: request.agent, purpose: request.purpose, lines: request.lines.map((l) => ({ formula: l.formula, args: l.args })),
    status: estimate.status, estimateNano: estimate.nano === null ? null : estimate.nano.toString(),
    byFunding: Object.fromEntries(FUNDINGS.map((f) => [f, estimate.byFunding[f].toString()])), ...(limitedBy ? { limitedBy } : {}),
    priceBasis: estimate.priceBasis, missing: estimate.missing,
    decision: { decision: policy.decision, ruleId: policy.ruleId, reason },
    remainingNano: overallRemaining.toString(), headroomNano: policy.headroomNano.toString(),
    priceBookHash: book.hash, policyVersion: POLICY_VERSION, autoApproveUsd: budget.autoApproveUsd,
  }, now, file);
  return { decision: policy.decision, exitCode: EXIT[policy.decision], policy: { ...policy, reason }, estimate, entry: stored, committedNano: spent.nano, remainingNano: overallRemaining, unknownCommitted: spent.unknownCount, limitedBy, funding };
}

/** The owner's approval of an estimate that asked for it. A STOP can never be approved: it needs a new gate run after the cause is lifted. */
export function approve(refSeq: number, by: string, note: string, deps: EngineDeps = {}): LedgerEntry {
  const file = deps.ledgerFile ?? DEFAULT_LEDGER;
  const target = readLedger(file).find((e) => e.seq === refSeq);
  if (!target || target.type !== 'ESTIMATE') throw new LedgerError('NO_SUCH_ESTIMATE', `entry ${refSeq} is not an estimate`);
  if (target.decision.decision !== 'ASK_OWNER') throw new LedgerError('NOT_APPROVABLE', `entry ${refSeq} has decision ${target.decision.decision}; only ASK_OWNER is approved this way`);
  const dup = readLedger(file).some((e) => e.type === 'APPROVAL' && e.refSeq === refSeq);
  if (dup) throw new LedgerError('ALREADY_APPROVED', `entry ${refSeq} already has an approval`);
  return appendEntry({ type: 'APPROVAL', refSeq, by, note }, deps.now ?? nowIso, file);
}

export interface ActualInput {
  refSeq: number | null; service: string; usd: string; source: 'console-report' | 'csv-export' | 'manual'; period: string; note: string;
  /** Which balance paid for it. Defaults to GCP_CREDIT. */
  funding?: Funding;
  /** The credits the billing report shows applied to this charge (the "Credits" column), when known. */
  creditUsd?: string;
}
export interface Variance { varianceNano: bigint; flagged: boolean; reason: string }

export function variance(estimateNano: bigint, actualNano: bigint): Variance {
  const diff = actualNano - estimateNano;
  const abs = diff < 0n ? -diff : diff;
  const absLimit = ceilNano(usdToNano(TOLERANCE.absoluteUsd));
  const pctLimit = (estimateNano * BigInt(TOLERANCE.percentOfEstimate)) / 100n;
  const limit = absLimit > pctLimit ? absLimit : pctLimit;
  const flagged = abs > limit;
  return { varianceNano: diff, flagged, reason: flagged ? `actual differs from the estimate by more than ${formatUsd(limit)} USD (larger of ${TOLERANCE.absoluteUsd} USD and ${TOLERANCE.percentOfEstimate} percent)` : 'within tolerance' };
}

/** Records an actual cost and, when it belongs to an estimate, the reconciliation against it. A charge the credit did not fully cover is flagged as card exposure. */
export function recordActual(input: ActualInput, deps: EngineDeps = {}): { actual: LedgerEntry; reconciliation: LedgerEntry | null } {
  const file = deps.ledgerFile ?? DEFAULT_LEDGER;
  const now = deps.now ?? nowIso;
  const funding: Funding = input.funding ?? 'GCP_CREDIT';
  const actualNano = ceilNano(usdToNano(input.usd));
  const creditNano = input.creditUsd === undefined ? null : ceilNano(usdToNano(input.creditUsd));
  if (input.refSeq !== null) {
    const target = readLedger(file).find((e) => e.seq === input.refSeq);
    if (!target || target.type !== 'ESTIMATE') throw new LedgerError('NO_SUCH_ESTIMATE', `entry ${input.refSeq} is not an estimate`);
  }
  const actual = appendEntry({ type: 'ACTUAL', refSeq: input.refSeq, service: input.service, actualNano: actualNano.toString(), funding, ...(creditNano !== null ? { creditAppliedNano: creditNano.toString() } : {}), source: input.source, period: input.period, note: input.note }, now, file);
  if (input.refSeq === null) return { actual, reconciliation: null };
  const estimate = readLedger(file).find((e) => e.seq === input.refSeq) as Extract<LedgerEntry, { type: 'ESTIMATE' }>;
  const cardExposure = funding === 'GCP_CREDIT' && creditNano !== null && creditNano < actualNano ? actualNano - creditNano : 0n;
  const exposureText = cardExposure > 0n ? `; CARD EXPOSURE: the credit covered ${formatUsd(creditNano as bigint)} of ${formatUsd(actualNano)} USD, so ${formatUsd(cardExposure)} USD reaches the payment method` : '';
  if (estimate.estimateNano === null) {
    const r = appendEntry({ type: 'RECONCILIATION', refSeq: input.refSeq, actualSeq: actual.seq, estimateNano: '0', actualNano: actualNano.toString(), varianceNano: actualNano.toString(), flagged: true, reason: `the estimate was UNKNOWN, so there is nothing to compare: record what was missing and add it to the price book${exposureText}` }, now, file);
    return { actual, reconciliation: r };
  }
  const v = variance(BigInt(estimate.estimateNano), actualNano);
  const r = appendEntry({ type: 'RECONCILIATION', refSeq: input.refSeq, actualSeq: actual.seq, estimateNano: estimate.estimateNano, actualNano: actualNano.toString(), varianceNano: v.varianceNano.toString(), flagged: v.flagged || cardExposure > 0n, reason: `${v.reason}${exposureText}` }, now, file);
  return { actual, reconciliation: r };
}

/** Cancels a recorded ACTUAL that was wrong, with a reason; the ACTUAL stays in the chain but stops counting. Only an ACTUAL that is not already reversed can be reversed. */
export function reverseActual(input: { seq: number; by: string; reason: string }, deps: EngineDeps = {}): LedgerEntry {
  const file = deps.ledgerFile ?? DEFAULT_LEDGER; const now = deps.now ?? nowIso;
  const entries = readLedger(file);
  const target = entries.find((e) => e.seq === input.seq);
  if (!target || target.type !== 'ACTUAL') throw new LedgerError('NO_SUCH_ACTUAL', `entry ${input.seq} is not an actual`);
  if (reversedSeqs(entries).has(input.seq)) throw new LedgerError('ALREADY_REVERSED', `entry ${input.seq} was already reversed`);
  return appendEntry({ type: 'REVERSAL', refSeq: input.seq, by: input.by, reason: input.reason }, now, file);
}

export interface Status {
  period: string; budgetNano: bigint; committedNano: bigint; remainingNano: bigint; unknownCommitted: number;
  funding: { source: Funding; balanceNano: bigint; committedNano: bigint; remainingNano: bigint }[];
  /** Charges recorded with no estimate (nothing was gated for them) and their total: spend nobody asked about. */
  unexplained: { count: number; nano: bigint };
  /** Part of recorded charges that credits did not cover (only known where the credit column was entered). */
  cardExposureNano: bigint;
  /** Committed credit-funded spend that no billing report has yet confirmed was paid by the credit: it reaches the card if the coverage assumption is wrong. */
  creditAssumedNano: bigint;
  open: { seq: number; actionId: string; decision: Decision; approved: boolean; hasActual: boolean }[]; flagged: number[];
}

export function status(deps: EngineDeps = {}): Status {
  const budget = deps.budget ?? loadBudget();
  const entries = readLedger(deps.ledgerFile ?? DEFAULT_LEDGER);
  const spent = committed(entries, budget.period);
  const today = (deps.now ?? nowIso)().slice(0, 10);
  const approvals = new Set(entries.filter((e) => e.type === 'APPROVAL').map((e) => (e as Extract<LedgerEntry, { type: 'APPROVAL' }>).refSeq));
  const reversed = reversedSeqs(entries);
  const actuals = entries.filter((e): e is Extract<LedgerEntry, { type: 'ACTUAL' }> => e.type === 'ACTUAL' && e.period === budget.period && !reversed.has(e.seq));
  const withActual = new Set(actuals.filter((e) => e.refSeq !== null).map((e) => e.refSeq as number));
  const open = entries.filter((e): e is Extract<LedgerEntry, { type: 'ESTIMATE' }> => e.type === 'ESTIMATE' && e.ts.startsWith(budget.period))
    .map((e) => ({ seq: e.seq, actionId: e.actionId, decision: e.decision.decision, approved: approvals.has(e.seq), hasActual: withActual.has(e.seq) }));
  const flagged = entries.filter((e): e is Extract<LedgerEntry, { type: 'RECONCILIATION' }> => e.type === 'RECONCILIATION' && e.flagged).map((e) => e.refSeq);
  const orphans = actuals.filter((e) => e.refSeq === null);
  let exposure = 0n;
  for (const a of actuals) if (a.funding === 'GCP_CREDIT' && a.creditAppliedNano !== undefined && BigInt(a.creditAppliedNano) < BigInt(a.actualNano)) exposure += BigInt(a.actualNano) - BigInt(a.creditAppliedNano);
  const estimates = entries.filter((e): e is Extract<LedgerEntry, { type: 'ESTIMATE' }> => e.type === 'ESTIMATE' && e.ts.startsWith(budget.period) && e.decision.decision !== 'STOP');
  let assumed = 0n;
  for (const est of estimates) {
    const part = BigInt(est.byFunding?.GCP_CREDIT ?? '0');
    if (part === 0n) continue;
    const confirmed = actuals.some((a) => a.refSeq === est.seq && a.funding === 'GCP_CREDIT' && a.creditAppliedNano !== undefined && BigInt(a.creditAppliedNano) >= BigInt(a.actualNano));
    if (!confirmed) assumed += part;
  }
  return {
    period: budget.period, budgetNano: budgetNano(budget), committedNano: spent.nano, remainingNano: budgetNano(budget) - spent.nano, unknownCommitted: spent.unknownCount,
    funding: FUNDINGS.map((source) => { const balance = fundingBalanceNano(budget, source, today); const used = spent.byFunding[source] ?? 0n; return { source, balanceNano: balance, committedNano: used, remainingNano: balance - used }; }),
    unexplained: { count: orphans.length, nano: orphans.reduce((sum, e) => sum + BigInt(e.actualNano), 0n) },
    cardExposureNano: exposure, creditAssumedNano: assumed, open, flagged,
  };
}
