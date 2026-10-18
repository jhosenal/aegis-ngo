// Job sheets and the job credit (AEG-NEWS-007). Every unit of work is one card with a UUID: its cost ESTIMATE comes from the price book through the same cost formulas the cost gate uses, so an
// administrator sees what a job will cost before it runs and an auditor can pull the card later. UNKNOWN is never free: when the price book is missing (the hosted image has none) or a price is absent,
// the card says UNKNOWN. The job credit is an operating balance for jobs (an append-only ledger); it never blocks an emergency alert, it only gates presenter renders.
import { randomUUID } from 'node:crypto';
import type { Db } from '../data/db.js';
import { addCredit, creditSummary, finishJob, getJob, insertJob, type JobCard, type JobKind, type JobLine } from '../data/repos/jobs.js';
import { estimateAction, type ActionLine } from '../costs/formulas.js';
import { formatUsd } from '../costs/money.js';
import { loadPriceBook, type PriceBook } from '../costs/pricebook.js';

let cached: PriceBook | null | undefined;
const priceBook = (): PriceBook | null => { if (cached === undefined) { try { cached = loadPriceBook(); } catch { cached = null; } } return cached; };
export const resetPriceBookCache = (book?: PriceBook | null): void => { cached = book; };

export interface Estimate { status: 'ESTIMATE' | 'UNKNOWN'; micro: number | null; lines: JobLine[]; notes: string[]; version: string | null }
const microOf = (nano: bigint): number => Number((nano + 999n) / 1000n);

export function estimateLines(lines: ActionLine[], notes: string[] = []): Estimate {
  const book = priceBook();
  if (!book) return { status: 'UNKNOWN', micro: null, lines: [], notes: [...notes, 'The price book is not on this server, so the cost is UNKNOWN (never treated as free).'], version: null };
  const e = estimateAction(lines, book);
  const out: JobLine[] = e.results.flatMap((r) => r.result.lines.map((l) => ({ item: l.item, quantity: l.quantity, unit: l.unit, usd: formatUsd(BigInt(l.nano)) })));
  const extra = e.results.flatMap((r) => r.result.notes);
  if (e.status === 'UNKNOWN' || e.nano === null) return { status: 'UNKNOWN', micro: null, lines: out, notes: [...notes, ...extra, `Missing prices: ${e.missing.join(', ')}`], version: book.version };
  return { status: 'ESTIMATE', micro: microOf(e.nano), lines: out, notes: [...notes, ...extra], version: book.version };
}

/** The cost lines of each kind of job. `params` are the numbers the job is priced on. */
export function estimateJob(kind: JobKind, params: Record<string, unknown>): Estimate {
  const n = (k: string): string => String(Math.max(0, Math.round(Number(params[k] ?? 0))));
  switch (kind) {
    case 'draft':
      return { status: 'ESTIMATE', micro: 0, lines: [{ item: 'Written by code from captured facts (no paid service)', quantity: '1', unit: 'draft', usd: '0.000000' }], notes: [], version: priceBook()?.version ?? null };
    case 'voice':
      return estimateLines([{ formula: 'AEG.F.GOOGLE-TTS-CHARS/1.0.0', args: { characters: n('characters') } }]);
    case 'translate': {
      const chars = Number(n('characters')); const lines: ActionLine[] = [];
      if (params['engine'] === 'google') lines.push({ formula: 'AEG.F.GOOGLE-TRANSLATE-CHARS/1.0.0', args: { characters: String(chars) } });
      // The English back-translation for the reviewer is a model call: about one token per three characters in and out, plus the instructions.
      lines.push({ formula: 'AEG.F.MODEL-CALL/1.0.0', args: { model: 'gpt-6-luna', inputTokens: String(Math.ceil(chars / 3) + 200), outputTokens: String(Math.ceil(chars / 3)) } });
      return estimateLines(lines, ['The back-translation tokens are an approximation (one token per three characters).']);
    }
    case 'review':
      return estimateLines([{ formula: 'AEG.F.VERTEX-GEMINI-CALL/1.0.0', args: { model: 'gemini-4-argon', inputTokens: n('inputTokens'), outputTokens: n('outputTokens') } }],
        ['Gemini 4 Argon on Vertex AI at 4 and 20 USD per million input and output tokens; thinking tokens count as output. The settled cost uses the token counts the API returned.']);
    case 'render':
      return estimateLines([{ formula: 'AEG.F.GCP-CLOUDRUN-GPU-JOB/1.0.0', args: { region: 'asia-southeast1', instanceSeconds: n('instanceSeconds') } }],
        ['The render speed on an L4 is an estimate until a run is measured; the figure is a ceiling computed from instance seconds including start-up.']);
  }
}

export const availableMicro = (db: Db): number => creditSummary(db).balanceMicro;

