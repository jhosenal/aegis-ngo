import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AegisError } from '../../src/engine/errors.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'aegis-tsk002-'));
  temporaryDirectories.push(directory);
  return directory;
}

function migrationDirectory(destination: string): string {
  const migrationFile = fileURLToPath(new URL('../../migrations/001_init.sql', import.meta.url));
  copyFileSync(migrationFile, join(destination, '001_init.sql'));
  return destination;
}

function runInitialMigration(db: ReturnType<typeof openDb>): void {
  migrate(db, fileURLToPath(new URL('../../migrations', import.meta.url)), '2026-01-01T00:00:00.000Z');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('database and migrations', () => {
  it('migrate applies every migration once and is idempotent', () => {
    const db = openDb(':memory:');
    try {
      const first = migrate(db, fileURLToPath(new URL('../../migrations', import.meta.url)), '2026-01-01T00:00:00.000Z');
      const second = migrate(db, fileURLToPath(new URL('../../migrations', import.meta.url)), '2026-01-02T00:00:00.000Z');

      expect(first.applied).toEqual(['001_init.sql', '002_accounts.sql', '003_admin_audit.sql', '004_chat_debug.sql', '005_broadcast.sql', '006_air_readings.sql', '007_official_snapshots.sql', '008_broadcast_reviews.sql', '009_pin_observations.sql', '010_station_readings.sql', '011_broadcast_review_log.sql', '012_credits_bookmarks.sql', '013_pin_catalog.sql', '014_essential_places.sql', '015_bulletin_pipeline.sql', '016_conversations.sql', '017_bulletin_voice.sql', '018_bulletin_translation.sql', '019_translation_memory.sql', '020_bulletin_edit_log.sql', '021_job_sheet.sql', '022_job_kinds.sql', '023_api_switch.sql']);
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(['001_init.sql', '002_accounts.sql', '003_admin_audit.sql', '004_chat_debug.sql', '005_broadcast.sql', '006_air_readings.sql', '007_official_snapshots.sql', '008_broadcast_reviews.sql', '009_pin_observations.sql', '010_station_readings.sql', '011_broadcast_review_log.sql', '012_credits_bookmarks.sql', '013_pin_catalog.sql', '014_essential_places.sql', '015_bulletin_pipeline.sql', '016_conversations.sql', '017_bulletin_voice.sql', '018_bulletin_translation.sql', '019_translation_memory.sql', '020_bulletin_edit_log.sql', '021_job_sheet.sql', '022_job_kinds.sql', '023_api_switch.sql']);
    } finally {
      db.close();
    }
  });

  it('foreign keys are enforced', () => {
    const db = openDb(':memory:');
    try {
      runInitialMigration(db);
      expect(() => db.prepare(
        'INSERT INTO users (user_id, tenant_id, role, display_name) VALUES (?, ?, ?, ?)',
      ).run('USER-1', 'MISSING', 'analyst', 'Synthetic User')).toThrow();
    } finally {
      db.close();
    }
  });

  it('audit_events rejects update and delete', () => {
    const db = openDb(':memory:');
    try {
      runInitialMigration(db);
      db.prepare(
        'INSERT INTO audit_events (event_id, product_id, tenant_id, sequence, previous_hash, hash, body_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('EVENT-1', 'AEG', 'SYSTEM', 1, 'GENESIS', 'HASH', '{}');

      expect(() => db.prepare('UPDATE audit_events SET body_json = ? WHERE event_id = ?').run('{"changed":true}', 'EVENT-1')).toThrow();
      expect(() => db.prepare('DELETE FROM audit_events WHERE event_id = ?').run('EVENT-1')).toThrow();
    } finally {
      db.close();
    }
  });

  it('active formulation is immutable but can be deprecated', () => {
    const db = openDb(':memory:');
    try {
      runInitialMigration(db);
      db.prepare(
        'INSERT INTO formulation_registry (formulation_id, version, state, algorithm_hash, spec_json, effective_from) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('AEG.F.TEST', '1.0.0', 'active', 'HASH-1', '{}', '2026-01-01T00:00:00.000Z');

      expect(() => db.prepare('UPDATE formulation_registry SET algorithm_hash = ? WHERE formulation_id = ?').run('HASH-2', 'AEG.F.TEST')).toThrow();
      db.prepare('UPDATE formulation_registry SET state = ? WHERE formulation_id = ?').run('deprecated', 'AEG.F.TEST');
      expect(db.prepare('SELECT state FROM formulation_registry WHERE formulation_id = ?').get('AEG.F.TEST')).toEqual({ state: 'deprecated' });
    } finally {
      db.close();
    }
  });

  it('restart persistence', () => {
    const directory = createTemporaryDirectory();
    const path = join(directory, 'nested', 'aegis.db');
    const first = openDb(path);
    runInitialMigration(first);
    first.prepare('INSERT INTO tenants (tenant_id, product_id, name) VALUES (?, ?, ?)').run('TENANT-1', 'AEG', 'Synthetic Tenant');
    first.close();

    const second = openDb(path);
    try {
      expect(second.prepare('SELECT name FROM tenants WHERE tenant_id = ?').get('TENANT-1')).toEqual({ name: 'Synthetic Tenant' });
    } finally {
      second.close();
    }
  });

  it('removed migration file is detected', () => {
    const directory = createTemporaryDirectory();
    migrationDirectory(directory);
    const db = openDb(':memory:');
    try {
      migrate(db, directory, '2026-01-01T00:00:00.000Z');
      rmSync(join(directory, '001_init.sql'));

      expect(() => migrate(db, directory, '2026-01-02T00:00:00.000Z')).toThrow(AegisError);
    } finally {
      db.close();
    }
  });

  it('wal mode on files, not on memory', () => {
    const memoryDb = openDb(':memory:');
    expect(memoryDb.pragma('journal_mode', { simple: true })).toBe('memory');
    memoryDb.close();

    const directory = createTemporaryDirectory();
    const fileDb = openDb(join(directory, 'aegis.db'));
    try {
      expect(fileDb.pragma('journal_mode', { simple: true })).toBe('wal');
    } finally {
      fileDb.close();
    }
  });
});
