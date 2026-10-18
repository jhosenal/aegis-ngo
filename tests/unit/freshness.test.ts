import { describe, expect, it } from 'vitest';
import { WARN_MS, TTL_MS, deadlineOf, mmss, stageOf } from '../../ui/src/dashboard/freshness.js';

describe('freshness stages of a live reading (AEG-FRESH-001)', () => {
  const fetched = '2026-10-17T03:00:00.000Z';
  const t0 = Date.parse(fetched);
  const deadline = deadlineOf(fetched);
  it('the deadline is one hour after retrieval, or the reading\'s own sooner deadline, and bad times fail closed', () => {
    expect(deadline).toBe(t0 + TTL_MS);
    expect(deadlineOf(fetched, '2026-10-17T03:30:00.000Z')).toBe(t0 + 30 * 60_000);
    expect(deadlineOf(fetched, '2026-10-17T09:00:00.000Z')).toBe(t0 + TTL_MS);   // never longer than an hour
    expect(Number.isNaN(deadlineOf(null))).toBe(true);
    expect(Number.isNaN(deadlineOf('not a date'))).toBe(true);
  });
  it('is live for the first 50 minutes, a warning for the last 10, expired after 60', () => {
    expect(stageOf(deadline, t0).stage).toBe('live');
    expect(stageOf(deadline, t0 + 49 * 60_000 + 59_000).stage).toBe('live');
    expect(stageOf(deadline, t0 + TTL_MS - WARN_MS).stage).toBe('warning');
    expect(stageOf(deadline, t0 + 59 * 60_000).stage).toBe('warning');
    expect(stageOf(deadline, t0 + TTL_MS).stage).toBe('expired');
    expect(stageOf(deadline, t0 + 2 * TTL_MS)).toEqual({ stage: 'expired', leftMs: 0 });
  });
  it('formats the countdown as minutes and seconds', () => {
    expect(mmss(TTL_MS)).toBe('60:00');
    expect(mmss(58 * 60_000 + 12_000)).toBe('58:12');
    expect(mmss(4 * 60_000 + 30_000)).toBe('04:30');
    expect(mmss(400)).toBe('00:01');
    expect(mmss(-5)).toBe('00:00');
  });
});
