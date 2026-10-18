// Remarks about the MVP: what the page cannot yet do or has not yet checked, stated to every reader instead of left unsaid (owner decision of
// 2026-10-14: for the MVP an open item becomes a visible remark, never a silent gap and never a false claim). Remarks are disclosures, not
// guidance, so they are not part of the content hash: editing a remark does not cancel a release approval.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const RemarkSchema = z.object({
  id: z.string().regex(/^[A-Z0-9-]{3,40}$/),
  /** Missing means the remark applies to every country. */
  country: z.enum(['MY', 'SG', 'ID']).optional(),
  text: z.string().min(10).max(420),
}).strict();
export type Remark = z.infer<typeof RemarkSchema>;

export const RemarkListSchema = z.array(RemarkSchema).max(30).superRefine((list, ctx) => {
  const seen = new Set<string>();
  for (const r of list) { if (seen.has(r.id)) ctx.addIssue({ code: 'custom', message: `duplicate remark ${r.id}` }); seen.add(r.id); }
});

const contentDir = fileURLToPath(new URL('../../content/assist/', import.meta.url));

/** A missing file means no remarks (a test requires the shipped file); an invalid file stops the load, like invalid cards. */
export function loadRemarks(dir: string = contentDir): Remark[] {
  const file = join(dir, 'remarks.json');
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch (error) {
    throw new Error(`assist remarks file ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return RemarkListSchema.parse(parsed);
}
