import { expect, test } from '@playwright/test';

test('hazard map desktop renders synthetic events, supports pause, selection and filters', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto('/prototype/map');
  const stage = page.getByTestId('hazard-map-stage');
  await expect(stage).toHaveAttribute('data-renderer', 'webgl');
  await expect(stage).toHaveAttribute('data-events', '9');
  await expect(page.getByText('PROTOTYPE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /hours ago/ })).toHaveCount(9);
  await expect(page.getByRole('button', { name: /Quake zone 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /CRITICAL/ }).first()).toBeVisible();

  const canvas = page.getByTestId('hazard-map-canvas');
  const playingA = await canvas.screenshot();
  await page.waitForTimeout(800);
  const playingB = await canvas.screenshot();
  expect(playingA.equals(playingB)).toBe(false);

  const pause = page.getByRole('button', { name: 'Pause animation' });
  await pause.click();
  await expect(page.getByRole('button', { name: 'Play animation' })).toHaveAttribute('aria-pressed', 'true');
  const pausedA = await canvas.screenshot();
  await page.waitForTimeout(450);
  const pausedB = await canvas.screenshot();
  expect(pausedA.equals(pausedB)).toBe(true);

  await page.getByRole('button', { name: /Quake zone 1/ }).click();
  await expect(page.getByTestId('hazard-map-detail')).toContainText('Quake zone 1');
  await expect(stage).toHaveAttribute('data-selected-event', 'ev-01');
  await page.getByRole('button', { name: 'Wildfire', exact: true }).click();
  await expect(stage).toHaveAttribute('data-events', '2');
  await expect(page.getByRole('button', { name: /Quake zone 1/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(stage).toHaveAttribute('data-events', '9');

  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  const box = bounds!;
  await page.mouse.click(box.x + box.width / 2 + (22 - 50) * box.height / 100, box.y + box.height / 2 - (50 - 30) * box.height / 100);
  await expect(stage).toHaveAttribute('data-selected-event', 'ev-01');
});

test('hazard map critical areas stay static under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto('/prototype/map');
  const stage = page.getByTestId('hazard-map-stage');
  await expect(stage).toHaveAttribute('data-paused', 'true');
  const canvas = page.getByTestId('hazard-map-canvas');
  const first = await canvas.screenshot();
  await page.waitForTimeout(800);
  const second = await canvas.screenshot();
  expect(first.equals(second)).toBe(true);
});
