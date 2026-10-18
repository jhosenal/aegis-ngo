// Local UI + diagnostics smoke. Only invalid helper input and deterministic help;
// no model call, no credentials or conversation content written to evidence.
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = 'http://127.0.0.1:8787';
const directory = 'records/screenshots/card-actions-2026-10-15';
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const sessionReply = await page.request.post(origin + '/api/session', { data: { userId: 'USER-A-COORD' } });
  expect(sessionReply.status()).toBe(200); const session = await sessionReply.json();
  const headers = { authorization: 'Bearer ' + session.token };
  const invalid = await page.request.post(origin + '/api/helper', { headers, data: { text: '', attachments: [] } });
  expect(invalid.status()).toBe(400); expect(invalid.headers()['x-aegis-chat-trace']).toMatch(/^TRACE-/);
  const help = await page.request.post(origin + '/api/chat', { headers, data: { text: 'help', mode: 'auto', attachments: [] } });
  expect(help.status()).toBe(200); expect(help.headers()['x-aegis-chat-trace']).toMatch(/^TRACE-/);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Guest preview: sign in' }).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.regional-card-row').first()).toBeVisible();
  await page.locator('.regional-card-row').first().click();
  const footer = page.locator('.card-dialog-footer');
  await expect(footer.getByTestId('pin-toggle').locator('svg')).toHaveCount(1);
  const pin = await footer.getByTestId('pin-toggle').boundingBox();
  const attach = await footer.getByTestId('attach-toggle').boundingBox();
  const next = await footer.getByRole('button', { name: 'Continue in Assist' }).boundingBox();
  expect(Math.abs(pin.y - attach.y)).toBeLessThan(2); expect(Math.abs(pin.y - next.y)).toBeLessThan(2);
  await page.getByRole('dialog').screenshot({ path: directory + '/actual-card-footer.png' });
  const result = { origin, footerAligned: true, pinIcon: true, invalidHelperStatus: invalid.status(), helperTrace: invalid.headers()['x-aegis-chat-trace'], commandTrace: help.headers()['x-aegis-chat-trace'], modelCalls: 0 };
  writeFileSync('records/reviews/AEG-DASH-004_2026-10-15_origin.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
