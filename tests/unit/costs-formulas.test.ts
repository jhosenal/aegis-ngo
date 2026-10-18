import { describe, expect, it } from 'vitest';
import { add, ceilNano, formatUsd, MoneyError, parseDecimal, usdToNano } from '../../src/costs/money.js';
import { loadPriceBook, parsePriceBook, runTier } from '../../src/costs/pricebook.js';
import { estimateAction, FORMULAS, findFormula, formulaHash, formulaKey } from '../../src/costs/formulas.js';
import { existsSync, readFileSync } from 'node:fs';

const book = loadPriceBook();
const run = (args: Record<string, string>) => findFormula('AEG.F.GCP-CLOUDRUN-REQUEST-MONTH/1.0.0')!.compute(args, book);
const USD = (text: string): bigint => ceilNano(usdToNano(text));

describe('exact money arithmetic', () => {
  it('has no floating point error: 0.1 + 0.2 is exactly 0.3', () => {
    const sum = add(parseDecimal('0.1'), parseDecimal('0.2'));
    expect(sum).toEqual(parseDecimal('0.3'));
  });

  it('refuses anything that is not a plain non-negative decimal', () => {
    for (const bad of ['-1', '1e3', '01', '.5', '1.', '1,000', '', ' 1', '1.1234567890123456789', '1'.repeat(19)]) expect(() => parseDecimal(bad), bad).toThrow(MoneyError);
  });

  it('rounds up to whole nano-USD, so an estimate never understates', () => {
    expect(ceilNano(parseDecimal('0.0000000001'))).toBe(1n);
    expect(ceilNano(parseDecimal('0'))).toBe(0n);
    expect(USD('0.000000001')).toBe(1n);
    expect(USD('1')).toBe(1_000_000_000n);
  });

  it('formats nano-USD back to USD text exactly', () => {
    expect(formatUsd(0n)).toBe('0.00');
    expect(formatUsd(1_000_000_000n)).toBe('1.00');
    expect(formatUsd(260_000_000n)).toBe('0.26');
    expect(formatUsd(1n)).toBe('0.000000001');
    expect(formatUsd(-500_000_000n)).toBe('-0.50');
  });
});

