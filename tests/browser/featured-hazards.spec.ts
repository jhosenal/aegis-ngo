import { expect, test } from '@playwright/test';
import { demoCards } from '../../ui/src/dashboard/data.js';

const hazards = ['seismic', 'hydrological', 'meteorological', 'wildfire', 'biological', 'displacement', 'volcanic'];

test('seven hazard cards show demo counts and each opens only matching incident cards', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('.featured-hazard-card')).toHaveCount(7);
  await expect(page.locator('.featured-hazard-count')).toHaveText(Array(7).fill('1'));
  const heading = await page.locator('.featured-hazards-heading h2').boundingBox();
  const subtitle = await page.locator('.featured-hazards-heading p').boundingBox();
  expect(Math.abs(heading!.y - subtitle!.y)).toBeLessThan(10);
  for (const hazard of hazards) {
    await page.goto('/');
    await page.locator('.featured-hazard-card[href$="hazard=' + hazard + '"]').click();
    await expect(page).toHaveURL(new RegExp('hazard=' + hazard));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(hazard.charAt(0).toUpperCase() + hazard.slice(1) + ' incidents');
    const rows = page.locator('.hazard-incident-sections .regional-card-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveClass(new RegExp('hazard-theme-' + hazard));
    expect((await rows.first().boundingBox())!.width).toBeLessThanOrEqual(281);
    await expect(page.getByRole('heading', { name: 'Historical incidents', exact: true })).toBeVisible();
    await rows.first().click();
    await expect(page.getByRole('dialog', { name: 'Card details & evidence' })).toBeVisible();
    const detail = await page.getByRole('dialog', { name: 'Card details & evidence' }).boundingBox();
    expect(detail!.width / detail!.height).toBeCloseTo(9 / 16, 2);
    await expect(page.getByTestId('synthetic-banner')).toBeVisible();
  }
});

test('mobile keyboard navigation preserves hazard filter and all-incidents action clears it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.featured-hazard-card').first().focus();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seismic incidents');
  await page.locator('.hazard-incident-sections .regional-card-row').first().click();
  const detail = page.getByRole('dialog', { name: 'Card details & evidence' });
  const bounds = await detail.boundingBox();
  expect(bounds).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await expect(page.getByTestId('pin-toggle')).toBeVisible();
  await expect(page.getByTestId('attach-toggle')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'All incidents', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Incidents');
  await expect(page.locator('.regional-card-row')).toHaveCount(7);
});

test('signed-in navigation retains session, excludes history from counts and marks unknown classification', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const base = demoCards.find(item => item.card.body.fields.some(field => field.key === 'hazardType' && field.value === 'earthquake'))!;
  const items = ['current', 'historical', 'unknown'].map(period => {
    const item = structuredClone(base);
    item.card.cardId = `COUNT-${period}`;
    item.card.title = `${period} seismic UI fixture`;
    item.card.body.fields = item.card.body.fields.filter(field => field.key !== 'incidentPeriod');
    if (period !== 'unknown') item.card.body.fields.push({ key: 'incidentPeriod', label: 'Period', value: period, unit: null, epistemic: 'proposal' });
    item.revisions = [item.card];
    return item;
  });
  let includeUnknown = false;
  await page.route('**/api/cards', route => route.fulfill({ json: { cards: items.slice(0, includeUnknown ? 3 : 2).map(item => ({ cardId: item.card.cardId, latestRevision: 1 })) } }));
  await page.route('**/api/cards/COUNT-*', route => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ json: items.find(item => item.card.cardId === id) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Guest preview' }).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  const seismic = page.locator('.featured-hazard-card[href$="hazard=seismic"]');
  await expect(seismic.locator('.featured-hazard-count')).toHaveText('1');
  await expect(page.locator('.regional-map-marker')).toHaveCount(1);
  await seismic.click();
  await expect(page.getByRole('button', { name: /^Account:/ })).toBeVisible();
  await expect(page.locator('.hazard-incident-sections .regional-card-row')).toHaveCount(2);
  await page.goBack();
  await expect(seismic.locator('.featured-hazard-count')).toHaveText('1');
  includeUnknown = true;
  await page.locator('.dashboard-sidebar').getByRole('button', { name: 'Incidents', exact: false }).click();
  await page.getByRole('button', { name: 'Refresh cards', exact: true }).click();
  await expect(page.locator('.regional-card-row')).toHaveCount(3);
  await page.locator('.dashboard-sidebar').getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(seismic.locator('.featured-hazard-count')).toHaveText('—');
});
