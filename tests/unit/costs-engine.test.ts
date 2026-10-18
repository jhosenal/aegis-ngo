import { beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEntry, committed, GENESIS, LedgerError, readLedger } from '../../src/costs/ledger.js';
import { approve, gate, recordActual, status, variance, type Budget } from '../../src/costs/engine.js';
import { loadPriceBook } from '../../src/costs/pricebook.js';
import { ceilNano, usdToNano } from '../../src/costs/money.js';

const book = loadPriceBook();
const nano = (usd: string): bigint => ceilNano(usdToNano(usd));
const budget: Budget = { period: '2026-10', monthlyBudgetUsd: '3.00', autoApproveUsd: '0.50', capEnforced: false, funding: { GCP_CREDIT: { balanceUsd: '300.00', expires: '2026-12-17' }, GEMINI_PREPAY: { balanceUsd: '5.00' }, OTHER: { balanceUsd: '0.00' } } };
let file = '';
let tick = 0;
const now = () => `2026-10-14T00:00:${String(tick++ % 60).padStart(2, '0')}Z`;
const deps = (over: Partial<{ budget: Budget }> = {}) => ({ book, budget: over.budget ?? budget, ledgerFile: file, now });
const scans = (n: string) => [{ formula: 'AEG.F.GCP-SCAN/1.0.0', args: { scans: n } }];
const request = (actionId: string, lines: { formula: string; args: unknown }[]) => ({ actionId, agent: 'ops-agent', purpose: 'test action', lines });

beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'cost-')), 'ledger.jsonl'); tick = 0; });

describe('the ledger is append-only and hash-chained', () => {
  it('starts empty, appends with a growing chain, and re-reads identically', () => {
    expect(readLedger(file)).toEqual([]);
    const a = gate(request('A1', scans('1')), deps());
    const b = gate(request('A2', scans('1')), deps());
    expect(a.entry.seq).toBe(1); expect(a.entry.prevHash).toBe(GENESIS);
    expect(b.entry.seq).toBe(2); expect(b.entry.prevHash).toBe(a.entry.hash);
    expect(readLedger(file)).toEqual([a.entry, b.entry]);
  });

  it('detects an edited entry', () => {
    gate(request('A1', scans('1')), deps()); gate(request('A2', scans('1')), deps());
    const lines = readFileSync(file, 'utf8').split('\n');
    lines[0] = lines[0]!.replace('"estimateNano":"260000000"', '"estimateNano":"1"');
    writeFileSync(file, lines.join('\n'));
    expect(() => readLedger(file)).toThrow(LedgerError);
    expect(() => readLedger(file)).toThrow(/altered/);
  });

  it('detects a deleted entry, a reordered pair and a truncated tail that breaks the sequence', () => {
    for (const id of ['A1', 'A2', 'A3']) gate(request(id, scans('1')), deps());
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n');
    expect(() => readLedger(file)).toThrow(/seq|does not follow/);
    writeFileSync(file, [lines[1], lines[0], lines[2]].join('\n') + '\n');
    expect(() => readLedger(file)).toThrow(LedgerError);
    writeFileSync(file, lines[0] + '\n' + lines[1]!.slice(0, 40) + '\n');
    expect(() => readLedger(file)).toThrow(LedgerError);
  });

  it('refuses to append to a damaged ledger, and refuses unknown keys', () => {
    gate(request('A1', scans('1')), deps());
    appendFileSync(file, '{"junk":true}\n');
    expect(() => gate(request('A2', scans('1')), deps())).toThrow(LedgerError);
    const clean = join(mkdtempSync(join(tmpdir(), 'cost-')), 'l.jsonl');
    expect(() => appendEntry({ type: 'APPROVAL', refSeq: 1, by: 'x', note: 'n', extra: 1 } as never, now, clean)).toThrow();
  });
});

