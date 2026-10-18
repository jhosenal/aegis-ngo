import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = import('better-sqlite3').Database;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });

  const db = new Database(path) as Db;
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  return db;
}

export function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}
