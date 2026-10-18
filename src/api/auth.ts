import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AegisError } from '../engine/errors.js';
import type { Clock } from '../engine/clock.js';
import type { AegisConfig } from '../config/config.js';
import { DEMO_LOGIN_IDS, DEV_USERS, createApiSession, ensureDevUser, findApiSession, findDemoUser, type ApiUser } from '../data/repos/apiAuth.js';
import { SessionBody } from '../types/api-schemas.js';
import type { Principal } from '../types/domain.js';
import { canUseOperationalTools } from '../roles/access.js';

type Db = import('better-sqlite3').Database;

export interface AuthDeps {
  db: Db;
  clock: Clock;
  config: AegisConfig;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    apiUser?: ApiUser;
  }
}

function userResponse(user: ApiUser): { userId: string; displayName: string; role: string; tenantId: string; tenantName: string; plan: string; isAdmin: boolean } {
  return {
    userId: user.principal.userId,
    displayName: user.displayName,
    role: user.principal.role,
    tenantId: user.principal.tenantId,
    tenantName: user.tenantName,
    plan: user.principal.plan ?? 'standard',
    isAdmin: user.principal.isAdmin === true,
  };
}

export function registerSessionRoute(app: FastifyInstance, deps: AuthDeps): void {
  app.post('/api/session', async (request) => {
    if (deps.config.authMode !== 'demo') throw new AegisError('E_DEMO_AUTH_DISABLED');
    const input = SessionBody.parse(request.body);
    // Only the named synthetic identities may sign in this way. A real (Google) account is never opened by knowing its id (S0038 finding 1).
    const isDev = DEV_USERS.some((entry) => entry.userId === input.userId);
    if (!DEMO_LOGIN_IDS.includes(input.userId) && !(isDev && deps.config.env !== 'cloud')) throw new AegisError('E_AUTH_REQUIRED');
    if (isDev) ensureDevUser(deps.db, input.userId);
    const user = findDemoUser(deps.db, input.userId);
    if (user !== null && user.email) throw new AegisError('E_AUTH_REQUIRED');
    if (user === null) throw new AegisError('E_AUTH_REQUIRED');

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const createdAt = deps.clock.now();
    const expiresAt = new Date(Date.parse(createdAt) + 8 * 60 * 60 * 1000).toISOString();
    createApiSession(deps.db, tokenHash, user.principal.userId, createdAt, expiresAt);
    return { token, expiresAt, user: userResponse(user) };
  });
}

export async function authenticateRequest(request: FastifyRequest, deps: AuthDeps): Promise<void> {
  const routeUrl = request.routeOptions.url;
  const samplePin = routeUrl === '/public/environment/sample-pin';
  if (!request.url.startsWith('/api/') && !samplePin) return;
  if (routeUrl === '/api/health' || routeUrl === '/api/session' || routeUrl?.startsWith('/api/auth/')) return;

  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer [0-9a-f]{64}$/i.test(authorization)) {
    throw new AegisError('E_AUTH_REQUIRED');
  }
  const token = authorization.slice('Bearer '.length);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = findApiSession(deps.db, tokenHash);
  if (session === null) throw new AegisError('E_AUTH_REQUIRED');
  if (Date.parse(session.expiresAt) <= Date.parse(deps.clock.now())) throw new AegisError('E_AUTH_EXPIRED');
  request.principal = session.principal;
  request.apiUser = session;
  if (!canUseOperationalTools(session.principal)) {
    const chatWrite = (request.method === 'POST' && ['/api/chat', '/api/helper', '/api/conversations'].includes(routeUrl ?? ''))
      || (['PATCH', 'DELETE'].includes(request.method) && routeUrl === '/api/conversations/:id');
    const writes = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (samplePin || routeUrl?.startsWith('/api/credits') || routeUrl?.startsWith('/api/bookmarks') || (writes && !chatWrite)) {
      throw new AegisError('E_FORBIDDEN_ROLE', 'Pro or Admin access is required for operational tools. Standard accounts can view information and use AI chat.');
    }
  }
}

export function principalFrom(request: FastifyRequest): Principal {
  if (!request.principal) throw new AegisError('E_AUTH_REQUIRED');
  return request.principal;
}

export function userFrom(request: FastifyRequest): ApiUser {
  if (!request.apiUser) throw new AegisError('E_AUTH_REQUIRED');
  return request.apiUser;
}
