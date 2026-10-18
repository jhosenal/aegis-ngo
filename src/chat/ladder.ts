import type { AegisConfig } from '../config/config.js';
import type { IdGen } from '../engine/ids.js';
import type { ModelGateway } from '../providers/gateway.js';
import { askManager } from '../roles/manager.js';
import type { Tier } from '../roles/modes.js';
import { ManagerProposal, validateProposal } from '../roles/validate.js';
import type { GatewayOutcome, Principal, ProviderNoticeCode } from '../types/domain.js';

/** What one tier's answer came to, as judged by code (never by the model's own confidence). */
export type Judged =
  | { kind: 'accept'; routeId: string; args: Record<string, unknown>; notice: ProviderNoticeCode | null; tier: Tier }
  | { kind: 'unavailable'; notice: ProviderNoticeCode; tier: Tier }
  | { kind: 'clarify'; tier: Tier }
  | { kind: 'denied'; routeId: string | null; code: string; tier: Tier };

/** Notices where a stronger model cannot help: out of budget, or the model refused. */
const NO_ESCALATION_NOTICES: readonly ProviderNoticeCode[] = ['BUDGET_EXHAUSTED', 'REFUSED', 'MODELS_DISABLED'];

export function judge(proposed: GatewayOutcome, principal: Principal, tier: Tier): Judged {
  if (proposed.status !== 'OK' || proposed.text === null) return { kind: 'unavailable', notice: proposed.notice ?? 'MODELS_UNAVAILABLE', tier };
  let decoded: unknown;
  try { decoded = JSON.parse(proposed.text) as unknown; } catch { decoded = null; }
  const raw = ManagerProposal.safeParse(decoded);
  if (!raw.success) return { kind: 'clarify', tier };
  if (raw.data.routeId === null || raw.data.clarification !== null) return { kind: 'clarify', tier };
  const checked = validateProposal(proposed.text, principal);
  if (!checked.ok) return { kind: 'denied', routeId: raw.data.routeId, code: checked.code, tier };
  return { kind: 'accept', routeId: checked.routeId, args: checked.args, notice: proposed.notice, tier };
}

/** A stronger tier is worth trying when the answer was unusable, but not when the problem is permission, refusal or budget. */
export function worthEscalating(result: Judged): boolean {
  switch (result.kind) {
    case 'accept': return false;
    case 'unavailable': return !NO_ESCALATION_NOTICES.includes(result.notice);
    case 'clarify': return true;
    case 'denied': return result.code !== 'E_FORBIDDEN_ROLE';
  }
}

/** Asks tier by tier, stopping at the first accepted answer. Every tier is a normal gateway call: budgeted, deadline-bound, audited. */
export async function proposeWithLadder(
  gateway: ModelGateway,
  config: AegisConfig,
  principal: Principal,
  ids: IdGen,
  text: string,
  tiers: Tier[],
): Promise<Judged> {
  let last: Judged | null = null;
  for (const [index, tier] of tiers.entries()) {
    const proposed = await askManager(gateway, config, principal, ids.next('CHAT-TASK'), text, tier.model);
    last = judge(proposed, principal, tier);
    if (!worthEscalating(last) || index === tiers.length - 1) break;
  }
  if (last === null) throw new Error('No tier was tried');
  return last;
}
