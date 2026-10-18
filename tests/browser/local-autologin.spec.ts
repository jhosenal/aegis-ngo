import { expect, test } from '@playwright/test';

// The Admin Desk signs in by itself only when the server says it is the owner's own computer; the page never decides that alone.
const healthSays = (localAutoLogin: boolean) => ({ status: 'ok', env: 'local', storage: 'local', providerMode: 'stub', modelsEnabled: false, localAutoLogin });

test('on the local computer the Admin Desk signs in as the local admin without a click', async ({ page }) => {
  await page.route('**/api/health', (r) => r.fulfill({ json: healthSays(true) }));
  await page.goto('/admin');
  await expect(page.getByRole('tab', { name: 'News approval' })).toBeVisible();
  await expect(page.locator('[data-card-id="admin:sign-in"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Account: hosen Choong/ })).toBeVisible();
});

test('without the local switch the sign-in screen is shown as before, and after a sign-out in this tab it is not skipped', async ({ page }) => {
  await page.route('**/api/health', (r) => r.fulfill({ json: healthSays(false) }));
  await page.goto('/admin');
  await expect(page.locator('[data-card-id="admin:sign-in"]')).toBeVisible();
  const second = await page.context().newPage();
  await second.route('**/api/health', (r) => r.fulfill({ json: healthSays(true) }));
  await second.addInitScript(() => sessionStorage.setItem('aegis.noAutoLogin', '1'));   // what an explicit sign-out leaves behind
  await second.goto('/admin');
  await expect(second.locator('[data-card-id="admin:sign-in"]')).toBeVisible();
});

test('the landing page is never signed in automatically', async ({ page }) => {
  await page.route('**/api/health', (r) => r.fulfill({ json: healthSays(true) }));
  await page.goto('/');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: /Account: hosen Choong/ })).toHaveCount(0);
});
