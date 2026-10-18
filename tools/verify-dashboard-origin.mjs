// Verify the existing local service, including its actual bundle responses.
// Uses a synthetic demo identity and the deterministic help command; no model call.
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = process.argv[2] ?? 'http://127.0.0.1:8787';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Local origin required');
const directory = 'records/screenshots/map-dock-2026-10-15';
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const assets = [];
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1080 } });
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(origin + '/assets/')) {
      const type = response.headers()['content-type'];
      assets.push({ path: new URL(response.url()).pathname, status: response.status(), type });
      if (![200, 304].includes(response.status()) || type?.includes('text/html')) failures.push('Invalid asset: ' + response.url());
    }
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Regional operations');
  await page.reload();
  await expect(page.locator('.regional-card-row')).toHaveCount(5);
  await page.screenshot({ path: directory + '/read-only-origin.png', fullPage: true });
  await page.getByRole('button', { name: 'Guest preview: sign in' }).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.dashboard-source-banner')).toContainText('System records');
  // Keep this routine origin smoke model-free. Live helper calls require their separate cost-gated canary.
  const loginResponse = await page.request.post(origin + '/api/session', { data: { userId: 'USER-A-COORD' } });
  const session = await loginResponse.json();
  const reply = await page.request.post(origin + '/api/chat', { headers: { authorization: 'Bearer ' + session.token }, data: { text: 'help', mode: 'auto', attachments: [] } });
  expect(reply.status()).toBe(200);
  const body = await reply.json();
  expect(body.route).toMatchObject({ routeId: 'I_aegis_help_show', source: 'local' });
  expect(failures).toEqual([]);
  expect(assets.some((asset) => /javascript/.test(asset.type))).toBe(true);
  expect(assets.some((asset) => /text\/css/.test(asset.type))).toBe(true);
  const result = { origin, rendered: true, refreshRendered: true, chatRoute: body.route.routeId, errors: failures, assets };
  writeFileSync('records/reviews/AEG-DASH-003_2026-10-15_origin.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
