// CONTRACT FILE: request validation. Every object is .strict(): unknown keys (e.g. ownerId, tenantId, role) are REJECTED, never ignored.
import { z } from 'zod';
import { CHAT_MODES } from '../roles/modes.js';
import { MAX_ATTACHMENTS_PER_MESSAGE } from './domain.js';

const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
const units = z.number().int().min(0).max(1_000_000_000);
const isoZ = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);

export const SessionBody = z.object({ userId: id }).strict();
export const CardRef = z.object({ cardId: id, revision: z.number().int().min(1) }).strict();

/** Omitted field => filled from the tenant's resources row. Explicit null => UNKNOWN (never coerced to 0). */
export const RunAssessmentBody = z.object({
  incidentCardId: id, incidentRevision: z.number().int().min(1),
  regionId: id, unitId: id, asOf: isoZ.optional(),
  demandUnits: units.nullable().optional(),
  availableUnits: units.nullable().optional(),
  reserveUnits: units.nullable().optional(),
  idempotencyKey: id.optional(),
}).strict();

export const ChatBody = z.object({
  text: z.string().min(1).max(2000),
  attachments: z.array(CardRef).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
  idempotencyKey: id.optional(),
  mode: z.enum(CHAT_MODES).default('auto'),
  /** The centre of the map the person is looking at, so "the nearest hospital" can mean here. Optional. */
  view: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().optional(),
}).strict();

export type SessionBodyT = z.infer<typeof SessionBody>;
export type RunAssessmentBodyT = z.infer<typeof RunAssessmentBody>;
export type ChatBodyT = z.infer<typeof ChatBody>;
