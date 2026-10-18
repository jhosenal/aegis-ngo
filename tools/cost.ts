// Command line for the cost-control engine (AEG-CON-004, AEG-SOP-002). It estimates, decides and records; it never spends money or calls a
// cloud API. Exit codes of `gate`: 0 GO, 10 ASK_OWNER, 11 STOP, 2 usage or data error.
//   npm run cost -- gate   --action ID --agent NAME --purpose "text" --lines '[{"formula":"AEG.F.GCP-SCAN/1.0.0","args":{"scans":"2"}}]'
//   npm run cost -- approve --seq N --by NAME --note "text"
//   npm run cost -- actual  --usd 0.012 --service cloud-run --period 2026-10 [--seq N] [--funding GCP_CREDIT|GEMINI_PREPAY|OTHER] [--credit-usd 0.012] [--source console-report|csv-export|manual] [--note "text"]
//   npm run cost -- reverse --seq N --by NAME --reason "why (at least 10 characters)"   (cancels a wrong ACTUAL with a new entry; the ledger is never edited)
//   npm run cost -- credit --charges '[{"service":"Cloud Run","usd":"0.011"}]' [--on 2026-10-20]   (where would these charges land: credit, Gemini prepay or card)
//   npm run cost -- status | verify | formulas
// Options for tests and drills: --ledger FILE --budget FILE --price-book FILE
import { applyCredit, COVERAGE_CLASSES, creditFormulaHash, creditLastDay, loadCreditTerms, type CoverageClass } from '../src/costs/credit.js';
import { FORMULAS, formulaHash, formulaKey } from '../src/costs/formulas.js';
import { approve, EXIT, fundingBalanceNano, gate, loadBudget, recordActual, reverseActual, status } from '../src/costs/engine.js';
import { LedgerError, readLedger } from '../src/costs/ledger.js';
import { ceilNano, formatUsd, MoneyError, usdToNano } from '../src/costs/money.js';
import { loadPriceBook } from '../src/costs/pricebook.js';

function parse(argv: string[]): { cmd: string; opts: Record<string, string> } {
  const [cmd = '', ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i] as string;
    if (!key.startsWith('--')) throw new Error(`unexpected argument ${key}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} needs a value`);
    opts[key.slice(2)] = value; i += 1;
  }
  return { cmd, opts };
}
const need = (opts: Record<string, string>, name: string): string => { const v = opts[name]; if (v === undefined) throw new Error(`--${name} is required`); return v; };

