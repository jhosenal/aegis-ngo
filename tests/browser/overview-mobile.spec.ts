import { expect, test } from '@playwright/test';

test.describe('S0024 incident overview mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('fits the phone, traps focus in the drawer and Assist sheet, and runs an action', async ({ page }, testInfo) => {
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Haze Situation Report' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('overview-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.setViewportSize({ width: 390, height: 844 });
    const phoneMetrics = await page.evaluate(() => {
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
      return { overlap: overlapWidth * overlapHeight / (mapBox.width * mapBox.height), fonts, mapHeight: mapBox.height, controlLabelOverlap };
    });
    expect(phoneMetrics.overlap).toBeLessThanOrEqual(0.25);
    expect(phoneMetrics.fonts).toHaveLength(8);
    expect(phoneMetrics.fonts.every((size) => size >= 11)).toBe(true);
    expect(phoneMetrics.controlLabelOverlap).toBe(false);
    expect(phoneMetrics.mapHeight).toBeGreaterThanOrEqual(280);
    const airQualityTime = page.getByText('US AQI · 14 Oct, 10:00');
    await expect(airQualityTime).toHaveAttribute('title', 'US AQI · 14 Oct 2026, 10:00 (UTC+8)');
    await expect(airQualityTime).toHaveAttribute('aria-label', 'US AQI · 14 Oct 2026, 10:00 (UTC+8)');
    const dock = page.getByRole('button', { name: 'Open AI Assist' });
    const dockIntersections = await page.evaluate(() => {
      const dock = document.querySelector<HTMLElement>('.assist-dock')!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>('a[href],button,input,[role="tab"]')]
        .filter((element) => !element.classList.contains('assist-dock'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && rect.right > dock.left && rect.left < dock.right && rect.bottom > dock.top && rect.top < dock.bottom;
        }).map((element) => element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName);
    });
    expect(dockIntersections).toEqual([]);
    const firstMarker = page.locator('.map-marker').first();
    await firstMarker.focus();
    await expect(firstMarker).toHaveAttribute('data-active', 'true');
    await expect(page.getByRole('tooltip')).toContainText('Community 1');
    const undersized = await page.locator('a,button,input,[role="tab"]').evaluateAll((elements) => elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && (rect.width < 48 || rect.height < 48);
      }).map((element) => ({ tag: element.tagName, text: element.textContent?.trim(), size: `${element.getBoundingClientRect().width}x${element.getBoundingClientRect().height}` })));
    expect(undersized).toEqual([]);

    const menu = page.getByRole('button', { name: 'Open navigation' });
    await menu.click();
    await expect(page.locator('.dashboard-sidebar')).toBeVisible();
    await expect(page.getByRole('navigation',{name:'Workspace pages'}).getByRole('link',{name:'Hazard domains'})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dashboard-sidebar')).toBeHidden();
    await expect(menu).toBeFocused();

    await dock.click();
    await expect(page.getByRole('dialog', { name: 'AI Assist' })).toBeVisible();
    const overlayOrder = await page.evaluate(() => ({
      overlay: getComputedStyle(document.querySelector('.sheet-backdrop')!).zIndex,
      dock: getComputedStyle(document.querySelector('.assist-dock')!).zIndex,
      topElement: document.elementFromPoint(window.innerWidth - 10, Math.floor(window.innerHeight * 0.58))?.closest('.assist-dock, .sheet-backdrop')?.className ?? '',
    }));
    expect(overlayOrder.overlay).toBe('30');
    expect(overlayOrder.dock).toBe('10');
    expect(overlayOrder.topElement).toContain('sheet-backdrop');
    await page.getByRole('button', { name: 'Summarize this incident' }).last().click();
    await expect(page.getByRole('heading', { name: 'Haze Incident Summary' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('overview-mobile-assist-sheet.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'AI Assist' })).toHaveCount(0);
    await expect(dock).toBeFocused();
  });
});
