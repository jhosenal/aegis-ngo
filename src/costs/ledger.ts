// The cost ledger (AEG-CON-004): an append-only, hash-chained record of every estimate, approval, actual cost and reconciliation.
// One JSON object per line in records/costs/ledger.jsonl, tracked in git so a reviewer can read the history. Each entry carries the hash of
// the previous one (domain AEG-COST-v1), so an edit, deletion or reordering is detected by verifyLedger and refused by appendEntry.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { hashWithDomain } from '../engine/canonical.js';

export const DEFAULT_LEDGER = fileURLToPath(new URL('../../records/costs/ledger.jsonl', import.meta.url));
export const GENESIS = '0'.repeat(64);

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/);
const nanoText = z.string().regex(/^-?\d{1,24}$/);
const ts = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
const base = { seq: z.number().int().min(1), ts, prevHash: hex64, hash: hex64 };

export const EstimateEntry = z.object({
  ...base, type: z.literal('ESTIMATE'),
  actionId: id, agent: z.string().min(1).max(80), purpose: z.string().min(1).max(300),
  lines: z.array(z.object({ formula: z.string(), args: z.unknown() }).strict()).min(1).max(20),
  status: z.enum(['ESTIMATE', 'UNKNOWN']),
  estimateNano: nanoText.nullable(),
  /** The estimate split by funding source (GCP_CREDIT, GEMINI_PREPAY, OTHER). */
  byFunding: z.record(z.string(), nanoText),
  /** The funding source whose remaining balance was the tightest limit, when one was. */
  limitedBy: z.string().optional(),
  priceBasis: z.enum(['QUOTED', 'SECONDARY', 'NONE']),
  missing: z.array(z.string()).max(40),
  decision: z.object({ decision: z.enum(['GO', 'ASK_OWNER', 'STOP']), ruleId: z.string(), reason: z.string() }).strict(),
  remainingNano: nanoText, headroomNano: nanoText,
  priceBookHash: hex64, policyVersion: z.string(), autoApproveUsd: z.string(),
}).strict();

export const ApprovalEntry = z.object({ ...base, type: z.literal('APPROVAL'), refSeq: z.number().int().min(1), by: z.string().min(1).max(80), note: z.string().min(1).max(300) }).strict();

export const ActualEntry = z.object({
  ...base, type: z.literal('ACTUAL'),
  refSeq: z.number().int().min(1).nullable(), service: z.string().min(1).max(60), actualNano: nanoText,
  funding: z.enum(['GCP_CREDIT', 'GEMINI_PREPAY', 'OTHER']),
  /** Credits the billing report says were applied to this charge, when known. Less than the charge means money reaches the card. */
  creditAppliedNano: nanoText.optional(),
  source: z.enum(['console-report', 'csv-export', 'manual']), period: z.string().regex(/^\d{4}-\d{2}$/), note: z.string().max(300),
}).strict();

export const ReconciliationEntry = z.object({
  ...base, type: z.literal('RECONCILIATION'),
  refSeq: z.number().int().min(1), actualSeq: z.number().int().min(1),
  estimateNano: nanoText, actualNano: nanoText, varianceNano: nanoText, flagged: z.boolean(), reason: z.string(),
}).strict();

/** A reversing entry (AEG-CON-004): the ledger can never be edited, so a recorded ACTUAL that was wrong (for example a period total entered without the estimate it belongs to, which double counts) is
 * cancelled by a new entry that names it and says why. Both stay in the chain; the reversed ACTUAL no longer counts as committed spend, unexplained spend or card exposure. */
export const ReversalEntry = z.object({ ...base, type: z.literal('REVERSAL'), refSeq: z.number().int().min(1), by: z.string().min(1).max(80), reason: z.string().min(10).max(300) }).strict();

export const LedgerEntrySchema = z.discriminatedUnion('type', [EstimateEntry, ApprovalEntry, ActualEntry, ReconciliationEntry, ReversalEntry]);
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
type WithoutChain<T> = T extends unknown ? Omit<T, 'seq' | 'ts' | 'prevHash' | 'hash'> : never;
export type NewEntry = WithoutChain<LedgerEntry>;

export class LedgerError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'LedgerError'; }
}

export const entryHash = (entry: Omit<LedgerEntry, 'hash'>): string => hashWithDomain('AEG-COST-v1', entry);

