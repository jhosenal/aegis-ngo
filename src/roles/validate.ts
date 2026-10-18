import { z } from 'zod';
import { getRoute } from '../registry/routes.js';
import { RunAssessmentBody } from '../types/api-schemas.js';
import type { Principal } from '../types/domain.js';

export const ManagerProposal: z.ZodType<{
  routeId: string | null;
  args: Record<string, unknown>;
  clarification: string | null;
}> = z.object({
  routeId: z.string().min(1).max(120).nullable(),
  args: z.record(z.string(), z.unknown()),
  clarification: z.string().max(500).nullable(),
}).strict();

const cardArgs = z.object({
  cardId: z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/),
  revision: z.number().int().min(1).optional(),
}).strict();
const noArgs = z.object({}).strict();

function argumentSchema(routeId: string): z.ZodType<Record<string, unknown>> {
  switch (routeId) {
    case 'I_aegis_help_show':
    case 'I_aegis_incident_list':
    case 'I_aegis_audit_verify':
      return noArgs as z.ZodType<Record<string, unknown>>;
    case 'I_aegis_card_open':
    case 'I_aegis_card_explain':
      return cardArgs as z.ZodType<Record<string, unknown>>;
    case 'I_aegis_resource_assess':
      return RunAssessmentBody as z.ZodType<Record<string, unknown>>;
    default:
      return noArgs as z.ZodType<Record<string, unknown>>;
  }
}

export function validateProposal(
  raw: string,
  principal: Principal,
): { ok: true; routeId: string; args: Record<string, unknown> } | { ok: false; code: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, code: 'E_JSON_PARSE' };
  }
  const proposal = ManagerProposal.safeParse(decoded);
  if (!proposal.success || proposal.data.routeId === null) return { ok: false, code: 'E_VALIDATION' };
  let route;
  try {
    route = getRoute(proposal.data.routeId);
  } catch {
    return { ok: false, code: 'E_ROUTE_DENIED' };
  }
  if (!route.modelProposable) return { ok: false, code: 'E_ROUTE_DENIED' };
  if (!route.allowedRoles.includes(principal.role)) return { ok: false, code: 'E_FORBIDDEN_ROLE' };
  if (!argumentSchema(route.routeId).safeParse(proposal.data.args).success) {
    return { ok: false, code: 'E_VALIDATION' };
  }
  return { ok: true, routeId: route.routeId, args: proposal.data.args };
}

export function explainTextIsSafe(modelText: string, cardRendered: string): boolean {
  if (modelText.includes('<') || modelText.includes('>')) return false;
  const allowedDigits = new Set(cardRendered.match(/[0-9]+/g) ?? []);
  return (modelText.match(/[0-9]+/g) ?? []).every((digits) => allowedDigits.has(digits));
}
