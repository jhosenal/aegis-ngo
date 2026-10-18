import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['ui/src/assist/audio/**/*.test.ts'], testTimeout: 30000 },
});
