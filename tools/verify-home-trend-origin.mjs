import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = 'http://127.0.0.1:8787';
const shots = 'records/screenshots/incident-trend-2026-10-16';
mkdirSync(shots, { recursive:true });
const browser = await chromium.launch({headless:true});
const receipt = { origin, date:'2026-10-16', mode:'actual local public feed endpoint and synthetic local login; no model calls', errors:[] };
try {
  const page = await browser.newPage({viewport:{width:1680,height:1080}});
  page.on('pageerror', error => receipt.errors.push(error.message));
  const countriesOnCards = [];
  page.on('response', async response => {
    if (/\/api\/cards\/[^/?]+\?/.test(response.url())) {
      const body = await response.json();
      if (body.card?.kind === 'incident') countriesOnCards.push(body.card.body.fields.some(field => field.key === 'country'));
    }
  });
  const data = await (await page.request.get(origin+'/public/hazards/trend?days=7')).json();
  await page.goto(origin);
  const panel = page.getByRole('region',{name:'Incident activity',exact:true});
  await expect(panel.locator('.trend-day')).toHaveCount(data.series.length);
  expect(await panel.locator('.trend-day').evaluateAll(nodes => nodes.map(node => ({date:node.dataset.date,total:Number(node.dataset.total)}))))
    .toEqual(data.series.map(day => ({date:day.date,total:day.total})));
  await expect(panel).toContainText(data.remarks[0]);
  await expect(panel.locator('.population-summary,.population-bar,.population-legend')).toHaveCount(0);
  await expect(page.locator('[data-card-id="metric:people-potentially-affected"] .metric-value')).toHaveText('Unknown');
  const region = page.getByRole('combobox',{name:'Region',exact:true});
  await expect(region.locator('option')).toHaveCount(13);
  for (const country of data.byCountry) await expect(region.locator(`option[value="${country.name}"]`)).toHaveText(`${country.name} (${country.active})`);
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({path:`${shots}/actual-chart-desktop.png`});
  await page.getByRole('button',{name:'Guest preview'}).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await page.locator('.dashboard-sidebar').getByRole('button',{name:/^Incidents/}).click();
  await expect(page.locator('.regional-card-row').first()).toBeVisible();
  receipt.countryFieldCoverage = { inspected: countriesOnCards.length, withField: countriesOnCards.filter(Boolean).length };
  if (countriesOnCards.length > 0 && countriesOnCards.every(Boolean)) {
  await region.selectOption('Philippines');
  await expect(page.locator('.regional-card-row').first()).toBeVisible();
  for (const label of await page.locator('.regional-card-copy small').allTextContents()) expect(label.trim()).toBe('Philippines');
  await region.selectOption('__offshore');
  await expect(page.locator('.regional-card-row').first()).toBeVisible();
  for (const label of await page.locator('.regional-card-copy small').allTextContents()) expect(label.trim()).toBe('Offshore / unspecified');
    receipt.countryFiltering = 'PASS';
  } else {
    receipt.countryFiltering = 'PENDING: existing API card revisions lack country; recorded for SNET in C0009';
    await region.selectOption('Philippines');
    await expect(page.getByText('Country classification is missing on some workspace cards.', { exact:false })).toBeVisible();
    await expect(page.locator('.regional-card-row')).toHaveCount(0);
  }
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(origin);
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({path:`${shots}/actual-chart-mobile.png`});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(receipt.errors).toEqual([]);
  receipt.series = data.series;
  receipt.byCountry = data.byCountry;
  receipt.countryUnknown = data.countryUnknown;
  receipt.status = receipt.countryFiltering === 'PASS' ? 'PASS' : 'PARTIAL: chart and counts pass; backend country field pending';
} catch(error) { receipt.status='FAIL';receipt.failure=error.message;process.exitCode=1; }
finally {
  await browser.close();
  writeFileSync('records/reviews/AEG-HOME-UI-002_2026-10-16_origin.json',JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:receipt.status,errors:receipt.errors,failure:receipt.failure}));
}
