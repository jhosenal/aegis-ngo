// The free-credit formulation (AEG-CON-004 rev 0.3): which of a set of charges the Google Cloud welcome credit pays, which the Gemini prepay
// pays, and which reaches the owner's card. The credit terms are data (records/costs/credit-terms.json) with each rule quoted from the
// publisher's page; the routing is a decision table in the restricted rule language of the Aegis table prover, so the test suite can prove
// it complete and unambiguous and cross-check this evaluator against the prover. All arithmetic is whole nano-USD (BigInt).
// Coverage of a service is ASSUMED until a billing report shows the credit applied; the result always says how much rests on that assumption.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { hashWithDomain } from '../engine/canonical.js';

export const DEFAULT_CREDIT_TERMS = fileURLToPath(new URL('../../records/costs/credit-terms.json', import.meta.url));

export const COVERAGE_CLASSES = ['COVERED_OBSERVED', 'COVERED_ASSUMED', 'EXCLUDED_GEMINI_AI_STUDIO', 'EXCLUDED_PARTNER_MODEL', 'NOT_COVERED', 'UNCLASSIFIED'] as const;
export type CoverageClass = (typeof COVERAGE_CLASSES)[number];

export const CreditTermsSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  source: z.object({
    publisher: z.string().min(1), title: z.string().min(1), url: z.string().url().refine((u) => u.startsWith('https://')),
    lastUpdatedByPublisher: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), accessed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    savedFilePrefix: z.string().min(1), savedFileNote: z.string().min(1),
  }).strict(),
  creditValidDays: z.number().int().min(1).max(366),
  rules: z.array(z.object({ id: z.string().regex(/^CT-\d+$/), meaning: z.string().min(1).max(300), quote: z.string().min(10).max(600) }).strict()).min(1),
  coverageClasses: z.record(z.enum(COVERAGE_CLASSES), z.string().min(1)),
  services: z.array(z.object({ service: z.string().min(1).max(80), coverage: z.enum(COVERAGE_CLASSES), basis: z.string().min(1).max(300) }).strict()).min(1),
}).strict();
export type CreditTerms = z.infer<typeof CreditTermsSchema>;

let cached: { file: string; terms: CreditTerms } | null = null;
export function loadCreditTerms(file: string = DEFAULT_CREDIT_TERMS): CreditTerms {
  if (cached && cached.file === file) return cached.terms;
  const terms = CreditTermsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const seen = new Set<string>();
  for (const s of terms.services) { if (seen.has(s.service)) throw new Error(`credit terms: duplicate service ${s.service}`); seen.add(s.service); }
  cached = { file, terms };
  return terms;
}
export const coverageOf = (terms: CreditTerms, service: string): CoverageClass => terms.services.find((s) => s.service === service)?.coverage ?? 'UNCLASSIFIED';

/** Adds days to a YYYY-MM-DD date (UTC). */
export function addDays(date: string, days: number): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The last day the credit may be counted on. Google's page says the credit "expires 90 days from the Free Trial signup"; the console shows
 * an end date that can be a day later. The engine uses the EARLIER of the console date and signup + validDays, so it never relies on a day
 * Google's own rule may already have taken away.
 */
export function creditLastDay(starts: string | undefined, consoleEnd: string | undefined, validDays: number): string | undefined {
  const byRule = starts ? addDays(starts, validDays) : undefined;
  if (byRule && consoleEnd) return byRule < consoleEnd ? byRule : consoleEnd;
  return byRule ?? consoleEnd;
}

// ---------- the routing table ----------
export type Route = 'CREDIT' | 'CREDIT_THEN_CARD' | 'PREPAY' | 'PREPAY_THEN_CARD' | 'CARD' | 'CARD_UNKNOWN_COVERAGE';
export const ROUTES: readonly Route[] = ['CREDIT', 'CREDIT_THEN_CARD', 'PREPAY', 'PREPAY_THEN_CARD', 'CARD', 'CARD_UNKNOWN_COVERAGE'];

export interface RouteInput { coverage: CoverageClass; creditExpired: boolean; creditEnough: boolean; prepayEnough: boolean }
export interface RouteRule {
  id: string; priority: number; outcome: Route; reason: string;
  when: { coverage?: CoverageClass[]; creditExpired?: boolean[]; creditEnough?: boolean[]; prepayEnough?: boolean[] };
}
export const CREDIT_FORMULA_ID = 'AEG.CF.CREDIT-APPLICATION';
export const CREDIT_FORMULA_VERSION = '1.0.0';
export const CREDIT_FORMULA_DEFINITION = 'For each charge in the given order: route by (coverage, creditExpired, creditEnough, prepayEnough). UNCLASSIFIED coverage = card, flagged. PARTNER_MODEL and NOT_COVERED = card. GEMINI_AI_STUDIO = prepay up to the prepay balance, rest card. COVERED_* with the credit expired = card; otherwise credit up to the remaining credit, rest card. Credit and prepay balances are reduced by what each line uses. assumedCredit = credit applied to COVERED_ASSUMED lines.';
export const creditFormulaHash = (): string => hashWithDomain('AEG-COST-v1', { id: CREDIT_FORMULA_ID, version: CREDIT_FORMULA_VERSION, definition: CREDIT_FORMULA_DEFINITION, rules: routeRules() });

