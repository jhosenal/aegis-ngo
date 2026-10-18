import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { demoCards } from '../../ui/src/dashboard/data.js';

const countries = ['Brunei', 'Cambodia', 'Indonesia', 'Laos', 'Malaysia', 'Myanmar', 'Philippines', 'Singapore', 'Thailand', 'Timor-Leste', 'Viet Nam'];
const codes = ['BRN','KHM','IDN','LAO','MYS','MMR','PHL','SGP','THA','TLS','VNM'];
const totals = [0, 2, 5, 1, 0, 3, 4];
const trend = {
  asOf:'2026-10-16T01:00:00Z', days:7,
  series: totals.map((total, i) => ({ date:`2026-10-${10 + i}`, total, byDomain:total ? { '1':total } : {} })),
  olderThanWindow:9, countryUnknown:2,
  byCountry: countries.map((name, i) => ({name, iso3:codes[i], active:name === 'Malaysia' ? 3 : 0})),
  remarks:['Fixture source notice: counts use UTC event dates, are incomplete, and are not a forecast.'],
};

test('real daily series drives labelled bars and table, with source notice and no affected panel', async ({ page }) => {
  await page.route('**/public/hazards/trend*', route => route.fulfill({json:trend}));
  await page.goto('/');
  const panel = page.getByRole('region', {name:'Incident activity', exact:true});
  await expect(panel.locator('figcaption')).toHaveText('Incidents per day (USGS and GDACS live feeds)');
  await expect(panel.locator('.trend-day')).toHaveCount(7);
  expect(await panel.locator('.trend-day').evaluateAll(nodes => nodes.map(n => Number((n as HTMLElement).dataset.total)))).toEqual(totals);
  await expect(panel.locator('[data-date="2026-10-12"] .trend-bar')).toHaveAttribute('style', 'height: 100%;');
  await expect(panel.locator('[data-date="2026-10-10"] .trend-bar')).toHaveAttribute('style', 'height: 0%;');
  await expect(panel).toContainText(trend.remarks[0]);
  await expect(panel).toContainText('9 incidents started before this window');
  await expect(panel.locator('.population-summary,.population-bar,.population-legend')).toHaveCount(0);
  await expect(panel.getByText('People potentially affected')).toHaveCount(0);
  await expect(page.locator('[data-card-id="metric:people-potentially-affected"] .metric-value')).toHaveText('Unknown');
  await panel.getByText('Daily counts and hazard breakdown').click();
  await expect(panel.getByRole('table')).toBeVisible();
  await expect(panel.getByRole('row', {name:'2026-10-12 5 Seismic: 5'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(panel.locator('figcaption')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('records/screenshots/incident-trend-2026-10-16',{recursive:true});
  await panel.screenshot({path:'records/screenshots/incident-trend-2026-10-16/fixture-mobile.png'});
});

test('all eleven countries have live counts; filtering follows country rather than region text', async ({ page }) => {
  await page.route('**/public/hazards/trend*', route => route.fulfill({json:trend}));
  const cards = ['Malaysia', 'Timor-Leste', null, '__missing'].map((country, i) => {
    const item = structuredClone(demoCards[2]!);
    item.card.cardId = `COUNTRY-${i}`; item.card.title = `Country fixture ${i}`;
    if (country === '__missing') item.card.body.fields = item.card.body.fields.filter(f => f.key !== 'country');
    else item.card.body.fields.find(f => f.key === 'country')!.value = country;
    // Deliberately misleading region text; this must never assign offshore incidents to a country.
    item.card.body.fields.find(f => f.key === 'regionId')!.value = 'Western North Pacific, east of the Philippines';
    return item;
  });
  await page.route('**/api/cards**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({json:cards.find(c => path.endsWith('/'+c.card.cardId)) ?? {cards:cards.map(c => ({cardId:c.card.cardId,latestRevision:1}))}});
  });
  await page.goto('/');
  const region = page.getByRole('combobox',{name:'Region',exact:true});
  for (const name of countries) await expect(region.locator(`option[value="${name}"]`)).toHaveText(`${name} (${name === 'Malaysia' ? 3 : 0})`);
  await expect(region.locator('option')).toHaveCount(13);
  await expect(region.locator('option[value="__offshore"]')).toHaveText('Offshore / unspecified (2)');
  await page.getByRole('button',{name:'Guest preview'}).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await page.locator('.dashboard-sidebar').getByRole('button',{name:/^Incidents/}).click();
  await region.selectOption('Malaysia');
  await expect(page.locator('.regional-card-row')).toHaveCount(1);
  await expect(page.locator('.regional-card-row')).toContainText('Country fixture 0');
  await expect(page.getByText('Country classification is missing on some workspace cards.', {exact:false})).toBeVisible();
  await region.selectOption('Timor-Leste');
  await expect(page.locator('.regional-card-row')).toHaveCount(1);
  await expect(page.locator('.regional-card-row')).toContainText('Country fixture 1');
  await region.selectOption('Philippines');
  await expect(page.locator('.regional-card-row')).toHaveCount(0);
  await region.selectOption('__offshore');
  await expect(page.locator('.regional-card-row')).toHaveCount(1);
  await expect(page.locator('.regional-card-row')).toContainText('Offshore / unspecified');
  await page.locator('.regional-card-row').click();
  await expect(page.getByTestId('field-country')).toContainText('Offshore / unspecified');
  await page.keyboard.press('Escape');
  await region.selectOption('');
  await expect(page.locator('.regional-card-row')).toHaveCount(4);
});

test('unavailable counts stay unknown and retry distinguishes a real zero series', async ({page}) => {
  let fail = true;
  await page.route('**/public/hazards/trend*', route => fail
    ? route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'Unavailable'}}})
    : route.fulfill({json:{...trend,series:trend.series.map(day=>({...day,total:0,byDomain:{}}))}}));
  await page.goto('/');
  await expect(page.getByText('Incident activity unavailable. Counts are unknown.')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Region',exact:true}).locator('option[value="Malaysia"]')).toHaveText('Malaysia (—)');
  await expect(page.locator('.trend-bar')).toHaveCount(0);
  fail = false;
  await page.getByRole('button',{name:'Retry incident activity'}).click();
  await expect(page.getByText('No incidents recorded in this event-date window.')).toBeVisible();
  await expect(page.locator('.trend-bar')).toHaveCount(7);
});