describe('the gate', () => {
  it('GO for a small action, recorded with its estimate, rule and the price book hash', () => {
    const r = gate(request('SMOKE', scans('1')), deps());
    expect(r.decision).toBe('GO'); expect(r.exitCode).toBe(0);
    expect(r.entry.type === 'ESTIMATE' && r.entry.estimateNano).toBe('260000000');
    expect(r.entry.type === 'ESTIMATE' && r.entry.priceBookHash).toBe(book.hash);
    expect(r.remainingNano).toBe(nano('3.00'));
  });

  it('ASK_OWNER above 0.50 USD, and the action does not count as spent until the owner approves it', () => {
    const r = gate(request('SCANS', scans('3')), deps());
    expect(r.decision).toBe('ASK_OWNER'); expect(r.exitCode).toBe(10);
    expect(status(deps()).committedNano).toBe(0n);
    approve(r.entry.seq, 'owner', 'accepted for the test', deps());
    expect(status(deps()).committedNano).toBe(nano('0.78'));
  });

  it('an approval can only follow an ASK_OWNER, only once, and a STOP can never be approved', () => {
    const go = gate(request('GO1', scans('1')), deps());
    expect(() => approve(go.entry.seq, 'owner', 'n', deps())).toThrow(/only ASK_OWNER/);
    const ask = gate(request('ASK1', scans('3')), deps());
    approve(ask.entry.seq, 'owner', 'n', deps());
    expect(() => approve(ask.entry.seq, 'owner', 'again', deps())).toThrow(/already has an approval/);
    const stop = gate(request('BIG', [{ formula: 'AEG.F.GCP-BUILD-MONTH/1.0.0', args: { minutes: '4000' } }]), deps());
    expect(stop.decision).toBe('STOP'); expect(stop.exitCode).toBe(11);
    expect(() => approve(stop.entry.seq, 'owner', 'n', deps())).toThrow(/only ASK_OWNER/);
    expect(() => approve(9999, 'owner', 'n', deps())).toThrow(/not an estimate/);
  });

  it('STOP when the action would exceed the remaining budget; the budget shrinks as approved actions accumulate', () => {
    const tight: Budget = { ...budget, monthlyBudgetUsd: '1.00' };
    expect(gate(request('S1', scans('1')), deps({ budget: tight })).decision).toBe('GO');     // 0.26 committed
    expect(gate(request('S2', scans('1')), deps({ budget: tight })).decision).toBe('GO');     // 0.52 committed
    expect(gate(request('S3', scans('1')), deps({ budget: tight })).decision).toBe('GO');     // 0.78 committed
    const r = gate(request('S4', scans('1')), deps({ budget: tight }));                        // 1.04 > 1.00
    expect(r.decision).toBe('STOP');
    expect(r.policy.ruleId).toBe('P-OVER-BUDGET');
  });

  it('an enforced cap stops even a free action', () => {
    const r = gate(request('CAP', scans('0')), deps({ budget: { ...budget, capEnforced: true } }));
    expect(r.decision).toBe('STOP'); expect(r.policy.ruleId).toBe('P-CAP');
  });

  it('an UNKNOWN estimate asks the owner; once approved it proceeds with an UNKNOWN cost that the status shows', () => {
    const r = gate(request('KL', [{ formula: 'AEG.F.GCP-CLOUDRUN-REQUEST-MONTH/1.0.0', args: { region: 'asia-southeast4', requests: '1', activeVcpuSeconds: '1', activeGibSeconds: '1' } }]), deps());
    expect(r.decision).toBe('ASK_OWNER'); expect(r.estimate.status).toBe('UNKNOWN');
    expect(r.entry.type === 'ESTIMATE' && r.entry.estimateNano).toBeNull();
    approve(r.entry.seq, 'owner', 'proceed knowing the cost is unknown', deps());
    expect(status(deps()).unknownCommitted).toBe(1);
  });

  it('every gate call is recorded, including STOP and UNKNOWN, so nothing can be tried quietly', () => {
    gate(request('A', scans('1')), deps()); gate(request('B', scans('3')), deps());
    gate(request('C', [{ formula: 'NO.SUCH/1.0.0', args: {} }]), deps());
    expect(readLedger(file).filter((e) => e.type === 'ESTIMATE')).toHaveLength(3);
  });
});