const COVERED: CoverageClass[] = ['COVERED_OBSERVED', 'COVERED_ASSUMED'];
export function routeRules(): RouteRule[] {
  return [
    { id: 'R-UNKNOWN', priority: 100, outcome: 'CARD_UNKNOWN_COVERAGE', reason: 'coverage is unknown; never assumed covered', when: { coverage: ['UNCLASSIFIED'] } },
    { id: 'R-CARD', priority: 90, outcome: 'CARD', reason: 'the credit cannot pay for this (partner model, or not a Free Trial product)', when: { coverage: ['EXCLUDED_PARTNER_MODEL', 'NOT_COVERED'] } },
    { id: 'R-PREPAY', priority: 80, outcome: 'PREPAY', reason: 'Gemini API in AI Studio is paid from the Gemini prepay balance', when: { coverage: ['EXCLUDED_GEMINI_AI_STUDIO'], prepayEnough: [true] } },
    { id: 'R-PREPAY-SPLIT', priority: 80, outcome: 'PREPAY_THEN_CARD', reason: 'the Gemini prepay balance runs out; the rest reaches the card', when: { coverage: ['EXCLUDED_GEMINI_AI_STUDIO'], prepayEnough: [false] } },
    { id: 'R-EXPIRED', priority: 70, outcome: 'CARD', reason: 'the credit has expired; everything reaches the card', when: { coverage: COVERED, creditExpired: [true] } },
    { id: 'R-CREDIT', priority: 60, outcome: 'CREDIT', reason: 'a covered service within the remaining credit', when: { coverage: COVERED, creditExpired: [false], creditEnough: [true] } },
    { id: 'R-CREDIT-SPLIT', priority: 60, outcome: 'CREDIT_THEN_CARD', reason: 'the remaining credit runs out; the rest reaches the card', when: { coverage: COVERED, creditExpired: [false], creditEnough: [false] } },
  ];
}

export function routeOf(input: RouteInput): { route: Route; ruleId: string; reason: string } {
  const matches = routeRules().filter((r) => {
    const w = r.when;
    return (!w.coverage || w.coverage.includes(input.coverage)) && (!w.creditExpired || w.creditExpired.includes(input.creditExpired))
      && (!w.creditEnough || w.creditEnough.includes(input.creditEnough)) && (!w.prepayEnough || w.prepayEnough.includes(input.prepayEnough));
  });
  if (matches.length === 0) return { route: 'CARD_UNKNOWN_COVERAGE', ruleId: 'R-NO-MATCH', reason: 'no rule matched; treated as reaching the card' };
  const top = Math.max(...matches.map((m) => m.priority));
  const winners = matches.filter((m) => m.priority === top);
  if (new Set(winners.map((w) => w.outcome)).size > 1) return { route: 'CARD_UNKNOWN_COVERAGE', ruleId: 'R-TIE', reason: 'rules tied; treated as reaching the card' };
  const w = winners[0] as RouteRule;
  return { route: w.outcome, ruleId: w.id, reason: w.reason };
}

// ---------- application ----------
export interface Charge { service: string; grossNano: bigint; coverage?: CoverageClass }
export interface ApplicationInput { charges: Charge[]; creditRemainingNano: bigint; prepayRemainingNano: bigint; onDate: string; creditLastDay?: string }
export interface AppliedLine { service: string; coverage: CoverageClass; grossNano: bigint; creditNano: bigint; prepayNano: bigint; cardNano: bigint; route: Route; ruleId: string }
export interface Application {
  creditExpired: boolean; lines: AppliedLine[];
  creditNano: bigint; prepayNano: bigint; cardNano: bigint; grossNano: bigint;
  /** Credit applied only because coverage is assumed: this is what reaches the card if Google does not cover those services. */
  assumedCreditNano: bigint;
  /** Charges whose coverage is UNCLASSIFIED (counted as card). */
  unknownCoverageNano: bigint;
  creditLeftNano: bigint; prepayLeftNano: bigint;
}

const minB = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export function applyCredit(input: ApplicationInput, terms: CreditTerms = loadCreditTerms()): Application {
  if (input.creditRemainingNano < 0n || input.prepayRemainingNano < 0n) throw new Error('remaining balances cannot be negative');
  const creditExpired = input.creditLastDay !== undefined && input.onDate > input.creditLastDay;
  let credit = creditExpired ? 0n : input.creditRemainingNano;
  let prepay = input.prepayRemainingNano;
  const lines: AppliedLine[] = [];
  let creditTotal = 0n; let prepayTotal = 0n; let cardTotal = 0n; let gross = 0n; let assumed = 0n; let unknown = 0n;
  for (const c of input.charges) {
    if (c.grossNano < 0n) throw new Error(`charge for ${c.service} is negative`);
    const coverage = c.coverage ?? coverageOf(terms, c.service);
    const { route, ruleId } = routeOf({ coverage, creditExpired, creditEnough: credit >= c.grossNano, prepayEnough: prepay >= c.grossNano });
    let useCredit = 0n; let usePrepay = 0n;
    if (route === 'CREDIT') useCredit = c.grossNano;
    else if (route === 'CREDIT_THEN_CARD') useCredit = minB(credit, c.grossNano);
    else if (route === 'PREPAY') usePrepay = c.grossNano;
    else if (route === 'PREPAY_THEN_CARD') usePrepay = minB(prepay, c.grossNano);
    const card = c.grossNano - useCredit - usePrepay;
    credit -= useCredit; prepay -= usePrepay;
    creditTotal += useCredit; prepayTotal += usePrepay; cardTotal += card; gross += c.grossNano;
    if (coverage === 'COVERED_ASSUMED') assumed += useCredit;
    if (coverage === 'UNCLASSIFIED') unknown += c.grossNano;
    lines.push({ service: c.service, coverage, grossNano: c.grossNano, creditNano: useCredit, prepayNano: usePrepay, cardNano: card, route, ruleId });
  }
  return { creditExpired, lines, creditNano: creditTotal, prepayNano: prepayTotal, cardNano: cardTotal, grossNano: gross, assumedCreditNano: assumed, unknownCoverageNano: unknown, creditLeftNano: credit, prepayLeftNano: prepay };
}
