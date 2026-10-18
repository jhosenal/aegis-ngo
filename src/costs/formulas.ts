// Registered cost formulas (AEG-CON-004). Each has an id, a version and a written definition that is hashed, so a change is a new version.
// Exact rational arithmetic only; results are whole nano-USD rounded UP. A missing price, an unlisted region or a bad argument gives
// status UNKNOWN (never zero) and names what is missing. Free tiers follow Google's stated rule (see runFreeTierRule in the price book).
import { z } from 'zod';
import { hashWithDomain } from '../engine/canonical.js';
import { add, ceilNano, cmp, div, max0, minR, mul, MoneyError, parseDecimal, rat, sub, ZERO, type Rat } from './money.js';
import { findPrice, freeQuantity, runTier, unitNano, type PriceBook } from './pricebook.js';

/** Where the money for a cost comes from. GCP_CREDIT is the Google Cloud welcome credit; GEMINI_PREPAY is the AI Studio prepaid balance (it cannot pay for, or be paid by, the credit); OTHER is anything else, which the owner must fund explicitly. */
export type Funding = 'GCP_CREDIT' | 'GEMINI_PREPAY' | 'OTHER';
export const FUNDINGS: readonly Funding[] = ['GCP_CREDIT', 'GEMINI_PREPAY', 'OTHER'];

export interface CostLine { item: string; quantity: string; unit: string; nano: string }
export interface FormulaResult {
  status: 'ESTIMATE' | 'UNKNOWN';
  nano: bigint | null;
  lines: CostLine[];
  missing: string[];
  notes: string[];
  /** SECONDARY when any price used comes from a second-hand table; QUOTED when all come from the publisher's own page. */
  priceBasis: 'QUOTED' | 'SECONDARY' | 'NONE';
}

export interface FormulaDef {
  id: string;
  version: string;
  title: string;
  /** Which balance pays for this cost (see Funding). Credit coverage of a service is ASSUMED until a billing report shows the credit applied. */
  funding: Funding;
  /** The service this formula prices, exactly as named in records/costs/credit-terms.json; the credit terms decide whether the credit may pay for it. */
  service: string;
  /** The formula as written text. Its hash identifies the formula; edit it only by creating a new version. */
  definition: string;
  compute: (args: unknown, book: PriceBook) => FormulaResult;
}

const dec = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/);
const unknown = (missing: string[], notes: string[] = []): FormulaResult => ({ status: 'UNKNOWN', nano: null, lines: [], missing, notes, priceBasis: 'NONE' });
const line = (item: string, quantity: Rat | string, unit: string, nano: bigint): CostLine => ({ item, quantity: typeof quantity === 'string' ? quantity : `${quantity.n}/${quantity.d}`, unit, nano: nano.toString() });

