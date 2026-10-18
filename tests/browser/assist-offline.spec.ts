import { expect, test } from '@playwright/test';

test('Assist page and cards remain available after the device goes offline', async ({ page, context }) => {
  await page.addInitScript(() => {
    const testWindow = window as Window & { __assistPrecacheComplete?: Promise<boolean> };
    testWindow.__assistPrecacheComplete = new Promise((resolve) => {
      window.addEventListener('aegis-assist-precache-complete', (event) => {
        const detail = (event as CustomEvent<{ complete?: boolean }>).detail;
        resolve(detail?.complete === true);
      }, { once: true });
    });
  });
  await page.goto('/assist/guidance');
  const workerState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const testWindow = window as Window & { __assistPrecacheComplete?: Promise<boolean> };
    const precacheComplete = await testWindow.__assistPrecacheComplete;
    return { active: registration.active !== null, precacheComplete };
  });
  expect(workerState.active).toBe(true);
  expect(workerState.precacheComplete).toBe(true);

  const cardList = page.getByRole('region', { name: 'Emergency guidance cards' });
  const cards = cardList.locator('article');
  await expect(page.getByRole('heading', { level: 1, name: 'Aegis Assist' })).toBeVisible();
  await expect(cards.first()).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Aegis Assist' })).toBeVisible();
  await expect(cards.first()).toBeVisible();
  await expect.poll(() => cards.count()).toBeGreaterThan(0);
  await expect(page.getByRole('status').filter({ hasText: 'Offline' })).toBeVisible();
});
