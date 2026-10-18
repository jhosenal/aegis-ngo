import type { Db } from '../db.js';

export type JobKind = 'draft' | 'translate' | 'voice' | 'render' | 'review';
export type JobStatus = 'ESTIMATED' | 'DONE' | 'FAILED' | 'WAITING_OWNER' | 'CANCELLED';
export interface JobLine { item: string; quantity: string; unit: string; usd: string }
export interface JobCard {
  jobId: string; kind: JobKind; bulletinId: string | null; language: string | null; label: string; createdBy: string; createdAt: string; status: JobStatus;
  estimateStatus: 'ESTIMATE' | 'UNKNOWN'; estimateMicro: number | null; settledMicro: number | null; lines: JobLine[]; params: Record<string, unknown>; note: string | null; priceBookVersion: string | null; finishedAt: string | null;
}
type Row = { job_id: string; kind: JobKind; bulletin_id: string | null; language: string | null; label: string; created_by: string; created_at: string; status: JobStatus; estimate_status: 'ESTIMATE' | 'UNKNOWN'; estimate_micro: number | null; settled_micro: number | null; lines_json: string; params_json: string; note: string | null; price_book_version: string | null; finished_at: string | null };
const toCard = (r: Row): JobCard => ({ jobId: r.job_id, kind: r.kind, bulletinId: r.bulletin_id, language: r.language, label: r.label, createdBy: r.created_by, createdAt: r.created_at, status: r.status, estimateStatus: r.estimate_status, estimateMicro: r.estimate_micro,
  settledMicro: r.settled_micro, lines: JSON.parse(r.lines_json) as JobLine[], params: JSON.parse(r.params_json) as Record<string, unknown>, note: r.note, priceBookVersion: r.price_book_version, finishedAt: r.finished_at });

export function insertJob(db: Db, j: JobCard): void {
  db.prepare(`INSERT INTO job_sheet (job_id, kind, bulletin_id, language, label, created_by, created_at, status, estimate_status, estimate_micro, settled_micro, lines_json, params_json, note, price_book_version, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(j.jobId, j.kind, j.bulletinId, j.language, j.label, j.createdBy, j.createdAt, j.status, j.estimateStatus, j.estimateMicro, j.settledMicro, JSON.stringify(j.lines), JSON.stringify(j.params), j.note, j.priceBookVersion, j.finishedAt);
}
export function getJob(db: Db, jobId: string): JobCard | null {
  const r = db.prepare('SELECT * FROM job_sheet WHERE job_id = ?').get(jobId) as Row | undefined; return r ? toCard(r) : null;
}
export function listJobs(db: Db, f: { bulletinId?: string; kind?: JobKind; createdBy?: string; limit?: number } = {}): JobCard[] {
  const where: string[] = []; const args: unknown[] = [];
  if (f.bulletinId) { where.push('bulletin_id = ?'); args.push(f.bulletinId); }
  if (f.kind) { where.push('kind = ?'); args.push(f.kind); }
  if (f.createdBy) { where.push('created_by = ?'); args.push(f.createdBy); }
  const sql = `SELECT * FROM job_sheet ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`;
  return (db.prepare(sql).all(...args, Math.min(500, f.limit ?? 100)) as Row[]).map(toCard);
}
export function finishJob(db: Db, p: { jobId: string; status: JobStatus; settledMicro: number | null; note: string | null; at: string }): void {
  db.prepare('UPDATE job_sheet SET status = ?, settled_micro = ?, note = COALESCE(?, note), finished_at = ? WHERE job_id = ?').run(p.status, p.settledMicro, p.note, p.at, p.jobId);
}

export type CreditKind = 'OPENING' | 'TOPUP' | 'RESERVE' | 'SETTLE' | 'RELEASE';
export interface CreditEntry { seq: number; at: string; kind: CreditKind; amountMicro: number; jobId: string | null; by: string; note: string | null }
export function addCredit(db: Db, e: { at: string; kind: CreditKind; amountMicro: number; jobId: string | null; by: string; note: string | null }): void {
  db.prepare('INSERT INTO job_credit_ledger (at, kind, amount_micro, job_id, by_user, note) VALUES (?, ?, ?, ?, ?, ?)').run(e.at, e.kind, e.amountMicro, e.jobId, e.by, e.note);
}
export function creditEntries(db: Db, limit = 50): CreditEntry[] {
  return (db.prepare('SELECT * FROM job_credit_ledger ORDER BY seq DESC LIMIT ?').all(limit) as { seq: number; at: string; kind: CreditKind; amount_micro: number; job_id: string | null; by_user: string; note: string | null }[])
    .map((r) => ({ seq: r.seq, at: r.at, kind: r.kind, amountMicro: r.amount_micro, jobId: r.job_id, by: r.by_user, note: r.note }));
}
/** Balance is the sum of every ledger row. Reserved is what jobs not yet finished hold; spent is what finished jobs settled at. */
export function creditSummary(db: Db): { balanceMicro: number; openingMicro: number; topupMicro: number; reservedMicro: number; spentMicro: number } {
  const sum = (kinds: string): number => (db.prepare(`SELECT COALESCE(SUM(amount_micro), 0) AS s FROM job_credit_ledger WHERE kind IN (${kinds})`).get() as { s: number }).s;
  const reserved = (db.prepare("SELECT COALESCE(SUM(estimate_micro), 0) AS s FROM job_sheet WHERE status IN ('ESTIMATED', 'WAITING_OWNER')").get() as { s: number }).s;
  const spent = (db.prepare("SELECT COALESCE(SUM(settled_micro), 0) AS s FROM job_sheet WHERE status = 'DONE'").get() as { s: number }).s;
  return { balanceMicro: (db.prepare('SELECT COALESCE(SUM(amount_micro), 0) AS s FROM job_credit_ledger').get() as { s: number }).s, openingMicro: sum("'OPENING'"), topupMicro: sum("'TOPUP'"), reservedMicro: reserved, spentMicro: spent };
}
