import { expect, test } from '@playwright/test';

test('admin desk: sign-in gate, nested cards, locked language stubs, GPU render state from the ledger', async ({ page }) => {
  await page.goto('/admin?preview=1');
  await expect(page.getByRole('heading', { name: 'Admin Desk', level:1 })).toBeVisible();
  await expect(page.locator('[data-card-id="admin:sign-in"]')).toBeVisible();
  await page.getByTestId('dev-login-DEV-ADMIN').click();
  const desk = page.getByLabel('Admin Desk');
  await expect(page.getByRole('tab')).toHaveText(['News approval', 'News desk', 'Feeds and telemetry', 'Governance and costs', 'API status', 'Remarks']);
  await expect(page.getByRole('tab', { name: 'News approval' })).toHaveAttribute('aria-selected', 'true');   // news approval is the default
  await expect(desk.locator('[data-card-id="admin:screening"]')).toBeVisible();
  await expect(desk.locator('[data-card-id="admin:spend"]')).toHaveCount(0);
  // The real landing page is shown in a dialog (Preview landing page button) with the draft bulletin, labelled as a preview that is not published.
  await page.getByRole('button', { name: 'Preview landing page' }).click();
  await expect(page.getByRole('dialog', { name: 'Landing page preview' })).toBeVisible();
  const frame = page.frameLocator('iframe[title="Landing page preview"]');
  await expect(frame.getByTestId('news-reader')).toBeVisible();   // the landing page's own news reader
  await expect(frame.getByText(/PREVIEW for approval · not published/)).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Play introduction' })).toBeVisible();
  // Only the hero card is copied: no sidebar and none of the cards below it, and the frame has the hero's real size.
  await expect(frame.locator('[data-card-id="module:asean-regional-overview"]')).toBeVisible();
  await expect(frame.locator('.dashboard-sidebar')).toBeHidden();
  // The dialog closes with its Close button and the controls underneath stay in place.
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.getByRole('dialog', { name: 'Landing page preview' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'News desk' }).click();
  await expect(desk.locator('[data-card-id="admin:broadcast"] [data-card-id="admin:broadcast-languages"]')).toBeVisible();   // a card inside a card
  const languages = desk.locator('[data-card-id="admin:broadcast-languages"] li');
  await expect(languages).toHaveCount(4);
  await expect(languages.nth(0)).toContainText('Active');
  for (const index of [1, 2, 3]) await expect(languages.nth(index)).toContainText('Review required');
  await expect(desk.locator('[data-card-id="admin:broadcast-render"]')).toContainText('GPU price in the price book: yes');
  await expect(desk.locator('[data-slot], [aria-label^="Slot "]')).toHaveCount(4);
  await page.getByRole('tab', { name: 'Governance and costs' }).click();
  await expect(desk.locator('[data-card-id="admin:spend"]')).toContainText('Monthly budget');
  await expect(page).toHaveURL(/tab=spend/);
  await page.getByRole('tab', { name: 'Feeds and telemetry' }).click();
  await expect(desk.locator('[data-card-id="admin:feeds"]')).toContainText('Provisional');
  await page.getByRole('tab', { name: 'Remarks' }).click();
  await expect(desk.locator('[data-card-id="admin:remarks"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('admin desk: a non-administrator is refused', async ({ page }) => {
  await page.goto('/admin');
  await page.getByTestId('dev-login-USER-A-VIEW').click();
  await expect(page.locator('[data-card-id="admin:forbidden"]')).toContainText('not an administrator');
});
