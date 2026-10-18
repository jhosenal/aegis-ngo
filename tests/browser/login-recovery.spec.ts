import { expect, test } from '@playwright/test';

test('Google sign-in requests the Assist return path without leaving the host before the server handoff', async ({ page }) => {
  await page.route('**/api/auth/providers', route => route.fulfill({ json: { google: true, devSignIn: false } }));
  await page.goto('/assist?login=true');
  await expect(page.getByTestId('google-signin')).toHaveAttribute('href', '/api/auth/google?returnTo=%2Fassist');
});

test('a server-rejected active session clears the account and chat identity without a page reload', async ({ page, request }) => {
  const response = await request.post('/api/session', { data: { userId: 'USER-A-COORD' } });
  expect(response.ok()).toBe(true);
  const session = await response.json();
  await page.addInitScript(token => sessionStorage.setItem('aegis.session', token), session.token);
  let release!: () => void;
  const rejected = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/pins', async route => {
    await rejected;
    await route.fulfill({ status: 401, json: { error: { code: 'E_AUTH_REQUIRED', message: 'Session expired' } } });
  });
  await page.goto('/assist');
  await expect(page.getByRole('button', { name: `Account: ${session.user.displayName}` })).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: `Account: ${session.user.displayName}` })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('aegis.session'))).toBeNull();
  await expect(page.locator('.sidebar-account')).not.toContainText(session.user.displayName);
});

test('a temporary profile outage does not erase the saved session', async ({ page, request }) => {
  const response = await request.post('/api/session', { data: { userId: 'USER-A-COORD' } });
  const session = await response.json();
  await page.addInitScript(token => sessionStorage.setItem('aegis.session', token), session.token);
  await page.route('**/api/me', route => route.fulfill({ status: 503, json: { error: { code: 'E_INTERNAL', message: 'Temporary outage' } } }));
  await page.goto('/assist');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('aegis.session'))).toBe(session.token);
  await page.unroute('**/api/me');
  await page.reload();
  await expect(page.getByRole('button', { name: `Account: ${session.user.displayName}` })).toBeVisible();
});

test('a delayed rejection from the signed-out account cannot sign out the next account', async ({ page, request }) => {
  const first = await (await request.post('/api/session', { data: { userId: 'USER-A-COORD' } })).json();
  const next = await (await request.post('/api/session', { data: { userId: 'USER-B-COORD' } })).json();
  await page.addInitScript(token => sessionStorage.setItem('aegis.session', token), first.token);
  let release!: () => void;
  let intercepted!: () => void;
  let finished!: () => void;
  const rejected = new Promise<void>(resolve => { release = resolve; });
  const pending = new Promise<void>(resolve => { intercepted = resolve; });
  const delivered = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/api/pins', async route => {
    if (route.request().headers().authorization !== `Bearer ${first.token}`) return route.fallback();
    intercepted();
    await rejected;
    await route.fulfill({ status: 401, json: { error: { code: 'E_AUTH_REQUIRED', message: 'Old session expired' } } });
    finished();
  });
  await page.goto('/assist');
  await expect(page.getByRole('button', { name: `Account: ${first.user.displayName}` })).toBeVisible();
  await pending;
  await page.getByRole('button', { name: `Account: ${first.user.displayName}` }).click();
  await page.getByRole('button', { name: 'Sign out of this tab' }).click();
  await page.getByRole('button', { name: 'Guest preview: sign in' }).click();
  await page.getByTestId('dev-login-USER-B-COORD').click();
  await expect(page.getByRole('button', { name: `Account: ${next.user.displayName}` })).toBeVisible();
  await page.evaluate(() => {
    window.addEventListener('aegis-session-expired', () => { document.documentElement.dataset.rejectionObserved = 'true'; }, { once: true });
  });
  release();
  await delivered;
  await expect(page.locator('html')).toHaveAttribute('data-rejection-observed', 'true');
  await expect(page.getByRole('button', { name: `Account: ${next.user.displayName}` })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('aegis.session'))).not.toBeNull();
});
