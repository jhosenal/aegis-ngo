import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, exportChain, loadChain, verifyStored } from '../../src/audit/chainStore.js';
import { GENESIS_HASH, sealEvent, verifyChain, type AuditEventBody } from '../../src/audit/chain-core.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { RandomIdGen, SeqIdGen } from '../../src/engine/ids.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const workerPath = fileURLToPath(new URL('./helpers/append-worker.ts', import.meta.url));
const verifierPath = fileURLToPath(new URL('../../tools/verify-audit.ts', import.meta.url));

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'aegis-tsk004-'));
  temporaryDirectories.push(directory);
  return directory;
}

function makeDb(path = ':memory:') {
  const db = openDb(path);
  migrate(db, migrationDirectory, '2026-10-13T01:00:00Z');
  return db;
}

function newEvent(tenantId = 'TENANT-A') {
  return {
    productId: 'AEG',
    tenantId,
    eventType: 'test.created',
    actorIdentity: 'synthetic-user',
    actorRole: 'coordinator',
    occurredAt: '2026-10-13T01:00:00Z',
    workflowId: null,
    workflowVersion: null,
    inputSnapshotHash: null,
    resultHash: null,
    versions: {},
    payloadHash: null,
    correlationKey: null,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('audit chain store and verifier', () => {
  it('serializes 100 concurrent appends from two OS processes into one contiguous chain', async () => {
    const databasePath = join(makeDirectory(), 'audit.db');
    const setup = makeDb(databasePath);
    setup.close();
    const args = [
      '--import', 'tsx', workerPath, databasePath, 'TENANT-A', '50',
    ];
    const runWorker = () => execFileAsync(process.execPath, args, { windowsHide: true });
    await Promise.all([runWorker(), runWorker()]);

    const db = openDb(databasePath);
    try {
      const events = loadChain(db, { productId: 'AEG', tenantId: 'TENANT-A' });
      expect(events).toHaveLength(100);
      expect(events.map((event) => event.sequence)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
      expect(new Set(events.map((event) => event.eventId)).size).toBe(100);
      expect(verifyStored(db, { productId: 'AEG', tenantId: 'TENANT-A' }).ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it('detects edited body_json as HASH_MISMATCH at sequence 2', () => {
    const db = makeDb();
    try {
      const ids = new SeqIdGen();
      appendEvent(db, newEvent(), ids);
      const second = appendEvent(db, newEvent(), ids);
      db.exec('DROP TRIGGER audit_events_no_update');
      const { hash: _secondHash, ...secondBody } = second;
      void _secondHash;
      secondBody.actorIdentity = 'changed';
      db.prepare('UPDATE audit_events SET body_json = ? WHERE sequence = ? AND tenant_id = ?')
        .run(JSON.stringify(secondBody), 2, 'TENANT-A');

      const result = verifyStored(db, { productId: 'AEG', tenantId: 'TENANT-A' });
      expect(result.errors.some((error) => error.code === 'HASH_MISMATCH' && error.sequence === 2)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('detects a deleted middle event as SEQ_GAP and PREV_MISMATCH', () => {
    const db = makeDb();
    try {
      const ids = new SeqIdGen();
      for (let index = 0; index < 3; index += 1) appendEvent(db, newEvent(), ids);
      db.exec('DROP TRIGGER audit_events_no_delete');
      db.prepare('DELETE FROM audit_events WHERE sequence = ? AND tenant_id = ?').run(2, 'TENANT-A');

      const codes = verifyStored(db, { productId: 'AEG', tenantId: 'TENANT-A' }).errors.map((error) => error.code);
      expect(codes).toContain('SEQ_GAP');
      expect(codes).toContain('PREV_MISMATCH');
    } finally {
      db.close();
    }
  });

  it('accepts tail truncation without a checkpoint and rejects it with a trusted checkpoint', () => {
    const db = makeDb();
    try {
      const ids = new SeqIdGen();
      for (let index = 0; index < 3; index += 1) appendEvent(db, newEvent(), ids);
      const checkpoint = { sequence: 3, hash: loadChain(db, { productId: 'AEG', tenantId: 'TENANT-A' })[2]!.hash };
      db.exec('DROP TRIGGER audit_events_no_delete');
      db.prepare('DELETE FROM audit_events WHERE sequence = ? AND tenant_id = ?').run(3, 'TENANT-A');

      expect(verifyStored(db, { productId: 'AEG', tenantId: 'TENANT-A' }).ok).toBe(true);
      expect(verifyStored(db, { productId: 'AEG', tenantId: 'TENANT-A' }, checkpoint).errors.map((error) => error.code))
        .toContain('CHECKPOINT_BEYOND_CHAIN');
    } finally {
      db.close();
    }
  });

  it('reports WRONG_SCOPE when events are checked against another tenant', () => {
    const db = makeDb();
    try {
      appendEvent(db, newEvent('TENANT-A'), new SeqIdGen());
      const events = loadChain(db, { productId: 'AEG', tenantId: 'TENANT-A' });
      const result = verifyChain(events, { productId: 'AEG', tenantId: 'TENANT-B' });
      expect(result.errors.some((error) => error.code === 'WRONG_SCOPE')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('rejects UPDATE and DELETE through append-only triggers', () => {
    const db = makeDb();
    try {
      const event = appendEvent(db, newEvent(), new SeqIdGen());
      expect(() => db.prepare('UPDATE audit_events SET body_json = ? WHERE event_id = ?').run('{}', event.eventId)).toThrow();
      expect(() => db.prepare('DELETE FROM audit_events WHERE event_id = ?').run(event.eventId)).toThrow();
    } finally {
      db.close();
    }
  });

  it('exports a chain for CLI verification and rejects a modified export', async () => {
    const directory = makeDirectory();
    const db = makeDb();
    try {
      appendEvent(db, newEvent(), new SeqIdGen());
      const exportPath = join(directory, 'audit-export.json');
      writeFileSync(exportPath, JSON.stringify(exportChain(db, { productId: 'AEG', tenantId: 'TENANT-A' })));
      const cliArgs = ['--import', 'tsx', verifierPath, exportPath];
      const valid = await execFileAsync(process.execPath, cliArgs, { windowsHide: true });
      expect(valid.stdout.trim()).toBe('OK');

      const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as { events: Array<{ actorIdentity: string }> };
      exported.events[0]!.actorIdentity = 'changed';
      writeFileSync(exportPath, JSON.stringify(exported));
      await expect(execFileAsync(process.execPath, cliArgs, { windowsHide: true })).rejects.toMatchObject({ code: 1 });
    } finally {
      db.close();
    }
  });

  it('full rewrite with matching checkpoint is not detectable (documented limit)', () => {
    const body: AuditEventBody = {
      eventId: 'EVT-FORGED-1',
      productId: 'AEG',
      tenantId: 'TENANT-A',
      sequence: 1,
      previousHash: GENESIS_HASH,
      eventType: 'test.forged',
      actorIdentity: 'synthetic-user',
      actorRole: 'coordinator',
      occurredAt: '2026-10-13T01:00:00Z',
      workflowId: null,
      workflowVersion: null,
      inputSnapshotHash: null,
      resultHash: null,
      versions: {},
      payloadHash: null,
      correlationKey: null,
    };
    const forged = [sealEvent(body)];
    expect(verifyChain(forged, { productId: 'AEG', tenantId: 'TENANT-A' }, {
      sequence: 1,
      hash: forged[0]!.hash,
    }).ok).toBe(true);
  });
});