describe('actual costs and reconciliation', () => {
  it('an actual replaces the estimate in the committed total, and the variance is recorded', () => {
    const r = gate(request('SMOKE', scans('1')), deps());           // estimate 0.26
    const rec = recordActual({ refSeq: r.entry.seq, service: 'artifact-analysis', usd: '0.26', source: 'console-report', period: '2026-10', note: 'billing report' }, deps());
    expect(rec.reconciliation && rec.reconciliation.type === 'RECONCILIATION' && rec.reconciliation.flagged).toBe(false);
    expect(status(deps()).committedNano).toBe(nano('0.26'));
    const r2 = gate(request('SMOKE2', scans('1')), deps());
    const rec2 = recordActual({ refSeq: r2.entry.seq, service: 'artifact-analysis', usd: '0.90', source: 'console-report', period: '2026-10', note: 'billing report' }, deps());
    expect(rec2.reconciliation && rec2.reconciliation.type === 'RECONCILIATION' && rec2.reconciliation.flagged).toBe(true);
    expect(status(deps()).flagged).toContain(r2.entry.seq);
    expect(status(deps()).committedNano).toBe(nano('0.26') + nano('0.90'));
  });

  it('an actual with no estimate still counts as spent', () => {
    recordActual({ refSeq: null, service: 'logging', usd: '0.05', source: 'manual', period: '2026-10', note: 'seen in the console' }, deps());
    expect(committed(readLedger(file), '2026-10').nano).toBe(nano('0.05'));
  });

  it('reconciling against an UNKNOWN estimate is always flagged so the missing price gets added', () => {
    const r = gate(request('KL', [{ formula: 'AEG.F.GCP-CLOUDRUN-REQUEST-MONTH/1.0.0', args: { region: 'asia-southeast4', requests: '1', activeVcpuSeconds: '1', activeGibSeconds: '1' } }]), deps());
    const rec = recordActual({ refSeq: r.entry.seq, service: 'cloud-run', usd: '0.01', source: 'manual', period: '2026-10', note: '' }, deps());
    expect(rec.reconciliation && rec.reconciliation.type === 'RECONCILIATION' && rec.reconciliation.flagged).toBe(true);
  });

  it('the tolerance is the larger of 0.05 USD and 25 percent of the estimate, in both directions', () => {
    expect(variance(nano('0.10'), nano('0.14')).flagged).toBe(false);   // 0.04 under 0.05
    expect(variance(nano('0.10'), nano('0.16')).flagged).toBe(true);    // 0.06 over 0.05
    expect(variance(nano('10'), nano('12.40')).flagged).toBe(false);    // 2.40 under 25 percent = 2.50
    expect(variance(nano('10'), nano('12.60')).flagged).toBe(true);
    expect(variance(nano('10'), nano('7.60')).flagged).toBe(false);
    expect(variance(nano('10'), nano('7.40')).flagged).toBe(true);
  });

  it('refuses an actual that names a missing or non-estimate entry', () => {
    expect(() => recordActual({ refSeq: 5, service: 's', usd: '1', source: 'manual', period: '2026-10', note: '' }, deps())).toThrow(/not an estimate/);
  });
});

