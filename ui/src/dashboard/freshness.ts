/** The one-hour life of a live Google reading, as three visible stages (owner design 2026-10-17). Pure, so it can be tested without a browser. */
export const TTL_MS = 60 * 60 * 1000;
export const WARN_MS = 10 * 60 * 1000;   // the last ten minutes: 50 to 60 minutes after retrieval
export type Stage = 'live' | 'warning' | 'expired';

/** The moment a reading stops being shown: one hour after retrieval, or its own deadline if that is sooner. Unreadable times fail closed (NaN). */
export function deadlineOf(fetchedAt: string | null | undefined, validUntil?: string | null): number {
  const fetched = fetchedAt ? Date.parse(fetchedAt) : NaN;
  if (!Number.isFinite(fetched)) return NaN;
  const until = validUntil ? Date.parse(validUntil) : NaN;
  return Number.isFinite(until) ? Math.min(fetched + TTL_MS, until) : fetched + TTL_MS;
}

export function stageOf(deadline: number, now: number): { stage: Stage; leftMs: number } {
  const leftMs = Math.max(0, deadline - now);
  return { stage: leftMs <= 0 ? 'expired' : leftMs <= WARN_MS ? 'warning' : 'live', leftMs };
}

export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
