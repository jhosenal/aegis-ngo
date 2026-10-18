import { AegisError } from '../../engine/errors.js';
import type { Principal, Role } from '../../types/domain.js';
import type { Db } from '../db.js';

export interface ApiUser {
  principal: Principal;
  displayName: string;
  tenantName: string;
  email?: string | null;
}

export interface ApiSession extends ApiUser {
  expiresAt: string;
}

interface UserRow {
  user_id: string;
  tenant_id: string;
  product_id: string;
  role: string;
  display_name: string;
  tenant_name: string;
  plan: string;
  is_admin: number;
  email: string | null;
}

interface SessionRow extends UserRow {
  expires_at: string;
}

const USER_COLUMNS = 'SELECT u.user_id, u.tenant_id, t.product_id, u.role, u.display_name, t.name AS tenant_name, u.plan, u.is_admin, u.email';

export function hasAnyTenants(db: Db): boolean {
  return db.prepare('SELECT 1 AS present FROM tenants LIMIT 1').get() !== undefined;
}

function parseRole(value: string): Role {
  if (value === 'coordinator' || value === 'analyst' || value === 'viewer') return value;
  throw new AegisError('E_INTERNAL', 'Stored user role is invalid');
}

function toApiUser(row: UserRow): ApiUser {
  return {
    principal: {
      userId: row.user_id,
      tenantId: row.tenant_id,
      productId: row.product_id,
      role: parseRole(row.role),
      plan: row.plan === 'pro' ? 'pro' : 'standard',
      isAdmin: row.is_admin === 1,
    },
    displayName: row.display_name,
    tenantName: row.tenant_name,
    email: row.email,
  };
}

export function findDemoUser(db: Db, userId: string): ApiUser | null {
  const row = db.prepare(
    `${USER_COLUMNS} FROM users u JOIN tenants t ON t.tenant_id = u.tenant_id WHERE u.user_id = ?`,
  ).get(userId) as UserRow | undefined;
  return row ? toApiUser(row) : null;
}

export function userExists(db: Db, userId: string): boolean {
  return db.prepare('SELECT 1 AS present FROM users WHERE user_id = ?').get(userId) !== undefined;
}

/** Local-only sign-in bypass (like Sonic's dev sign-in): two synthetic accounts in TENANT-A. Never created or accepted when AEGIS_ENV is cloud. */
export const DEV_USERS = [
  { userId: 'DEV-ADMIN', displayName: 'hosen Choong', plan: 'pro', isAdmin: 1 },
  { userId: 'DEV-PRO', displayName: 'Dev Pro (local)', plan: 'pro', isAdmin: 0 },
] as const;

export function ensureDevUser(db: Db, userId: string): void {
  const dev = DEV_USERS.find((entry) => entry.userId === userId);
  if (!dev || db.prepare("SELECT 1 AS present FROM tenants WHERE tenant_id = 'TENANT-A'").get() === undefined) return;
  const values = [dev.userId, dev.displayName, dev.plan, dev.isAdmin] as const;
  if (dev.userId === 'DEV-ADMIN') {
    db.prepare("INSERT INTO users (user_id, tenant_id, role, display_name, plan, is_admin) VALUES (?, 'TENANT-A', 'coordinator', ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name WHERE users.tenant_id = 'TENANT-A' AND users.email IS NULL").run(...values);
  } else {
    db.prepare("INSERT OR IGNORE INTO users (user_id, tenant_id, role, display_name, plan, is_admin) VALUES (?, 'TENANT-A', 'coordinator', ?, ?, ?)").run(...values);
  }
}

export function createApiSession(db: Db, tokenHash: string, userId: string, createdAt: string, expiresAt: string): void {
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, createdAt, expiresAt);
}

export function findApiSession(db: Db, tokenHash: string): ApiSession | null {
  const row = db.prepare(
    `SELECT s.expires_at, u.user_id, u.tenant_id, t.product_id, u.role, u.display_name, t.name AS tenant_name, u.plan, u.is_admin, u.email FROM sessions s JOIN users u ON u.user_id = s.user_id JOIN tenants t ON t.tenant_id = u.tenant_id WHERE s.token_hash = ?`,
  ).get(tokenHash) as SessionRow | undefined;
  return row ? { ...toApiUser(row), expiresAt: row.expires_at } : null;
}

export function findUserByGoogleSub(db: Db, sub: string): ApiUser | null {
  const row = db.prepare(`${USER_COLUMNS} FROM users u JOIN tenants t ON t.tenant_id = u.tenant_id WHERE u.google_sub = ?`).get(sub) as UserRow | undefined;
  return row ? toApiUser(row) : null;
}

export function emailTaken(db: Db, email: string): boolean {
  return db.prepare('SELECT 1 AS present FROM users WHERE lower(email) = lower(?)').get(email) !== undefined;
}

export interface NewGoogleUser { userId: string; tenantId: string; email: string; googleSub: string; displayName: string; termsVersion: string; now: string }