describe('the command line (what agents actually run)', () => {
  const cli = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'tools/cost.ts', ...args], { cwd: process.cwd(), encoding: 'utf8' });
  const budgetFile = (): string => { const f = join(mkdtempSync(join(tmpdir(), 'cost-')), 'budget.json'); writeFileSync(f, JSON.stringify(budget)); return f; };

  it('exits 0 for GO, 10 for ASK_OWNER, 11 for STOP and 2 for bad usage, and writes only to the ledger it was given', () => {
    const b = budgetFile();
    const common = ['--ledger', file, '--budget', b];
    const go = cli(['gate', ...common, '--action', 'X1', '--agent', 'ops', '--purpose', 'p', '--lines', JSON.stringify(scans('1'))]);
    expect(go.status).toBe(0); expect(go.stdout).toMatch(/DECISION GO/);
    const ask = cli(['gate', ...common, '--action', 'X2', '--agent', 'ops', '--purpose', 'p', '--lines', JSON.stringify(scans('3'))]);
    expect(ask.status).toBe(10); expect(ask.stdout).toMatch(/approve --seq 2/);
    const stop = cli(['gate', ...common, '--action', 'X3', '--agent', 'ops', '--purpose', 'p', '--lines', JSON.stringify([{ formula: 'AEG.F.GCP-BUILD-MONTH/1.0.0', args: { minutes: '9000' } }])]);
    expect(stop.status).toBe(11); expect(stop.stdout).toMatch(/do not proceed/);
    expect(cli(['gate', ...common, '--action', 'X4']).status).toBe(2);
    expect(cli(['nonsense']).status).toBe(2);
    const verify = cli(['verify', '--ledger', file]);
    expect(verify.status).toBe(0); expect(verify.stdout).toMatch(/3 entries, chain intact/);
  });

  it('refuses to run against a tampered ledger', () => {
    const b = budgetFile();
    cli(['gate', '--ledger', file, '--budget', b, '--action', 'X1', '--agent', 'ops', '--purpose', 'p', '--lines', JSON.stringify(scans('1'))]);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"agent":"ops"', '"agent":"evil"'));
    const r = cli(['gate', '--ledger', file, '--budget', b, '--action', 'X2', '--agent', 'ops', '--purpose', 'p', '--lines', JSON.stringify(scans('1'))]);
    expect(r.status).toBe(2); expect(r.stderr).toMatch(/LEDGER_BAD_HASH/);
  });
});

