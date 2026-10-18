import { expect, test } from '@playwright/test';

const viewports = [
  { width: 1280, height: 800 }, { width: 1672, height: 941 }, { width: 1920, height: 1080 },
  { width: 360, height: 740 }, { width: 390, height: 844 },
];

async function textCollisions(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.map-card')!;
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const boxes: Array<{ text: string; left: number; top: number; right: number; bottom: number; inControl: boolean }> = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest('[aria-hidden="true"], .visually-hidden')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rects = parent.namespaceURI === 'http://www.w3.org/2000/svg' ? [parent.getBoundingClientRect()] : [...range.getClientRects()];
      for (const rect of rects) {
        if (rect.width > 0 && rect.height > 0) boxes.push({ text: node.textContent.trim(), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, inControl: parent.closest('.map-controls') !== null });
      }
    }
    const overlaps: string[] = [];
    for (let left = 0; left < boxes.length; left += 1) for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left]!, b = boxes[right]!;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) overlaps.push(`${a.text} [${a.left.toFixed(0)},${a.top.toFixed(0)}-${a.right.toFixed(0)},${a.bottom.toFixed(0)}] / ${b.text} [${b.left.toFixed(0)},${b.top.toFixed(0)}-${b.right.toFixed(0)},${b.bottom.toFixed(0)}]`);
    }
    const controls = [...card.querySelectorAll<HTMLElement>('.map-controls button')].map((element) => element.getBoundingClientRect());
    const controlOverlaps = boxes.filter((box) => !box.inControl && controls.some((control) => box.right > control.left && box.left < control.right && box.bottom > control.top && box.top < control.bottom)).map((box) => box.text);
    return { overlaps, controlOverlaps };
  });
}

test('S0026 map text and controls do not overlap at desktop and phone widths', async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/overview');
    await expect(page.locator('.map-card')).toBeVisible();
    const collisions = await textCollisions(page);
    expect(collisions.overlaps, `text overlap at ${viewport.width}×${viewport.height}`).toEqual([]);
    expect(collisions.controlOverlaps, `map control overlap at ${viewport.width}×${viewport.height}`).toEqual([]);
    const mapLayout = await page.evaluate(() => {
      const rect = (selector: string) => { const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; };
      return { card: rect('.map-card'), stage: rect('.map-stage'), legend: rect('.map-legend'), rowHeights: [...document.querySelectorAll<HTMLElement>('.map-legend-row')].map((row) => row.getBoundingClientRect().height) };
    });
    expect(mapLayout.rowHeights.every((height) => height >= 48), `legend touch target at ${viewport.width}×${viewport.height}`).toBe(true);
    if (mapLayout.card.width >= 640) {
      expect(mapLayout.legend.left).toBeGreaterThanOrEqual(mapLayout.stage.right - 0.5);
      expect(Math.abs(mapLayout.legend.top - mapLayout.stage.top)).toBeLessThanOrEqual(1);
    } else {
      expect(mapLayout.legend.top).toBeGreaterThanOrEqual(mapLayout.stage.bottom - 0.5);
      expect(mapLayout.legend.height).toBeLessThanOrEqual(mapLayout.stage.height * 0.6 + 1);
    }
    const marker = page.locator('.map-marker[aria-label^="Community 7"]');
    await marker.focus();
    await expect(marker).toHaveAttribute('data-active', 'true');
    const markerTooltip = await textCollisions(page);
    expect(markerTooltip.overlaps, `marker tooltip overlap at ${viewport.width}×${viewport.height}`).toEqual([]);
    expect(markerTooltip.controlOverlaps, `marker tooltip control overlap at ${viewport.width}×${viewport.height}`).toEqual([]);
    await page.locator('.map-layer-chips button').first().focus();
    const legendRow = page.locator('.map-legend-row').first();
    await legendRow.focus();
    const legendTooltip = await textCollisions(page);
    expect(legendTooltip.overlaps, `legend tooltip overlap at ${viewport.width}×${viewport.height}`).toEqual([]);
    expect(legendTooltip.controlOverlaps, `legend tooltip control overlap at ${viewport.width}×${viewport.height}`).toEqual([]);
  }
});

test('S0026 community legend is sorted, linked by focus and clears on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/overview');
  const rows = page.locator('.map-legend-row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0)).toContainText('Community 1');
  await expect(rows.nth(0)).toContainText('Unhealthy');
  await expect(rows.nth(1)).toContainText('Community 5');
  await expect(rows.nth(2)).toContainText('Community 2');
  await expect(page.locator('.map-marker').first()).toHaveAttribute('aria-label', 'Community 1, AQI 182, Unhealthy');

  await page.locator('.map-layer-chips button').first().focus();
  for (let step = 0; step < 30; step += 1) {
    if (await page.evaluate(() => document.activeElement?.classList.contains('map-legend-row') ?? false)) break;
    await page.keyboard.press('Tab');
  }
  const focusedRow = page.locator('.map-legend-row:focus');
  await expect(focusedRow).toHaveAttribute('data-active', 'true');
  const activeId = await focusedRow.getAttribute('aria-pressed');
  expect(activeId).toBe('true');
  await expect(page.locator('.map-marker[data-active="true"]')).toHaveCount(1);
  await expect(page.getByRole('tooltip')).toContainText('Community');
  await page.keyboard.press('Escape');
  await expect(focusedRow).toHaveAttribute('data-active', 'false');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const collisions = await textCollisions(page);
  expect(collisions.overlaps).toEqual([]);
  expect(collisions.controlOverlaps).toEqual([]);
});

test('S0026 phone chips and buttons stay within cards and tabs show a scroll hint', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/overview');
  const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.overview-card button, .overview-card [class*="chip"]')]
    .filter((element) => {
      const card = element.closest<HTMLElement>('.overview-card');
      return card && element.getBoundingClientRect().right > card.getBoundingClientRect().right + 0.5;
    }).map((element) => element.getAttribute('aria-label') || element.textContent?.trim() || element.className));
  expect(clipped).toEqual([]);
  const strip = page.locator('.overview-tabs');
  expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const hint = page.getByRole('button', { name: 'Scroll to more incident sections' });
  await expect(hint).toBeVisible();
  const resources = page.getByRole('tab', { name: 'Resources' });
  await hint.click();
  expect(await resources.evaluate((element) => {
    const viewport = element.parentElement!.getBoundingClientRect();
    const tab = element.getBoundingClientRect();
    return tab.left >= viewport.left && tab.right <= viewport.right;
  })).toBe(true);
});
