import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { canonicalize, hashWithDomain, sha256Hex } from '../../src/engine/canonical.js';
import { sealEvent, verifyChain, GENESIS_HASH, type AuditEventBody } from '../../src/audit/chain-core.js';
import { computeShortfall, ALGORITHM_HASH } from '../../src/registry/formulations/resource-shortfall.js';
import { BudgetLedger } from '../../src/providers/budget-ledger.js';
import { AegisError } from '../../src/engine/errors.js';

describe('canonical JSON v1 (ADR-004)', () => {
  it('sorts keys, no whitespace', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'é'] })).toBe('{"a":[true,null,"é"],"b":1}');
    expect(canonicalize({ z: { y: 2, x: 'a b' }, a: 0 })).toBe('{"a":0,"z":{"x":"a b","y":2}}');
  });
  it('NFC-normalizes strings', () => expect(canonicalize({ k: 'e\u0301' })).toBe(canonicalize({ k: '\u00e9' })));
  it('rejects decimals, undefined, bad keys, non-plain objects', () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow(AegisError);
    expect(() => canonicalize({ a: undefined })).toThrow(AegisError);
    expect(() => canonicalize({ 'a-b': 1 })).toThrow(AegisError);
    expect(() => canonicalize({ d: new Date() })).toThrow(AegisError);
    expect(() => canonicalize({ n: NaN })).toThrow(AegisError);
  });
  it('hash vectors', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashWithDomain('AEG-INPUT-v1', { a: 1 })).toBe('a525ee1992c05092a69adb96ba86b0182e6ebd8f9c7ceea344c1ee6c258e8e16');
  });
});

const q = (units: number | null, over: Partial<{ unitId: string; regionId: string; asOf: string }> = {}) =>
  ({ units, unitId: 'UNIT.WATER_KIT', regionId: 'REGION.DEMO_A', asOf: '2026-10-13T00:00:00Z', ...over });
const code = (fn: () => unknown) => { try { fn(); return 'NO_ERROR'; } catch (e) { return (e as AegisError).code; } };

describe('AEG.F.RESOURCE-SHORTFALL/1.0.0 (REQ-010)', () => {
  it('120/85/5 -> usable 80, shortfall 40, surplus 0 with frozen hashes', () => {
    const o = computeShortfall({ demand: q(120), available: q(85), reserve: q(5) });
    expect([o.usableUnits, o.shortfallUnits, o.surplusUnits]).toEqual([80, 40, 0]);
    expect(o.algorithmHash).toBe('1fd27b8a48713b2d7583d8df4f4a3b902d2573900b2eb4713c9f95dcc3ac2ef6');
    expect(ALGORITHM_HASH).toBe(o.algorithmHash);
    expect(o.canonicalInputHash).toBe('d7de266b480c7f7fee0078d8d34258fe898c8bfba67cc116c3e3941e59a68d90');
  });
  it('surplus, zero demand, zero reserve, exact match', () => {
    expect(computeShortfall({ demand: q(50), available: q(85), reserve: q(5) })).toMatchObject({ usableUnits: 80, shortfallUnits: 0, surplusUnits: 30 });
    expect(computeShortfall({ demand: q(0), available: q(10), reserve: q(0) })).toMatchObject({ shortfallUnits: 0, surplusUnits: 10 });
    expect(computeShortfall({ demand: q(80), available: q(85), reserve: q(5) })).toMatchObject({ shortfallUnits: 0, surplusUnits: 0 });
    expect(computeShortfall({ demand: q(7), available: q(0), reserve: q(0) })).toMatchObject({ usableUnits: 0, shortfallUnits: 7 });
  });
  it('rejects invalid input with exact codes', () => {
    expect(code(() => computeShortfall({ demand: q(null), available: q(85), reserve: q(5) }))).toBe('E_INPUT_NULL');
    expect(code(() => computeShortfall({ demand: q(-1), available: q(85), reserve: q(5) }))).toBe('E_INPUT_NOT_NONNEG_INT');
    expect(code(() => computeShortfall({ demand: q(1.5), available: q(85), reserve: q(5) }))).toBe('E_INPUT_NOT_NONNEG_INT');
    expect(code(() => computeShortfall({ demand: q(10), available: q(5), reserve: q(6) }))).toBe('E_RESERVE_EXCEEDS_AVAILABLE');
    expect(code(() => computeShortfall({ demand: q(10), available: q(5, { unitId: 'UNIT.TENT' }), reserve: q(1) }))).toBe('E_UNIT_MISMATCH');
    expect(code(() => computeShortfall({ demand: q(10), available: q(5, { regionId: 'REGION.DEMO_B' }), reserve: q(1) }))).toBe('E_REGION_MISMATCH');
    expect(code(() => computeShortfall({ demand: q(10), available: q(5, { asOf: '2026-10-12T00:00:00Z' }), reserve: q(1) }))).toBe('E_ASOF_MISMATCH');
    expect(code(() => computeShortfall({ demand: q(10), available: q(5, { asOf: 'yesterday' }), reserve: q(1) }))).toBe('E_ASOF_INVALID');
  });
  it('is replay-stable', () => {
    const i = { demand: q(120), available: q(85), reserve: q(5) };
    expect(computeShortfall(i)).toEqual(computeShortfall(structuredClone(i)));
  });
});

