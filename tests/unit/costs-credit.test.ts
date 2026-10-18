import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, applyCredit, COVERAGE_CLASSES, coverageOf, creditFormulaHash, creditLastDay, loadCreditTerms, routeOf, routeRules, ROUTES, type CoverageClass } from '../../src/costs/credit.js';
import { fundingBalanceNano, gate, recordActual, status, type Budget } from '../../src/costs/engine.js';
import { FORMULAS } from '../../src/costs/formulas.js';
import { ceilNano, usdToNano } from '../../src/costs/money.js';
import { loadPriceBook } from '../../src/costs/pricebook.js';
import { evaluate, oneOf, prove, type Field, type Table } from '../../research/engineer/decisiontable.js';

const terms = loadCreditTerms();
const nano = (usd: string): bigint => ceilNano(usdToNano(usd));
const charge = (service: string, usd: string) => ({ service, grossNano: nano(usd) });
const base = { creditRemainingNano: nano('300'), prepayRemainingNano: nano('5'), onDate: '2026-10-14', creditLastDay: '2026-12-16' };

describe('the credit terms are Google\'s words, checked against the saved page', () => {
  const inboxDir = join(process.cwd(), 'docs', '99-inbox');
  const savedCopy = readdirSync(inboxDir).find((f) => f.startsWith(terms.source.savedFilePrefix) && f.endsWith('.html'));
  // The owner's saved copy may be absent from a checkout (it is an owner-supplied file); then this test skips, and it fails if the copy is present and a quote is missing.
  it.skipIf(savedCopy === undefined)('every rule quote is found in the saved copy of Google\'s page (skipped if the owner\'s saved copy is not in this checkout)', () => {
    const inbox = inboxDir;
    const file = savedCopy;
    const squash = (t: string): string => t.replace(/&#39;|&apos;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/[’]/g, "'")
      .replace(/\s+/g, ' ').replace(/ ([,.;:)])/g, '$1').replace(/\( /g, '(').trim();
    const page = squash(readFileSync(join(inbox, file as string), 'utf8').replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
    const missing = terms.rules.filter((r) => !page.includes(squash(r.quote))).map((r) => r.id);
    expect(missing).toEqual([]);
    expect(terms.rules.length).toBeGreaterThanOrEqual(8);
  });

  it('every coverage class is described and every service names a described class', () => {
    for (const c of COVERAGE_CLASSES) expect(terms.coverageClasses[c], c).toBeTruthy();
    for (const s of terms.services) expect(COVERAGE_CLASSES).toContain(s.coverage);
  });
});

describe('every cost formula agrees with the credit terms about who pays', () => {
  it('names a service that the credit terms know, and its funding matches that service\'s coverage', () => {
    const expectedFunding = (c: CoverageClass): string => (c === 'COVERED_OBSERVED' || c === 'COVERED_ASSUMED' ? 'GCP_CREDIT' : c === 'EXCLUDED_GEMINI_AI_STUDIO' ? 'GEMINI_PREPAY' : 'OTHER');
    for (const f of FORMULAS) {
      expect(terms.services.map((s) => s.service), `${f.id} service`).toContain(f.service);
      expect(f.funding, `${f.id} funding for ${f.service}`).toBe(expectedFunding(coverageOf(terms, f.service)));
    }
  });

  it('an unlisted service is UNCLASSIFIED coverage, never assumed covered', () => {
    expect(coverageOf(terms, 'Some New Service')).toBe('UNCLASSIFIED');
  });
});

describe('the 90-day rule', () => {
  it('signup + 90 days is 2026-12-16 for a 2026-09-17 start, and the engine uses the earlier of that and the console date', () => {
    expect(addDays('2026-09-17', 90)).toBe('2026-12-16');
    expect(creditLastDay('2026-09-17', '2026-12-17', 90)).toBe('2026-12-16');
    expect(creditLastDay('2026-09-17', '2026-12-10', 90)).toBe('2026-12-10');
    expect(creditLastDay(undefined, '2026-12-17', 90)).toBe('2026-12-17');
    expect(creditLastDay('2026-09-17', undefined, 90)).toBe('2026-12-16');
    expect(creditLastDay(undefined, undefined, 90)).toBeUndefined();
  });

  it('the credit balance counts on 2026-12-16 and is 0 on 2026-12-17 for the shipped budget', () => {
    const budget = JSON.parse(readFileSync(join(process.cwd(), 'records', 'costs', 'budget.json'), 'utf8')) as Budget;
    expect(fundingBalanceNano(budget, 'GCP_CREDIT', '2026-12-16')).toBe(nano('300'));
    expect(fundingBalanceNano(budget, 'GCP_CREDIT', '2026-12-17')).toBe(0n);
    expect(fundingBalanceNano(budget, 'GEMINI_PREPAY', '2026-12-17')).toBe(nano('5'));   // the prepay has its own, later expiry
  });
});

describe('applying the credit to charges', () => {
  it('a covered charge within the credit is paid by the credit; assumed coverage is reported', () => {
    const r = applyCredit({ ...base, charges: [charge('Cloud Run', '0.011')] }, terms);
    expect(r).toMatchObject({ creditNano: nano('0.011'), cardNano: 0n, prepayNano: 0n, assumedCreditNano: nano('0.011') });
    expect(r.lines[0]).toMatchObject({ route: 'CREDIT', ruleId: 'R-CREDIT' });
  });

  it('when the remaining credit runs out, the rest reaches the card', () => {
    const r = applyCredit({ ...base, creditRemainingNano: nano('0.004'), charges: [charge('Cloud Run', '0.010')] }, terms);
    expect(r).toMatchObject({ creditNano: nano('0.004'), cardNano: nano('0.006') });
    expect(r.lines[0]?.route).toBe('CREDIT_THEN_CARD');
  });

  it('Gemini API in AI Studio is never paid by the credit, only by the prepay, then the card', () => {
    const within = applyCredit({ ...base, charges: [charge('Gemini API (AI Studio)', '2')] }, terms);
    expect(within).toMatchObject({ creditNano: 0n, prepayNano: nano('2'), cardNano: 0n });
    const beyond = applyCredit({ ...base, prepayRemainingNano: nano('1'), charges: [charge('Gemini API (AI Studio)', '2.50')] }, terms);
    expect(beyond).toMatchObject({ creditNano: 0n, prepayNano: nano('1'), cardNano: nano('1.50') });
    expect(beyond.lines[0]?.route).toBe('PREPAY_THEN_CARD');
  });

  it('a partner model or a non-Google product goes entirely to the card, and unclassified coverage is counted as card and flagged', () => {
    const r = applyCredit({ ...base, charges: [charge('Third-party model API (reAPI)', '0.10'), charge('Mystery', '0.05')] }, terms);
    expect(r).toMatchObject({ creditNano: 0n, prepayNano: 0n, cardNano: nano('0.15'), unknownCoverageNano: nano('0.05') });
    expect(applyCredit({ ...base, charges: [{ service: 'X', grossNano: nano('1'), coverage: 'EXCLUDED_PARTNER_MODEL' }] }, terms).cardNano).toBe(nano('1'));
  });

  it('after the credit has expired everything reaches the card, even a covered service', () => {
    const r = applyCredit({ ...base, onDate: '2026-12-17', charges: [charge('Cloud Run', '1')] }, terms);
    expect(r).toMatchObject({ creditExpired: true, creditNano: 0n, cardNano: nano('1') });
    expect(r.lines[0]?.ruleId).toBe('R-EXPIRED');
    expect(applyCredit({ ...base, onDate: '2026-12-16', charges: [charge('Cloud Run', '1')] }, terms).creditExpired).toBe(false);
  });

  it('charges are applied in the order given: the earlier one uses the credit first', () => {
    const input = { ...base, creditRemainingNano: nano('1') };
    const first = applyCredit({ ...input, charges: [charge('Cloud Run', '0.8'), charge('Cloud Build', '0.8')] }, terms);
    expect(first.lines.map((l) => [l.creditNano, l.cardNano])).toEqual([[nano('0.8'), 0n], [nano('0.2'), nano('0.6')]]);
  });

  it('observed coverage is not counted as an assumption', () => {
    const r = applyCredit({ ...base, charges: [{ service: 'Cloud Run', grossNano: nano('1'), coverage: 'COVERED_OBSERVED' }] }, terms);
    expect(r).toMatchObject({ creditNano: nano('1'), assumedCreditNano: 0n });
  });

  it('always conserves money: credit + prepay + card = gross, balances never go negative, nothing is created', () => {
    const services = ['Cloud Run', 'Cloud Build', 'Gemini API (AI Studio)', 'Third-party model API (reAPI)', 'Mystery'];
    let seed = 12345;
    const rand = (max: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % max; };
    for (let run = 0; run < 300; run += 1) {
      const charges = Array.from({ length: 1 + rand(6) }, () => ({ service: services[rand(services.length)] as string, grossNano: BigInt(rand(2_000_000_000)) }));
      const input = { charges, creditRemainingNano: BigInt(rand(3_000_000_000)), prepayRemainingNano: BigInt(rand(3_000_000_000)), onDate: rand(2) ? '2026-10-14' : '2026-12-20', creditLastDay: '2026-12-16' };
      const r = applyCredit(input, terms);
      expect(r.creditNano + r.prepayNano + r.cardNano).toBe(r.grossNano);
      expect(r.creditLeftNano).toBe((r.creditExpired ? 0n : input.creditRemainingNano) - r.creditNano);
      expect(r.prepayLeftNano).toBe(input.prepayRemainingNano - r.prepayNano);
      expect(r.creditLeftNano >= 0n && r.prepayLeftNano >= 0n).toBe(true);
      for (const l of r.lines) { expect(l.creditNano >= 0n && l.prepayNano >= 0n && l.cardNano >= 0n).toBe(true); expect(l.creditNano + l.prepayNano + l.cardNano).toBe(l.grossNano); }
      const creditToGemini = r.lines.filter((l) => l.coverage === 'EXCLUDED_GEMINI_AI_STUDIO').reduce((s, l) => s + l.creditNano, 0n);
      expect(creditToGemini).toBe(0n);   // the credit never pays for Gemini API in AI Studio
      if (r.creditExpired) expect(r.creditNano).toBe(0n);
    }
  });

  it('refuses negative inputs instead of clipping them', () => {
    expect(() => applyCredit({ ...base, creditRemainingNano: -1n, charges: [] }, terms)).toThrow(/negative/);
    expect(() => applyCredit({ ...base, charges: [{ service: 'Cloud Run', grossNano: -1n }] }, terms)).toThrow(/negative/);
  });
});

/** The routing rules as a table for the exhaustive prover (enum fields only). */
function routeTable(): Table {
  const fields: Field[] = [
    { name: 'coverage', type: 'enum', values: [...COVERAGE_CLASSES] },
    { name: 'creditExpired', type: 'enum', values: ['false', 'true'] },
    { name: 'creditEnough', type: 'enum', values: ['false', 'true'] },
    { name: 'prepayEnough', type: 'enum', values: ['false', 'true'] },
  ];
  const rules: Table['rules'] = routeRules().map((r) => ({
    id: r.id, priority: r.priority, outcome: r.outcome,
    when: [
      ...(r.when.coverage ? [oneOf('coverage', ...r.when.coverage)] : []),
      ...(r.when.creditExpired ? [oneOf('creditExpired', ...r.when.creditExpired.map(String))] : []),
      ...(r.when.creditEnough ? [oneOf('creditEnough', ...r.when.creditEnough.map(String))] : []),
      ...(r.when.prepayEnough ? [oneOf('prepayEnough', ...r.when.prepayEnough.map(String))] : []),
    ],
  }));
  return { id: 'CREDIT-ROUTE', fields, rules, defaultOutcome: null };
}

describe('the routing table is proved, not just tested', () => {
  it('the exhaustive prover accepts it: every combination has exactly one outcome and no gap', () => {
    const analysis = prove(routeTable());
    expect(analysis.validationErrors).toEqual([]);
    expect(analysis.analysisComplete).toBe(true);
    expect(analysis.gaps).toEqual([]);
    expect(analysis.ambiguities).toEqual([]);
    expect(analysis.status).toBe('ACCEPTED');
    expect(analysis.cells).toBe(COVERAGE_CLASSES.length * 8);
  });

  it('the engine evaluator and the prover agree on all 48 combinations, and only produce declared routes', () => {
    const table = routeTable();
    let compared = 0;
    for (const coverage of COVERAGE_CLASSES) for (const creditExpired of [false, true]) for (const creditEnough of [false, true]) for (const prepayEnough of [false, true]) {
      const engine = routeOf({ coverage, creditExpired, creditEnough, prepayEnough });
      const proved = evaluate(table, { coverage, creditExpired: String(creditExpired), creditEnough: String(creditEnough), prepayEnough: String(prepayEnough) });
      expect(proved.outcome, `${coverage} expired=${creditExpired} credit=${creditEnough} prepay=${prepayEnough}`).toBe(engine.route);
      expect(ROUTES).toContain(engine.route);
      compared += 1;
    }
    expect(compared).toBe(48);
  });

  it('a table with a deliberate gap would be rejected by the same prover (the proof is not vacuous)', () => {
    const table = routeTable();
    table.rules = table.rules.filter((r) => r.id !== 'R-EXPIRED');
    const analysis = prove(table);
    expect(analysis.status).toBe('REJECTED_COVERAGE');
    expect(analysis.gaps.length).toBeGreaterThan(0);
  });

  it('the formulation has a stable hash that changes with the rules', () => {
    expect(creditFormulaHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(creditFormulaHash()).toBe(creditFormulaHash());
  });
});

describe('the engine reports how much spend rests on the credit assumption', () => {
  let file = '';
  let tick = 0;
  const now = () => `2026-10-14T00:00:${String(tick++ % 60).padStart(2, '0')}Z`;
  const book = loadPriceBook();
  const budget: Budget = { period: '2026-10', monthlyBudgetUsd: '3.00', autoApproveUsd: '0.50', capEnforced: false, funding: { GCP_CREDIT: { balanceUsd: '300.00', starts: '2026-09-17', expires: '2026-12-17' }, GEMINI_PREPAY: { balanceUsd: '5.00', expires: '2027-09-17' }, OTHER: { balanceUsd: '0.00' } } };
  beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'credit-')), 'ledger.jsonl'); tick = 0; });
  const deps = { book, budget, get ledgerFile() { return file; }, now };

  it('a gated credit-funded action counts as assumed until a billing report confirms the credit', () => {
    const g = gate({ actionId: 'A1', agent: 'ops', purpose: 'test', lines: [{ formula: 'AEG.F.GCP-SCAN/1.0.0', args: { scans: '1' } }] }, deps);
    expect(status(deps).creditAssumedNano).toBe(g.estimate.nano);
    recordActual({ refSeq: g.entry.seq, service: 'Artifact Analysis scanning', usd: '0.26', source: 'console-report', period: '2026-10', note: '', funding: 'GCP_CREDIT', creditUsd: '0.26' }, deps);
    expect(status(deps).creditAssumedNano).toBe(0n);
  });

  it('a charge the credit did not cover is not confirmed: it stays assumed and shows as card exposure', () => {
    const g = gate({ actionId: 'A1', agent: 'ops', purpose: 'test', lines: [{ formula: 'AEG.F.GCP-SCAN/1.0.0', args: { scans: '1' } }] }, deps);
    recordActual({ refSeq: g.entry.seq, service: 'Artifact Analysis scanning', usd: '0.26', source: 'console-report', period: '2026-10', note: '', funding: 'GCP_CREDIT', creditUsd: '0.00' }, deps);
    const s = status(deps);
    expect(s.creditAssumedNano).toBe(g.estimate.nano);
    expect(s.cardExposureNano).toBe(nano('0.26'));
  });

  it('a Gemini-funded action never counts toward the credit assumption', () => {
    gate({ actionId: 'G1', agent: 'ops', purpose: 'test', lines: [{ formula: 'AEG.F.GEMINI-API-CALL/1.0.0', args: { model: 'gemini-3.5-flash-lite', inputTokens: '1000', outputTokens: '1000', onDate: '2026-10-14' } }] }, deps);
    expect(status(deps).creditAssumedNano).toBe(0n);
  });

  it('the shipped terms file exists next to the price book', () => {
    expect(existsSync(join(process.cwd(), 'records', 'costs', 'credit-terms.json'))).toBe(true);
  });
});
