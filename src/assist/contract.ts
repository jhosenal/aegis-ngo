// CONTRACT FILE: the public Assist content contract (AEG-PLN-003). Every worker builds against this file; change it only through the engineer.
// Rules enforced in code, not by convention:
//  - every instruction line names a source, and the source must exist in the same card;
//  - the first line of every card is the "call the emergency number" contact line;
//  - a public build renders only cards whose sources are all SOURCED, except draft medical cards, which are shown only when the
//    server flag is on and always carry the demo banner;
//  - a SOURCED source must quote its passage; content is never "sourced" by assertion alone.
import { z } from 'zod';

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const httpsUrl = z.string().url().max(500).refine((u) => u.startsWith('https://'), 'source URLs must be https');

export const SourceStatus = z.enum(['SOURCED', 'DRAFT_UNREVIEWED', 'PENDING_SOURCE']);
export type SourceStatusT = z.infer<typeof SourceStatus>;

export const SourceSchema = z.object({
  sourceId: id,
  publisher: z.string().min(1).max(200),
  url: httpsUrl,
  accessed: isoDate,
  status: SourceStatus,
  /** Verbatim text from the source. Required (non-empty) whenever status is SOURCED. */
  passage: z.string().max(1200),
  /** When the source itself was published ("2008" or "2026-10-01"), if the page says. Shown to the reader; older guidance must say so. */
  published: z.string().regex(/^\d{4}(-\d{2}-\d{2})?$/).optional(),
  /** The saved evidence copy of the page (an inbox file name), so a reviewer can check the quote. */
  savedFile: z.string().min(1).max(200).optional(),
}).strict().superRefine((s, ctx) => {
  if (s.status === 'SOURCED' && s.passage.trim() === '') ctx.addIssue({ code: 'custom', message: 'a SOURCED source must quote its passage', path: ['passage'] });
});

/** Who a card is written for. The groups follow the authorities' own groupings; a group is never invented beyond what a source says. */
export const Audience = z.enum(['general', 'lung-heart', 'children-older-pregnant']);
export type AudienceT = z.infer<typeof Audience>;
export const AUDIENCE_LABELS: Record<AudienceT, string> = {
  general: 'Everyone',
  'lung-heart': 'Chronic lung or heart conditions',
  'children-older-pregnant': 'Children, older adults, pregnant women',
};

export const LineKind = z.enum(['contact', 'step', 'do', 'dont']);
export const LineSchema = z.object({
  id,
  kind: LineKind,
  /** Long enough for an authority's full caveat sentence: cutting one short can change its meaning. */
  text: z.string().min(1).max(500),
  sourceId: id,
  /** The authority's own condition for the instruction (for example "only if safe and dry"); shown next to the text. */
  condition: z.string().min(1).max(160).optional(),
}).strict();

export const CardSchema = z.object({
  id,
  language: z.enum(['en', 'ms']),
  /** Which country's authorities and emergency numbers the card is written for. Missing means MY (the first content set). */
  country: z.enum(['MY', 'SG', 'ID']).default('MY'),
  hazard: z.enum(['flood', 'haze', 'cardiac']),
  /** Missing means general (everyone). */
  audience: Audience.default('general'),
  severity: z.enum(['high', 'moderate', 'safe']),
  title: z.string().min(1).max(120),
  region: z.string().min(1).max(120).optional(),
  /** True for synthetic scenario data; the UI shows the synthetic banner. */
  synthetic: z.boolean(),
  lines: z.array(LineSchema).min(1).max(24),
  sources: z.array(SourceSchema).min(1).max(40),
}).strict();

export type Card = z.infer<typeof CardSchema>;
export type Source = z.infer<typeof SourceSchema>;

export interface PublishOptions { draftMedical: boolean }
export interface PublicCard { card: Card; demoBanner: boolean }

/** Structural validation: shape, resolvable sources, unique ids, first line is the emergency contact. Returns problems; empty = valid. */
export function validateCard(input: unknown): string[] {
  const parsed = CardSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.') || 'card'}: ${i.message}`);
  const card = parsed.data;
  const problems: string[] = [];
  const sourceIds = new Set<string>();
  for (const s of card.sources) {
    if (sourceIds.has(s.sourceId)) problems.push(`duplicate source ${s.sourceId}`);
    sourceIds.add(s.sourceId);
  }
  const lineIds = new Set<string>();
  for (const line of card.lines) {
    if (lineIds.has(line.id)) problems.push(`duplicate line ${line.id}`);
    lineIds.add(line.id);
    if (!sourceIds.has(line.sourceId)) problems.push(`line ${line.id} names unknown source ${line.sourceId}`);
  }
  if (card.lines[0]?.kind !== 'contact') problems.push('the first line must be the emergency contact line (kind "contact")');
  return problems;
}

/**
 * The only way content reaches a public page. Throws on any invalid card, so a bad content file fails the build or the request
 * instead of silently showing less safe content. Returns the cards a public visitor may see.
 */
export function selectPublicCards(cards: unknown[], options: PublishOptions): PublicCard[] {
  const out: PublicCard[] = [];
  for (const raw of cards) {
    const problems = validateCard(raw);
    if (problems.length > 0) throw new Error(`invalid assist card: ${problems.join('; ')}`);
    const card = CardSchema.parse(raw);   // normalised: defaults applied (country)
    const statuses = new Set(card.lines.map((l) => card.sources.find((s) => s.sourceId === l.sourceId)?.status));
    const allSourced = [...statuses].every((s) => s === 'SOURCED');
    if (allSourced) { out.push({ card, demoBanner: false }); continue; }
    const onlyDraft = [...statuses].every((s) => s === 'SOURCED' || s === 'DRAFT_UNREVIEWED');
    if (card.hazard === 'cardiac' && onlyDraft && options.draftMedical) { out.push({ card, demoBanner: true }); continue; }
    // PENDING_SOURCE anywhere, or draft content with the flag off: not shown publicly
  }
  return out;
}

export const DEMO_BANNER_TEXT = 'Demo content. Not reviewed by a clinician. Not for real emergencies.';
export const DISCLAIMER_TEXT = 'Aegis gives general guidance for bystanders while official help is contacted. It is not medical advice and does not replace emergency services.';