const body = (n: number, prev: string): AuditEventBody => ({
  eventId: `EVT-${n}`, productId: 'AEG', tenantId: 'TENANT-A', sequence: n, previousHash: prev, eventType: 'workflow.completed',
  actorIdentity: 'user-1', actorRole: 'coordinator', occurredAt: `2026-10-13T00:0${n}:00Z`, workflowId: 'AEG.W.RESOURCE-ASSESSMENT', workflowVersion: '1.0.0',
  inputSnapshotHash: 'a'.repeat(64), resultHash: 'b'.repeat(64), versions: { formulation: 'AEG.F.RESOURCE-SHORTFALL/1.0.0' }, payloadHash: null, correlationKey: `K-${n}`,
});
const mk = () => { const e1 = sealEvent(body(1, GENESIS_HASH)); const e2 = sealEvent(body(2, e1.hash)); const e3 = sealEvent(body(3, e2.hash)); return [e1, e2, e3]; };
const scope = { productId: 'AEG', tenantId: 'TENANT-A' };

describe('audit chain (REQ-012)', () => {
  it('frozen hash vectors', () => {
    const [e1, e2, e3] = mk();
    expect(e1!.hash).toBe('5a4b9893f238dde1aa0b63a90aa436ec8a45931c779cb42e45f477665d5f4348');
    expect(e2!.hash).toBe('03def2224ed918ac0dc53be8971d2844f7725ca18598eb0025d2f0ac383d335f');
    expect(e3!.hash).toBe('7f773ab82131bd91e4305ed91ee1eedc1e7ea58a2fe56b8b52ced0edcd1f7bd6');
  });
  it('valid chain verifies and matches checkpoint', () => {
    const ev = mk();
    expect(verifyChain(ev, scope, { sequence: 3, hash: ev[2]!.hash }).ok).toBe(true);
  });
  it('detects payload edit', () => {
    const ev = mk(); ev[1] = { ...ev[1]!, resultHash: 'c'.repeat(64) };
    expect(verifyChain(ev, scope).errors.map((e) => e.code)).toContain('HASH_MISMATCH');
  });
  it('detects middle deletion and reorder', () => {
    const ev = mk();
    expect(verifyChain([ev[0]!, ev[2]!], scope).errors.map((e) => e.code)).toEqual(expect.arrayContaining(['SEQ_GAP', 'PREV_MISMATCH']));
    expect(verifyChain([ev[0]!, ev[2]!, ev[1]!], scope).ok).toBe(false);
  });
  it('tail truncation is detected ONLY with a trusted checkpoint', () => {
    const ev = mk();
    expect(verifyChain(ev.slice(0, 2), scope).ok).toBe(true);
    expect(verifyChain(ev.slice(0, 2), scope, { sequence: 3, hash: ev[2]!.hash }).errors.map((e) => e.code)).toContain('CHECKPOINT_BEYOND_CHAIN');
  });
  it('detects replaced history against checkpoint, and wrong scope', () => {
    const ev = mk();
    const forged = [sealEvent({ ...body(1, GENESIS_HASH), eventType: 'forged' })]; 
    forged.push(sealEvent(body(2, forged[0]!.hash)), sealEvent(body(3, sealEvent(body(2, forged[0]!.hash)).hash)));
    const res = verifyChain(forged, scope, { sequence: 3, hash: ev[2]!.hash });
    expect(res.ok).toBe(false); expect(res.errors.map((e) => e.code)).toContain('CHECKPOINT_MISMATCH');
    expect(verifyChain(ev, { productId: 'AEG', tenantId: 'TENANT-B' }).errors.map((e) => e.code)).toContain('WRONG_SCOPE');
  });
});

