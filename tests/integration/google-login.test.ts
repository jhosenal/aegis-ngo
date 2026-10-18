import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { seedAll } from '../../src/services/seed.js';
import { createApp } from '../../src/api/server.js';
import type { FastifyInstance } from 'fastify';

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const ENV = {
  AEGIS_ENV: 'test',
  AEGIS_DB_PATH: ':memory:',
  AEGIS_GOOGLE_LOGIN_CLIENT_ID: CLIENT_ID,
  AEGIS_GOOGLE_LOGIN_CLIENT_SECRET: 'stub-secret',
  AEGIS_PUBLIC_BASE_URL: 'http://localhost:8799',
  AEGIS_GOOGLE_LOGIN_ADMINS: 'Boss@Example.com',
  AEGIS_GOOGLE_LOGIN_PRO: 'pro@example.com',
};
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function idToken(overrides: Record<string, unknown>): string {
  const claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, email: 'boss@example.com', email_verified: true, sub: 'sub-1', name: 'Boss Person', ...overrides };
  return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
}

function harness(claims: Record<string, unknown> = {}, tokenStatus = 200) {
  const db = openDb(':memory:');
  const ids = new SeqIdGen();
  migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
  seedAll(db, fixturesDirectory, new FixedClock('2026-10-13T00:00:00Z'), ids);
  const sent: string[] = [];
  let nonce = '';
  let current = claims;
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    sent.push(init.body);
    return new Response(JSON.stringify({ id_token: idToken({ nonce, ...current }) }), { status: tokenStatus });
  }) as unknown as typeof fetch;
  const app = createApp({ db, clock: new FixedClock(new Date().toISOString()), ids, config: loadConfig(ENV), fetchImpl });
  apps.push(app);
  async function start(returnTo?: string) {
    const res = await app.inject({ method: 'GET', url: '/api/auth/google' + (returnTo ? `?${new URLSearchParams({ returnTo })}` : ''), headers: { host: 'localhost:8799' } });
    const location = new URL(String(res.headers.location));
    nonce = location.searchParams.get('nonce') ?? '';
    return { res, location, state: location.searchParams.get('state') ?? '', cookie: String(res.headers['set-cookie']).split(';')[0]! };
  }
  async function callback(as: Record<string, unknown> = {}, returnTo?: string) {
    current = { ...current, ...as };
    const { state, cookie } = await start(returnTo);
    return app.inject({ method: 'GET', url: `/api/auth/google/callback?code=abc&state=${state}`, headers: { cookie } });
  }
  async function terms() { return (await app.inject({ method: 'GET', url: '/api/auth/terms' })).json() as { version: string; sections: unknown[] }; }
  async function register(location: string, extra: Record<string, unknown> = {}) {
    const ticket = /#register=(.+)$/.exec(location)![1]!;
    const t = await terms();
    return app.inject({ method: 'POST', url: '/api/auth/register', payload: { ticket, displayName: 'Boss', acceptTerms: true, termsVersion: t.version, ...extra } });
  }
  const me = async (token: string) => (await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } })).json() as Record<string, unknown>;
  return { app, db, start, callback, register, terms, me, sent };
}

