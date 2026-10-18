import { expect, test } from '@playwright/test';

const scenarios = [
  { name: 'unknown', texts: ['Unknown'] },
  { name: 'empty', texts: ['No affected communities in this data.', 'No group data.', 'No resource shortfall recorded.', 'No updates yet.'] },
  { name: 'error', texts: ['The overview could not be loaded', 'Please try again in a moment.', 'Try again'] },
] as const;

for (const scenario of scenarios) {
  for (const viewport of [{ width: 1672, height: 941 }, { width: 390, height: 844 }]) {
    test(`${scenario.name} overview state at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/overview?scenario=${scenario.name}`);
      if (scenario.name === 'error') {
        const heading = page.getByRole('heading', { name: 'The overview could not be loaded' });
        await expect(heading).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
        await expect(page.locator('.synthetic-strip')).toBeVisible();
        expect(await heading.evaluate((node) => node === document.activeElement)).toBe(true);
        await expect(page.getByText(/stack|exception|scenario error|provider/i)).toHaveCount(0);
      } else {
        for (const text of scenario.texts) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
        if (scenario.name === 'unknown') {
          await expect(page.locator('.kpi-card .kpi-main strong')).toHaveCount(4);
          await expect(page.locator('.kpi-card .kpi-main strong')).toHaveText(['Unknown', 'Unknown', 'Unknown', 'Unknown']);
          await expect(page.locator('.kpi-card .sparkline')).toHaveCount(0);
          await expect(page.locator('.kpi-card .change-chip, .kpi-card .action-chip')).toHaveCount(0);
          await expect(page.locator('.map-aqi-label')).toHaveText(Array(8).fill('?'));
          await expect(page.locator('.legend-community')).toHaveText(Array.from({ length: 8 }, (_, i) => `Community ${i + 1} · Unknown`));
          expect(await page.locator('.kpi-card .kpi-main strong, .group-count, .shortfall-table td:nth-child(3), .shortfall-table td:nth-child(4), .shortfall-table td:nth-child(5)').evaluateAll((nodes) => nodes.filter((node) => node.textContent?.trim() === '0').length)).toBe(0);
        }
        if (scenario.name === 'empty') {
          await expect(page.locator('.schematic-map')).toBeVisible();
          await expect(page.locator('.kpi-card .kpi-main strong').nth(2)).toHaveText('0');
          await expect(page.locator('.kpi-card .kpi-main strong').nth(3)).toHaveText('0');
          if (viewport.width <= 800) await page.getByRole('button', { name: 'Open AI Assist' }).click();
          await (viewport.width <= 800 ? page.locator('.assist-content-mobile') : page.locator('.desktop-assist')).getByRole('button', { name: 'Suggest required resources' }).click();
          await expect(page.locator('.message-assistant').last()).toContainText('No shortfall rows in this data.');
        }
      }
      await expect(page.locator('body')).not.toContainText(/\b(NaN|undefined|null)\b/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
