// Read-only local frontend verification; no helper, model, or speech generation.
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const directory = 'records/screenshots/hazard-incident-cards-2026-10-16';
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const result = { origin: 'http://127.0.0.1:8787', errors: [], assets: [], layouts: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', error => result.errors.push(error.message));
  for (const path of ['/favicon.svg', '/favicon.ico', '/icons/aegis-180.png']) {
    const response = await page.request.get(result.origin + path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).not.toContain('text/html');
    result.assets.push({ path, status: response.status(), type: response.headers()['content-type'] });
  }
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(result.origin);
    await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider', 'google', { timeout: 35000 });
    // Idle establishes camera/controls; let satellite tiles finish painting too.
    await page.waitForTimeout(2500);
    await expect(page.locator('.map-layer-control button')).toHaveCount(7);
    const layers = await page.locator('.map-layer-control').boundingBox();
    const map = await page.locator('.regional-map').boundingBox();
    const styles = await page.locator('.map-style-switch button').evaluateAll(nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { width: b.width, height: b.height }; }));
    expect(styles[0]).toEqual(styles[1]);
    if (viewport.width > 1150) expect(layers.y - map.y).toBeLessThan(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${directory}/toolbar-${viewport.width}.png` });
    if (viewport.width === 1920) {
      await page.getByRole('button', { name: 'Map', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Satellite', exact: true }).click();
      await page.getByRole('button', { name: 'wildfire', exact: true }).click();
      await expect(page.getByRole('button', { name: 'wildfire', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await page.getByRole('button', { name: 'wildfire', exact: true }).click();
      await page.getByRole('button', { name: 'Expand map', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Exit map fullscreen', exact: true })).toBeVisible();
      await page.screenshot({ path: `${directory}/toolbar-fullscreen.png` });
      await page.getByRole('button', { name: 'Exit map fullscreen', exact: true }).click();
    }
    await page.locator('.featured-hazard-card').first().click();
    const incident = page.locator('.hazard-incident-sections .regional-card-row').first();
    await expect(incident).toBeVisible();
    await page.screenshot({ path: `${directory}/category-${viewport.width}.png` });
    await incident.click();
    const dialog = page.getByRole('dialog', { name: 'Card details & evidence' });
    await expect(dialog).toBeVisible();
    const detail = await dialog.boundingBox();
    if (viewport.width === 390) expect(detail).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    else expect(detail.width / detail.height).toBeCloseTo(9 / 16, 2);
    await dialog.screenshot({ path: `${directory}/portrait-${viewport.width}.png` });
    result.layouts.push({ viewport, layers, map, styles, detail });
  }
  expect(result.errors).toEqual([]);
  writeFileSync('records/reviews/AEG-HAZARD-001_2026-10-16_origin.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
