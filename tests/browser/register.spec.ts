import { expect, test } from '@playwright/test';

const TERMS = { version: 'v-test', title: 'Terms', status: 'DRAFT', sections: [{ heading: '1. Test', text: 'Test terms text.' }] };

test.beforeEach(async ({ page }) => {
  // Callback/registration tests use an invented bearer token; isolate its protected data reads too.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().headers().authorization !== `Bearer ${'a'.repeat(64)}`) return route.fallback();
    if (path === '/api/cards') return route.fulfill({ json: { cards: [] } });
    if (path === '/api/pins') return route.fulfill({ json: { pins: [] } });
    if (path === '/api/modes') return route.fulfill({ json: { default: 'auto', modes: [] } });
    if (path === '/api/bookmarks') return route.fulfill({ json: { bookmarks: [] } });
    if (path === '/api/credits') return route.fulfill({ json: { balance: 0, pinLookupCost: 1, packs: [], stub: true, note: 'Test fixture', liveLookup: false } });
    if (path === '/api/conversations') return route.fulfill({ json: { items: [], nextCursor: null, complete: true } });
    return route.fallback();
  });
});

test('dashboard Google callback lets a new account accept terms and enter the workspace', async ({ page }) => {
  let registrations = 0;
  await page.route('**/api/auth/terms', route => route.fulfill({ json: TERMS }));
  await page.route('**/api/auth/register/preview', route => route.fulfill({ json: { email: 'new@example.com', displayName: 'New Person', returning: false } }));
  await page.route('**/api/auth/register', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ ticket: 'dashboard-registration', acceptTerms: true, termsVersion: 'v-test' });
    registrations++;
    await route.fulfill({ json: { token: 'a'.repeat(64) } });
  });
  await page.route('**/api/me', route => route.fulfill({ json: { userId: 'USER-G-1', displayName: 'New Person', role: 'coordinator', tenantId: 'TENANT-G-1', tenantName: "New Person's workspace" } }));
  await page.goto('/#register=dashboard-registration');
  await expect(page.getByTestId('register-dialog')).toBeVisible();
  await expect(page.getByTestId('signup-access')).toContainText('Standard accounts');
  await expect(page.getByTestId('signup-access')).toContainText('AI chat');
  await expect(page.getByTestId('signup-access')).toContainText('require Pro or Admin access');
  await expect(page.getByTestId('register-submit')).toBeDisabled();
  expect(registrations).toBe(0);
  // These clicks must reach the form; visibility alone misses native-dialog inertness.
  await page.getByTestId('register-accept').check();
  await page.getByTestId('register-submit').click();
  await expect(page.getByRole('button', { name: 'Account: New Person' })).toBeVisible();
  await expect(page.getByTestId('signin-screen')).toHaveCount(0);
  await expect(page.getByTestId('register-dialog')).toHaveCount(0);
  expect(registrations).toBe(1);
  expect(page.url()).not.toContain('register=');
});

test('dashboard returning account must accept changed terms before sign-in completes', async ({ page }) => {
  let accepted = false;
  await page.route('**/api/auth/terms', route => route.fulfill({ json: TERMS }));
  await page.route('**/api/auth/register/preview', route => route.fulfill({ json: { email: 'returning@example.com', displayName: 'Returning Person', returning: true } }));
  await page.route('**/api/auth/register', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ acceptTerms: true, termsVersion: TERMS.version });
    accepted = true;
    await route.fulfill({ json: { token: 'a'.repeat(64) } });
  });
  await page.route('**/api/me', route => route.fulfill({ json: { userId: 'USER-G-1', displayName: 'Returning Person', role: 'coordinator', tenantId: 'TENANT-G-1', tenantName: 'Personal workspace' } }));
  await page.goto('/#register=changed-terms');
  await expect(page.getByRole('heading', { name: 'The terms have changed' })).toBeVisible();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('register-submit')).toBeDisabled();
  expect(accepted).toBe(false);
  await page.getByTestId('register-accept').check();
  await page.getByTestId('register-submit').click();
  await expect(page.getByRole('button', { name: 'Account: Returning Person' })).toBeVisible();
  expect(accepted).toBe(true);
});

