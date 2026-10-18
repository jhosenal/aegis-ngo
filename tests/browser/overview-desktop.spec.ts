import { expect, test } from '@playwright/test';

test.describe('S0024 incident overview desktop', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('renders the incident overview, map layers, shortfalls, groups, updates and deterministic Assist', async ({ page }, testInfo) => {
    await page.goto('/overview');
    await expect(page.getByText(/Synthetic demonstration data\./)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('overview-desktop.png'), fullPage: true });
    await expect(page.locator('.dashboard-sidebar')).toBeVisible();
    await expect(page.getByRole('navigation',{name:'Workspace pages'}).getByRole('link',{name:'Hazard domains'})).toHaveAttribute('href','/domains');
    await expect(page.locator('.overview-workspace > .overview-nav')).toBeHidden();
    const previewStamp = page.locator('.situation-card .preview-stamp');
    await expect(previewStamp).toBeVisible();
    expect(await previewStamp.evaluate((element) => {
      const badge = element.getBoundingClientRect();
      const card = element.parentElement!.getBoundingClientRect();
      return badge.left > card.left && badge.right < card.right && badge.top > card.top;
    })).toBe(true);
    await expect(page.getByText('156', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('12,480', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('8', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('3', { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel('Incident indicators').getByText('Unhealthy', { exact: true })).toBeVisible();
    await expect(page.locator('.map-marker')).toHaveCount(8);
    for (let i = 1; i <= 8; i += 1) await expect(page.getByRole('img', { name: `Community ${i}, AQI` })).toBeVisible();
    const mapMetrics = await page.evaluate(() => {
      const map = document.querySelector<SVGSVGElement>('.schematic-map')!;
      const mapBox = map.getBoundingClientRect();
      const layers = document.querySelector<HTMLElement>('.map-layer-chips')!.getBoundingClientRect();
      const controls = document.querySelector<HTMLElement>('.map-controls')!.getBoundingClientRect();
      const overlapWidth = Math.max(0, Math.min(mapBox.right, layers.right) - Math.max(mapBox.left, layers.left));
      const overlapHeight = Math.max(0, Math.min(mapBox.bottom, layers.bottom) - Math.max(mapBox.top, layers.top));
      const viewBox = map.viewBox.baseVal;
      const scale = Math.min(mapBox.width / viewBox.width, mapBox.height / viewBox.height);
      const fonts = [...document.querySelectorAll<SVGTextElement>('.map-marker text')].map((element) => Number.parseFloat(getComputedStyle(element).fontSize) * scale);
      const controlLabelOverlap = [...document.querySelectorAll<SVGTextElement>('.map-marker text')].some((element) => {
        if (getComputedStyle(element).display === 'none') return false;
        const rect = element.getBoundingClientRect();
        return rect.right > controls.left && rect.left < controls.right && rect.bottom > controls.top && rect.top < controls.bottom;
      });
      return { overlap: overlapWidth * overlapHeight / (mapBox.width * mapBox.height), fonts, controlLabelOverlap };
    });
    expect(mapMetrics.overlap).toBeLessThanOrEqual(0.25);
    expect(mapMetrics.fonts).toHaveLength(8);
    expect(mapMetrics.fonts.every((size) => size >= 11)).toBe(true);
    expect(mapMetrics.controlLabelOverlap).toBe(false);
    const haze = page.locator('.haze-layer');
    await expect(haze).toBeVisible();
    await page.getByRole('button', { name: 'Haze extent (MODIS)' }).click();
    await expect(haze).toHaveCount(0);
    await page.getByRole('button', { name: 'Haze extent (MODIS)' }).click();
    await expect(haze).toBeVisible();
    await expect(page.locator('.shortfall-table tbody tr')).toHaveCount(3);
    for (const priority of ['Critical', 'High']) await expect(page.getByText(priority, { exact: true }).first()).toBeVisible();
    await expect(page.locator('.group-row')).toHaveCount(4);
    for (const count of ['4,320', '2,180', '1,960', '4,020']) await expect(page.getByText(count, { exact: true })).toBeVisible();
    for (const relative of ['2 hours ago', '5 hours ago', '8 hours ago']) await expect(page.getByText(relative, { exact: true })).toBeVisible();

    const main = page.locator('.overview-main');
    const assist = page.locator('.desktop-assist');
    const ratio = async () => (await main.boundingBox())!.width / (await assist.boundingBox())!.width;
    expect(await ratio()).toBeGreaterThan(1.7);
    expect(await ratio()).toBeLessThan(2.3);
    const before = await ratio();
    await page.getByRole('separator', { name: 'Resize workspace and chat panels' }).focus();
    await page.keyboard.press('ArrowRight');
    expect(await ratio()).toBeGreaterThan(before);

    await page.getByRole('button', { name: 'Summarize this incident' }).click();
    await expect(page.getByRole('heading', { name: 'Haze Incident Summary' })).toBeVisible();
    await expect(page.getByText(/Air quality in Synthetic Region A is in the unhealthy range/)).toBeVisible();
    await expect(page.locator('.message-assistant ol li')).toHaveCount(3);
    await expect(page.getByText(/No AI model is used in this preview\./)).toBeVisible();
    await page.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Report incident' })).toHaveAttribute('aria-selected', 'true');
  });
});
