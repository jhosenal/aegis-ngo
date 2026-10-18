// Release gate for the public Assist content (AEG-PLN-003). Astra, 2026-10-14: release is HELD pending review of contextual accuracy,
// country-specific emergency routing and source applicability; saved quotations alone do not establish safe guidance.
// The gate is mechanical: content is released only when a recorded APPROVED decision names the EXACT content hash being served, so any
// later change to any card cancels the approval. A held or stale decision never throws: it yields a visible "not released" state.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const ReleaseRecordSchema = z.object({
  status: z.enum(['HELD', 'APPROVED']),
  /** sha256 of the served card list (AssistContent.hash) that the reviewer actually reviewed. Required when APPROVED. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  reviewedBy: z.string().min(1).max(120).nullable(),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z)?$/).nullable(),
  /** Where the review evidence is recorded (an inbox note or review record). Required when APPROVED. */
  evidenceRef: z.string().min(1).max(200).nullable(),
  /**
   * What the approval means, shown to every reader. Required when APPROVED. SOURCES_CHECKED_NOT_CLINICAL says in plain words that the
   * quotes were checked against saved official pages and that no clinician reviewed the guidance; CLINICAL is for a named clinician.
   */
  reviewScope: z.enum(['SOURCES_CHECKED_NOT_CLINICAL', 'CLINICAL']).nullable().optional(),
  note: z.string().max(600).optional(),
}).strict();
export type ReleaseRecord = z.infer<typeof ReleaseRecordSchema>;

export interface ReleaseDecision { released: boolean; reason: string }

export const DEFAULT_RELEASE_FILE = fileURLToPath(new URL('../../records/releases/assist-release.json', import.meta.url));

/** A missing, unreadable or invalid record is treated as HELD. */
export function readReleaseRecord(file: string = DEFAULT_RELEASE_FILE): ReleaseRecord | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = ReleaseRecordSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function decideRelease(record: ReleaseRecord | null, contentHash: string): ReleaseDecision {
  if (record === null) return { released: false, reason: 'no valid release record: held' };
  if (record.status !== 'APPROVED') return { released: false, reason: 'release is held pending review' };
  if (!record.contentHash || !record.reviewedBy || !record.reviewedAt || !record.evidenceRef || !record.reviewScope) {
    return { released: false, reason: 'approval record is incomplete (hash, reviewer, date, evidence and scope are all required)' };
  }
  if (record.contentHash !== contentHash) return { released: false, reason: 'content changed since it was approved; it must be reviewed again' };
  return { released: true, reason: 'approved for exactly this content' };
}

export const NOT_RELEASED_BANNER = 'Under review. This guidance has not been approved for release. Do not rely on it.';

export interface ApprovalNotice { by: string; at: string; scope: 'SOURCES_CHECKED_NOT_CLINICAL' | 'CLINICAL'; evidenceRef: string; text: string }

/** The sentence every reader sees once the content is released. It states what the approval does and does not mean. */
export function approvalNotice(record: ReleaseRecord | null, decision: ReleaseDecision): ApprovalNotice | null {
  if (!decision.released || record === null || !record.reviewedBy || !record.reviewedAt || !record.evidenceRef || !record.reviewScope) return null;
  const text = record.reviewScope === 'CLINICAL'
    ? `Reviewed and approved by ${record.reviewedBy} on ${record.reviewedAt}.`
    : `Approved for release by ${record.reviewedBy} on ${record.reviewedAt}. The quotes were checked against saved official pages. This guidance has not been clinically reviewed.`;
  return { by: record.reviewedBy, at: record.reviewedAt, scope: record.reviewScope, evidenceRef: record.evidenceRef, text };
}

/** The record the release command writes: always bound to the hash it was given, so any later content change cancels it. */
export function buildApprovalRecord(input: { contentHash: string; reviewedBy: string; reviewedAt: string; evidenceRef: string; reviewScope: 'SOURCES_CHECKED_NOT_CLINICAL' | 'CLINICAL'; note?: string }): ReleaseRecord {
  return ReleaseRecordSchema.parse({ status: 'APPROVED', ...input });
}

// An NGO (or any organisation) can endorse the content under its own name. The endorsement is bound to the exact content hash like an
// approval, so it stops counting the moment a card changes. It is a statement by the named organisation, not by Aegis.
export const EndorsementSchema = z.object({
  organisation: z.string().min(1).max(120),
  endorsedBy: z.string().min(1).max(120),
  endorsedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  note: z.string().max(300).optional(),
}).strict();
export type Endorsement = z.infer<typeof EndorsementSchema>;

export const DEFAULT_ENDORSEMENTS_FILE = fileURLToPath(new URL('../../records/releases/assist-endorsements.json', import.meta.url));

/** A missing, unreadable or invalid file means no endorsements (never an error that hides the content). */
export function readEndorsements(file: string = DEFAULT_ENDORSEMENTS_FILE): Endorsement[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = z.array(EndorsementSchema).safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : [];
  } catch { return []; }
}

/** Only endorsements of exactly the served content count. */
export function currentEndorsements(all: Endorsement[], contentHash: string): Pick<Endorsement, 'organisation' | 'endorsedBy' | 'endorsedOn' | 'note'>[] {
  return all.filter((e) => e.contentHash === contentHash).map(({ organisation, endorsedBy, endorsedOn, note }) => ({ organisation, endorsedBy, endorsedOn, ...(note ? { note } : {}) }));
}
