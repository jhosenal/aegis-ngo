// CONTRACT FILE: the data behind the NGO incident overview screen (design references D0001 to D0004). Interface first, data later: the screen is
// built against this contract with a synthetic stub (content/overview/stub-haze-incident.json); a real provider can replace the stub without
// touching the screen. Change this file only through the engineer.
// Rules enforced in code:
//  - a value that is not known is null, and the screen must show "Unknown", never 0 (the same rule as the resource-shortfall formulation);
//  - every stub is marked synthetic and carries a label the screen shows on every view;
//  - no photograph or personal record: groups are aggregates and icons are glyph names, never image URLs.
import { z } from 'zod';

const id = z.string().min(1).max(60).regex(/^[A-Za-z0-9._:-]+$/);
const text = (max: number) => z.string().min(1).max(max);
const isoTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/);
const nullableCount = z.number().int().min(0).max(1_000_000_000).nullable();
const percent = z.number().min(0).max(100).nullable();

/** How a value should be read, matching the workspace card language (AEG-ENG-006 section 3). */
export const EpistemicTag = z.enum(['FACT', 'CALCULATION', 'ESTIMATE', 'PROPOSAL', 'UNKNOWN', 'SYNTHETIC']);
export type EpistemicTagT = z.infer<typeof EpistemicTag>;

export const AirBand = z.enum(['GOOD', 'MODERATE', 'UNHEALTHY_SENSITIVE', 'UNHEALTHY', 'VERY_UNHEALTHY', 'HAZARDOUS', 'UNKNOWN']);
export const Priority = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
export const IncidentStatus = z.enum(['ACTIVE', 'MONITORING', 'CLOSED']);
/** Glyph names the screen draws itself (inline vector icons). Never an image URL: no photographs of people. */
export const GroupIcon = z.enum(['child', 'older', 'respiratory', 'general']);
export const ItemType = z.enum(['Equipment', 'Medical', 'Supplies']);
export const UpdateKind = z.enum(['AIR_QUALITY', 'HEALTH_REPORT', 'RESOURCE_REQUEST', 'GENERAL']);

const trend = z.array(z.number().min(0).max(100)).max(12);

export const OverviewSchema = z.object({
  schemaVersion: z.literal(1),
  /** True for every stub. The screen shows `syntheticLabel` on every view while this is true. */
  synthetic: z.boolean(),
  syntheticLabel: text(200),
  /** The data's own clock: relative times ("2 hours ago") are computed against it, so a snapshot reads the same whenever it is opened. */
  generatedAt: isoTime,
  incident: z.object({
    id: text(40),
    title: text(80),
    status: IncidentStatus,
    region: text(80),
    reportedAt: isoTime,
    tags: z.array(text(24)).max(6),
    situation: z.object({ label: text(40), note: text(160) }).strict(),
  }).strict(),
  kpis: z.object({
    airQuality: z.object({ value: z.number().min(0).max(1000).nullable(), scale: text(20), pollutant: text(12), band: AirBand, asOf: isoTime.nullable(), trend, tag: EpistemicTag }).strict(),
    peopleAtRisk: z.object({ total: nullableCount, changePercent: z.number().min(-1000).max(1000).nullable(), communities: nullableCount, trend, tag: EpistemicTag }).strict(),
    affectedAreas: z.object({ count: nullableCount, unit: text(24), trend, tag: EpistemicTag }).strict(),
    resourceShortfall: z.object({ criticalItems: nullableCount, actionNeeded: z.boolean(), tag: EpistemicTag }).strict(),
  }).strict(),
  /** A schematic map, not a geographic one: x and y are 0..100 positions on a drawn sketch. */
  map: z.object({
    schematic: z.literal(true),
    note: text(160),
    layers: z.array(z.object({ id, label: text(40), defaultOn: z.boolean() }).strict()).max(8),
    areas: z.array(z.object({ id, name: text(40), aqi: z.number().min(0).max(1000).nullable(), band: AirBand, x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict()).max(24),
  }).strict(),
  groups: z.array(z.object({ id, label: text(60), icon: GroupIcon, count: nullableCount, sharePercent: percent }).strict()).max(8),
  shortfall: z.array(z.object({
    id, item: text(60), type: ItemType,
    requested: nullableCount, available: nullableCount, shortfall: nullableCount,
    /** Until a documented priority rule exists the stub supplies the value; the engineer replaces it with a rule-derived one. */
    priority: Priority, tag: EpistemicTag,
  }).strict()).max(20),
  updates: z.array(z.object({ id, at: isoTime, text: text(200), kind: UpdateKind }).strict()).max(30),
  assist: z.object({
    title: text(40),
    subtitle: text(120),
    /** Shown under the input. Must state honestly what answers the panel gives. */
    footnote: text(200),
    quickActions: z.array(z.object({ id, label: text(40) }).strict()).min(1).max(6),
    suggestions: z.array(z.object({ id, label: text(30) }).strict()).max(6),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.synthetic && !/synthetic/i.test(value.syntheticLabel)) ctx.addIssue({ code: 'custom', message: 'a synthetic overview must say so in its label', path: ['syntheticLabel'] });
  const shares = value.groups.map((g) => g.sharePercent).filter((s): s is number => s !== null);
  if (shares.length === value.groups.length && shares.length > 0) {
    const sum = shares.reduce((a, b) => a + b, 0);
    if (sum < 98 || sum > 102) ctx.addIssue({ code: 'custom', message: `group shares add up to ${sum}, not about 100`, path: ['groups'] });
  }
  for (const row of value.shortfall) {
    if (row.requested !== null && row.available !== null && row.shortfall !== null && row.shortfall > row.requested) {
      ctx.addIssue({ code: 'custom', message: `${row.item}: a shortfall cannot exceed what was requested`, path: ['shortfall'] });
    }
  }
});

export type Overview = z.infer<typeof OverviewSchema>;

export function parseOverview(input: unknown): Overview {
  return OverviewSchema.parse(input);
}

/** The ways a count is shown: null is "Unknown", never 0. */
export function formatCount(value: number | null): string {
  return value === null ? 'Unknown' : value.toLocaleString('en-US');
}

/** The screen's source of data. The stub provider and a future API provider both implement it, so the screen never knows which it has. */
export interface OverviewProvider {
  load(): Promise<Overview>;
}
