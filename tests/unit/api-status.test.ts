import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { buildApiStatus, FEED_FRESH_HOURS, type ApiStatusDeps } from '../../src/services/apiStatus.js';
import { createJob, failJob, settleJob } from '../../src/services/jobs.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const NOW = '2026-10-18T06:00:00.000Z';
const fresh = () => { const db = openDb(':memory:'); migrate(db, dir, '2026-10-17T00:00:00Z'); return db; };
const base = (db: ReturnType<typeof fresh>, over: Partial<ApiStatusDeps> = {}): ApiStatusDeps => ({ db, config: loadConfig({ AEGIS_ENV: 'local' }), nowIso: NOW, sources: [], env: null, ...over });
const row = (s: ReturnType<typeof buildApiStatus>, id: string) => s.groups.flatMap((g) => g.rows).find((r) => r.id === id)!;

describe('the API status catalogue makes no call and states only what the server knows', () => {
  it('lists the groups, and shows a service that is switched off as Off, never as Working', () => {
    const s = buildApiStatus(base(fresh()));
    expect(s.groups.map((g) => g.id)).toEqual(['ai', 'env', 'feeds']);
    for (const id of ['vertex-argon', 'translation', 'tts', 'billing-export', 'google-env', 'google-on-demand']) expect(row(s, id).state).toBe('off');
    expect(s.summary.working).toBe(0);
    expect(s.remarks.join(' ')).toMatch(/no call to any outside service/);
  });
  it('a configured service with no proof is Configured; a finished job makes it Working; a later failure makes it a Problem', () => {
    const db = fresh();
    const reviewer = { model: 'gemini-4-argon', location: 'global' };
    expect(row(buildApiStatus(base(db, { reviewer })), 'vertex-argon')).toMatchObject({ state: 'configured', lastOkAt: null });
    const job = createJob(db, { kind: 'review', bulletinId: 'B1', label: 'Script review', by: 'DEV-ADMIN', at: '2026-10-18T05:00:00.000Z', params: { inputTokens: 300, outputTokens: 200 } }).job;
    settleJob(db, job.jobId, { at: '2026-10-18T05:00:05.000Z', by: 'DEV-ADMIN', params: { inputTokens: 300, outputTokens: 200 } });
    expect(row(buildApiStatus(base(db, { reviewer })), 'vertex-argon')).toMatchObject({ state: 'working', lastOkAt: '2026-10-18T05:00:05.000Z' });
    const bad = createJob(db, { kind: 'review', bulletinId: 'B1', label: 'Script review', by: 'DEV-ADMIN', at: '2026-10-18T05:30:00.000Z', params: { inputTokens: 300, outputTokens: 200 } }).job;
    failJob(db, bad.jobId, { at: '2026-10-18T05:30:02.000Z', by: 'DEV-ADMIN', note: 'HTTP 503' });
    expect(row(buildApiStatus(base(db, { reviewer })), 'vertex-argon')).toMatchObject({ state: 'problem', lastProblemAt: '2026-10-18T05:30:02.000Z' });
  });
  it('shows each live feed from its own last poll: fresh is Working, old is only Configured, a failed poll is a Problem with its reason; demo feeds are left out', () => {
    const sources = [
      { sourceId: 'SRC.USGS.LIVE', state: 'OK' as const, lastOkAt: '2026-10-18T05:50:00.000Z', lastAttemptAt: '2026-10-18T05:50:00.000Z', detail: null },
      { sourceId: 'SRC.GDACS.LIVE', state: 'OK' as const, lastOkAt: new Date(Date.parse(NOW) - (FEED_FRESH_HOURS + 1) * 3_600_000).toISOString(), lastAttemptAt: NOW, detail: null },
      { sourceId: 'SRC.OPENMETEO.PINS', state: 'UNAVAILABLE' as const, lastOkAt: '2026-10-17T08:44:00.000Z', lastAttemptAt: '2026-10-17T14:50:00.000Z', detail: 'rate limited' },
      { sourceId: 'SRC.SYNTH_FEED_A', state: 'OK' as const, lastOkAt: '2026-10-13T00:30:00.000Z', lastAttemptAt: '2026-10-13T00:30:00.000Z', detail: null },
    ];
    const s = buildApiStatus(base(fresh(), { sources }));
    expect(row(s, 'SRC.USGS.LIVE').state).toBe('working');
    expect(row(s, 'SRC.GDACS.LIVE').state).toBe('configured');
    expect(row(s, 'SRC.OPENMETEO.PINS')).toMatchObject({ state: 'problem', lastProblemAt: '2026-10-17T14:50:00.000Z' }); expect(row(s, 'SRC.OPENMETEO.PINS').detail).toMatch(/rate limited/);
    expect(s.groups.find((g) => g.id === 'feeds')!.rows.map((r) => r.id)).not.toContain('SRC.SYNTH_FEED_A');
    expect(s.summary).toMatchObject({ working: 1, problem: 1 });
  });
  it('never contains a key or secret value', () => {
    const config = loadConfig({ AEGIS_ENV: 'local', AEGIS_GOOGLE_API_KEY: 'AIza-TEST-SECRET-123', AEGIS_REAPI_API_KEY: 'reapi-TEST-SECRET-456', AEGIS_REAPI_BASE_URL: 'https://example.invalid' });
    const text = JSON.stringify(buildApiStatus(base(fresh(), { config })));
    expect(text).not.toContain('TEST-SECRET'); expect(text).not.toContain('example.invalid');
    expect(row(buildApiStatus(base(fresh(), { config })), 'reapi').state).toBe('configured');
  });
});

