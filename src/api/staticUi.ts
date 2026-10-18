import { existsSync } from 'node:fs';
import FastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';

const uiDist = fileURLToPath(new URL('../../ui/dist/', import.meta.url));
const uiIndex = fileURLToPath(new URL('../../ui/dist/index.html', import.meta.url));

export function hasUiBuild(): boolean {
  return existsSync(uiIndex);
}

export function registerStaticUi(app: FastifyInstance): void {
  if (!existsSync(uiDist)) return;
  // Resolve assets per request: Vite changes their filenames on every rebuild.
  // Enumerating files at startup leaves a running server unaware of new bundles.
  app.register(FastifyStatic, { root: uiDist, prefix: '/', wildcard: true });
}
