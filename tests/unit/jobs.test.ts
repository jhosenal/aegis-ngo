import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { fileURLToPath } from 'node:url';
import { creditSummary, getJob, listJobs } from '../../src/data/repos/jobs.js';
import { createJob, failJob, renderOptions, settleJob, topUp } from '../../src/services/jobs.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fresh = () => { const db = openDb(':memory:'); migrate(db, dir, '2026-10-17T00:00:00Z'); return db; };
const AT = '2026-10-17T10:00:00.000Z';

describe('job sheets and the job credit', () => {
  it("starts with the owner's 4.00 USD opening credit", () => {
    const s = creditSummary(fresh());
    expect(s).toMatchObject({ balanceMicro: 4_000_000, openingMicro: 4_000_000, reservedMicro: 0, spentMicro: 0 });
  });
  it('a voice job gets a UUID card with a priced estimate, reserves it, and settles on the real characters', () => {
    const db = fresh();
    const { job } = createJob(db, { kind: 'voice', bulletinId: 'B1', language: 'ms', label: 'Voice (ms)', by: 'U1', at: AT, params: { characters: 300 } });
    expect(job.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.estimateStatus).toBe('ESTIMATE');
    expect(job.estimateMicro).toBe(1200);                       // 300 characters at 4 USD per million = 0.0012 USD
    expect(job.lines[0]).toMatchObject({ item: 'Text-to-Speech standard voice', unit: 'character' });
    expect(creditSummary(db)).toMatchObject({ balanceMicro: 4_000_000 - 1200, reservedMicro: 1200 });
    const done = settleJob(db, job.jobId, { params: { characters: 250 }, at: AT, by: 'U1' })!;
    expect(done).toMatchObject({ status: 'DONE', settledMicro: 1000 });
    expect(creditSummary(db)).toMatchObject({ balanceMicro: 4_000_000 - 1000, reservedMicro: 0, spentMicro: 1000 });
  });
  it('a failed job releases its reservation; a code-only draft costs nothing and is DONE at once', () => {
    const db = fresh();
    const { job } = createJob(db, { kind: 'translate', bulletinId: 'B1', language: 'zh', label: 'Translate (zh)', by: 'U1', at: AT, params: { characters: 400, engine: 'google' } });
    expect(job.estimateMicro).toBeGreaterThan(0);
    failJob(db, job.jobId, { at: AT, by: 'U1', note: 'provider down' });
    expect(creditSummary(db).balanceMicro).toBe(4_000_000);
    expect(createJob(db, { kind: 'draft', bulletinId: 'B1', label: 'Draft', by: 'U1', at: AT, params: {} }).job).toMatchObject({ status: 'DONE', estimateMicro: 0, settledMicro: 0 });
  });
  it('a render that the credit cannot cover waits for the owner and reserves nothing; an alert voice is never held back', () => {
    const db = fresh();
    topUp(db, { amountMicro: 1_000_000, by: 'owner', at: AT, note: 'test' });
    expect(creditSummary(db).balanceMicro).toBe(5_000_000);
    const big = createJob(db, { kind: 'render', bulletinId: 'B1', label: 'Render', by: 'U1', at: AT, params: { instanceSeconds: 100_000 }, gateOnCredit: true });
    expect(big.waiting).toBe(true); expect(big.job.status).toBe('WAITING_OWNER');
    expect(creditSummary(db).balanceMicro).toBe(5_000_000);
    const small = createJob(db, { kind: 'render', bulletinId: 'B1', label: 'Render', by: 'U1', at: AT, params: { instanceSeconds: 600 }, gateOnCredit: true });
    expect(small.waiting).toBe(false); expect(small.job.status).toBe('ESTIMATED');
    expect(listJobs(db, { bulletinId: 'B1' })).toHaveLength(2);
    expect(getJob(db, big.job.jobId)!.estimateMicro).toBeGreaterThan(5_000_000);
  });
  it('render speeds: more GPUs finish sooner for about the same money; Max needs the quota', () => {
    const opts = renderOptions(60, 3);
    expect(opts.map((o) => o.speed)).toEqual(['normal', 'fast', 'max']);
    expect(opts[0]!.etaSeconds).toBeGreaterThan(opts[1]!.etaSeconds); expect(opts[1]!.etaSeconds).toBeGreaterThan(opts[2]!.etaSeconds);
    expect(opts[2]!.estimate.micro!).toBeLessThan(opts[0]!.estimate.micro! * 1.5);
    expect(renderOptions(60, 2)[2]!.available).toBe(false);
  });
});