test('cancelling dashboard registration creates no account and returns to sign-in', async ({ page }) => {
  let registrations = 0;
  await page.route('**/api/auth/terms', route => route.fulfill({ json: TERMS }));
  await page.route('**/api/auth/register/preview', route => route.fulfill({ json: { email: 'new@example.com', displayName: 'New Person', returning: false } }));
  await page.route('**/api/auth/register', route => { registrations++; return route.fulfill({ status: 500 }); });
  await page.goto('/#register=cancel-registration');
  await page.getByTestId('register-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('register-dialog')).toHaveCount(0);
  await expect(page.getByTestId('signin-screen')).toBeVisible();
  expect(registrations).toBe(0);
});

test('dashboard Google callback consumes a returning account session and closes sign-in', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: { userId: 'USER-G-1', displayName: 'Returning Person', role: 'coordinator', tenantId: 'TENANT-G-1', tenantName: 'Personal workspace' } }));
  await page.goto('/#aegis_session=' + 'a'.repeat(64));
  await expect(page.getByRole('button', { name: 'Account: Returning Person' })).toBeVisible();
  await expect(page.getByTestId('signin-screen')).toHaveCount(0);
  expect(page.url()).not.toContain('aegis_session=');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Account: Returning Person' })).toBeVisible();
  await expect(page.locator('.sidebar-account')).toContainText('Returning Person');
  await expect(page.locator('.assist-signin')).toHaveCount(0);
  await page.getByRole('link', { name: 'Card workspace', exact: true }).click();
  await expect(page.locator('.identity')).toContainText('Returning Person');
  await expect(page.getByTestId('signin-screen')).toHaveCount(0);
});

test('an expired tab session is discarded without granting account access', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('aegis.session', 'a'.repeat(64)));
  await page.route('**/api/me', route => route.fulfill({ status: 401, json: { error: { code: 'E_AUTH_REQUIRED', message: 'Session expired' } } }));
  await page.goto('/workspace');
  await expect(page.getByTestId('signin-screen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('aegis.session'))).toBeNull();
  await expect(page.locator('.identity')).toHaveCount(0);
});

test('AEG-UXD-001 a new Google account must accept the terms before an account is created', async ({ page }) => {
  let posted: Record<string, unknown> | null = null;
  await page.route('**/api/auth/terms', (route) => route.fulfill({ json: TERMS }));
  await page.route('**/api/auth/register/preview', (route) => route.fulfill({ json: { email: 'new@example.com', displayName: 'New Person', returning: false } }));
  await page.route('**/api/auth/register', async (route) => {
    posted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { token: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' } });
  });
  await page.route('**/api/me', (route) => route.fulfill({ json: { userId: 'USER-G-1', displayName: 'New Person', role: 'coordinator', tenantId: 'TENANT-G-1', tenantName: "New Person's workspace", plan: 'standard', isAdmin: false } }));
  await page.goto('/workspace#register=tkn123');
  const dialog = page.getByTestId('register-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('register-terms')).toContainText('Test terms text.');
  await expect(page.getByTestId('register-submit')).toBeDisabled();
  await page.getByTestId('register-accept').check();
  await expect(page.getByTestId('register-submit')).toBeEnabled();
  await page.getByTestId('register-submit').click();
  await expect(dialog).toBeHidden();
  expect(posted).toMatchObject({ ticket: 'tkn123', acceptTerms: true, termsVersion: 'v-test', displayName: 'New Person' });
  await expect(page.locator('.identity')).toContainText('New Person');
  expect(page.url()).not.toContain('register=');
});

test('AEG-UXD-001 the dev sign-in lists the local admin and Pro accounts outside the cloud', async ({ page }) => {
  await page.goto('/workspace');
  await expect(page.getByTestId('signin-bypass')).toBeVisible();
  await page.getByTestId('dev-login-DEV-ADMIN').click();
  await expect(page.locator('.identity')).toContainText('Admin');
  await expect(page.locator('.identity')).toContainText('Pro');
});

test('AEG-UXD-001 a failed Google sign-in shows a plain message', async ({ page }) => {
  await page.goto('/workspace?login_error=state');
  await expect(page.getByRole('alert')).toContainText('expired');
});

test('AEG-UXD-001 the local Google preview walks through first-time registration, then signs straight in next time', async ({ page }) => {
  await page.goto('/workspace');
  await expect(page.getByTestId('google-preview')).toContainText('Local preview');
  await page.getByTestId('google-preview').click();
  await expect(page.getByTestId('register-dialog')).toBeVisible();
  await page.getByTestId('register-accept').check();
  await page.getByTestId('register-submit').click();
  await expect(page.locator('.identity')).toContainText('Preview Person');
  await page.reload();
  await expect(page.locator('.identity')).toContainText('Preview Person');
  await expect(page.getByTestId('signin-screen')).toHaveCount(0);
  // A later tab without the saved session signs in again without registration.
  await page.evaluate(() => sessionStorage.removeItem('aegis.session'));
  await page.reload();
  await page.getByTestId('google-preview').click();
  await expect(page.getByTestId('register-dialog')).toHaveCount(0);
  await expect(page.locator('.identity')).toContainText('Preview Person');
});
