import { defineConfig } from 'vitest/config';

try { process.loadEnvFile('.env'); } catch { /* no .env: the live tests skip themselves */ }
export default defineConfig({
  test: { include: ['tests/live/**/*.test.ts'], testTimeout: 60000, hookTimeout: 30000 },
});