describe('funding sources: the tightest balance decides, and credit coverage is checked against the billing report', () => {
  const withFunding = (funding: Budget['funding']): Budget => ({ ...budget, funding });
  const modelCall = [{ formula: 'AEG.F.MODEL-CALL/1.0.0', args: { model: 'gpt-6-luna', inputTokens: '1000000', outputTokens: '500000' } }];   // 0.28 USD, funded by OTHER

  it('records each estimate split by funding source', () => {
    const r = gate(request('SPLIT', [...scans('1'), ...modelCall]), deps({ budget: withFunding({ GCP_CREDIT: { balanceUsd: '300.00' }, OTHER: { balanceUsd: '10.00' } }) }));
    expect(r.entry.type === 'ESTIMATE' && r.entry.byFunding).toEqual({ GCP_CREDIT: nano('0.26').toString(), GEMINI_PREPAY: '0', OTHER: nano('0.28').toString() });
    expect(r.funding.map((f) => f.source)).toEqual(['GCP_CREDIT', 'OTHER']);
  });

  it('a small credit balance stops the action even though the monthly budget has room, and says which balance limited it', () => {
    const small = withFunding({ GCP_CREDIT: { balanceUsd: '0.30' } });
    expect(gate(request('C1', scans('1')), deps({ budget: small })).decision).toBe('GO');          // 0.26 of 0.30
    const r = gate(request('C2', scans('1')), deps({ budget: small }));                             // 0.04 left, needs 0.26
    expect(r.decision).toBe('STOP');
    expect(r.limitedBy).toBe('GCP_CREDIT');
    expect(r.policy.reason).toMatch(/GCP_CREDIT balance/);
    expect(r.entry.type === 'ESTIMATE' && r.entry.limitedBy).toBe('GCP_CREDIT');
  });

  it('a funding source with no configured balance counts as 0, so spending from it is STOP until the owner funds it', () => {
    expect(gate(request('NOFUND', scans('1')), deps({ budget: withFunding(undefined) })).decision).toBe('STOP');
    expect(gate(request('MODEL0', modelCall), deps({ budget: withFunding({ GCP_CREDIT: { balanceUsd: '300.00' }, OTHER: { balanceUsd: '0.00' } }) })).decision).toBe('STOP');
    expect(gate(request('MODEL10', modelCall), deps({ budget: withFunding({ OTHER: { balanceUsd: '10.00' } }) })).decision).toBe('GO');
  });

  it('an expired source counts as 0 from the day after its expiry date', () => {
    const expired = withFunding({ GCP_CREDIT: { balanceUsd: '300.00', expires: '2026-10-13' } });   // the test clock is 2026-10-14
    expect(gate(request('EXP', scans('1')), deps({ budget: expired })).decision).toBe('STOP');
    const lastDay = withFunding({ GCP_CREDIT: { balanceUsd: '300.00', expires: '2026-10-14' } });
    expect(gate(request('LAST', scans('1')), deps({ budget: lastDay })).decision).toBe('GO');
  });

  it('actual spend reduces the balance of the funding source it was charged to, not the others', () => {
    const b = withFunding({ GCP_CREDIT: { balanceUsd: '300.00' }, GEMINI_PREPAY: { balanceUsd: '5.00' } });
    recordActual({ refSeq: null, service: 'gemini-api', usd: '1.25', source: 'manual', period: '2026-10', note: 'AI Studio usage', funding: 'GEMINI_PREPAY' }, deps({ budget: b }));
    const s = status(deps({ budget: b }));
    const by = Object.fromEntries(s.funding.map((f) => [f.source, f.remainingNano]));
    expect(by.GEMINI_PREPAY).toBe(nano('3.75'));
    expect(by.GCP_CREDIT).toBe(nano('300.00'));
  });

  it('a charge the credit did not fully cover is flagged as card exposure and shown in the status', () => {
    const r = gate(request('E1', scans('1')), deps());
    const rec = recordActual({ refSeq: r.entry.seq, service: 'artifact-analysis', usd: '0.26', creditUsd: '0.10', source: 'console-report', period: '2026-10', note: 'billing report' }, deps());
    const reconciliation = rec.reconciliation as Extract<NonNullable<typeof rec.reconciliation>, { type: 'RECONCILIATION' }>;
    expect(reconciliation.flagged).toBe(true);
    expect(reconciliation.reason).toMatch(/CARD EXPOSURE.*0\.16/);
    expect(status(deps()).cardExposureNano).toBe(nano('0.16'));
    const r2 = gate(request('E2', scans('1')), deps());
    const ok = recordActual({ refSeq: r2.entry.seq, service: 'artifact-analysis', usd: '0.26', creditUsd: '0.26', source: 'console-report', period: '2026-10', note: 'billing report' }, deps());
    expect((ok.reconciliation as { flagged: boolean }).flagged).toBe(false);
    expect(status(deps()).cardExposureNano).toBe(nano('0.16'));     // unchanged: the second charge was fully covered
  });

  it('charges recorded with no estimate are listed as unexplained spend', () => {
    recordActual({ refSeq: null, service: 'cloud-run committed use discount', usd: '25.00', source: 'console-report', period: '2026-10', note: 'seen in the billing report' }, deps());
    const s = status(deps());
    expect(s.unexplained).toEqual({ count: 1, nano: nano('25.00') });
    expect(s.committedNano).toBe(nano('25.00'));
  });
});

describe('the command line shows funding and card exposure', () => {
  const cli = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'tools/cost.ts', ...args], { cwd: process.cwd(), encoding: 'utf8' });
  it('prints the funding split on a gate call, and records funding and credit on an actual', () => {
    const b = join(mkdtempSync(join(tmpdir(), 'cost-')), 'budget.json'); writeFileSync(b, JSON.stringify(budget));
    const g = cli(['gate', '--ledger', file, '--budget', b, '--action', 'F1', '--agent', 'ops', '--purpose', 'p', '--lines', JSON.stringify(scans('1'))]);
    expect(g.status).toBe(0); expect(g.stdout).toMatch(/funding GCP_CREDIT: this action 0\.26 USD/);
    const a = cli(['actual', '--ledger', file, '--budget', b, '--seq', '1', '--usd', '0.26', '--credit-usd', '0', '--service', 'artifact-analysis', '--period', '2026-10', '--source', 'console-report']);
    expect(a.status).toBe(0); expect(a.stdout).toMatch(/FLAGGED.*CARD EXPOSURE/);
    const s = cli(['status', '--ledger', file, '--budget', b]);
    expect(s.stdout).toMatch(/CARD EXPOSURE: 0\.26 USD/); expect(s.stdout).toMatch(/GCP_CREDIT: balance 300\.00 USD/);
    expect(cli(['actual', '--ledger', file, '--budget', b, '--usd', '1', '--service', 's', '--period', '2026-10', '--funding', 'BOGUS']).status).toBe(2);
  });
});