/** Creates a personal workspace (its own tenant, so isolation holds) and its coordinator user in one transaction. */
export function createGoogleUser(db: Db, input: NewGoogleUser): void {
  db.transaction(() => {
    db.prepare('INSERT INTO tenants (tenant_id, product_id, name) VALUES (?, ?, ?)').run(input.tenantId, 'AEG', `${input.displayName}'s workspace`);
    db.prepare('INSERT INTO users (user_id, tenant_id, role, display_name, email, google_sub, terms_version, terms_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(input.userId, input.tenantId, 'coordinator', input.displayName, input.email, input.googleSub, input.termsVersion, input.now, input.now);
  })();
}

/** The only accounts the synthetic demo sign-in may open (S0038 finding 1). Knowing a real account's id must never authenticate it. */
export const DEMO_LOGIN_IDS: readonly string[] = ['USER-A-COORD', 'USER-A-VIEW', 'USER-B-COORD'];

export interface UserFlags { plan: 'standard' | 'pro'; isAdmin: boolean; locked: boolean }

export function getUserFlags(db: Db, userId: string): UserFlags | null {
  const row = db.prepare('SELECT plan, is_admin, flags_locked FROM users WHERE user_id = ?').get(userId) as { plan: string; is_admin: number; flags_locked: number } | undefined;
  return row ? { plan: row.plan === 'pro' ? 'pro' : 'standard', isAdmin: row.is_admin === 1, locked: row.flags_locked === 1 } : null;
}

/**
 * Changes plan and/or admin in one transaction and writes an audit row (actor, target, before and after) when something actually changes.
 * `lock` marks the account as explicitly managed so that the owner's bootstrap lists no longer re-grant what an administrator removed.
 * Returns false when the user does not exist.
 */
export function changeUserFlags(db: Db, input: { actor: string; userId: string; flags: { plan?: 'standard' | 'pro'; isAdmin?: boolean }; lock: boolean; now: string }): boolean {
  return db.transaction((): boolean => {
    const before = getUserFlags(db, input.userId);
    if (before === null) return false;
    const after = { plan: input.flags.plan ?? before.plan, isAdmin: input.flags.isAdmin ?? before.isAdmin };
    if (after.plan !== before.plan || after.isAdmin !== before.isAdmin) {
      db.prepare('UPDATE users SET plan = ?, is_admin = ? WHERE user_id = ?').run(after.plan, after.isAdmin ? 1 : 0, input.userId);
      db.prepare('INSERT INTO admin_audit (at, actor, target, before_plan, before_admin, after_plan, after_admin) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(input.now, input.actor, input.userId, before.plan, before.isAdmin ? 1 : 0, after.plan, after.isAdmin ? 1 : 0);
    }
    if (input.lock) db.prepare('UPDATE users SET flags_locked = 1 WHERE user_id = ?').run(input.userId);
    return true;
  })();
}

export interface AuditRow { at: string; actor: string; target: string; beforePlan: string; beforeAdmin: boolean; afterPlan: string; afterAdmin: boolean }
export function listAdminAudit(db: Db, limit = 100): AuditRow[] {
  return (db.prepare('SELECT at, actor, target, before_plan, before_admin, after_plan, after_admin FROM admin_audit ORDER BY audit_id DESC LIMIT ?').all(limit) as { at: string; actor: string; target: string; before_plan: string; before_admin: number; after_plan: string; after_admin: number }[])
    .map((r) => ({ at: r.at, actor: r.actor, target: r.target, beforePlan: r.before_plan, beforeAdmin: r.before_admin === 1, afterPlan: r.after_plan, afterAdmin: r.after_admin === 1 }));
}

export function termsVersionOf(db: Db, userId: string): string | null {
  return (db.prepare('SELECT terms_version FROM users WHERE user_id = ?').get(userId) as { terms_version: string | null } | undefined)?.terms_version ?? null;
}

export function recordTermsAcceptance(db: Db, userId: string, version: string, now: string): void {
  db.prepare('UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE user_id = ?').run(version, now, userId);
}

export function findUserByEmail(db: Db, email: string): ApiUser | null {
  const row = db.prepare(`${USER_COLUMNS} FROM users u JOIN tenants t ON t.tenant_id = u.tenant_id WHERE lower(u.email) = lower(?)`).get(email) as UserRow | undefined;
  return row ? toApiUser(row) : null;
}

export interface AccountRow { userId: string; email: string | null; displayName: string; plan: string; isAdmin: boolean; termsVersion: string | null; createdAt: string | null }
export function listAccounts(db: Db): AccountRow[] {
  return (db.prepare('SELECT user_id, email, display_name, plan, is_admin, terms_version, created_at FROM users WHERE email IS NOT NULL ORDER BY created_at, user_id').all() as { user_id: string; email: string | null; display_name: string; plan: string; is_admin: number; terms_version: string | null; created_at: string | null }[])
    .map((r) => ({ userId: r.user_id, email: r.email, displayName: r.display_name, plan: r.plan, isAdmin: r.is_admin === 1, termsVersion: r.terms_version, createdAt: r.created_at }));
}