/** Reads and fully verifies the ledger (structure, contiguous sequence, hash chain). Throws LedgerError on any damage. */
export function readLedger(file: string = DEFAULT_LEDGER): LedgerEntry[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
  const entries: LedgerEntry[] = [];
  let previous = GENESIS;
  lines.forEach((text, index) => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new LedgerError('LEDGER_BAD_JSON', `line ${index + 1} is not valid JSON`); }
    const result = LedgerEntrySchema.safeParse(parsed);
    if (!result.success) throw new LedgerError('LEDGER_BAD_ENTRY', `line ${index + 1}: ${result.error.issues[0]?.message ?? 'invalid entry'}`);
    const entry = result.data;
    if (entry.seq !== index + 1) throw new LedgerError('LEDGER_BAD_SEQUENCE', `line ${index + 1} has seq ${entry.seq}`);
    if (entry.prevHash !== previous) throw new LedgerError('LEDGER_BROKEN_CHAIN', `entry ${entry.seq} does not follow entry ${entry.seq - 1}`);
    const { hash, ...rest } = entry;
    if (entryHash(rest) !== hash) throw new LedgerError('LEDGER_BAD_HASH', `entry ${entry.seq} was altered`);
    previous = hash;
    entries.push(entry);
  });
  return entries;
}

/** Appends one entry after verifying the whole ledger. Returns the stored entry. */
export function appendEntry(entry: NewEntry, now: () => string, file: string = DEFAULT_LEDGER): LedgerEntry {
  const existing = readLedger(file);
  const last = existing[existing.length - 1];
  const shell = { ...entry, seq: existing.length + 1, ts: now(), prevHash: last ? last.hash : GENESIS } as Omit<LedgerEntry, 'hash'>;
  const stored = LedgerEntrySchema.parse({ ...shell, hash: entryHash(shell) });
  appendFileSync(file, JSON.stringify(stored) + '\n', 'utf8');
  return stored;
}

/** The sequence numbers of ACTUAL entries that a later REVERSAL cancelled. */
export const reversedSeqs = (entries: LedgerEntry[]): Set<number> => new Set(entries.filter((e): e is z.infer<typeof ReversalEntry> => e.type === 'REVERSAL').map((e) => e.refSeq));

export interface Committed { nano: bigint; unknownCount: number; counted: { seq: number; nano: bigint; basis: 'ACTUAL' | 'ESTIMATE' }[]; byFunding: Record<string, bigint> }

/**
 * Money committed in a period (YYYY-MM): for each proceeding estimate (decision GO, or ASK_OWNER with a later APPROVAL, never STOP) its
 * recorded actual if there is one, otherwise its estimate, plus every actual with no estimate. An UNKNOWN estimate counts 0 but is counted
 * in unknownCount so the owner can see that something proceeded without a known cost. Also split by funding source.
 */
export function committed(entries: LedgerEntry[], period: string): Committed {
  const inPeriod = (e: LedgerEntry): boolean => e.ts.startsWith(period);
  const approvals = new Set(entries.filter((e) => e.type === 'APPROVAL').map((e) => (e as z.infer<typeof ApprovalEntry>).refSeq));
  const actualsFor = new Map<number, { nano: bigint; byFunding: Record<string, bigint> }>();
  const byFunding: Record<string, bigint> = { GCP_CREDIT: 0n, GEMINI_PREPAY: 0n, OTHER: 0n };
  let orphan = 0n;
  const counted: Committed['counted'] = [];
  const reversed = reversedSeqs(entries);
  for (const e of entries) {
    if (e.type !== 'ACTUAL' || e.period !== period || reversed.has(e.seq)) continue;
    const amount = BigInt(e.actualNano);
    if (e.refSeq === null) { orphan += amount; byFunding[e.funding] = (byFunding[e.funding] ?? 0n) + amount; counted.push({ seq: e.seq, nano: amount, basis: 'ACTUAL' }); }
    else {
      const cur = actualsFor.get(e.refSeq) ?? { nano: 0n, byFunding: {} };
      cur.nano += amount; cur.byFunding[e.funding] = (cur.byFunding[e.funding] ?? 0n) + amount;
      actualsFor.set(e.refSeq, cur);
    }
  }
  let total = orphan; let unknownCount = 0;
  for (const e of entries) {
    if (e.type !== 'ESTIMATE' || !inPeriod(e)) continue;
    const proceeds = e.decision.decision === 'GO' || (e.decision.decision === 'ASK_OWNER' && approvals.has(e.seq));
    if (!proceeds) continue;
    const actual = actualsFor.get(e.seq);
    if (actual !== undefined) {
      total += actual.nano; counted.push({ seq: e.seq, nano: actual.nano, basis: 'ACTUAL' });
      for (const [k, v] of Object.entries(actual.byFunding)) byFunding[k] = (byFunding[k] ?? 0n) + v;
      continue;
    }
    if (e.estimateNano === null) { unknownCount += 1; continue; }
    total += BigInt(e.estimateNano); counted.push({ seq: e.seq, nano: BigInt(e.estimateNano), basis: 'ESTIMATE' });
    for (const [k, v] of Object.entries(e.byFunding)) byFunding[k] = (byFunding[k] ?? 0n) + BigInt(v);
  }
  return { nano: total, unknownCount, counted, byFunding };
}
