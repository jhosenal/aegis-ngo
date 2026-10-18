import { expect, test } from '@playwright/test';

test('forced SVG renderer mirrors events and respects pause and reduced motion', async ({ page }) => {
  await page.goto('/prototype/map?renderer=svg');
  const stage = page.getByTestId('hazard-map-stage');
  await expect(stage).toHaveAttribute('data-renderer', 'svg');
  await expect(stage).toHaveAttribute('data-events', '9');
  await expect(page.locator('.hazard-svg-event')).toHaveCount(9);
  await expect(page.getByTestId('hazard-map-canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await expect(page.getByRole('button', { name: 'Play animation' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.hazard-svg-event[data-event-id="ev-01"]').click();
  await expect(stage).toHaveAttribute('data-selected-event', 'ev-01');
  await expect(page.getByTestId('hazard-map-detail')).toContainText('Quake zone 1');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(stage).toHaveAttribute('data-paused', 'true');
  const svg = page.locator('.hazard-svg-overlay');
  const first = await svg.screenshot();
  await page.waitForTimeout(500);
  const second = await svg.screenshot();
  expect(first.equals(second)).toBe(true);
});
