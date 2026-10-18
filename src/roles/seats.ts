import type { RuntimeRole } from '../types/domain.js';

/**
 * Role seats, modelled on how the QZEEX project runs its LLM "company" (07_REFERENCES/LLM_CFO_SOP.md there):
 * every seat has one narrow job, its own model and its own limits, cheap seats do the bulk work, the expensive seat is called
 * only for material decisions, and the hard limits (budgets, permissions, validation) live in code, never in a model.
 *
 * Aegis has one primary and one backup provider (AEGIS_PRIMARY_PROVIDER; reAPI first by default in this deployment, Google as the
 * backup), so a seat differs by MODEL and by limits. The reviewer and advisor use other makers than the manager, which gives them
 * some independence; the reviewer (gpt-6-sol) is still the same maker as the cheap seats (gpt-6-luna), as in QZEEX.
 * Models are checked against the reAPI price table of the QZEEX project (2026-10-06).
 */
export interface Seat {
  roleId: RuntimeRole;
  /** What the seat does and, as important, what it never does. */
  job: string;
  /** Default reAPI model for this seat: the backup when Google is primary, the primary when reAPI is primary. */
  reapiModel: string;
  maxInputChars: number;
  maxOutputTokens: number;
}

export const SEATS: Record<RuntimeRole, Seat> = {
  helper: {
    // 24,000: the helper's own system prompt (formulation + tool list) is about 11,100 characters and a tool result adds up to 2,200 more, so the old 12,000 failed
    // every turn whose first tool answer was longer than about 900 characters ("The LLM helper could not answer"; trace HELPER_CONTEXT_LIMIT, 2026-10-17).
    // Cost at gpt-6-luna with one token reserved per input byte: about 2,300 micro-USD per attempt, inside the 10,000 micro-USD per-request cap.
    roleId: 'helper', reapiModel: 'gpt-6-luna', maxInputChars: 24000, maxOutputTokens: 1024,
    job: 'Conversational helper with bounded history and explicit card context; may request read-only internal MCP tools. Cannot write, dispatch or authorize.',
  },
  manager: {
    roleId: 'manager', reapiModel: 'gpt-6-luna', maxInputChars: 2000, maxOutputTokens: 512,
    job: 'Proposes ONE registered route as strict JSON. Never runs it; code validates the proposal and the route allowlist decides.',
  },
  coordinator: {
    roleId: 'coordinator', reapiModel: 'gpt-6-luna', maxInputChars: 2000, maxOutputTokens: 512,
    job: 'Cheap bulk sorting and tagging into fixed JSON (the QZEEX "worker" seat).',
  },
  specialist: {
    roleId: 'specialist', reapiModel: 'gpt-6-luna', maxInputChars: 4000, maxOutputTokens: 1024,
    job: 'Writes a short summary of ONE attached card explanation. Uses only that text; never adds facts. Also translates one validated bulletin text at a time (translation-v1), never adding or removing a fact.',
  },
  reviewer: {
    roleId: 'reviewer', reapiModel: 'gpt-6-sol', maxInputChars: 6000, maxOutputTokens: 512,
    job: 'Checks a specialist summary against its source card (the QZEEX "CFO" seat). Re-checks, never trusts; can send work back. Also translates a translated bulletin text back to English for the human reviewer (translation-v1).',
  },
  advisor: {
    roleId: 'advisor', reapiModel: 'claude-opus-5-5', maxInputChars: 8000, maxOutputTokens: 1024,
    job: 'Independent second opinion on material decisions only. Has no veto and never changes a result.',
  },
};
