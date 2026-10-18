import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthDeps } from '../auth.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AegisError } from '../../engine/errors.js';
import { changeUserFlags, createApiSession, createGoogleUser, emailTaken, findUserByGoogleSub, getUserFlags, recordTermsAcceptance, termsVersionOf, type ApiUser } from '../../data/repos/apiAuth.js';

const termsFile = fileURLToPath(new URL('../../../content/legal/terms.json', import.meta.url));
const TICKET_TTL_MS = 15 * 60 * 1000;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 200;
const COOKIE = 'aegis_oauth';

interface Pending { verifier: string; nonce: string; expires: number; returnTo: string }
const LOGIN_RETURN_PATHS = new Set(['/assist', '/dashboard', '/admin', '/history', '/domains', '/overview', '/workspace']);
/** `userId` is set when a returning account must accept newer terms (no new account is created). */
interface Ticket { sub: string; email: string; name: string; expires: number; userId?: string }
export interface GoogleLoginDeps extends AuthDeps { fetchImpl?: typeof fetch; /** Test seam: the terms file. */ termsFile?: string }

const b64url = (buffer: Buffer): string => buffer.toString('base64url');

function cookieValue(request: FastifyRequest, name: string): string {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return '';
}

/** Decodes the payload of an id_token received directly from Google's token endpoint over TLS (the case where Google says the signature need not be re-checked); every claim is still validated. */
function idTokenClaims(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/**
 * Google sign-in for named admin accounts (S0037). Authorization-code flow with PKCE, state bound to the browser by a short-lived cookie and to the
 * server by an in-memory record, nonce checked in the id_token, verified email required. A known Google account signs in; a new one gets a short-lived
 * registration ticket and must accept the current terms before an account (with its own tenant) is created. The owner's AEGIS_GOOGLE_LOGIN_ADMINS and
 * AEGIS_GOOGLE_LOGIN_PRO email lists grant admin and Pro at sign-in. The session is the same hashed bearer token the demo sign-in uses; it is handed to the page in the
 * URL fragment, which is never sent to a server or written to a log.
 */
export function registerGoogleLoginRoutes(app: FastifyInstance, deps: GoogleLoginDeps): void {
  const cfg = deps.config.googleLogin;
  const secure = cfg.baseUrl.startsWith('https://');
  const pending = new Map<string, Pending>();
  const tickets = new Map<string, Ticket>();
  const doFetch = deps.fetchImpl ?? fetch;
  const redirectUri = `${cfg.baseUrl}/api/auth/google/callback`;
  const clearCookie = `${COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

  const previewStub = deps.config.env !== 'cloud' && !cfg.enabled;
  app.get('/api/auth/providers', async () => ({ google: cfg.enabled, localPreview: previewStub, devSignIn: deps.config.env !== 'cloud' }));

  const termsPath = deps.termsFile ?? termsFile;
  const readTerms = (): { version: string; title: string; status: string; sections: { heading: string; text: string }[] } => JSON.parse(readFileSync(termsPath, 'utf8'));
  const startSession = (userId: string): { token: string; expiresAt: string } => {
    const token = randomBytes(32).toString('hex');
    const createdAt = deps.clock.now();
    const expiresAt = new Date(Date.parse(createdAt) + 8 * 60 * 60 * 1000).toISOString();
    createApiSession(deps.db, createHash('sha256').update(token).digest('hex'), userId, createdAt, expiresAt);
    return { token, expiresAt };
  };
  /**
   * The single authority for privileges (S0038 finding 4): the owner's email lists only BOOTSTRAP an account, at sign-in, until an administrator (or the
   * admin tool) changes that account; that change locks it, so a revocation survives the next sign-in and removing an email from the list alone revokes nothing.
   * Every change is audited with actor, target, before and after. Sessions read the stored flags on every request, so a revocation applies at once.
   */
  const applyGrants = (userId: string, email: string): void => {
    const current = getUserFlags(deps.db, userId);
    if (current === null || current.locked) return;
    const flags: { plan?: 'pro'; isAdmin?: true } = {};
    if (cfg.adminEmails.includes(email)) flags.isAdmin = true;
    if (cfg.proEmails.includes(email)) flags.plan = 'pro';
    changeUserFlags(deps.db, { actor: 'bootstrap-list', userId, flags, lock: false, now: deps.clock.now() });
  };
  /** Terms with an unfilled [placeholder] (operator or contact) may not be accepted by real people in the cloud (S0038 finding 6). */
  const registrationOpen = (): boolean => {
    if (deps.config.env !== 'cloud') return true;
    const terms = readTerms();
    return ![terms.status, terms.title, ...terms.sections.flatMap((section) => [section.heading, section.text])].some((text) => /\[[^\]]+\]/.test(text));
  };

  app.get('/api/auth/terms', async () => readTerms());

  /** The ticket travels in the request body, never in a URL (S0038 finding 5). */
  app.post('/api/auth/register/preview', async (request) => {
    if (!registrationOpen()) throw new AegisError('E_VALIDATION', 'Registration is not open yet: the terms still need the operator and contact details.');
    const ticket = tickets.get(String(((request.body ?? {}) as Record<string, unknown>).ticket ?? ''));
    if (!ticket || ticket.expires <= Date.now()) throw new AegisError('E_AUTH_REQUIRED', 'This registration link has expired. Sign in with Google again.');
    return { email: ticket.email, displayName: ticket.name, returning: ticket.userId !== undefined };
  });

  app.post('/api/auth/register', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (!registrationOpen()) throw new AegisError('E_VALIDATION', 'Registration is not open yet: the terms still need the operator and contact details.');
    const key = typeof body.ticket === 'string' ? body.ticket : '';
    const ticket = tickets.get(key);
    if (!ticket || ticket.expires <= Date.now()) throw new AegisError('E_AUTH_REQUIRED', 'This registration link has expired. Sign in with Google again.');
    const terms = readTerms();
    if (body.acceptTerms !== true || body.termsVersion !== terms.version) throw new AegisError('E_VALIDATION', 'You must accept the current terms to continue.');
    if (ticket.userId !== undefined) {
      recordTermsAcceptance(deps.db, ticket.userId, terms.version, deps.clock.now());
      tickets.delete(key);
      return startSession(ticket.userId);
    }
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    // eslint-disable-next-line no-control-regex
    if (displayName.length < 2 || displayName.length > 50 || /[\u0000-\u001f<>]/.test(displayName)) throw new AegisError('E_VALIDATION', 'Display name must be 2 to 50 characters.');
    if (findUserByGoogleSub(deps.db, ticket.sub) !== null || emailTaken(deps.db, ticket.email)) {
      tickets.delete(key);
      throw new AegisError('E_VALIDATION', 'An account for this Google sign-in already exists. Sign in again.');
    }
    const suffix = randomBytes(5).toString('hex');
    const userId = `USER-G-${suffix}`;
    createGoogleUser(deps.db, { userId, tenantId: `TENANT-G-${suffix}`, email: ticket.email, googleSub: ticket.sub, displayName, termsVersion: terms.version, now: deps.clock.now() });
    tickets.delete(key);
    applyGrants(userId, ticket.email);
    return startSession(userId);
  });

  /** Local UI preview of Google sign-in (never in the cloud, never when real Google is configured): the same first-time and returning flows with a fixed fake identity. */
  if (previewStub) {
    app.post('/api/auth/dev-google', async () => {
      const sub = 'dev-stub-google';
      const email = 'preview.user@example.test';
      const known = findUserByGoogleSub(deps.db, sub);
      if (known) {
        applyGrants(known.principal.userId, email);
        if (termsVersionOf(deps.db, known.principal.userId) !== readTerms().version) {
          const again = b64url(randomBytes(24));
          tickets.set(again, { sub, email, name: known.displayName, expires: Date.now() + TICKET_TTL_MS, userId: known.principal.userId });
          return { ticket: again };
        }
        return startSession(known.principal.userId);
      }
      const ticketId = b64url(randomBytes(24));
      tickets.set(ticketId, { sub, email, name: 'Preview Person', expires: Date.now() + TICKET_TTL_MS });
      return { ticket: ticketId };
    });
  }
  if (!cfg.enabled) return;

  const fail = (reply: FastifyReply, code: string): FastifyReply => {
    reply.header('Set-Cookie', clearCookie);
    return reply.redirect(`/?login_error=${code}`);
  };

  app.get('/api/auth/google', async (request, reply) => {
    const requested = (request.query as Record<string, unknown>).returnTo;
    const returnTo = typeof requested === 'string' && LOGIN_RETURN_PATHS.has(requested) ? requested : '/assist';
    // Move to the configured host BEFORE creating its host-only cookie and process-local state.
    // A preview-host cookie/state cannot complete a callback served by the canonical revision.
    if (request.headers.host?.toLowerCase() !== new URL(cfg.baseUrl).host.toLowerCase()) {
      return reply.redirect(`${cfg.baseUrl}/api/auth/google?${new URLSearchParams({ returnTo })}`);
    }
    const now = Date.now();
    for (const [key, value] of pending) if (value.expires <= now) pending.delete(key);
    if (pending.size >= MAX_PENDING) return fail(reply, 'busy');
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(16));
    pending.set(state, { verifier, nonce, expires: now + PENDING_TTL_MS, returnTo });
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    reply.header('Set-Cookie', `${COOKIE}=${state}; Path=/api/auth; Max-Age=600; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
    return reply.redirect(url.toString());
  });

  app.get('/api/auth/google/callback', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const state = typeof query.state === 'string' ? query.state : '';
    const code = typeof query.code === 'string' ? query.code : '';
    const record = pending.get(state);
    pending.delete(state);
    if (typeof query.error === 'string') return fail(reply, 'denied');
    if (!record || record.expires <= Date.now() || cookieValue(request, COOKIE) !== state || !code) return fail(reply, 'state');

    let idToken = '';
    try {
      const response = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: record.verifier,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return fail(reply, 'exchange');
      const body = await response.json() as { id_token?: unknown };
      idToken = typeof body.id_token === 'string' ? body.id_token : '';
    } catch {
      return fail(reply, 'exchange');
    }

    const claims = idTokenClaims(idToken);
    const email = typeof claims?.email === 'string' ? claims.email.toLowerCase() : '';
    const aud = claims?.aud;
    const exp = typeof claims?.exp === 'number' ? claims.exp : 0;
    const audienceOk = Array.isArray(aud) ? aud.includes(cfg.clientId) : aud === cfg.clientId;
    if (!claims || !ISSUERS.includes(String(claims.iss)) || !audienceOk || exp * 1000 <= Date.now()
      || claims.nonce !== record.nonce || claims.email_verified !== true || !email) return fail(reply, 'token');
    const sub = typeof claims.sub === 'string' ? claims.sub : '';
    if (!sub) return fail(reply, 'token');
    reply.header('Set-Cookie', clearCookie);
    const known: ApiUser | null = findUserByGoogleSub(deps.db, sub);
    if (known === null) {
      if (emailTaken(deps.db, email)) return fail(reply, 'account_exists');
      const now = Date.now();
      for (const [key, value] of tickets) if (value.expires <= now) tickets.delete(key);
      if (tickets.size >= MAX_PENDING) return fail(reply, 'busy');
      const ticketId = b64url(randomBytes(24));
      tickets.set(ticketId, { sub, email, name: typeof claims.name === 'string' ? claims.name.slice(0, 50) : '', expires: now + TICKET_TTL_MS });
      return reply.redirect(`${record.returnTo}#register=${ticketId}`);
    }
    applyGrants(known.principal.userId, email);
    if (termsVersionOf(deps.db, known.principal.userId) !== readTerms().version) {
      const again = b64url(randomBytes(24));
      tickets.set(again, { sub, email, name: known.displayName, expires: Date.now() + TICKET_TTL_MS, userId: known.principal.userId });
      return reply.redirect(`${record.returnTo}#register=${again}`);
    }
    const session = startSession(known.principal.userId);
    return reply.redirect(`${record.returnTo}#aegis_session=${session.token}&expires=${encodeURIComponent(session.expiresAt)}`);
  });
}
