import type { FastifyInstance } from 'fastify';
import type { AuthDeps } from '../auth.js';
import { registerSessionRoute } from '../auth.js';

export function registerSessionRoutes(app: FastifyInstance, deps: AuthDeps): void {
  registerSessionRoute(app, deps);
}