export interface CreateResult { job: JobCard; waiting: boolean }
/** Creates the job card and reserves its estimate from the credit. Only a render is held back when the credit cannot cover it (status WAITING_OWNER); everything else proceeds. */
export function createJob(db: Db, p: { kind: JobKind; bulletinId?: string | null; language?: string | null; label: string; by: string; at: string; params: Record<string, unknown>; gateOnCredit?: boolean; note?: string | null }): CreateResult {
  const est = estimateJob(p.kind, p.params);
  const jobId = randomUUID();
  const free = est.micro === 0;
  const short = p.gateOnCredit === true && (est.micro === null || est.micro > availableMicro(db));
  const status: JobCard['status'] = free ? 'DONE' : short ? 'WAITING_OWNER' : 'ESTIMATED';
  const job: JobCard = { jobId, kind: p.kind, bulletinId: p.bulletinId ?? null, language: p.language ?? null, label: p.label, createdBy: p.by, createdAt: p.at, status, estimateStatus: est.status, estimateMicro: est.micro, settledMicro: free ? 0 : null,
    lines: est.lines, params: p.params, note: [p.note ?? null, ...est.notes].filter(Boolean).join(' '), priceBookVersion: est.version, finishedAt: free ? p.at : null };
  db.transaction(() => {
    insertJob(db, job);
    if (!free && !short && est.micro !== null) addCredit(db, { at: p.at, kind: 'RESERVE', amountMicro: -est.micro, jobId, by: p.by, note: 'Estimate reserved' });
  })();
  return { job, waiting: short };
}

/** The job finished: recompute the cost from the real numbers, return the difference to the credit. */
export function settleJob(db: Db, jobId: string, p: { params?: Record<string, unknown>; at: string; by: string; note?: string }): JobCard | null {
  const job = getJob(db, jobId); if (!job || job.status === 'DONE') return job;
  const est = estimateJob(job.kind, p.params ?? job.params);
  const settled = est.micro ?? job.estimateMicro ?? 0;
  const reserved = job.status === 'ESTIMATED' ? (job.estimateMicro ?? 0) : 0;
  db.transaction(() => {
    finishJob(db, { jobId, status: 'DONE', settledMicro: settled, note: p.note ?? null, at: p.at });
    if (reserved !== 0 || settled !== 0) addCredit(db, { at: p.at, kind: 'SETTLE', amountMicro: reserved - settled, jobId, by: p.by, note: `Settled at ${(settled / 1_000_000).toFixed(6)} USD` });
  })();
  return getJob(db, jobId);
}
export function failJob(db: Db, jobId: string, p: { at: string; by: string; note: string }): JobCard | null {
  const job = getJob(db, jobId); if (!job || job.status === 'DONE' || job.status === 'FAILED') return job;
  const reserved = job.status === 'ESTIMATED' ? (job.estimateMicro ?? 0) : 0;
  db.transaction(() => {
    finishJob(db, { jobId, status: 'FAILED', settledMicro: 0, note: p.note, at: p.at });
    if (reserved !== 0) addCredit(db, { at: p.at, kind: 'RELEASE', amountMicro: reserved, jobId, by: p.by, note: 'Reservation released: the job failed' });
  })();
  return getJob(db, jobId);
}
export function topUp(db: Db, p: { amountMicro: number; by: string; at: string; note: string }): void {
  if (!Number.isInteger(p.amountMicro) || p.amountMicro <= 0 || p.amountMicro > 1_000_000_000) throw new Error('amount must be between 0.000001 and 1000 USD');
  addCredit(db, { at: p.at, kind: 'TOPUP', amountMicro: p.amountMicro, jobId: null, by: p.by, note: p.note });
}

// ---- presenter render speeds ----
export type RenderSpeed = 'normal' | 'fast' | 'max';
export interface RenderOption { speed: RenderSpeed; parallel: number; instanceSecondsEach: number; etaSeconds: number; estimate: { status: 'ESTIMATE' | 'UNKNOWN'; micro: number | null }; available: boolean; note: string }
/** Measured on a real L4 (render trial, 2026-10-16): about 160 s of fixed set-up per job, then about 20 s of render per second of speech; plus container start (assumed 60 s) and upload (30 s). Estimates until calibrated. */
export const RENDER_MODEL = { setupSec: 160, startSec: 60, uploadSec: 30, renderSecPerSpeechSec: 20 } as const;
export function renderOptions(speechSeconds: number, maxParallel: number): RenderOption[] {
  const speeds: { speed: RenderSpeed; parallel: number }[] = [{ speed: 'normal', parallel: 1 }, { speed: 'fast', parallel: 2 }, { speed: 'max', parallel: 3 }];
  return speeds.map(({ speed, parallel }) => {
    const each = Math.ceil(RENDER_MODEL.setupSec + RENDER_MODEL.startSec + (RENDER_MODEL.renderSecPerSpeechSec * speechSeconds) / parallel);
    const est = estimateJob('render', { instanceSeconds: each * parallel });
    const available = parallel <= maxParallel;
    return { speed, parallel, instanceSecondsEach: each, etaSeconds: each + RENDER_MODEL.uploadSec, estimate: { status: est.status, micro: est.micro }, available, note: available ? `${parallel} GPU job${parallel > 1 ? 's' : ''} in parallel` : `Needs ${parallel} GPUs; the project quota allows ${maxParallel}` };
  });
}
