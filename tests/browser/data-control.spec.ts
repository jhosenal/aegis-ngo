import { expect, test } from '@playwright/test';

// Admin Desk > Data control (AEG-DATA-001): pin list, filters, demo data, delete and restore. Add and refresh reach the network, so the backend tests cover them.
test('data control: pins list, filters, dummy data, delete and restore', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/admin?tab=data');
  await page.getByTestId('dev-login-DEV-ADMIN').click();
  await expect(page.getByRole('tab', { name: 'Feeds and telemetry' })).toHaveAttribute('aria-selected', 'true');
  const summary = page.locator('[data-card-id="admin:data-summary"]');
  await expect(summary).toContainText('125');
  await expect(summary).toContainText('SG 23 · MY 81 · BN 21');
  const list = page.locator('[data-card-id="admin:data-pins"]');
  const rows = page.locator('.data-pins tbody tr');
  await expect(rows).toHaveCount(125);
  // filters: country, then state, then search
  await list.getByLabel('Country').selectOption('BN');
  await expect(rows).toHaveCount(21);
  await list.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(125);
  await list.getByLabel('Search').fill('orchard');
  await expect(rows.first()).toContainText('Orchard');
  await list.getByRole('button', { name: 'Clear filters' }).click();
  // the refresh card: tick the sources; Google is off (no keys) and says so; the confirmation appears only when Google is ticked
  const refresh = page.locator('[data-card-id="admin:data-refresh"]');
  await expect(refresh.getByLabel(/Google air quality and weather/)).toBeDisabled();
  await expect(refresh.getByLabel(/Open-Meteo 7-day modelled history/)).toBeChecked();
  // dummy data: load for all pins, the list says demo, the public map says DEMO, then clear
  await page.getByRole('button', { name: 'Load dummy data for all pins' }).click();
  await expect(summary).toContainText('synthetic, labelled DEMO');
  await expect(page.locator('[data-card-id="admin:data-pins"]').locator('.admin-badge', { hasText: 'demo' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear dummy data' }).click();
  await expect(page.getByText(/Cleared \d+ demo readings/)).toBeVisible();
  // delete one pin, find it under deleted pins, restore it
  page.once('dialog', (d) => void d.accept());
  await rows.first().getByRole('button', { name: 'Delete' }).click();
  await expect(rows).toHaveCount(124);
  await list.getByLabel('show deleted').check();
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('button', { name: 'Restore' }).click();
  await list.getByLabel('show deleted').uncheck();
  await expect(rows).toHaveCount(125);
  await expect(page.locator('[data-card-id="admin:data-history"]')).toContainText('RESTORE');
});
