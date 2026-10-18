import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
  test(`hazard map fits phone viewport ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/prototype/map');
    const stage = page.getByTestId('hazard-map-stage');
    await expect(stage).toBeVisible();
    await expect(page.getByText('PROTOTYPE', { exact: true })).toBeVisible();
    expect(await stage.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const buttons = page.locator('.hazard-map-root button:visible');
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) {
      const box = await buttons.nth(index).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
    await expect(page.locator('.hazard-map-event-row')).toHaveCount(9);
    await expect(page.locator('.hazard-map-filters')).toHaveCSS('flex-wrap', 'wrap');
  });
}
