import { expect, test } from '@playwright/test';

// The version label sits at the far top-left corner of the page, in the first column (the sidebar), on the landing page (owner decision 2026-10-17: "v2.0-RC1", pre-pilot).
test('the version label is in the far top-left corner of the page', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/assist');
  const label = page.getByTestId('app-version');
  await expect(label).toHaveText('v2.0-RC1');
  const sidebar = page.locator('.dashboard-sidebar');
  const s = (await sidebar.boundingBox())!; const l = (await label.boundingBox())!;
  expect(l.x).toBeGreaterThanOrEqual(0);                                    // on the page
  expect(l.x).toBeLessThan(16);                                             // against the far left edge of the page
  expect(l.y - s.y).toBeLessThan(16);                                       // against its top edge
  const logo = (await sidebar.locator('.sidebar-brand img').first().boundingBox())!;
  expect(l.y + l.height).toBeLessThanOrEqual(logo.y);                       // above the logo: it never covers any part of it
  await page.screenshot({ path: 'data/_version-label.png', clip: { x: 0, y: 0, width: 420, height: 160 } });
});