function main(): number {
  let parsed: ReturnType<typeof parse>;
  try { parsed = parse(process.argv.slice(2)); } catch (error) { console.error(`cost: ${(error as Error).message}`); return 2; }
  const { cmd, opts } = parsed;
  const deps = {
    ...(opts.ledger ? { ledgerFile: opts.ledger } : {}),
    ...(opts.budget ? { budget: loadBudget(opts.budget) } : {}),
    ...(opts['price-book'] ? { book: loadPriceBook(opts['price-book']) } : {}),
  };
  try {
    if (cmd === 'gate') {
      let lines: unknown;
      try { lines = JSON.parse(need(opts, 'lines')); } catch { throw new Error('--lines must be a JSON array of {formula, args}'); }
      if (!Array.isArray(lines)) throw new Error('--lines must be a JSON array');
      const r = gate({ actionId: need(opts, 'action'), agent: need(opts, 'agent'), purpose: need(opts, 'purpose'), lines: lines as { formula: string; args: unknown }[] }, deps);
      console.log(`DECISION ${r.decision}  (rule ${r.policy.ruleId}) ledger entry ${r.entry.seq}`);
      console.log(`reason: ${r.policy.reason}`);
      console.log(`estimate: ${r.estimate.status === 'ESTIMATE' ? `${formatUsd(r.estimate.nano as bigint)} USD (${r.estimate.priceBasis} prices)` : `UNKNOWN, missing: ${r.estimate.missing.join(', ')}`}`);
      for (const f of r.funding) console.log(`  funding ${f.source}: this action ${formatUsd(f.actionNano)} USD, remaining ${formatUsd(f.remainingNano)} USD`);
      if (r.limitedBy) console.log(`tightest limit: ${r.limitedBy}`);
      console.log(`committed this period: ${formatUsd(r.committedNano)} USD; remaining before this action: ${formatUsd(r.remainingNano)} USD; headroom after: ${formatUsd(r.policy.headroomNano)} USD`);
      if (r.unknownCommitted > 0) console.log(`warning: ${r.unknownCommitted} action(s) proceeded with an UNKNOWN cost`);
      if (r.decision === 'ASK_OWNER') console.log(`next: the owner reads this and, if it is acceptable, runs: npm run cost -- approve --seq ${r.entry.seq} --by <name> --note "<why>"`);
      if (r.decision === 'STOP') console.log('next: do not proceed. A STOP is not approved; lift the cause (budget or cap) and run the gate again.');
      return r.exitCode;
    }
    if (cmd === 'approve') { const e = approve(Number(need(opts, 'seq')), need(opts, 'by'), need(opts, 'note'), deps); console.log(`approval recorded as entry ${e.seq}`); return 0; }
    if (cmd === 'actual') {
      const source = (opts.source ?? 'manual') as 'console-report' | 'csv-export' | 'manual';
      const funding = (opts.funding ?? 'GCP_CREDIT') as 'GCP_CREDIT' | 'GEMINI_PREPAY' | 'OTHER';
      if (!['GCP_CREDIT', 'GEMINI_PREPAY', 'OTHER'].includes(funding)) throw new Error('--funding must be GCP_CREDIT, GEMINI_PREPAY or OTHER');
      const r = recordActual({ refSeq: opts.seq === undefined ? null : Number(opts.seq), service: need(opts, 'service'), usd: need(opts, 'usd'), source, period: need(opts, 'period'), note: opts.note ?? '', funding, ...(opts['credit-usd'] !== undefined ? { creditUsd: opts['credit-usd'] } : {}) }, deps);
      console.log(`actual recorded as entry ${r.actual.seq}${r.reconciliation ? `; reconciliation entry ${r.reconciliation.seq}: ${(r.reconciliation as { flagged: boolean; reason: string }).flagged ? 'FLAGGED' : 'ok'} (${(r.reconciliation as { reason: string }).reason})` : ''}`);
      return 0;
    }
    if (cmd === 'reverse') { const e = reverseActual({ seq: Number(need(opts, 'seq')), by: need(opts, 'by'), reason: need(opts, 'reason') }, deps); console.log(`actual ${need(opts, 'seq')} reversed by entry ${e.seq}; it no longer counts as committed spend`); return 0; }
    if (cmd === 'credit') {
      let charges: unknown;
      try { charges = JSON.parse(need(opts, 'charges')); } catch { throw new Error('--charges must be a JSON array of {service, usd, coverage?}'); }
      if (!Array.isArray(charges)) throw new Error('--charges must be a JSON array');
      const budget = deps.budget ?? loadBudget();
      const terms = loadCreditTerms();
      const onDate = opts.on ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) throw new Error('--on must be a date YYYY-MM-DD');
      const spent = status(deps);
      const creditSource = spent.funding.find((f) => f.source === 'GCP_CREDIT');
      const prepaySource = spent.funding.find((f) => f.source === 'GEMINI_PREPAY');
      const creditBalance = fundingBalanceNano(budget, 'GCP_CREDIT', onDate) - (creditSource?.committedNano ?? 0n);
      const prepayBalance = fundingBalanceNano(budget, 'GEMINI_PREPAY', onDate) - (prepaySource?.committedNano ?? 0n);
      const credit = budget.funding?.GCP_CREDIT;
      const lastDay = creditLastDay(credit?.starts, credit?.expires, terms.creditValidDays);
      const parsedCharges = (charges as { service?: unknown; usd?: unknown; coverage?: unknown }[]).map((c) => {
        if (typeof c.service !== 'string' || typeof c.usd !== 'string') throw new Error('each charge needs a service and a usd text, for example {"service":"Cloud Run","usd":"0.011"}');
        if (c.coverage !== undefined && !COVERAGE_CLASSES.includes(c.coverage as CoverageClass)) throw new Error(`coverage must be one of ${COVERAGE_CLASSES.join(', ')}`);
        return { service: c.service, grossNano: ceilNano(usdToNano(c.usd)), ...(c.coverage ? { coverage: c.coverage as CoverageClass } : {}) };
      });
      const r = applyCredit({ charges: parsedCharges, creditRemainingNano: creditBalance < 0n ? 0n : creditBalance, prepayRemainingNano: prepayBalance < 0n ? 0n : prepayBalance, onDate, ...(lastDay ? { creditLastDay: lastDay } : {}) }, terms);
      console.log(`credit formulation AEG.CF.CREDIT-APPLICATION/1.0.0 ${creditFormulaHash().slice(0, 12)}  on ${onDate}; credit counted until ${lastDay ?? 'no end date'}${r.creditExpired ? ' (EXPIRED: no credit)' : ''}`);
      console.log(`credit remaining ${formatUsd(creditBalance < 0n ? 0n : creditBalance)} USD; Gemini prepay remaining ${formatUsd(prepayBalance < 0n ? 0n : prepayBalance)} USD`);
      for (const l of r.lines) console.log(`  ${l.service} [${l.coverage}]: ${formatUsd(l.grossNano)} USD -> credit ${formatUsd(l.creditNano)}, prepay ${formatUsd(l.prepayNano)}, card ${formatUsd(l.cardNano)}  (${l.route}, ${l.ruleId})`);
      console.log(`TOTAL ${formatUsd(r.grossNano)} USD: credit ${formatUsd(r.creditNano)}, Gemini prepay ${formatUsd(r.prepayNano)}, CARD ${formatUsd(r.cardNano)}`);
      if (r.assumedCreditNano > 0n) console.log(`assumption: ${formatUsd(r.assumedCreditNano)} USD of the credit rests on ASSUMED coverage; it reaches the card if Google does not cover those services (confirm with the billing report)`);
      if (r.unknownCoverageNano > 0n) console.log(`warning: ${formatUsd(r.unknownCoverageNano)} USD has UNCLASSIFIED coverage and is counted as reaching the card`);
      return r.cardNano > 0n ? 11 : 0;
    }
    if (cmd === 'status') {
      const s = status(deps);
      console.log(`period ${s.period}: budget ${formatUsd(s.budgetNano)} USD, committed ${formatUsd(s.committedNano)} USD, remaining ${formatUsd(s.remainingNano)} USD`);
      if (s.unknownCommitted > 0) console.log(`warning: ${s.unknownCommitted} action(s) proceeded with an UNKNOWN cost`);
      for (const f of s.funding) console.log(`  ${f.source}: balance ${formatUsd(f.balanceNano)} USD, committed ${formatUsd(f.committedNano)} USD, remaining ${formatUsd(f.remainingNano)} USD`);
      if (s.unexplained.count > 0) console.log(`warning: ${s.unexplained.count} recorded charge(s) with no estimate, ${formatUsd(s.unexplained.nano)} USD: spend nobody asked about`);
      if (s.creditAssumedNano > 0n) console.log(`credit assumption: ${formatUsd(s.creditAssumedNano)} USD of committed spend is expected to be paid by the credit but no billing report has confirmed it yet`);
      if (s.cardExposureNano > 0n) console.log(`CARD EXPOSURE: ${formatUsd(s.cardExposureNano)} USD of recorded charges was not covered by credits`);
      for (const o of s.open) console.log(`  #${o.seq} ${o.actionId}: ${o.decision}${o.decision === 'ASK_OWNER' ? (o.approved ? ' (approved)' : ' (WAITING FOR THE OWNER)') : ''}${o.hasActual ? ' actual recorded' : ''}`);
      if (s.flagged.length > 0) console.log(`reconciliation flagged for entries: ${s.flagged.join(', ')}`);
      return 0;
    }
    if (cmd === 'verify') { const n = readLedger(opts.ledger).length; console.log(`ledger verified: ${n} entries, chain intact`); return 0; }
    if (cmd === 'formulas') { for (const f of FORMULAS) console.log(`${formulaKey(f)}  ${formulaHash(f).slice(0, 12)}  ${f.title}`); return 0; }
    console.error('cost: unknown command. Use gate, approve, actual, reverse, credit, status, verify or formulas.');
    return 2;
  } catch (error) {
    if (error instanceof LedgerError || error instanceof MoneyError) { console.error(`cost: ${error.code}: ${error.message}`); return 2; }
    console.error(`cost: ${(error as Error).message}`);
    return 2;
  }
}
process.exit(main());
export { EXIT };