describe('budget ledger (REQ-009)', () => {
  const run = (db: string, attempt: string, amount: number) => new Promise<{ ok: boolean; reason?: string }>((res, rej) => {
    const p = spawn(process.execPath, ['--import', 'tsx', 'tests/unit/helpers/reserve-worker.ts', db, attempt, String(amount)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.on('close', (c) => (c === 0 ? res(JSON.parse(out)) : rej(new Error('worker exit ' + c))));
  });
  it('4 concurrent processes each asking 60 of 100 -> exactly one reserves', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'aegis-bud-')), 'b.db');
    const db = new Database(path); db.pragma('journal_mode = WAL'); new BudgetLedger(db, { accountMicro: 100, dayMicro: 100, taskMicro: 100 }); db.close();
    const results = await Promise.all(['a1', 'a2', 'a3', 'a4'].map((a) => run(path, a, 60)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.reason === 'ACCOUNT_LIMIT')).toBe(true);
  }, 30000);
  it('liability keeps the reservation; release frees it; settle uses actual; unknown price blocks', () => {
    const db = new Database(':memory:'); const l = new BudgetLedger(db, { accountMicro: 100, dayMicro: 100, taskMicro: 100 });
    const p = (id: string, amt: number, price: string | null = 'P1') => ({ reservationId: 'R' + id, taskId: 'T' + id, attemptId: id, dayKey: '2026-10-13', maxMicro: amt, priceSnapshotId: price, now: 'n' });
    expect(l.reserve(p('1', 60)).ok).toBe(true);
    expect(l.reserve(p('2', 60))).toEqual({ ok: false, reason: 'ACCOUNT_LIMIT' });
    l.markLiability('R1', 'n');                                   // timeout after possible charge
    expect(l.reserve(p('3', 60)).ok).toBe(false);                 // still held
    l.settle('R1', 10, 'n');                                      // reconciled: actual 10
    expect(l.totals().committedMicro).toBe(10);
    expect(l.reserve(p('4', 60)).ok).toBe(true);
    l.release('R4', 'n'); expect(l.totals().committedMicro).toBe(10);
    expect(l.reserve(p('5', 1, null))).toEqual({ ok: false, reason: 'NO_PRICE' });
    expect(l.reserve(p('4', 1))).toEqual({ ok: false, reason: 'DUPLICATE_ATTEMPT' });
  });
  it('per-task and per-day limits are enforced independently', () => {
    const db = new Database(':memory:'); const l = new BudgetLedger(db, { accountMicro: 1000, dayMicro: 100, taskMicro: 50 });
    const base = { dayKey: '2026-10-13', priceSnapshotId: 'P', now: 'n' };
    expect(l.reserve({ ...base, reservationId: 'a', taskId: 'T', attemptId: 'a', maxMicro: 40 }).ok).toBe(true);
    expect(l.reserve({ ...base, reservationId: 'b', taskId: 'T', attemptId: 'b', maxMicro: 20 })).toEqual({ ok: false, reason: 'TASK_LIMIT' });
    expect(l.reserve({ ...base, reservationId: 'c', taskId: 'U', attemptId: 'c', maxMicro: 50 }).ok).toBe(true);
    expect(l.reserve({ ...base, reservationId: 'd', taskId: 'V', attemptId: 'd', maxMicro: 20 })).toEqual({ ok: false, reason: 'DAY_LIMIT' });
  });
});
