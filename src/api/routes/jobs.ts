import type { FastifyInstance } from 'fastify';
import { AegisError } from '../../engine/errors.js';
import { creditEntries, creditSummary, getJob, listJobs, type JobCard, type JobKind } from '../../data/repos/jobs.js';
import { topUp } from '../../services/jobs.js';
import { principalFrom } from '../auth.js';
import type { AppDeps } from '../server.js';

const usd = (micro: number | null): string | null => (micro === null ? null : (micro / 1_000_000).toFixed(6));
const KINDS: JobKind[] = ['draft', 'translate', 'voice', 'render', 'review'];

/** The card as the API shows it: money as USD strings, UNKNOWN stays null (never zero). */
export const presentJob = (j: JobCard) => ({ jobId: j.jobId, kind: j.kind, bulletinId: j.bulletinId, language: j.language, label: j.label, createdBy: j.createdBy, createdAt: j.createdAt, finishedAt: j.finishedAt, status: j.status,
  estimateStatus: j.estimateStatus, estimateUsd: usd(j.estimateMicro), settledUsd: usd(j.settledMicro), lines: j.lines, params: j.params, note: j.note, priceBookVersion: j.priceBookVersion });

/**
 * Job cards and the job credit. Administrators see every card; a Pro account sees only the cards it created (read-only). Nobody else sees any. The credit is topped up by an administrator, with a reason,
 * as an append-only ledger row.
 */
export function registerJobsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const who = (request: Parameters<typeof principalFrom>[0]): { admin: boolean; userId: string } => {
    const p = principalFrom(request);
    if (p.isAdmin !== true && p.plan !== 'pro') throw new AegisError('E_FORBIDDEN_ROLE');
    return { admin: p.isAdmin === true, userId: p.userId };
  };
  const wallet = () => { const s = creditSummary(deps.db); return { balanceUsd: usd(s.balanceMicro), openingUsd: usd(s.openingMicro), topupUsd: usd(s.topupMicro), reservedUsd: usd(s.reservedMicro), spentUsd: usd(s.spentMicro), note: 'Job credit: an operating balance for jobs. It never blocks an emergency alert; it gates presenter renders. Separate from the monthly cost-engine budget and the Google credit.' }; };

  app.get('/api/jobs', async (request) => {
    const w = who(request);
    const q = request.query as { bulletinId?: string; kind?: string; limit?: string };
    const kind = KINDS.includes(q.kind as JobKind) ? (q.kind as JobKind) : undefined;
    const jobs = listJobs(deps.db, { ...(q.bulletinId ? { bulletinId: q.bulletinId } : {}), ...(kind ? { kind } : {}), ...(w.admin ? {} : { createdBy: w.userId }), limit: Number(q.limit) || 100 });
    const total = jobs.reduce((n, j) => n + (j.settledMicro ?? j.estimateMicro ?? 0), 0);
    return { wallet: wallet(), scope: w.admin ? 'all' : 'own', totalUsd: usd(total), unknown: jobs.filter((j) => j.estimateStatus === 'UNKNOWN').length, jobs: jobs.map(presentJob) };
  });
  app.get('/api/jobs/:jobId', async (request) => {
    const w = who(request);
    const job = getJob(deps.db, (request.params as { jobId: string }).jobId);
    if (!job || (!w.admin && job.createdBy !== w.userId)) throw new AegisError('E_NOT_FOUND');
    return { job: presentJob(job) };
  });
  /** The same cards as a downloadable JSON file, for audit. */
  app.get('/api/jobs-export', async (request, reply) => {
    const w = who(request);
    const q = request.query as { bulletinId?: string };
    const jobs = listJobs(deps.db, { ...(q.bulletinId ? { bulletinId: q.bulletinId } : {}), ...(w.admin ? {} : { createdBy: w.userId }), limit: 500 });
    reply.header('content-disposition', `attachment; filename="aegis-job-sheets-${deps.clock.now().slice(0, 10)}.json"`);
    return { exportedAt: deps.clock.now(), scope: w.admin ? 'all' : 'own', wallet: wallet(), jobs: jobs.map(presentJob) };
  });
  /** Google's real bill for the month (cost, credits, net to the card, by service) from the BigQuery billing export, beside what our job cards estimated. Administrators only. */
  app.get('/api/admin/billing', async (request) => {
    if (principalFrom(request).isAdmin !== true) throw new AegisError('E_FORBIDDEN_ROLE');
    const refresh = (request.query as { refresh?: string }).refresh === '1';
    const report = deps.billing ? await deps.billing.report(refresh) : { available: false as const, reason: 'The billing export is not connected on this server (AEGIS_BILLING_EXPORT_TABLE is not set).' };
    const month = deps.clock.now().slice(0, 7);
    const mine = listJobs(deps.db, { limit: 500 }).filter((j) => j.createdAt.startsWith(month));
    const jobCardsMicro = mine.reduce((n, j) => n + (j.settledMicro ?? j.estimateMicro ?? 0), 0);
    return { report, jobCards: { count: mine.length, usd: usd(jobCardsMicro), note: 'Job cards are price-book ceilings for translation, voice and renders asked through AEGIS this month; the bill also covers hosting and anything run outside AEGIS.' } };
  });
  app.get('/api/admin/credit', async (request) => {
    if (principalFrom(request).isAdmin !== true) throw new AegisError('E_FORBIDDEN_ROLE');
    return { wallet: wallet(), entries: creditEntries(deps.db, 50).map((e) => ({ ...e, amountUsd: usd(e.amountMicro) })) };
  });
  app.post('/api/admin/credit/topup', async (request) => {
    const p = principalFrom(request);
    if (p.isAdmin !== true) throw new AegisError('E_FORBIDDEN_ROLE');
    const body = (request.body ?? {}) as { amountUsd?: unknown; note?: unknown };
    const amount = Number(body.amountUsd); const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) throw new AegisError('E_VALIDATION', 'amountUsd must be more than 0 and at most 1000.');
    if (note.length < 5) throw new AegisError('E_VALIDATION', 'Write the reason for the top-up (at least 5 characters).');
    topUp(deps.db, { amountMicro: Math.round(amount * 1_000_000), by: p.userId, at: deps.clock.now(), note });
    return { ok: true, wallet: wallet() };
  });
}
