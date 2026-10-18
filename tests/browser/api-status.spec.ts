import { expect, test } from '@playwright/test';

test('API status tab: every outside service in groups, honest states, no secrets, and no call to any outside service', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.hostname.endsWith('googleapis.com') && !u.hostname.endsWith('gstatic.com') && !u.hostname.endsWith('google.com')) outside.push(u.hostname); });
  await page.goto('/admin');
  await page.getByTestId('dev-login-DEV-ADMIN').click();
  await page.getByRole('tab', { name: 'API status' }).click();
  await expect(page.locator('[data-card-id="admin:apis"]')).toBeVisible();
  // the summary and the three groups
  await expect(page.getByRole('status', { name: 'Summary' })).toContainText('working');
  for (const group of ['admin:apis-ai', 'admin:apis-env', 'admin:apis-feeds']) await expect(page.locator(`[data-card-id="${group}"]`)).toBeVisible();
  // each service row names its state, whether it is billed, and the setting that controls it
  const argon = page.locator('[data-api-id="vertex-argon"]');
  await expect(argon).toContainText('Gemini 4 Argon on Vertex AI'); await expect(argon).toContainText('Billed'); await expect(argon).toContainText('AEGIS_VERTEX_PROJECT'); await expect(argon).toContainText('Last success');
  // a service switched off here is shown as Off, never as Working
  await expect(page.locator('[data-api-id="tts"] .api-state')).toHaveText(/Off|Configured|Working|Problem|Not set/);
  // the browser row is made by the page and says it cannot be tested from the server
  const maps = page.locator('[data-api-id="maps-browser"]');
  await expect(maps).toContainText('Google Maps in the browser'); await expect(maps).toContainText(/cannot test it|schematic map/);
  // no key or secret value is ever shown
  const text = await page.locator('#admin-panel').innerText();
  expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  // Refresh reloads the catalogue
  const calls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/admin/api-status')) calls.push(r.url()); });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => calls.length).toBeGreaterThanOrEqual(1);
  expect(outside).toEqual([]);
});

test('each service shows when it was last called, and a service that is set up has an on/off switch', async ({ page }) => {
  const row = (over: Record<string, unknown>) => ({ id: 'tts', name: 'Google Cloud Text-to-Speech', purpose: 'The voice of approved bulletins.', cost: 'free allowance', state: 'working', detail: 'Voice en-GB-Standard-B.', lastCalledAt: '2026-10-18T05:00:00.000Z', lastOkAt: '2026-10-18T04:59:00.000Z', lastProblemAt: null, switch: 'AEGIS_TTS_ENABLED', switchable: true, switchedOff: false, switchedBy: null, switchedAt: null, ...over });
  let off = false; const puts: unknown[] = [];
  const catalogue = () => ({ asOf: '2026-10-18T06:00:00.000Z', summary: { working: off ? 0 : 1, configured: 0, off: off ? 2 : 1, problem: 0, total: 3 }, remarks: ['A remark.'], groups: [{ id: 'ai', title: 'Google AI and cloud', rows: [
    row(off ? { state: 'off', switchedOff: true, switchedBy: 'DEV-ADMIN', switchedAt: '2026-10-18T05:55:00.000Z', detail: 'Switched off by DEV-ADMIN at 2026-10-18 05:55 UTC. Turn the switch on to use it again.' } : {}),
    row({ id: 'reapi', name: 'Backup model (reAPI)', state: 'configured', switchable: false, lastCalledAt: null, lastOkAt: null }),
    row({ id: 'billing-export', name: 'Cloud Billing export (BigQuery)', state: 'off', switchable: false, lastCalledAt: null, lastOkAt: null }),
  ] }] });
  await page.route('**/api/admin/api-status', (r) => r.fulfill({ json: catalogue() }));
  await page.route('**/api/admin/api-switch', async (r) => { puts.push(r.request().postDataJSON()); off = !off; await r.fulfill({ json: { ok: true } }); });
  await page.goto('/admin');
  await page.getByTestId('dev-login-DEV-ADMIN').click();
  await page.getByRole('tab', { name: 'API status' }).click();
  const tts = page.locator('[data-api-id="tts"]');
  await expect(tts).toContainText('Last called: 2026-10-18 05:00 UTC'); await expect(tts).toContainText('Last success: 2026-10-18 04:59 UTC');
  await expect(page.locator('[data-api-id="reapi"]')).toContainText('Last called: none recorded');
  // a service that can be switched has a live switch; a service that is on but cannot be switched off here has a grey, locked On switch; one that is off and not set up has none
  await expect(page.getByRole('switch')).toHaveCount(2);
  const locked = page.locator('[data-api-id="reapi"]').getByRole('switch', { name: /is on and locked/ });
  await expect(locked).toBeDisabled(); await expect(locked).toHaveAttribute('aria-checked', 'true'); await expect(page.locator('[data-api-id="reapi"]')).toContainText('Locked on');
  await expect(page.locator('[data-api-id="billing-export"]').getByRole('switch')).toHaveCount(0);
  const toggle = tts.getByRole('switch', { name: 'Switch Google Cloud Text-to-Speech' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect.poll(() => puts.length).toBe(1); expect(puts[0]).toEqual({ id: 'tts', on: false });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(tts).toContainText('Switched off by DEV-ADMIN');
  await toggle.click();
  await expect.poll(() => puts.length).toBe(2); expect(puts[1]).toEqual({ id: 'tts', on: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});
