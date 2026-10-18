import type { FastifyInstance } from 'fastify';
import { userFrom } from '../auth.js';

export function registerMeRoute(app: FastifyInstance): void {
  app.get('/api/me', async (request) => {
    const user = userFrom(request);
    return {
      userId: user.principal.userId,
      displayName: user.displayName,
      role: user.principal.role,
      tenantId: user.principal.tenantId,
      tenantName: user.tenantName,
      plan: user.principal.plan ?? 'standard',
      isAdmin: user.principal.isAdmin === true,
      email: user.email ?? null,
    };
  });
}
