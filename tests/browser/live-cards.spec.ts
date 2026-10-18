import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { demoCards } from '../../ui/src/dashboard/data.js';

test('dense live card contract: GREEN toggle, cyclone coordinates, credits and pagination', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const cards = Array.from({ length: 30 }, (_, i) => {
    const item = structuredClone(demoCards[2]!);
    item.card.cardId = `LIVE-CONTRACT-${i}`;
    item.card.title = i === 0 ? 'CHAMPI fixture storm' : `Live fixture storm ${i}`;
    item.card.body.synthetic = false;
    item.card.body.syntheticLabel = null;
    for (const f of item.card.body.fields) {
      if (f.key === 'hazardType') f.value = 'STORM';
      if (f.key === 'alertLevel') f.value = i % 2 ? 'GREEN' : 'RED';
      if (f.key === 'location') f.value = `${11300000 + i * 1000},${i === 0 ? 154000000 : 120000000 + i * 1000}`;
    }
    return { ...item, evidence: [{ evidenceId: `E-${i}`, sourceId: 'SRC.GDACS', synthetic: false,
      licenceRef: 'LIC.GDACS-CC-BY-4.0-INDICATIVE-ONLY', sourceUrl: 'https://www.gdacs.org/report.aspx?eventid=fixture',
      publishedAt: '2026-10-16T00:00:00Z', fetchedAt: '2026-10-16T01:00:00Z', flags: [], payload: { title: 'Contract fixture' } }] };
  });
  await page.route('**/api/cards**', async route => {
    const path = new URL(route.request().url()).pathname;
    const item = cards.find(c => path.endsWith('/' + c.card.cardId));
    await route.fulfill({ json: item ?? { cards: cards.map(c => ({ cardId: c.card.cardId, latestRevision: 1 })) } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Guest preview' }).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await page.getByRole('button',{name:'Map layers',exact:true}).click();
  const green = page.getByRole('button', { name: 'GREEN alerts',exact:true });
  await expect(green).toHaveAttribute('aria-pressed', 'true');
  await expect(green.locator('.map-layer-count')).toHaveText('15');
  await expect(page.locator('.offline-map .regional-map-marker')).toHaveCount(30);
  await green.click();
  await expect(page.getByRole('checkbox',{name:'All map layers',exact:true})).toHaveAttribute('aria-checked','mixed');
  await expect(page.locator('.offline-map .regional-map-marker')).toHaveCount(15);
  const storm = page.locator('.offline-map').getByRole('button', { name: /CHAMPI fixture storm.*Storm position/ });
  await expect(storm).toHaveCount(1);
  await storm.dispatchEvent('click');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Storm position \(GDACS\).*not an impact location/)).toBeVisible();
  await expect(dialog.locator('.live-source-credit').first()).toContainText('GDACS, CC BY 4.0. Indicative only');
  await expect(dialog.getByRole('link', { name: 'Open source' }).first()).toHaveAttribute('href', /gdacs\.org/);
  await page.keyboard.press('Escape');
  if(await page.getByRole('button',{name:'Map layers',exact:true}).getAttribute('aria-expanded')==='false')await page.getByRole('button',{name:'Map layers',exact:true}).click();
  await green.click();
  await expect(page.locator('.offline-map .regional-map-marker')).toHaveCount(30);
  await page.getByRole('button', { name: 'Incidents 30' }).click();
  await expect(page.locator('.regional-card-list .regional-card-row')).toHaveCount(12);
  await expect(page.getByRole('navigation', { name: 'Incident pages' })).toContainText('1–12 of 30');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Incident pages' })).toContainText('13–24 of 30');
  mkdirSync('records/screenshots/map-layer-toolbar-2026-10-17', { recursive: true });
  await page.screenshot({ path: 'records/screenshots/map-layer-toolbar-2026-10-17/fixture-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'records/screenshots/map-layer-toolbar-2026-10-17/fixture-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

const notice = JSON.parse(readFileSync(new URL('../../content/legal/data-sources-and-pilot-notice.json', import.meta.url), 'utf8')) as { sections: unknown[] };

test('pilot notice route renders content without internal draft instructions', async ({ page }) => {
  await page.goto('/legal/data-sources');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Data & Compliance');
  await expect(page.locator('.legal-notice').getByRole('heading', { level: 2 })).toHaveCount(notice.sections.length);
  await expect(page.getByText(/Do not link from the footer/)).toHaveCount(0);
});
