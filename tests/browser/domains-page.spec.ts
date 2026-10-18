import { expect, test } from '@playwright/test';

// The /domains catalogue (public, no login). It must show seven domains, say on every card that the domain is not running yet, and be
// usable on a phone.
test.use({ viewport: { width: 360, height: 740 } });

test('/domains shows the seven domains, says none runs yet, and fits a 360 px phone with no cookies', async ({ page, context }) => {
  await page.goto('/domains');
  await expect(page.getByRole('heading', { level: 1, name: 'Aegis hazard domains' })).toBeVisible();
  await expect(page.getByText(/None of the seven runs in the Aegis engine yet/)).toBeVisible();
  await expect(page.locator('article.domain-card')).toHaveCount(7);
  await expect(page.getByText('Specified; selected claims reviewed. Not running in the engine yet.')).toHaveCount(7);
  for (const name of ['Seismic', 'Hydrological', 'Meteorological', 'Wildfire', 'Biological', 'Displacement', 'Volcanic']) {
    await expect(page.getByRole('heading', { level: 2, name: new RegExp(name) })).toBeVisible();
  }
  await expect(page.getByText(/source-verified/i)).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  const small = await page.evaluate(() => [...document.querySelectorAll('a,button,summary')]
    .map((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent ?? '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((r) => r.w > 0 && (r.w < 48 || r.h < 48)));
  expect(small).toEqual([]);
  expect(await context.cookies()).toEqual([]);
});

test('each card opens its audit and shows what was held back as well as what was supported', async ({ page }) => {
  await page.goto('/domains');
  const meteorological = page.locator('article.domain-card', { hasText: 'Meteorological' });
  await meteorological.getByText(/What the source audit found/).click();
  await expect(meteorological.getByRole('heading', { level: 3, name: 'Supported by a saved source' })).toBeVisible();
  await expect(meteorological.getByRole('heading', { level: 3, name: /Held back/ })).toBeVisible();
  await expect(meteorological.getByText(/storm-surge heights of 2\.0, 2\.5 and 4\.0 m/i)).toBeVisible();
});

test('the page links to the haze guidance and the link works', async ({ page }) => {
  await page.goto('/domains');
  await page.getByRole('link', { name: /Open Aegis Assist/ }).click();
  // on a phone the chat is the main view of the Assist page and the cards (with the heading) are behind the Cards button
  await expect(page.getByTestId('assist-chat')).toBeVisible();
  await expect(page.getByTestId('assist-emergency')).toBeVisible();
});

test('the hero image and the seven domain icons load, are described by the page text, and cause no horizontal scroll', async ({ page }) => {
  await page.goto('/domains');
  const hero = page.locator('.domains-hero img');
  await expect(hero).toBeVisible();
  expect(await hero.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(1000);
  await expect(page.locator('.domains-hero figcaption')).toContainText(/Illustrative artwork.*not photographs or evidence of current incidents/);
  const icons = page.locator('.domain-card .domain-icon svg');
  await expect(icons).toHaveCount(7);
  expect(await icons.evaluateAll(list => list.every(svg => svg.getAttribute('aria-hidden') === 'true'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
