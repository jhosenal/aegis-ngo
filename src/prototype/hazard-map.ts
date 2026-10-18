// CONTRACT FILE: the data behind the hazard-map prototype (areas of disaster, pulsing, with an icon per kind of hazard; brief S0032).
// Interface first, data later: the prototype reads this contract through a provider seam; today the provider is a synthetic stub.
// Change this file only through the engineer.
// Rules enforced in code: every stub is marked synthetic and says so; positions are on a SCHEMATIC frame (x and y are 0..100), never a
// real place; names are fictional; the seven hazard kinds are exactly the seven domains of the catalogue.
import { z } from 'zod';

export const HAZARD_TYPES = ['seismic', 'hydrological', 'meteorological', 'wildfire', 'biological', 'displacement', 'volcanic'] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];
export const Severity = z.enum(['WATCH', 'WARNING', 'CRITICAL']);
export type SeverityT = z.infer<typeof Severity>;

const isoTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/);

export const HazardEventSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._:-]{1,40}$/),
  type: z.enum(HAZARD_TYPES),
  /** A fictional name; never a real place. */
  label: z.string().min(1).max(40),
  severity: Severity,
  /** Position on the schematic frame, 0..100 each way. */
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  /** Radius of the affected area as a percentage of the frame width, 1..30. */
  radius: z.number().min(1).max(30),
  startedAt: isoTime,
  note: z.string().min(1).max(120),
}).strict();

export const HazardMapSchema = z.object({
  schemaVersion: z.literal(1),
  synthetic: z.boolean(),
  syntheticLabel: z.string().min(1).max(200),
  generatedAt: isoTime,
  frame: z.object({ name: z.string().min(1).max(60), schematic: z.literal(true), note: z.string().min(1).max(160) }).strict(),
  events: z.array(HazardEventSchema).min(1).max(40),
}).strict().superRefine((value, ctx) => {
  if (value.synthetic && !/synthetic/i.test(value.syntheticLabel)) ctx.addIssue({ code: 'custom', message: 'a synthetic map must say so in its label', path: ['syntheticLabel'] });
  const ids = new Set<string>();
  for (const e of value.events) { if (ids.has(e.id)) ctx.addIssue({ code: 'custom', message: `duplicate event ${e.id}`, path: ['events'] }); ids.add(e.id); }
});

export type HazardMap = z.infer<typeof HazardMapSchema>;
export type HazardEvent = z.infer<typeof HazardEventSchema>;
export const parseHazardMap = (input: unknown): HazardMap => HazardMapSchema.parse(input);

/** The screen's source of data. The stub and a future real provider both implement it. */
export interface HazardMapProvider { load(): Promise<HazardMap> }

export const SEVERITY_ORDER: Record<SeverityT, number> = { WATCH: 1, WARNING: 2, CRITICAL: 3 };
