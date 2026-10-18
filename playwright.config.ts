import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

if (process.env.TEST_WORKER_INDEX === undefined) {
  const dataDirectory = join(process.cwd(), 'data');
  try {
    for (const name of readdirSync(dataDirectory)) {
      if (!name.startsWith('browser-test-')
        || !/\.db(?:-wal|-shm)?$/.test(name)) continue;
      const path = join(dataDirectory, name);
      try {
        if (Date.now() - statSync(path).mtimeMs > 10 * 60 * 1000) unlinkSync(path);
      } catch {
        // Old browser database cleanup is best-effort and must not fail a run.
      }
    }
  } catch {
    // The data directory may not exist yet; cleanup is best-effort.
  }
}

process.env.AEGIS_BROWSER_DB ??= `./data/browser-test-${Date.now()}.db`;

const browserPort = process.env.AEGIS_BROWSER_PORT ?? '8799';
const baseURL = `http://127.0.0.1:${browserPort}`;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'data/test-results',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    // Software GL so headless Chromium can run the WebGL background on any machine.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: process.platform === 'win32' ? 'npm.cmd run start:test' : 'npm run start:test',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      AEGIS_ENV: 'local',
      AEGIS_AHA_WEEKLY: 'false',
      PORT: browserPort,
      AEGIS_DB_PATH: process.env.AEGIS_BROWSER_DB,
      AEGIS_MODELS_ENABLED: 'false',
      AEGIS_PROVIDER_MODE: 'stub',
      AEGIS_ASSIST_ENABLED: 'true',
    },
  },
});
