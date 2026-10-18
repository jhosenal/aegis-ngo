import type { FastifyInstance } from 'fastify';
import type { AegisConfig } from '../../config/config.js';

export function registerHealthRoute(app: FastifyInstance, config: AegisConfig): void {
  app.get('/api/health', async () => ({
    status: 'ok' as const,
    env: config.env,
    storage: config.storageMode === 'sqlite-local' ? 'local' as const : 'ephemeral-demo' as const,
    providerMode: config.providerMode,
    modelsEnabled: config.modelsEnabled,
    // True only on the owner's own computer: the app is in local mode (never cloud or test), and AEGIS_LOCAL_AUTOLOGIN=true is set. The Admin Desk then signs in as the local admin by itself.
    localAutoLogin: config.env === 'local' && process.env['AEGIS_LOCAL_AUTOLOGIN'] === 'true',
  }));
}