describe('Gemini spend is gated against the Gemini prepaid balance', () => {
  const gemini = (tokens: string) => [{ formula: 'AEG.F.GEMINI-API-CALL/1.0.0', args: { model: 'gemini-3.8-flash', inputTokens: tokens, outputTokens: '0', onDate: '2026-10-14' } }];

  it('a call that fits the 5 USD prepay and the per-action limit is GO and draws only on GEMINI_PREPAY', () => {
    const r = gate(request('G1', gemini('400000')), deps());      // 0.30 USD
    expect(r.decision).toBe('GO');
    expect(r.entry.type === 'ESTIMATE' && r.entry.byFunding).toEqual({ GCP_CREDIT: '0', GEMINI_PREPAY: nano('0.30').toString(), OTHER: '0' });
  });

  it('a call larger than the remaining prepay is STOP even though the credit and the monthly budget have room', () => {
    const small: Budget = { ...budget, funding: { ...budget.funding, GEMINI_PREPAY: { balanceUsd: '0.20' } } };
    const r = gate(request('G2', gemini('400000')), deps({ budget: small }));
    expect(r.decision).toBe('STOP');
    expect(r.limitedBy).toBe('GEMINI_PREPAY');
  });
});

describe('the shipped files work together (a live drill on a scratch ledger, never the real one)', () => {
  it('records/costs/budget.json and price-book.json load, and a realistic test-1 action is gated without error', async () => {
    const { loadBudget } = await import('../../src/costs/engine.js');
    const shippedBudget = loadBudget();                       // the real file: this failed once on a note that was too long
    expect(shippedBudget.monthlyBudgetUsd).toMatch(/^\d+\.\d{2}$/);   // the owner edits this in the Admin Desk (10.00 on 2026-10-16, 15.00 on 2026-10-18), so check the shape, not the number
    expect(Number(shippedBudget.autoApproveUsd)).toBeLessThanOrEqual(Number(shippedBudget.monthlyBudgetUsd));
    expect(shippedBudget.autoApproveUsd).toMatch(/^\d+\.\d{2}$/);   // 0.50 until 2026-10-18, 5.00 for the final push: the shape, not the number
    expect(shippedBudget.capEnforced).toBe(false);
    expect(shippedBudget.funding?.GCP_CREDIT?.balanceUsd).toBe('300.00');
    expect(shippedBudget.funding?.GEMINI_PREPAY?.balanceUsd).toBe('5.00');
    const r = gate(request('DRILL', [
      { formula: 'AEG.F.GCP-BUILD-MONTH/1.0.0', args: { minutes: '5' } },
      { formula: 'AEG.F.GCP-ARTIFACT-STORAGE-MONTH/1.0.0', args: { averageGib: '0.6' } },
      { formula: 'AEG.F.GCP-CLOUDRUN-REQUEST-MONTH/1.0.0', args: { region: 'asia-southeast1', requests: '100', activeVcpuSeconds: '50', activeGibSeconds: '25' } },
      { formula: 'AEG.F.GCP-EGRESS-MONTH/1.0.0', args: { destination: 'ASIA_EX_KR_ID', gib: '0.01' } },
    ]), { budget: shippedBudget, ledgerFile: file, now: () => '2026-10-14T00:00:00Z' });
    expect(r.decision).toBe('GO');
    expect(r.estimate.status).toBe('ESTIMATE');
    expect(r.estimate.nano).toBe(nano('0.011391759'));          // 0.6 GiB stored: 0.1 x 744 x 0.000136986 plus 0.01 GiB egress at 0.12
  });

  it('the real ledger file, if it exists, verifies', () => {
    expect(() => readLedger()).not.toThrow();
  });
});
