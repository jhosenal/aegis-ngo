// Explicit live canary: run only after the cost gate and owner budget configuration.
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
if (!process.argv.includes('--authorized-canary')) throw new Error('A cost-gated --authorized-canary is required');
const origin = 'http://127.0.0.1:8787';
const directory = 'records/screenshots/map-dock-2026-10-15';
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Regional operations');
  await page.reload();
  await expect(page.locator('.map-panel')).toBeVisible();
  const main = await page.locator('.dashboard-main').boundingBox(); const dock = await page.locator('.dashboard-assist').boundingBox();
  expect(main.width / dock.width).toBeGreaterThan(1.8); expect(main.width / dock.width).toBeLessThan(2.2);
  await page.screenshot({ path: directory + '/live-map-1920.png' });
  await page.getByRole('button', { name: 'Guest preview: sign in' }).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const replies = [];
  for (const text of ['Hello. In one sentence, how can you help me?', 'Please use your internal tool to list my incident cards. Clearly say if they are synthetic.']) {
    await page.getByTestId('chat-input').fill(text);
    const responsePromise = page.waitForResponse(response => response.url() === origin + '/api/helper' && response.request().method() === 'POST', { timeout: 60000 });
    await page.getByTestId('chat-send').click();
    const response = await responsePromise; expect(response.status()).toBe(200);
    const body = await response.json();
    if (body.providerNotice) throw new Error('Helper notice: ' + body.providerNotice);
    expect(body.route.source).toBe('model');
    expect(body.blocks.some(block => block.type === 'text' && block.text.length > 10)).toBe(true);
    replies.push(body);
  }
  expect(replies[1].blocks.some(block => block.type === 'notice' && block.code === 'HELPER_TOOL_READ')).toBe(true);
  await page.screenshot({ path: directory + '/live-helper-1920.png' });
  await page.getByRole('button', { name: 'Collapse assistant dock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Assist', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Assist', exact: true }).click();
  await expect(page.getByTestId('chat-message-2')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Close Assist', exact: true }).click();
  await page.getByRole('button', { name: 'Open Assist', exact: true }).click();
  await expect(page.getByTestId('chat-message-2')).toBeVisible();
  await page.screenshot({ path: directory + '/live-helper-mobile.png' });
  await page.getByRole('button', { name: 'Close Assist', exact: true }).click();
  await page.screenshot({ path: directory + '/live-right-edge-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
  const record = { origin, desktop: '1920x1080', workspaceToDockRatio: main.width / dock.width, refreshRendered: true, errors, replies, evidence: directory };
  writeFileSync('records/reviews/AEG-HELPER-001_2026-10-15_live.json', JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ origin, ratio: record.workspaceToDockRatio, helperTurns: replies.length, internalToolRead: true, errors }));
} finally { await browser.close(); }