describe('Google sign-in and registration', () => {
  it('reports itself off when not configured', async () => {
    const app = createApp({ db: openDb(':memory:'), clock: new FixedClock('2026-10-13T00:00:00Z'), ids: new SeqIdGen(), config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) });
    apps.push(app);
    expect(((await app.inject({ method: 'GET', url: '/api/auth/providers' })).json() as { google: boolean }).google).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/auth/google' })).statusCode).not.toBe(302);
  });

  it('starts with state, nonce and PKCE S256, and an HttpOnly cookie bound to the state', async () => {
    const { start } = harness();
    const { res, location, state, cookie } = await start();
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:8799/api/auth/google/callback');
    expect(cookie).toBe(`aegis_oauth=${state}`);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/);
  });

  it('serves the terms publicly, with a version', async () => {
    const { terms } = harness();
    const t = await terms();
    expect(t.version).toMatch(/draft/);
    expect(t.sections.length).toBeGreaterThan(8);
  });

  it('moves a preview-host start to the configured host before setting any OAuth cookie', async () => {
    const { app, sent } = harness();
    const res = await app.inject({ method: 'GET', url: '/api/auth/google?returnTo=%2Fadmin', headers: { host: 'preview.example.test' } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:8799/api/auth/google?returnTo=%2Fadmin');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/assist?next=https://evil.example'])('never redirects a signed-in account to untrusted return path %s', async (returnTo) => {
    const h = harness();
    await h.register(String((await h.callback()).headers.location));
    expect(String((await h.callback({}, returnTo)).headers.location)).toMatch(/^\/assist#aegis_session=/);
  });

  it('keeps the admin return path through first registration and a returning sign-in', async () => {
    const h = harness();
    const first = await h.callback({}, '/admin');
    expect(first.headers.location).toMatch(/^\/admin#register=/);
    await h.register(String(first.headers.location));
    expect((await h.callback({}, '/admin')).headers.location).toMatch(/^\/admin#aegis_session=/);
  });

  it('sends a new Google account to registration; it needs the terms accepted, then creates a workspace and signs in; the owner list makes it admin', async () => {
    const h = harness();
    const cb = await h.callback();
    const location = String(cb.headers.location);
    expect(location).toMatch(/^\/assist#register=/);
    const ticket = /#register=(.+)$/.exec(location)![1]!;
    expect((await h.app.inject({ method: 'POST', url: '/api/auth/register/preview', payload: { ticket } })).json()).toEqual({ email: 'boss@example.com', displayName: 'Boss Person', returning: false });
    expect((await h.app.inject({ method: 'GET', url: `/api/auth/register?ticket=${ticket}` })).statusCode).not.toBe(200);   // no ticket in any URL (finding 5)
    expect((await h.register(location, { acceptTerms: false })).statusCode).toBe(400);
    expect((await h.register(location, { termsVersion: 'old' })).statusCode).toBe(400);
    expect((await h.register(location, { displayName: 'x' })).statusCode).toBe(400);
    const done = await h.register(location);
    expect(done.statusCode).toBe(200);
    const profile = await h.me(done.json().token);
    expect(profile).toMatchObject({ displayName: 'Boss', role: 'coordinator', isAdmin: true, plan: 'standard', email: 'boss@example.com' });
    expect(String(profile.tenantId)).toMatch(/^TENANT-G-/);
    expect((await h.register(location)).statusCode).toBe(401);
    const row = h.db.prepare('SELECT terms_version, terms_accepted_at FROM users WHERE email = ?').get('boss@example.com') as { terms_version: string; terms_accepted_at: string };
    expect(row.terms_version).toBe((await h.terms()).version);
    expect(row.terms_accepted_at).toBeTruthy();
  });

  it('signs a returning account straight in, and the Pro list makes a Pro user who can reach the Pro mode flag', async () => {
    const h = harness({ email: 'pro@example.com', sub: 'sub-pro', name: 'Pro Person' });
    const first = await h.register(String((await h.callback()).headers.location));
    expect((await h.me(first.json().token))).toMatchObject({ plan: 'pro', isAdmin: false });
    const again = await h.callback();
    expect(String(again.headers.location)).toMatch(/^\/assist#aegis_session=[0-9a-f]{64}&expires=/);
    const token = /aegis_session=([0-9a-f]{64})/.exec(String(again.headers.location))![1]!;
    expect((await h.me(token)).plan).toBe('pro');
  });

  it('keeps administration for administrators', async () => {
    const h = harness();
    const admin = (await h.register(String((await h.callback()).headers.location))).json().token as string;
    const other = harness({ email: 'someone@example.com', sub: 'sub-2' });
    const user = (await other.register(String((await other.callback()).headers.location))).json().token as string;
    expect((await other.app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${user}` } })).statusCode).toBe(403);
    const list = await h.app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${admin}` } });
    expect(list.statusCode).toBe(200);
    const target = (list.json().users as { userId: string }[])[0]!.userId;
    expect((await h.app.inject({ method: 'POST', url: `/api/admin/users/${target}`, headers: { authorization: `Bearer ${admin}` }, payload: { plan: 'pro' } })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: `/api/admin/users/${target}`, headers: { authorization: `Bearer ${admin}` }, payload: { isAdmin: false } })).statusCode).toBe(400);
  });

  it('signup cannot self-assign Pro or Admin through submitted form fields', async () => {
    const h = harness({ email: 'standard@example.com', sub: 'sub-standard' });
    const done = await h.register(String((await h.callback()).headers.location), { plan: 'pro', isAdmin: true });
    expect(await h.me(done.json().token)).toMatchObject({ plan: 'standard', isAdmin: false });
  });

  it.each([
    ['an unverified email', { email_verified: false }],
    ['the wrong audience', { aud: 'other-client' }],
    ['the wrong issuer', { iss: 'https://evil.example' }],
    ['an expired token', { exp: 1 }],
    ['a replayed or wrong nonce', { nonce: 'not-the-nonce' }],
  ])('refuses %s', async (_label, claims) => {
    const h = harness(claims);
    expect(String((await h.callback()).headers.location)).toBe('/?login_error=token');
  });

  it('refuses a callback without the matching cookie, with an unknown state, after a reuse, and when Google refuses the code', async () => {
    const { app, start } = harness();
    const first = await start();
    expect(String((await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=abc&state=${first.state}` })).headers.location)).toBe('/?login_error=state');
    const second = await start();
    expect(String((await app.inject({ method: 'GET', url: '/api/auth/google/callback?code=abc&state=nope', headers: { cookie: second.cookie } })).headers.location)).toBe('/?login_error=state');
    const third = await start();
    await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=abc&state=${third.state}`, headers: { cookie: third.cookie } });
    expect(String((await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=abc&state=${third.state}`, headers: { cookie: third.cookie } })).headers.location)).toBe('/?login_error=state');
    const bad = harness({}, 400);
    expect(String((await bad.callback()).headers.location)).toBe('/?login_error=exchange');
  });

  it('local dev bypass: DEV-ADMIN and DEV-PRO sign in outside the cloud and are refused in the cloud', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'DEV-ADMIN' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ displayName: 'hosen Choong', isAdmin: true, plan: 'pro' });
    h.db.prepare("UPDATE users SET display_name = 'Dev Admin (local)' WHERE user_id = 'DEV-ADMIN'").run();
    const renamed = await h.app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'DEV-ADMIN' } });
    expect(renamed.json().user.displayName).toBe('hosen Choong');
    const cloudDb = openDb(':memory:');
    const ids = new SeqIdGen();
    migrate(cloudDb, migrationDirectory, '2026-10-13T00:00:00Z');
    seedAll(cloudDb, fixturesDirectory, new FixedClock('2026-10-13T00:00:00Z'), ids);
    const cloud = createApp({ db: cloudDb, clock: new FixedClock(new Date().toISOString()), ids, config: loadConfig({ AEGIS_ENV: 'cloud', PORT: '8080', AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo' }) });
    apps.push(cloud);
    expect((await cloud.inject({ method: 'POST', url: '/api/session', payload: { userId: 'DEV-ADMIN' } })).statusCode).toBe(401);
    expect(cloudDb.prepare("SELECT 1 FROM users WHERE user_id = 'DEV-ADMIN'").get()).toBeUndefined();
  });

  it('local Google preview: only when Google is not configured and not in the cloud; first time a ticket, then straight in', async () => {
    const db = openDb(':memory:');
    const ids = new SeqIdGen();
    migrate(db, migrationDirectory, '2026-10-13T00:00:00Z');
    seedAll(db, fixturesDirectory, new FixedClock('2026-10-13T00:00:00Z'), ids);
    const app = createApp({ db, clock: new FixedClock(new Date().toISOString()), ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) });
    apps.push(app);
    expect((await app.inject({ method: 'GET', url: '/api/auth/providers' })).json()).toEqual({ google: false, localPreview: true, devSignIn: true });
    const first = (await app.inject({ method: 'POST', url: '/api/auth/dev-google', payload: {} })).json() as { ticket: string };
    expect(first.ticket).toBeTruthy();
    const t = (await app.inject({ method: 'GET', url: '/api/auth/terms' })).json() as { version: string };
    const done = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ticket: first.ticket, displayName: 'Preview', acceptTerms: true, termsVersion: t.version } });
    expect(done.statusCode).toBe(200);
    expect(((await app.inject({ method: 'POST', url: '/api/auth/dev-google', payload: {} })).json() as { token: string }).token).toMatch(/^[0-9a-f]{64}$/);
    const cloud = createApp({ db: openDb(':memory:'), clock: new FixedClock('2026-10-13T00:00:00Z'), ids, config: loadConfig({ AEGIS_ENV: 'cloud', PORT: '8080', AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo' }) });
    apps.push(cloud);
    expect((await cloud.inject({ method: 'GET', url: '/api/auth/providers' })).json()).toEqual({ google: false, localPreview: false, devSignIn: false });
    expect((await cloud.inject({ method: 'POST', url: '/api/auth/dev-google', payload: {} })).statusCode).not.toBe(200);
  });

  it('S0038-1 knowing a real account id never opens it through the demo sign-in, in any environment, including administrators', async () => {
    const h = harness();
    const done = await h.register(String((await h.callback()).headers.location));
    expect(done.statusCode).toBe(200);
    const userId = (await h.me(done.json().token)).userId as string;
    expect(userId).toMatch(/^USER-G-/);
    expect((await h.app.inject({ method: 'POST', url: '/api/session', payload: { userId } })).statusCode).toBe(401);
    const cloud = createApp({ db: h.db, clock: new FixedClock(new Date().toISOString()), ids: new SeqIdGen(), config: loadConfig({ AEGIS_ENV: 'cloud', PORT: '8080', AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo' }) });
    apps.push(cloud);
    expect((await cloud.inject({ method: 'POST', url: '/api/session', payload: { userId } })).statusCode).toBe(401);
    expect((await cloud.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD' } })).statusCode).toBe(200);
    for (const row of h.db.prepare("SELECT user_id FROM users WHERE email IS NOT NULL").all() as { user_id: string }[]) {
      expect((await cloud.inject({ method: 'POST', url: '/api/session', payload: { userId: row.user_id } })).statusCode).toBe(401);
    }
  });

  it('S0038-4 an administrator revocation survives the next sign-in while the email stays on the list; every change is audited; issued sessions lose the right at once', async () => {
    const h = harness();
    const first = await h.register(String((await h.callback()).headers.location));
    const adminToken = first.json().token as string;
    const adminId = (await h.me(adminToken)).userId as string;
    expect((await h.me(adminToken)).isAdmin).toBe(true);
    // a second admin-listed person is not needed: another administrator revokes the first
    h.db.prepare("UPDATE users SET is_admin = 1 WHERE user_id = 'USER-A-COORD'").run();
    const other = (await h.app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'DEV-ADMIN' } })).json().token as string;
    const revoke = await h.app.inject({ method: 'POST', url: `/api/admin/users/${adminId}`, headers: { authorization: `Bearer ${other}` }, payload: { isAdmin: false, plan: 'standard' } });
    expect(revoke.statusCode).toBe(200);
    expect((await h.me(adminToken)).isAdmin).toBe(false);                                   // the already-issued session is demoted immediately
    expect((await h.app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${adminToken}` } })).statusCode).toBe(403);
    const again = await h.callback();                                                       // signs in again: the list must not restore it
    const token = /aegis_session=([0-9a-f]{64})/.exec(String(again.headers.location))![1]!;
    expect((await h.me(token)).isAdmin).toBe(false);
    const audit = await h.app.inject({ method: 'GET', url: '/api/admin/audit', headers: { authorization: `Bearer ${other}` } });
    const changes = audit.json().changes as { actor: string; target: string; beforeAdmin: boolean; afterAdmin: boolean }[];
    expect(changes.some((c) => c.actor === 'bootstrap-list' && c.target === adminId && c.afterAdmin)).toBe(true);
    expect(changes.some((c) => c.actor === 'DEV-ADMIN' && c.target === adminId && c.beforeAdmin && !c.afterAdmin)).toBe(true);
  });

  it('S0038-5 an expired or used registration ticket cannot be replayed', async () => {
    const h = harness();
    const location = String((await h.callback()).headers.location);
    const ticket = /#register=(.+)$/.exec(location)![1]!;
    expect((await h.register(location)).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: '/api/auth/register/preview', payload: { ticket } })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url: '/api/auth/register/preview', payload: { ticket: 'nope' } })).statusCode).toBe(401);
  });

  it('S0038-6 a returning account must accept a newer terms version, and real registration stays closed in the cloud while the terms have placeholders', async () => {
    const h = harness();
    const done = await h.register(String((await h.callback()).headers.location));
    expect(done.statusCode).toBe(200);
    h.db.prepare("UPDATE users SET terms_version = 'older' WHERE email = 'boss@example.com'").run();
    const again = await h.callback();
    expect(String(again.headers.location)).toMatch(/^\/assist#register=/);
    const ticket = /#register=(.+)$/.exec(String(again.headers.location))![1]!;
    expect((await h.app.inject({ method: 'POST', url: '/api/auth/register/preview', payload: { ticket } })).json()).toMatchObject({ returning: true });
    const t = await h.terms();
    expect((await h.app.inject({ method: 'POST', url: '/api/auth/register', payload: { ticket, acceptTerms: false, termsVersion: t.version } })).statusCode).toBe(400);
    const ok = await h.app.inject({ method: 'POST', url: '/api/auth/register', payload: { ticket, acceptTerms: true, termsVersion: t.version } });
    expect(ok.statusCode).toBe(200);
    expect((await h.me(ok.json().token)).email).toBe('boss@example.com');
    expect((h.db.prepare("SELECT terms_version FROM users WHERE email = 'boss@example.com'").get() as { terms_version: string }).terms_version).toBe(t.version);
    // cloud + placeholders in the terms text: closed
    const cloudDb = openDb(':memory:');
    const ids = new SeqIdGen();
    migrate(cloudDb, migrationDirectory, '2026-10-13T00:00:00Z');
    seedAll(cloudDb, fixturesDirectory, new FixedClock('2026-10-13T00:00:00Z'), ids);
    const cloud = createApp({ db: cloudDb, clock: new FixedClock(new Date().toISOString()), ids, config: loadConfig({ ...ENV, AEGIS_DB_PATH: undefined, AEGIS_ENV: 'cloud', PORT: '8080', AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo', AEGIS_PUBLIC_BASE_URL: 'https://demo.example' }), fetchImpl: (async () => new Response(JSON.stringify({ id_token: 'x' }))) as unknown as typeof fetch });
    apps.push(cloud);
    // the real terms have no placeholders left, so the cloud is open (an unknown ticket is a 401, not the 400 "not open yet")
    expect((await cloud.inject({ method: 'POST', url: '/api/auth/register', payload: { ticket: 'x', acceptTerms: true, termsVersion: t.version, displayName: 'Boss' } })).statusCode).toBe(401);
    // a terms file with an unfilled [placeholder] closes it
    const dir = mkdtempSync(join(tmpdir(), 'terms-'));
    const open = JSON.parse(readFileSync(fileURLToPath(new URL('../../content/legal/terms.json', import.meta.url)), 'utf8'));
    open.sections[0].text += ' Contact: [to be confirmed]';
    writeFileSync(join(dir, 'terms.json'), JSON.stringify(open));
    const closed = createApp({ db: openDb(':memory:'), clock: new FixedClock(new Date().toISOString()), ids, config: loadConfig({ ...ENV, AEGIS_DB_PATH: undefined, AEGIS_ENV: 'cloud', PORT: '8080', AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo', AEGIS_PUBLIC_BASE_URL: 'https://demo.example' }), termsFile: join(dir, 'terms.json') });
    apps.push(closed);
    expect((await closed.inject({ method: 'POST', url: '/api/auth/register', payload: { ticket: 'x', acceptTerms: true, termsVersion: t.version, displayName: 'Boss' } })).statusCode).toBe(400);
    rmSync(dir, { recursive: true, force: true });
  });

  it('S0038-8 account-wide spend is visible to platform administrators only', async () => {
    const h = harness();
    const coordinator = (await h.app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD' } })).json().token as string;
    expect((await h.app.inject({ method: 'GET', url: '/api/budget', headers: { authorization: `Bearer ${coordinator}` } })).statusCode).toBe(403);
    const admin = (await h.app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'DEV-ADMIN' } })).json().token as string;
    expect((await h.app.inject({ method: 'GET', url: '/api/budget', headers: { authorization: `Bearer ${admin}` } })).statusCode).toBe(200);
  });

  it('rejects incomplete or unsafe configuration', () => {
    expect(() => loadConfig({ AEGIS_ENV: 'test', AEGIS_GOOGLE_LOGIN_CLIENT_ID: 'x' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...ENV, AEGIS_GOOGLE_LOGIN_ADMINS: 'not-an-email' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...ENV, AEGIS_ENV: 'cloud', PORT: '8080', AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo', AEGIS_PUBLIC_BASE_URL: 'http://x.example' })).toThrow(/https/);
  });
});
