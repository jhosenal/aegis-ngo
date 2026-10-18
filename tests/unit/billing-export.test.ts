import { describe, expect, it } from 'vitest';
import { billingFromEnv, createBillingSource } from '../../src/services/billingExport.js';

const T = 'proj.Aegis.gcp_billing_export_resource_v1_X';
const reply = (rows: unknown[][]) => new Response(JSON.stringify({ jobComplete: true, rows: rows.map((r) => ({ f: r.map((v) => ({ v })) })) }), { status: 200 });

describe('Google billing export reader', () => {
  it('returns cost, credits and the net that reached the card by service, with one parameterised read-only query', async () => {
    const seen: { url: string; body: { query: string; queryParameters: unknown[] }; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => { seen.push({ url, body: JSON.parse(init.body), auth: init.headers['authorization'] ?? null }); return reply([['Cloud Run', '4.32245', '-4.322535', '1791957600', '1792213200'], ['Gemini API', '0.000008', '0', '1792087200', '1792090800']]); }) as unknown as typeof fetch;
    const src = createBillingSource({ table: T, auth: 'gcloud', token: async () => 'tok', fetchImpl, now: () => new Date('2026-10-17T10:00:00Z') });
    const r = await src.report();
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.month).toBe('2026-10');
    expect(r.rows[0]).toMatchObject({ service: 'Cloud Run', costUsd: 4.32245 });
    expect(r.costUsd).toBeCloseTo(4.322458, 6); expect(r.creditsUsd).toBeCloseTo(-4.322535, 6); expect(r.netUsd).toBeCloseTo(-0.000077, 6);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.auth).toBe('Bearer tok');
    expect(seen[0]!.body.query).toMatch(/^SELECT /); expect(seen[0]!.body.query).not.toMatch(/INSERT|UPDATE|DELETE|DROP/i);
    expect(seen[0]!.body.query).toContain('@since'); expect(JSON.stringify(seen[0]!.body.queryParameters)).toContain('2026-10-01');
    await src.report();                                              // cached: no second query
    expect(seen).toHaveLength(1);
    await src.report(true);
    expect(seen).toHaveLength(2);
  });
  it('says plainly when it cannot read the export, refuses a table name that is not project.dataset.table, and is off without the setting', async () => {
    const denied = createBillingSource({ table: T, auth: 'gcloud', token: async () => 'tok', fetchImpl: (async () => new Response(JSON.stringify({ error: { message: 'Access Denied: Table' } }), { status: 403 })) as unknown as typeof fetch });
    expect(await denied.report()).toMatchObject({ available: false, reason: expect.stringContaining('403') });
    expect(() => createBillingSource({ table: 'x`; DROP TABLE y; --', auth: 'gcloud' })).toThrow(/project.dataset.table/);
    expect(billingFromEnv({})).toBeNull();
  });
});