describe('last called, and the switch state of a service', () => {
  it('last called is the latest attempt, success or failure, while last success is only a success; a service with no record says none', () => {
    const db = fresh(); const reviewer = { model: 'gemini-4-argon', location: 'global' };
    const ok = createJob(db, { kind: 'review', bulletinId: 'B1', label: 'Script review', by: 'DEV-ADMIN', at: '2026-10-18T05:00:00.000Z', params: { inputTokens: 300, outputTokens: 200 } }).job;
    settleJob(db, ok.jobId, { at: '2026-10-18T05:00:05.000Z', by: 'DEV-ADMIN', params: { inputTokens: 300, outputTokens: 200 } });
    const bad = createJob(db, { kind: 'review', bulletinId: 'B1', label: 'Script review', by: 'DEV-ADMIN', at: '2026-10-18T05:30:00.000Z', params: { inputTokens: 300, outputTokens: 200 } }).job;
    failJob(db, bad.jobId, { at: '2026-10-18T05:30:02.000Z', by: 'DEV-ADMIN', note: 'HTTP 503' });
    const s = buildApiStatus(base(db, { reviewer }));
    expect(row(s, 'vertex-argon')).toMatchObject({ lastCalledAt: '2026-10-18T05:30:02.000Z', lastOkAt: '2026-10-18T05:00:05.000Z', lastProblemAt: '2026-10-18T05:30:02.000Z' });
    expect(row(s, 'billing-export').lastCalledAt).toBeNull();
  });
  it('a model provider\'s last call comes from the budget reservations, and a missing table means no record, not an error', () => {
    const db = fresh();
    expect(row(buildApiStatus(base(db)), 'reapi').lastCalledAt).toBeNull();
    db.exec("CREATE TABLE budget_reservations (reservation_id TEXT, task_id TEXT, attempt_id TEXT, day_key TEXT, amount_micro INTEGER, state TEXT, settled_micro INTEGER, price_snapshot_id TEXT, created_at TEXT, updated_at TEXT, provider TEXT)");
    db.prepare("INSERT INTO budget_reservations VALUES ('r1','t1','a1','2026-10-18',100,'settled',90,'p','2026-10-18T04:00:00.000Z','2026-10-18T04:00:03.000Z','reapi')").run();
    db.prepare("INSERT INTO budget_reservations VALUES ('r2','t2','a2','2026-10-18',100,'released',NULL,'p','2026-10-18T05:00:00.000Z','2026-10-18T05:00:01.000Z','reapi')").run();
    const config = loadConfig({ AEGIS_ENV: 'local', AEGIS_REAPI_API_KEY: 'k', AEGIS_REAPI_BASE_URL: 'https://example.invalid' });
    expect(row(buildApiStatus(base(db, { config })), 'reapi')).toMatchObject({ lastCalledAt: '2026-10-18T05:00:00.000Z', lastOkAt: '2026-10-18T04:00:03.000Z' });
  });
  it('a set-up service has a switch; switched off it reads Off with who and when; a service that is not set up has none; the chat providers are switched elsewhere', () => {
    const db = fresh(); const tts = { voice: 'en-GB-Standard-B' };
    expect(row(buildApiStatus(base(db, { tts })), 'tts')).toMatchObject({ switchable: true, switchedOff: false });
    const off = row(buildApiStatus(base(db, { tts, switches: { tts: { off: true, changedBy: 'DEV-ADMIN', changedAt: '2026-10-18T05:10:00.000Z' } } })), 'tts');
    expect(off).toMatchObject({ state: 'off', switchable: true, switchedOff: true, switchedBy: 'DEV-ADMIN' }); expect(off.detail).toMatch(/Switched off by DEV-ADMIN at 2026-10-18 05:10 UTC/);
    expect(row(buildApiStatus(base(db)), 'tts')).toMatchObject({ switchable: false, switchedOff: false });
    expect(row(buildApiStatus(base(db, { switches: { 'gemini-chat': { off: true, changedBy: 'x', changedAt: 'y' } } })), 'gemini-chat').switchable).toBe(false);
  });
});