describe('the shipped price book', () => {
  it('loads, and every price and free tier carries an https source, an access date and a quoted passage', () => {
    expect(book.prices.length).toBeGreaterThan(10);
    for (const p of book.prices) {
      expect(p.source.url.startsWith('https://')).toBe(true);
      expect(p.source.passage.length).toBeGreaterThan(5);
      expect(p.source.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const f of book.freeTiers) expect(f.source.passage.length).toBeGreaterThan(5);
    expect(book.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a price without a quoted source, a duplicate id, a free tier that names no price, and a region in two tiers', () => {
    const raw = JSON.parse(readFileSync(new URL('../../records/costs/price-book.json', import.meta.url), 'utf8')) as Record<string, any>;
    const noPassage = structuredClone(raw); noPassage.prices[0].source.passage = '';
    expect(() => parsePriceBook(noPassage)).toThrow();
    const noSource = structuredClone(raw); delete noSource.prices[0].source;
    expect(() => parsePriceBook(noSource)).toThrow();
    const dup = structuredClone(raw); dup.prices.push(structuredClone(dup.prices[0]));
    expect(() => parsePriceBook(dup)).toThrow(/duplicate priceId/);
    const orphan = structuredClone(raw); orphan.freeTiers[0].priceId = 'NO.SUCH.PRICE';
    expect(() => parsePriceBook(orphan)).toThrow(/unknown price/);
    const twice = structuredClone(raw); twice.regionTiers['cloud-run'].TIER_2.push('us-central1');
    expect(() => parsePriceBook(twice)).toThrow(/listed twice/);
    const badPrice = structuredClone(raw); badPrice.prices[0].priceUsd = '-1';
    expect(() => parsePriceBook(badPrice)).toThrow();
  });

  it('changes its hash when any price changes', () => {
    const raw = JSON.parse(readFileSync(new URL('../../records/costs/price-book.json', import.meta.url), 'utf8')) as Record<string, any>;
    raw.prices[0].priceUsd = '0.000025';
    expect(parsePriceBook(raw).hash).not.toBe(book.hash);
  });

  it('knows the tier of the regions read from the source and nothing else', () => {
    expect(runTier(book, 'asia-southeast1')).toBe('TIER_2');   // Singapore
    expect(runTier(book, 'asia-southeast2')).toBe('TIER_2');   // Jakarta
    expect(runTier(book, 'us-central1')).toBe('TIER_1');
    expect(runTier(book, 'asia-southeast4')).toBeNull();       // Kuala Lumpur: not on the Cloud Run locations page
    expect(runTier(book, 'mars-north1')).toBeNull();
  });
});

describe('Cloud Run request-based monthly cost', () => {
  const big = { requests: '5000000', activeVcpuSeconds: '1000000', activeGibSeconds: '2000000' };

  it('Singapore (Tier 2): gross 42.60 USD minus the free-tier discount of 6.02 USD valued at Tier 1 prices = 36.58 USD, by hand', () => {
    // gross: 1,000,000 x 0.0000336 = 33.60; 2,000,000 x 0.0000035 = 7.00; 5,000,000 x 0.40 / 1,000,000 = 2.00  => 42.60
    // free value at Tier 1: 180,000 x 0.000024 = 4.32; 360,000 x 0.0000025 = 0.90; 2,000,000 x 0.40 / 1,000,000 = 0.80  => 6.02
    const r = run({ region: 'asia-southeast1', ...big });
    expect(r.status).toBe('ESTIMATE');
    expect(r.nano).toBe(USD('36.58'));
    expect(r.priceBasis).toBe('QUOTED');
  });

  it('Tier 1 region, same usage: gross 31.00 - 6.02 = 24.98 USD', () => {
    expect(run({ region: 'us-central1', ...big }).nano).toBe(USD('24.98'));
  });

  it('a smoke test far below the free tier costs nothing in Singapore, and says so', () => {
    const r = run({ region: 'asia-southeast1', requests: '100', activeVcpuSeconds: '50', activeGibSeconds: '25' });
    expect(r.status).toBe('ESTIMATE');
    expect(r.nano).toBe(0n);
  });

  it('free-tier discount already used by the billing account this month is not given twice', () => {
    expect(run({ region: 'asia-southeast1', ...big, freeDiscountUsedUsd: '6.02' }).nano).toBe(USD('42.60'));
    expect(run({ region: 'asia-southeast1', ...big, freeDiscountUsedUsd: '3.01' }).nano).toBe(USD('39.59'));
    expect(run({ region: 'asia-southeast1', ...big, freeDiscountUsedUsd: '100' }).nano).toBe(USD('42.60'));
  });

  it('idle minimum-instance time is charged at its own price: 100,000 vCPU-s and 100,000 GiB-s idle in Singapore', () => {
    // 100,000 x 0.0000035 + 100,000 x 0.0000035 = 0.70, all beyond nothing else: gross 0.70, discount min(0.70, 6.02) = 0.70 => 0
    const r = run({ region: 'asia-southeast1', requests: '0', activeVcpuSeconds: '0', activeGibSeconds: '0', idleVcpuSeconds: '100000', idleGibSeconds: '100000' });
    expect(r.nano).toBe(0n);
    const r2 = run({ region: 'asia-southeast1', requests: '0', activeVcpuSeconds: '0', activeGibSeconds: '0', idleVcpuSeconds: '1000000', idleGibSeconds: '1000000' });
    // gross 3.50 + 3.50 = 7.00; minus 6.02 = 0.98
    expect(r2.nano).toBe(USD('0.98'));
  });

  it('an unlisted region is UNKNOWN, never zero (Kuala Lumpur is on the pricing page but not on the locations page)', () => {
    const r = run({ region: 'asia-southeast4', ...big });
    expect(r.status).toBe('UNKNOWN');
    expect(r.nano).toBeNull();
    expect(r.missing).toContain('REGION_TIER:asia-southeast4');
  });

  it('bad arguments are UNKNOWN, not a thrown error and not zero', () => {
    for (const args of [{ region: 'asia-southeast1' }, { region: 'asia-southeast1', requests: '-1', activeVcpuSeconds: '0', activeGibSeconds: '0' }, { region: 'asia-southeast1', requests: '1e3', activeVcpuSeconds: '0', activeGibSeconds: '0' }, { region: 'asia-southeast1', requests: '1', activeVcpuSeconds: '1', activeGibSeconds: '1', extra: '1' }]) {
      const r = run(args as Record<string, string>);
      expect(r.status).toBe('UNKNOWN');
      expect(r.nano).toBeNull();
    }
  });

  it('a missing price makes the result UNKNOWN', () => {
    const raw = JSON.parse(readFileSync(new URL('../../records/costs/price-book.json', import.meta.url), 'utf8')) as Record<string, any>;
    raw.prices = raw.prices.filter((p: { priceId: string }) => p.priceId !== 'GCP.RUN.REQ.CPU.ACTIVE.T2');
    const r = findFormula('AEG.F.GCP-CLOUDRUN-REQUEST-MONTH/1.0.0')!.compute({ region: 'asia-southeast1', ...big }, parsePriceBook(raw));
    expect(r.status).toBe('UNKNOWN');
    expect(r.missing).toContain('GCP.RUN.REQ.CPU.ACTIVE.T2');
  });
});

describe('the other registered formulas', () => {
  it('Artifact Registry: 1 GiB average over 744 hours: (1 - 0.5) x 744 x 0.000136986 USD', () => {
    const r = findFormula('AEG.F.GCP-ARTIFACT-STORAGE-MONTH/1.0.0')!.compute({ averageGib: '1' }, book);
    expect(r.nano).toBe(372n * 136_986n);
    expect(findFormula('AEG.F.GCP-ARTIFACT-STORAGE-MONTH/1.0.0')!.compute({ averageGib: '0.4' }, book).nano).toBe(0n);
  });

  it('Cloud Run GPU job in Singapore: 1,000 instance seconds on one L4 with 4 vCPU and 16 GiB = 0.22404 + 0.0864 + 0.0384 = 0.34884 USD; another region is UNKNOWN', () => {
    const f = findFormula('AEG.F.GCP-CLOUDRUN-GPU-JOB/1.0.0')!;
    const r = f.compute({ region: 'asia-southeast1', instanceSeconds: '1000' }, book);
    expect(r.nano).toBe(USD('0.34884'));
    expect(r.priceBasis).toBe('QUOTED');
    expect(r.lines.map((l) => l.nano)).toEqual([USD('0.22404').toString(), USD('0.0864').toString(), USD('0.0384').toString()]);
    expect(f.compute({ region: 'us-central1', instanceSeconds: '1000' }, book).status).toBe('UNKNOWN');
    expect(f.compute({ region: 'asia-southeast1' }, book).status).toBe('UNKNOWN');
  });

  it('Cloud Build: 3,000 minutes with none used: 500 billable x 0.006 = 3.00 USD; 2,000 minutes is free; used minutes reduce the free amount', () => {
    const f = findFormula('AEG.F.GCP-BUILD-MONTH/1.0.0')!;
    expect(f.compute({ minutes: '3000' }, book).nano).toBe(USD('3.00'));
    expect(f.compute({ minutes: '2000' }, book).nano).toBe(0n);
    expect(f.compute({ minutes: '1000', freeMinutesUsed: '2000' }, book).nano).toBe(USD('3.00'));   // only 500 free minutes left, 500 billable
  });

  it('vulnerability scans: 3 pushes with scanning on cost 0.78 USD', () => {
    expect(findFormula('AEG.F.GCP-SCAN/1.0.0')!.compute({ scans: '3' }, book).nano).toBe(USD('0.78'));
  });

  it('a model call: gpt-6-luna with 1,000,000 input and 500,000 output tokens = 0.28 USD from the saved provider quote', () => {
    const r = findFormula('AEG.F.MODEL-CALL/1.0.0')!.compute({ model: 'gpt-6-luna', inputTokens: '1000000', outputTokens: '500000' }, book);
    expect(r.nano).toBe(USD('0.28'));
    expect(r.priceBasis).toBe('QUOTED');
  });

  it('a model with no price in the book (for example a Gemini model) is UNKNOWN, never free', () => {
    for (const model of ['gemini-3.8-flash', 'nonexistent']) {
      const r = findFormula('AEG.F.MODEL-CALL/1.0.0')!.compute({ model, inputTokens: '1000', outputTokens: '1000' }, book);
      expect(r.status).toBe('UNKNOWN');
    }
  });
});

describe('an action is the sum of its lines', () => {
  it('adds the lines; one UNKNOWN line makes the whole action UNKNOWN', () => {
    const ok = estimateAction([
      { formula: 'AEG.F.GCP-SCAN/1.0.0', args: { scans: '1' } },
      { formula: 'AEG.F.GCP-BUILD-MONTH/1.0.0', args: { minutes: '3000' } },
    ], book);
    expect(ok.status).toBe('ESTIMATE');
    expect(ok.nano).toBe(USD('3.26'));
    const bad = estimateAction([{ formula: 'AEG.F.GCP-SCAN/1.0.0', args: { scans: '1' } }, { formula: 'AEG.F.NO-SUCH/1.0.0', args: {} }], book);
    expect(bad.status).toBe('UNKNOWN');
    expect(bad.nano).toBeNull();
    expect(estimateAction([], book).status).toBe('UNKNOWN');
  });

  it('registered formulas have unique keys and stable distinct hashes tied to their written definition', () => {
    const keys = FORMULAS.map(formulaKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(FORMULAS.map(formulaHash)).size).toBe(FORMULAS.length);
    for (const f of FORMULAS) expect(formulaHash(f)).toBe(formulaHash({ ...f }));
    expect(formulaHash({ ...FORMULAS[0]!, definition: FORMULAS[0]!.definition + ' ' })).not.toBe(formulaHash(FORMULAS[0]!));
  });
});

describe('internet egress', () => {
  const egress = (args: Record<string, string>) => findFormula('AEG.F.GCP-EGRESS-MONTH/1.0.0')!.compute(args, book);

  it('Asia (excluding Korea and Indonesia) is 0.12 USD per GiB and Indonesia is 0.19 USD per GiB, with no free GiB deducted', () => {
    expect(egress({ destination: 'ASIA_EX_KR_ID', gib: '10' }).nano).toBe(USD('1.20'));
    expect(egress({ destination: 'AU_ID_KR_SA_SAUDI', gib: '10' }).nano).toBe(USD('1.90'));
    expect(egress({ destination: 'ASIA_EX_KR_ID', gib: '0.5' }).nano).toBe(USD('0.06'));
  });

  it('beyond the first volume band the price is not in the book, so the result is UNKNOWN', () => {
    expect(egress({ destination: 'ASIA_EX_KR_ID', gib: '1024' }).status).toBe('ESTIMATE');
    const r = egress({ destination: 'ASIA_EX_KR_ID', gib: '1024.000000000000000001' });
    expect(r.status).toBe('UNKNOWN');
    expect(r.missing).toContain('VOLUME_BAND_BEYOND_1024_GIB');
    expect(egress({ destination: 'MARS', gib: '1' }).status).toBe('UNKNOWN');
  });
});

describe('every price in the book is re-checked against the saved copy of its source page', () => {
  const decode = (raw: string): string => raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  const normalise = (raw: string): string => decode(raw).replace(/\s+/g, ' ');
  const stripped = (raw: string): string => normalise(raw.replace(/<[^>]+>/g, ' '));
  const entries = [
    ...book.prices.map((p) => ({ id: p.priceId, check: p.source.check })),
    ...book.freeTiers.map((f) => ({ id: f.freeId, check: f.source.check })),
    { id: 'runFreeTierRule', check: book.runFreeTierRule.source.check },
  ];

  it('names a check for every Cloud Run, Artifact Registry, Cloud Build, scan and egress price (model prices are SECONDARY and have none)', () => {
    const unchecked = book.prices.filter((p) => p.status === 'QUOTED' && !p.source.check).map((p) => p.priceId);
    expect(unchecked).toEqual([]);
  });

  for (const { id, check } of entries) {
    if (!check) continue;
    const path = new URL(`../../${check.file}`, import.meta.url);
    it.skipIf(!existsSync(path))(`${id}: the saved page ${check.file} contains every required string`, () => {
      const raw = readFileSync(path, 'utf8');
      const asText = stripped(raw);
      const asSource = normalise(raw);   // price tokens embedded in the page's script data only appear here
      for (const needle of check.contains) expect(asText.includes(normalise(needle)) || asSource.includes(normalise(needle)), `${id} needs "${needle}"`).toBe(true);
    });
  }
});

describe('cross-check against the independent research model (L0026 scenarios A, B and C)', () => {
  // Luna II's scenario lines that the engine covers, from the same stated assumptions: Cloud Run compute is inside the free tier, and
  // egress is the 0.12 USD per GiB line. Her totals also contain Firebase Hosting transfer, which the price book does not cover yet.
  const scenarios = [
    { name: 'A', requests: '1000', cpu: '200', mem: '100', egressGib: '0.0476837158203125', expectedEgress: '0.005722' },
    { name: 'B', requests: '150000', cpu: '30000', mem: '15000', egressGib: '7.152557373046875', expectedEgress: '0.858307' },
    { name: 'C', requests: '352000', cpu: '70400', mem: '35200', egressGib: '16.78466796875', expectedEgress: '2.014160' },
  ];
  for (const s of scenarios) {
    it(`scenario ${s.name}: Cloud Run in Singapore costs 0 (inside the free tier) and egress matches her ${s.expectedEgress} USD to six decimals`, () => {
      const r = run({ region: 'asia-southeast1', requests: s.requests, activeVcpuSeconds: s.cpu, activeGibSeconds: s.mem });
      expect(r.nano).toBe(0n);
      const e = findFormula('AEG.F.GCP-EGRESS-MONTH/1.0.0')!.compute({ destination: 'ASIA_EX_KR_ID', gib: s.egressGib }, book);
      expect(e.status).toBe('ESTIMATE');
      const ours = Number((e.nano as bigint) / 1000n) / 1_000_000;
      expect(Math.abs(ours - Number(s.expectedEgress))).toBeLessThan(0.0000011);
    });
  }
});

describe('Gemini Developer API calls: prices that change by date', () => {
  const gem = (args: Record<string, string>) => findFormula('AEG.F.GEMINI-API-CALL/1.0.0')!.compute(args, book);
  const call = { model: 'gemini-3.8-flash', inputTokens: '1000000', outputTokens: '100000' };

  it('gemini-3.8-flash through 31 Dec 2026: 1,000,000 input at 0.75 + 100,000 output at 3.75 = 1.125 USD', () => {
    expect(gem({ ...call, onDate: '2026-10-14' }).nano).toBe(USD('1.125'));
    expect(gem({ ...call, onDate: '2026-12-31' }).nano).toBe(USD('1.125'));
  });

  it('from 1 Jan 2027 the page doubles the price: 1.50 + 0.75 = 2.25 USD, and the boundary day is exact', () => {
    expect(gem({ ...call, onDate: '2027-01-01' }).nano).toBe(USD('2.25'));
    expect(gem({ ...call, onDate: '2028-06-01' }).nano).toBe(USD('2.25'));
  });

  it('gemini-3.5-flash-lite has one price: 1,000,000 in at 0.30 + 1,000,000 out at 2.50 = 2.80 USD', () => {
    expect(gem({ model: 'gemini-3.5-flash-lite', inputTokens: '1000000', outputTokens: '1000000', onDate: '2026-10-14' }).nano).toBe(USD('2.80'));
  });

  it('a model without a price entry, or a missing date, is UNKNOWN', () => {
    expect(gem({ ...call, model: 'gemini-9-ultra', onDate: '2026-10-14' }).status).toBe('UNKNOWN');
    expect(gem(call as Record<string, string>).status).toBe('UNKNOWN');
    expect(gem({ ...call, onDate: '2026-13-45x' }).status).toBe('UNKNOWN');
  });

  it('is funded by the Gemini prepaid balance, never by the Google Cloud credit', () => {
    expect(findFormula('AEG.F.GEMINI-API-CALL/1.0.0')!.funding).toBe('GEMINI_PREPAY');
  });
});

describe('Secret Manager, Logging, Scheduler, Firebase Hosting and Cloud CDN', () => {
  const f = (id: string, args: Record<string, string>) => findFormula(id)!.compute(args, book);

  it('Secret Manager: 10 versions for 744 hours, 30,000 accesses, 5 rotations beyond the free amounts', () => {
    const r = f('AEG.F.GCP-SECRET-MANAGER-MONTH/1.0.0', { averageActiveVersions: '10', accessOperations: '30000', rotationNotifications: '5' });
    expect(r.nano).toBe(4n * 744n * 82_192n + USD('0.06') + USD('0.10'));
    expect(f('AEG.F.GCP-SECRET-MANAGER-MONTH/1.0.0', { averageActiveVersions: '6', accessOperations: '10000', rotationNotifications: '3' }).nano).toBe(0n);
  });

  it('Cloud Logging: 60 GiB with the free 50 GiB = 5.00 USD; 20 GiB of the free amount already used by other logs = 15.00 USD; retention adds 0.01 per GiB-month', () => {
    expect(f('AEG.F.GCP-LOGGING-MONTH/1.0.0', { ingestedGib: '60' }).nano).toBe(USD('5.00'));
    expect(f('AEG.F.GCP-LOGGING-MONTH/1.0.0', { ingestedGib: '60', freeGibUsed: '20' }).nano).toBe(USD('15.00'));
    expect(f('AEG.F.GCP-LOGGING-MONTH/1.0.0', { ingestedGib: '10', retainedBeyond30DaysGibMonths: '10' }).nano).toBe(USD('0.10'));
  });

  it('Cloud Scheduler: 5 jobs with 3 free = 0.20 USD for 31 days, 0.10 for 15.5 days, 0.50 when the free jobs are used elsewhere', () => {
    expect(f('AEG.F.GCP-SCHEDULER-MONTH/1.0.0', { jobs: '5' }).nano).toBe(USD('0.20'));
    expect(f('AEG.F.GCP-SCHEDULER-MONTH/1.0.0', { jobs: '5', days: '15.5' }).nano).toBe(USD('0.10'));
    expect(f('AEG.F.GCP-SCHEDULER-MONTH/1.0.0', { jobs: '5', freeJobsUsed: '3' }).nano).toBe(USD('0.50'));
  });

  it('Firebase Hosting: 12 GB stored and 20 GB transferred = 0.052 + 1.50 USD', () => {
    expect(f('AEG.F.FIREBASE-HOSTING-MONTH/1.0.0', { storageGb: '12', transferGb: '20' }).nano).toBe(USD('1.552'));
    expect(f('AEG.F.FIREBASE-HOSTING-MONTH/1.0.0', { storageGb: '10', transferGb: '10' }).nano).toBe(0n);
  });

  it('Cloud CDN Asia Pacific: 100 GiB = 9.00 USD; beyond the first 10 TiB band the price is not in the book', () => {
    expect(f('AEG.F.GCP-CDN-EGRESS-MONTH/1.0.0', { gib: '100' }).nano).toBe(USD('9.00'));
    expect(f('AEG.F.GCP-CDN-EGRESS-MONTH/1.0.0', { gib: '10240' }).status).toBe('ESTIMATE');
    expect(f('AEG.F.GCP-CDN-EGRESS-MONTH/1.0.0', { gib: '10241' }).status).toBe('UNKNOWN');
  });

  it('every registered formula declares a funding source, and the existing formula hashes did not change', () => {
    for (const x of FORMULAS) expect(['GCP_CREDIT', 'GEMINI_PREPAY', 'OTHER']).toContain(x.funding);
    const hashes = Object.fromEntries(FORMULAS.map((x) => [formulaKey(x), formulaHash(x).slice(0, 12)]));
    expect(hashes['AEG.F.GCP-CLOUDRUN-REQUEST-MONTH/1.0.0']).toBe('c9623f5d6422');
    expect(hashes['AEG.F.GCP-SCAN/1.0.0']).toBe('0fc206a0df68');
    expect(hashes['AEG.F.MODEL-CALL/1.0.0']).toBe('e70bb0d617bd');
  });
});
