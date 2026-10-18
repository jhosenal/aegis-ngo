// Public catalogue of the seven hazard domains. It states what each domain is, what its specification covers, and exactly what the
// source audit found, so a reader (or a judge) never mistakes a specification for running code. Content is hand-written from our own
// documents (the specification files and the S0008/S0010/S0011/S0012 audit notes); nothing here is produced by a model.
import { z } from 'zod';

const text = (max: number) => z.string().min(1).max(max);

export const AuditFindingSchema = z.object({
  /** supported: a saved primary source says it. held-back: the audit found no support or a conflict, so it is not used. */
  kind: z.enum(['supported', 'held-back']),
  text: text(300),
}).strict();

export const DomainSchema = z.object({
  number: z.number().int().min(1).max(7),
  refId: z.string().regex(/^AEG-FRM-00[1-7]$/),
  name: text(40),
  /** One plain sentence about the hazard itself. */
  hazard: text(160),
  /** The data feeds the specification expects (as the master architecture names them). */
  inputFeeds: text(120),
  /** The shortfalls or indicators the specification computes. */
  outputs: z.array(text(80)).min(1).max(8),
  /** The highest decision level the specification defines, as written. */
  topDecisionLevel: text(80),
  /** Always false until the domain is implemented as code and tested; the page says so on every card. */
  runsInEngine: z.boolean(),
  /** What the audit against saved primary sources found. */
  audit: z.array(AuditFindingSchema).min(1).max(8),
  specFile: text(120),
  auditNote: text(80),
}).strict();

export const CatalogueSchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statement: text(500),
  domains: z.array(DomainSchema).length(7),
}).strict().superRefine((value, ctx) => {
  const numbers = value.domains.map((d) => d.number).sort((a, b) => a - b);
  if (numbers.join(',') !== '1,2,3,4,5,6,7') ctx.addIssue({ code: 'custom', message: 'the catalogue must hold domains 1 to 7 exactly once', path: ['domains'] });
});

export type Catalogue = z.infer<typeof CatalogueSchema>;
export type Domain = z.infer<typeof DomainSchema>;

export function parseCatalogue(input: unknown): Catalogue {
  return CatalogueSchema.parse(input);
}
