import type { FastifyInstance } from 'fastify';
import { modesFor } from '../../roles/modes.js';
import { principalFrom } from '../auth.js';
import type { AppDeps } from '../server.js';

/** The model modes this user may pick, with a plain note for each. The browser never learns model names. */
export function registerModesRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/modes', async (request) => ({
    default: 'auto' as const,
    modes: modesFor(principalFrom(request), deps.config),
  }));
}