function basisOf(book: PriceBook, ids: string[]): 'QUOTED' | 'SECONDARY' {
  return ids.some((id) => findPrice(book, id)?.status === 'SECONDARY') ? 'SECONDARY' : 'QUOTED';
}
function guarded(args: unknown, schema: z.ZodTypeAny, run: (parsed: never) => FormulaResult): FormulaResult {
  const parsed = schema.safeParse(args);
  if (!parsed.success) return unknown(['ARGUMENTS'], parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`));
  try { return run(parsed.data as never); } catch (error) {
    if (error instanceof MoneyError) return unknown([error.code], [error.message]);
    throw error;
  }
}

// ---------- Cloud Run, request-based billing, one month ----------
const RunArgs = z.object({
  region: z.string().min(1).max(40),
  requests: dec, activeVcpuSeconds: dec, activeGibSeconds: dec,
  idleVcpuSeconds: dec.default('0'), idleGibSeconds: dec.default('0'),
  /** USD of the monthly free-tier discount already used this month by the whole billing account. */
  freeDiscountUsedUsd: dec.default('0'),
}).strict();

const RUN_DEF = 'gross = sum over {active vCPU-seconds, active GiB-seconds, idle vCPU-seconds, idle GiB-seconds, requests} of quantity x price for the region\'s tier; '
  + 'freeValue = sum over {180,000 vCPU-seconds, 360,000 GiB-seconds, 2,000,000 requests} of free quantity x TIER 1 price (the free tier is a spending-based discount at Tier 1 prices); '
  + 'discount = min(gross, max(0, freeValue - freeDiscountUsed)); net = gross - discount; result = ceil(net) in nano-USD. Unlisted region or missing price = UNKNOWN.';

function cloudRunMonth(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, RunArgs, (a: z.infer<typeof RunArgs>) => {
    const tier = runTier(book, a.region);
    if (!tier) return unknown([`REGION_TIER:${a.region}`], ['the region is not in the price book; its Cloud Run pricing tier was not read from the source']);
    const t = tier === 'TIER_1' ? 'T1' : 'T2';
    const ids = { cpuA: `GCP.RUN.REQ.CPU.ACTIVE.${t}`, memA: `GCP.RUN.REQ.MEM.ACTIVE.${t}`, cpuI: `GCP.RUN.REQ.CPU.IDLE.${t}`, memI: `GCP.RUN.REQ.MEM.IDLE.${t}`, req: `GCP.RUN.REQ.REQUESTS.${t}` };
    const t1 = { cpu: 'GCP.RUN.REQ.CPU.ACTIVE.T1', mem: 'GCP.RUN.REQ.MEM.ACTIVE.T1', req: 'GCP.RUN.REQ.REQUESTS.T1' };
    const need = [...Object.values(ids), ...Object.values(t1)];
    const missing = need.filter((id) => !findPrice(book, id));
    const freeIds = ['GCP.RUN.REQ.FREE.CPU', 'GCP.RUN.REQ.FREE.MEM', 'GCP.RUN.REQ.FREE.REQUESTS'];
    for (const id of freeIds) if (freeQuantity(book, id) === null) missing.push(id);
    if (missing.length > 0) return unknown(missing);
    const price = (id: string): Rat => unitNano(book, id) as Rat;
    const parts: [string, Rat, string, string][] = [
      ['active CPU', parseDecimal(a.activeVcpuSeconds), 'vCPU-second', ids.cpuA],
      ['active memory', parseDecimal(a.activeGibSeconds), 'GiB-second', ids.memA],
      ['idle CPU (minimum instances)', parseDecimal(a.idleVcpuSeconds), 'vCPU-second', ids.cpuI],
      ['idle memory (minimum instances)', parseDecimal(a.idleGibSeconds), 'GiB-second', ids.memI],
      ['requests', parseDecimal(a.requests), 'request', ids.req],
    ];
    let gross = ZERO;
    const lines: CostLine[] = [];
    for (const [item, qty, unit, priceId] of parts) {
      const cost = mul(qty, price(priceId));
      gross = add(gross, cost);
      lines.push(line(`${item} at ${tier}`, qty, unit, ceilNano(cost)));
    }
    const freeValue = add(add(mul(freeQuantity(book, freeIds[0] as string) as Rat, price(t1.cpu)), mul(freeQuantity(book, freeIds[1] as string) as Rat, price(t1.mem))), mul(freeQuantity(book, freeIds[2] as string) as Rat, price(t1.req)));
    const used = mul(parseDecimal(a.freeDiscountUsedUsd), rat(1_000_000_000n));
    const available = max0(sub(freeValue, used));
    const discount = minR(gross, available);
    const net = sub(gross, discount);
    lines.push(line('free-tier discount (spending based, valued at Tier 1 prices)', 'discount', 'nano-USD', -ceilNano(discount)));
    return {
      status: 'ESTIMATE', nano: ceilNano(net), lines, missing: [], priceBasis: basisOf(book, need),
      notes: ['free tier applied as a spending-based discount at Tier 1 prices (Google pricing page, 2026-10-14)', 'billed instance time rounding is not modelled: pass the billed seconds'],
    };
  });
}

// ---------- Artifact Registry storage, one month ----------
const ArArgs = z.object({ averageGib: dec, hours: dec.default('744') }).strict();
function artifactStorage(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, ArArgs, (a: z.infer<typeof ArArgs>) => {
    const p = unitNano(book, 'GCP.AR.STORAGE'); const free = freeQuantity(book, 'GCP.AR.FREE.STORAGE');
    if (!p || !free) return unknown(['GCP.AR.STORAGE', 'GCP.AR.FREE.STORAGE'].filter((id) => (id === 'GCP.AR.STORAGE' ? !p : !free)));
    const over = max0(sub(parseDecimal(a.averageGib), free));
    const cost = mul(mul(over, parseDecimal(a.hours)), p);
    return { status: 'ESTIMATE', nano: ceilNano(cost), lines: [line('storage above the free 0.5 GiB-month', over, 'GiB over free, times hours', ceilNano(cost))], missing: [], notes: ['free amount applies per billing account, so storage used by other projects reduces it: pass the account average if known'], priceBasis: basisOf(book, ['GCP.AR.STORAGE']) };
  });
}

// ---------- Cloud Build, one month ----------
const BuildArgs = z.object({ minutes: dec, freeMinutesUsed: dec.default('0') }).strict();
function cloudBuild(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, BuildArgs, (a: z.infer<typeof BuildArgs>) => {
    const p = unitNano(book, 'GCP.BUILD.E2STD2'); const free = freeQuantity(book, 'GCP.BUILD.FREE.MINUTES');
    if (!p || !free) return unknown(['GCP.BUILD.E2STD2', 'GCP.BUILD.FREE.MINUTES'].filter((id) => (id === 'GCP.BUILD.E2STD2' ? !p : !free)));
    const left = max0(sub(free, parseDecimal(a.freeMinutesUsed)));
    const billable = max0(sub(parseDecimal(a.minutes), left));
    const cost = mul(billable, p);
    return { status: 'ESTIMATE', nano: ceilNano(cost), lines: [line('build-minutes beyond the free minutes (e2-standard-2)', billable, 'build-minute', ceilNano(cost))], missing: [], notes: ['the free minutes are promotional and "subject to change" per the page'], priceBasis: basisOf(book, ['GCP.BUILD.E2STD2']) };
  });
}

// ---------- Vulnerability scans ----------
const ScanArgs = z.object({ scans: dec }).strict();
function scans(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, ScanArgs, (a: z.infer<typeof ScanArgs>) => {
    const p = unitNano(book, 'GCP.AA.SCAN');
    if (!p) return unknown(['GCP.AA.SCAN']);
    const cost = mul(parseDecimal(a.scans), p);
    return { status: 'ESTIMATE', nano: ceilNano(cost), lines: [line('automatic or on-demand vulnerability scans', a.scans, 'scan', ceilNano(cost))], missing: [], notes: ['billed while the Container Scanning API is enabled: each pushed image is a scan'], priceBasis: basisOf(book, ['GCP.AA.SCAN']) };
  });
}

// ---------- One model call ----------
const ModelArgs = z.object({ model: z.string().min(1).max(60), inputTokens: dec, outputTokens: dec }).strict();
function modelCall(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, ModelArgs, (a: z.infer<typeof ModelArgs>) => {
    const key = a.model.toUpperCase();
    const inId = `MODEL.REAPI.${key}.IN`; const outId = `MODEL.REAPI.${key}.OUT`;
    const pin = unitNano(book, inId); const pout = unitNano(book, outId);
    if (!pin || !pout) return unknown([inId, outId].filter((id) => !unitNano(book, id)), ['no published price for this model in the book']);
    const million = rat(1_000_000n);
    const cin = mul(parseDecimal(a.inputTokens), div(pin, million));
    const cout = mul(parseDecimal(a.outputTokens), div(pout, million));
    return { status: 'ESTIMATE', nano: ceilNano(add(cin, cout)), lines: [line('input tokens', a.inputTokens, 'token', ceilNano(cin)), line('output tokens', a.outputTokens, 'token', ceilNano(cout))], missing: [], notes: [], priceBasis: basisOf(book, [inId, outId]) };
  });
}

// ---------- One Gemini call on Vertex AI, by token counts ----------
const VertexArgs = z.object({ model: z.string().min(1).max(80), inputTokens: dec, outputTokens: dec }).strict();
const VERTEX_DEF = 'cost = inputTokens / 1,000,000 x the Vertex AI input price + outputTokens / 1,000,000 x the output price (thinking tokens count as output); only the models with a Vertex AI price in the book (gemini-4-argon, global, text, online predictions) are priced, anything else = UNKNOWN';
function vertexGemini(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, VertexArgs, (a: z.infer<typeof VertexArgs>) => {
    const key = a.model === 'gemini-4-argon' ? 'ARGON' : a.model.toUpperCase();
    const inId = `VERTEX.${key}.TEXT.IN.GLOBAL`; const outId = `VERTEX.${key}.TEXT.OUT.GLOBAL`;
    const pin = unitNano(book, inId); const pout = unitNano(book, outId);
    if (!pin || !pout) return unknown([inId, outId].filter((id) => !unitNano(book, id)), ['no Vertex AI price for this model in the book']);
    const million = rat(1_000_000n);
    const cin = mul(parseDecimal(a.inputTokens), div(pin, million)); const cout = mul(parseDecimal(a.outputTokens), div(pout, million));
    return { status: 'ESTIMATE', nano: ceilNano(add(cin, cout)), lines: [line('input tokens (Vertex AI)', a.inputTokens, 'token', ceilNano(cin)), line('output and thinking tokens (Vertex AI)', a.outputTokens, 'token', ceilNano(cout))], missing: [], notes: [], priceBasis: basisOf(book, [inId, outId]) };
  });
}

// ---------- Google Cloud Text-to-Speech and Translation by character ----------
const CharArgs = z.object({ characters: dec }).strict();
function byCharacter(priceId: string, item: string, note: string) {
  return (args: unknown, book: PriceBook): FormulaResult => guarded(args, CharArgs, (a: z.infer<typeof CharArgs>) => {
    const p = unitNano(book, priceId);
    if (!p) return unknown([priceId]);
    const cost = mul(parseDecimal(a.characters), p);
    return { status: 'ESTIMATE', nano: ceilNano(cost), lines: [line(item, a.characters, 'character', ceilNano(cost))], missing: [], notes: [note], priceBasis: basisOf(book, [priceId]) };
  });
}
const TTS_DEF = 'cost = characters x the Cloud Text-to-Speech standard-voice price per character (first paid band); the monthly free allowance (4,000,000 characters) is NOT deducted, so this is a ceiling; no price in the book = UNKNOWN';
const TRANSLATE_DEF = 'cost = characters x the Cloud Translation (Basic, neural) price per character (first paid band); the monthly free allowance is NOT deducted, so this is a ceiling; no price in the book = UNKNOWN';

// ---------- Internet egress (Premium Tier), first volume band ----------
const EgressArgs = z.object({ destination: z.enum(['ASIA_EX_KR_ID', 'AU_ID_KR_SA_SAUDI']), gib: dec }).strict();
function egress(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, EgressArgs, (a: z.infer<typeof EgressArgs>) => {
    const priceId = a.destination === 'ASIA_EX_KR_ID' ? 'GCP.NET.EGRESS.PREMIUM.ASIA_EX_KR_ID.BAND1' : 'GCP.NET.EGRESS.PREMIUM.AU_ID_KR_SA_SAUDI.BAND1';
    const p = unitNano(book, priceId);
    if (!p) return unknown([priceId]);
    const gib = parseDecimal(a.gib);
    if (cmp(gib, rat(1024n)) > 0) return unknown(['VOLUME_BAND_BEYOND_1024_GIB'], ['only the first volume band (up to 1,024 GiB per month) is in the price book']);
    const cost = mul(gib, p);
    return { status: 'ESTIMATE', nano: ceilNano(cost), lines: [line(`internet egress to ${a.destination}`, a.gib, 'GiB', ceilNano(cost))], missing: [], notes: ['no free egress is deducted: the Cloud Run page limits its free 1 GiB to North America', 'the price is by destination, Premium Tier; Cloud CDN and Firebase Hosting have their own prices'], priceBasis: basisOf(book, [priceId]) };
  });
}

// ---------- Gemini Developer API call (paid tier, standard), prices that change by date ----------
const GeminiArgs = z.object({ model: z.string().min(1).max(80), inputTokens: dec, outputTokens: dec, onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
function geminiPriceFor(book: PriceBook, model: string, direction: 'input' | 'output', onDate: string): { id: string; nano: Rat } | 'NONE' | 'AMBIGUOUS' {
  const hits = book.prices.filter((p) => p.service === 'gemini-api' && p.model === model && p.direction === direction
    && (p.validFrom === undefined || p.validFrom <= onDate) && (p.validUntil === undefined || onDate <= p.validUntil));
  if (hits.length === 0) return 'NONE';
  if (hits.length > 1) return 'AMBIGUOUS';
  const hit = hits[0] as (typeof hits)[number];
  return { id: hit.priceId, nano: unitNano(book, hit.priceId) as Rat };
}
function geminiCall(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, GeminiArgs, (a: z.infer<typeof GeminiArgs>) => {
    const pin = geminiPriceFor(book, a.model, 'input', a.onDate);
    const pout = geminiPriceFor(book, a.model, 'output', a.onDate);
    if (pin === 'NONE' || pout === 'NONE') return unknown([`GEMINI_PRICE:${a.model}@${a.onDate}`], ['no price in the book for this model on this date (a price that changes on a date needs an entry for each period)']);
    if (pin === 'AMBIGUOUS' || pout === 'AMBIGUOUS') return unknown([`GEMINI_PRICE_AMBIGUOUS:${a.model}@${a.onDate}`]);
    const million = rat(1_000_000n);
    const cin = mul(parseDecimal(a.inputTokens), div(pin.nano, million));
    const cout = mul(parseDecimal(a.outputTokens), div(pout.nano, million));
    return { status: 'ESTIMATE', nano: ceilNano(add(cin, cout)), lines: [line(`input tokens (${pin.id})`, a.inputTokens, 'token', ceilNano(cin)), line(`output tokens including thinking (${pout.id})`, a.outputTokens, 'token', ceilNano(cout))], missing: [], notes: ['paid tier, standard; the free tier is free of charge but its content may be used to improve Google products', 'thinking tokens count as output tokens', 'grounding, caching and audio or image inputs are not modelled'], priceBasis: basisOf(book, [pin.id, pout.id]) };
  });
}

// ---------- Secret Manager, one month ----------
const SecretArgs = z.object({ averageActiveVersions: dec, accessOperations: dec.default('0'), rotationNotifications: dec.default('0'), hours: dec.default('744') }).strict();
function secretManager(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, SecretArgs, (a: z.infer<typeof SecretArgs>) => {
    const need = ['GCP.SECRET.ACTIVE-VERSION.HOUR', 'GCP.SECRET.ACCESS-OPS', 'GCP.SECRET.ROTATION'];
    const missing = need.filter((id) => !unitNano(book, id));
    const fv = freeQuantity(book, 'GCP.SECRET.FREE.VERSIONS'); const fa = freeQuantity(book, 'GCP.SECRET.FREE.ACCESS'); const fr = freeQuantity(book, 'GCP.SECRET.FREE.ROTATION');
    if (missing.length > 0 || !fv || !fa || !fr) return unknown(missing.length > 0 ? missing : ['GCP.SECRET.FREE.*']);
    const versions = mul(mul(max0(sub(parseDecimal(a.averageActiveVersions), fv)), parseDecimal(a.hours)), unitNano(book, need[0] as string) as Rat);
    const ops = mul(max0(sub(parseDecimal(a.accessOperations), fa)), unitNano(book, need[1] as string) as Rat);
    const rot = mul(max0(sub(parseDecimal(a.rotationNotifications), fr)), unitNano(book, need[2] as string) as Rat);
    const total = add(add(versions, ops), rot);
    return { status: 'ESTIMATE', nano: ceilNano(total), lines: [line('active versions beyond the free versions', a.averageActiveVersions, 'average versions', ceilNano(versions)), line('access operations beyond the free operations', a.accessOperations, 'operation', ceilNano(ops)), line('rotation notifications beyond the free ones', a.rotationNotifications, 'notification', ceilNano(rot))], missing: [], notes: ['free amounts are per billing account: usage elsewhere in the account reduces them'], priceBasis: basisOf(book, need) };
  });
}

// ---------- Cloud Logging, one month ----------
const LoggingArgs = z.object({ ingestedGib: dec, retainedBeyond30DaysGibMonths: dec.default('0'), freeGibUsed: dec.default('0') }).strict();
function cloudLogging(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, LoggingArgs, (a: z.infer<typeof LoggingArgs>) => {
    const pi = unitNano(book, 'GCP.LOG.INGEST'); const pr = unitNano(book, 'GCP.LOG.RETENTION'); const free = freeQuantity(book, 'GCP.LOG.FREE.INGEST');
    if (!pi || !pr || !free) return unknown(['GCP.LOG.INGEST', 'GCP.LOG.RETENTION', 'GCP.LOG.FREE.INGEST'].filter((id) => (id === 'GCP.LOG.INGEST' ? !pi : id === 'GCP.LOG.RETENTION' ? !pr : !free)));
    const left = max0(sub(free, parseDecimal(a.freeGibUsed)));
    const billable = max0(sub(parseDecimal(a.ingestedGib), left));
    const ingest = mul(billable, pi); const keep = mul(parseDecimal(a.retainedBeyond30DaysGibMonths), pr);
    return { status: 'ESTIMATE', nano: ceilNano(add(ingest, keep)), lines: [line('log ingestion beyond the free GiB', billable, 'GiB', ceilNano(ingest)), line('retention beyond 30 days', a.retainedBeyond30DaysGibMonths, 'GiB-month', ceilNano(keep))], missing: [], notes: ['the free 50 GiB is per project per month; logs in the _Required bucket have no storage charge'], priceBasis: basisOf(book, ['GCP.LOG.INGEST', 'GCP.LOG.RETENTION']) };
  });
}

// ---------- Cloud Scheduler ----------
const SchedulerArgs = z.object({ jobs: dec, days: dec.default('31'), freeJobsUsed: dec.default('0') }).strict();
function cloudScheduler(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, SchedulerArgs, (a: z.infer<typeof SchedulerArgs>) => {
    const p = unitNano(book, 'GCP.SCHED.JOB'); const free = freeQuantity(book, 'GCP.SCHED.FREE.JOBS');
    if (!p || !free) return unknown(['GCP.SCHED.JOB', 'GCP.SCHED.FREE.JOBS'].filter((id) => (id === 'GCP.SCHED.JOB' ? !p : !free)));
    const billable = max0(sub(parseDecimal(a.jobs), max0(sub(free, parseDecimal(a.freeJobsUsed)))));
    const cost = mul(mul(billable, p), div(parseDecimal(a.days), rat(31n)));
    return { status: 'ESTIMATE', nano: ceilNano(cost), lines: [line('jobs beyond the free jobs (per 31 days, prorated)', billable, 'job', ceilNano(cost))], missing: [], notes: ['paused jobs still count as jobs; the free jobs are per billing account'], priceBasis: basisOf(book, ['GCP.SCHED.JOB']) };
  });
}

// ---------- Firebase Hosting, one month ----------
const FirebaseArgs = z.object({ storageGb: dec, transferGb: dec }).strict();
function firebaseHosting(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, FirebaseArgs, (a: z.infer<typeof FirebaseArgs>) => {
    const ps = unitNano(book, 'FB.HOSTING.STORAGE'); const pt = unitNano(book, 'FB.HOSTING.TRANSFER'); const fs = freeQuantity(book, 'FB.HOSTING.FREE.STORAGE'); const ft = freeQuantity(book, 'FB.HOSTING.FREE.TRANSFER');
    if (!ps || !pt || !fs || !ft) return unknown(['FB.HOSTING.*']);
    const storage = mul(max0(sub(parseDecimal(a.storageGb), fs)), ps); const transfer = mul(max0(sub(parseDecimal(a.transferGb), ft)), pt);
    return { status: 'ESTIMATE', nano: ceilNano(add(storage, transfer)), lines: [line('hosting storage beyond the free GB', a.storageGb, 'GB', ceilNano(storage)), line('CDN transfer beyond the free GB', a.transferGb, 'GB', ceilNano(transfer))], missing: [], notes: ['free amounts are per project; a project not on the Blaze plan may have releases deleted or be disabled at the quota (see the saved page)'], priceBasis: basisOf(book, ['FB.HOSTING.STORAGE', 'FB.HOSTING.TRANSFER']) };
  });
}

// ---------- Cloud CDN cached egress to Asia Pacific, first band ----------
const CdnArgs = z.object({ gib: dec }).strict();
function cdnEgress(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, CdnArgs, (a: z.infer<typeof CdnArgs>) => {
    const p = unitNano(book, 'GCP.CDN.EGRESS.APAC.BAND1');
    if (!p) return unknown(['GCP.CDN.EGRESS.APAC.BAND1']);
    if (cmp(parseDecimal(a.gib), rat(10_240n)) > 0) return unknown(['VOLUME_BAND_BEYOND_10_TIB'], ['only the first volume band (up to 10 TiB) is in the price book']);
    const cost = mul(parseDecimal(a.gib), p);
    return { status: 'ESTIMATE', nano: ceilNano(cost), lines: [line('Cloud CDN cached egress to Asia Pacific', a.gib, 'GiB', ceilNano(cost))], missing: [], notes: ['no free transfer allowance is stated; cache fill, requests and load balancing are not modelled'], priceBasis: basisOf(book, ['GCP.CDN.EGRESS.APAC.BAND1']) };
  });
}

// ---------- Cloud Run job with one GPU (Singapore) ----------
const GpuJobArgs = z.object({ region: z.string().min(1).max(40), instanceSeconds: dec, vcpu: dec.default('4'), gib: dec.default('16') }).strict();
const GPU_JOB_DEF = 'cost = instanceSeconds x (L4 GPU price per second (no zonal redundancy) + vcpu x job CPU price per vCPU-second + gib x job memory price per GiB-second), all asia-southeast1 prices; '
  + 'instanceSeconds is the WHOLE instance lifecycle including start-up and model loading; one L4 per instance (minimum 4 vCPU and 16 GiB); any other region or a missing price = UNKNOWN';
function cloudRunGpuJob(args: unknown, book: PriceBook): FormulaResult {
  return guarded(args, GpuJobArgs, (a: z.infer<typeof GpuJobArgs>) => {
    if (a.region !== 'asia-southeast1') return unknown([`GPU_PRICE_REGION:${a.region}`], ['only asia-southeast1 GPU, CPU and memory prices are in the book']);
    const ids = ['GCP.RUN.JOB.GPU.L4.NOZR.ASIA-SOUTHEAST1', 'GCP.RUN.JOB.CPU.ASIA-SOUTHEAST1', 'GCP.RUN.JOB.MEM.ASIA-SOUTHEAST1'];
    const missing = ids.filter((id) => !findPrice(book, id));
    if (missing.length > 0) return unknown(missing);
    const secs = parseDecimal(a.instanceSeconds);
    const gpu = mul(secs, unitNano(book, ids[0] as string) as Rat);
    const cpu = mul(mul(secs, parseDecimal(a.vcpu)), unitNano(book, ids[1] as string) as Rat);
    const mem = mul(mul(secs, parseDecimal(a.gib)), unitNano(book, ids[2] as string) as Rat);
    return {
      status: 'ESTIMATE', nano: ceilNano(add(add(gpu, cpu), mem)), priceBasis: basisOf(book, ids), missing: [],
      lines: [line('NVIDIA L4 GPU, no zonal redundancy', secs, 'GPU-second', ceilNano(gpu)), line(`CPU (${a.vcpu} vCPU)`, mul(secs, parseDecimal(a.vcpu)), 'vCPU-second', ceilNano(cpu)), line(`memory (${a.gib} GiB)`, mul(secs, parseDecimal(a.gib)), 'GiB-second', ceilNano(mem))],
      notes: ['pass the instance seconds including start-up and model loading; the render speed on an L4 is not measured yet, so the seconds are an assumption until the first run', 'storage, Artifact Registry and network egress for the output file are not included'],
    };
  });
}

export const FORMULAS: readonly FormulaDef[] = [
  { id: 'AEG.F.GCP-CLOUDRUN-GPU-JOB', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Cloud Run', title: 'Cloud Run job with one NVIDIA L4 GPU in Singapore, by instance seconds', definition: GPU_JOB_DEF, compute: cloudRunGpuJob },
  { id: 'AEG.F.GCP-CLOUDRUN-REQUEST-MONTH', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Cloud Run', title: 'Cloud Run request-based cost for one month', definition: RUN_DEF, compute: cloudRunMonth },
  { id: 'AEG.F.GCP-ARTIFACT-STORAGE-MONTH', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Artifact Registry', title: 'Artifact Registry storage for one month', definition: 'cost = max(0, averageGib - 0.5) x hours x price per GiB-hour', compute: artifactStorage },
  { id: 'AEG.F.GCP-BUILD-MONTH', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Cloud Build', title: 'Cloud Build minutes for one month', definition: 'billable = max(0, minutes - max(0, 2500 - freeMinutesUsed)); cost = billable x price per build-minute', compute: cloudBuild },
  { id: 'AEG.F.GCP-SCAN', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Artifact Analysis scanning', title: 'Vulnerability scans', definition: 'cost = scans x price per scan', compute: scans },
  { id: 'AEG.F.GCP-EGRESS-MONTH', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Network egress', title: 'Internet egress for one month (first volume band)', definition: 'cost = GiB x price per GiB for the destination group, Premium Tier, first band (up to 1,024 GiB per month); no free GiB is deducted; more than 1,024 GiB = UNKNOWN', compute: egress },
  { id: 'AEG.F.GEMINI-API-CALL', version: '1.0.0', funding: 'GEMINI_PREPAY', service: 'Gemini API (AI Studio)', title: 'One Gemini Developer API call, paid tier, by token counts and date', definition: 'cost = inputTokens / 1,000,000 x the input price valid on onDate + outputTokens (including thinking tokens) / 1,000,000 x the output price valid on onDate; no single price entry valid on that date = UNKNOWN', compute: geminiCall },
  { id: 'AEG.F.GCP-SECRET-MANAGER-MONTH', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Secret Manager', title: 'Secret Manager for one month', definition: 'cost = max(0, averageActiveVersions - 6) x hours x price per version-hour + max(0, accessOperations - 10,000) / 10,000 x price + max(0, rotationNotifications - 3) x price', compute: secretManager },
  { id: 'AEG.F.GCP-LOGGING-MONTH', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Cloud Logging', title: 'Cloud Logging for one month', definition: 'cost = max(0, ingestedGib - max(0, 50 - freeGibUsed)) x price per GiB + retained GiB-months beyond 30 days x price', compute: cloudLogging },
  { id: 'AEG.F.GCP-SCHEDULER-MONTH', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Cloud Scheduler', title: 'Cloud Scheduler jobs', definition: 'cost = max(0, jobs - max(0, 3 - freeJobsUsed)) x price per job per 31 days x days / 31', compute: cloudScheduler },
  { id: 'AEG.F.FIREBASE-HOSTING-MONTH', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Firebase Hosting', title: 'Firebase Hosting for one month', definition: 'cost = max(0, storageGb - 10) x price per GB-month + max(0, transferGb - 10) x price per GB', compute: firebaseHosting },
  { id: 'AEG.F.GCP-CDN-EGRESS-MONTH', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Cloud CDN', title: 'Cloud CDN cached egress to Asia Pacific (first band)', definition: 'cost = GiB x price per GiB, first band (up to 10 TiB); more than that = UNKNOWN', compute: cdnEgress },
  { id: 'AEG.F.VERTEX-GEMINI-CALL', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Vertex AI', title: 'One Gemini call on Vertex AI by token counts', definition: VERTEX_DEF, compute: vertexGemini },
  { id: 'AEG.F.GOOGLE-TTS-CHARS', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Cloud Text-to-Speech', title: 'Spoken characters with a standard voice', definition: TTS_DEF, compute: byCharacter('GCP.TTS.STANDARD.CHAR.T1', 'Text-to-Speech standard voice', 'free allowance not deducted: a ceiling') },
  { id: 'AEG.F.GOOGLE-TRANSLATE-CHARS', version: '1.0.0', funding: 'GCP_CREDIT', service: 'Cloud Translation', title: 'Translated characters (neural machine translation)', definition: TRANSLATE_DEF, compute: byCharacter('GCP.TRANSLATE.NMT.CHAR.T1', 'Cloud Translation', 'free allowance not deducted: a ceiling') },
  { id: 'AEG.F.MODEL-CALL', version: '1.0.0', funding: 'OTHER', service: 'Third-party model API (reAPI)', title: 'One model call by token counts', definition: 'cost = inputTokens / 1,000,000 x input price + outputTokens / 1,000,000 x output price; no price in the book = UNKNOWN', compute: modelCall },
];

export const formulaKey = (f: { id: string; version: string }): string => `${f.id}/${f.version}`;
export const findFormula = (key: string): FormulaDef | null => FORMULAS.find((f) => formulaKey(f) === key) ?? null;
export const formulaHash = (f: FormulaDef): string => hashWithDomain('AEG-COST-v1', { id: f.id, version: f.version, definition: f.definition });

export interface ActionLine { formula: string; args: unknown }
export interface ActionEstimate { status: 'ESTIMATE' | 'UNKNOWN'; nano: bigint | null; byFunding: Record<Funding, bigint>; results: { formula: string; result: FormulaResult }[]; missing: string[]; priceBasis: 'QUOTED' | 'SECONDARY' | 'NONE' }

const zeroFunding = (): Record<Funding, bigint> => ({ GCP_CREDIT: 0n, GEMINI_PREPAY: 0n, OTHER: 0n });

/** An action is the sum of its formula lines. One UNKNOWN line makes the whole action UNKNOWN. */
export function estimateAction(lines: ActionLine[], book: PriceBook): ActionEstimate {
  if (lines.length === 0) return { status: 'UNKNOWN', nano: null, byFunding: zeroFunding(), results: [], missing: ['NO_LINES'], priceBasis: 'NONE' };
  const results: ActionEstimate['results'] = [];
  const missing: string[] = [];
  let total = 0n; let unknownAny = false; let secondary = false;
  const byFunding = zeroFunding();
  for (const l of lines) {
    const f = findFormula(l.formula);
    if (!f) { unknownAny = true; missing.push(`FORMULA:${l.formula}`); results.push({ formula: l.formula, result: unknown([`FORMULA:${l.formula}`]) }); continue; }
    const result = f.compute(l.args, book);
    results.push({ formula: l.formula, result });
    if (result.status === 'UNKNOWN' || result.nano === null) { unknownAny = true; missing.push(...result.missing.map((m) => `${l.formula}:${m}`)); } else { total += result.nano; byFunding[f.funding] += result.nano; }
    if (result.priceBasis === 'SECONDARY') secondary = true;
  }
  return unknownAny
    ? { status: 'UNKNOWN', nano: null, byFunding: zeroFunding(), results, missing, priceBasis: 'NONE' }
    : { status: 'ESTIMATE', nano: total, byFunding, results, missing: [], priceBasis: secondary ? 'SECONDARY' : 'QUOTED' };
}

