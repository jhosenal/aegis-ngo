import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { EnvPin } from '../../src/sources/pinRegistry.js';
const registry = JSON.parse(readFileSync(new URL('../../fixtures/environment-pins.json', import.meta.url), 'utf8')) as {registryId:string;asOf:string;pins:EnvPin[]};
import { mkdirSync } from 'node:fs';

const pins = registry.pins.map(pin => ({ ...pin, unverified:pin.review, air:null, weather:{current:null,hourly:null,alerts:null} }));
const payload = {
  asOf:'2026-10-16T07:00:00Z', status:{enabled:false,lastRunAt:null,lastReadings:0,lastFailures:0,lastSkipped:0,alertsNotCovered:0},
  attribution:{air:'Source: Includes air quality data from Google',weather:'Source: Includes weather data from Google'},
  registry:{id:registry.registryId,asOf:registry.asOf,pins:pins.length}, pins,
  remarks:['Fixture route: refresh is switched off. Null means no reading held.'],
};
const toggle = (page: import('@playwright/test').Page) => page.locator('.map-layer-control').getByRole('button',{name:'Air & Weather',exact:true});

test('all layers start on, master tracks partial/off and region-first toolbar keeps monitoring coverage explicit',async({page})=>{
 await page.route('**/public/environment',r=>r.fulfill({json:payload}));await page.goto('/');
 const master=page.getByRole('checkbox',{name:'All map layers',exact:true});await expect(master).toHaveAttribute('aria-checked','true');await expect(page.locator('.offline-environment-marker').first()).toBeVisible();
 const disclosure=page.getByRole('button',{name:'Map layers',exact:true});await expect(disclosure).toHaveAttribute('aria-expanded','false');await disclosure.click();await expect(toggle(page)).toHaveAttribute('aria-pressed','true');await expect(toggle(page).locator('.map-layer-count')).toHaveText('125');await expect(page.getByRole('button',{name:'Air & Weather information',exact:true})).toHaveCount(0);
 await toggle(page).click();await expect(master).toHaveAttribute('aria-checked','mixed');await expect(page.locator('.offline-environment-marker')).toHaveCount(0);await expect(toggle(page).locator('.map-layer-count')).toHaveText('125');await master.click();await expect(master).toHaveAttribute('aria-checked','true');await expect(page.locator('.offline-environment-marker').first()).toBeVisible();await master.click();await expect(master).toHaveAttribute('aria-checked','false');await expect(page.locator('.offline-environment-marker')).toHaveCount(0);await expect(page.locator('.offline-map .regional-map-marker')).toHaveCount(0);await master.click();
 for(const country of ['Malaysia','Brunei']) {
  await page.getByRole('combobox',{name:'Region',exact:true}).selectOption(country);const marker=page.locator('.offline-environment-marker').first();await marker.focus();await marker.press('Enter');const picker=page.getByRole('dialog',{name:'Air and weather locations',exact:true});if(await picker.count())await picker.locator('.environment-location-list button').first().click();const popup=page.getByRole('dialog',{name:/^Air and weather:/});await expect(popup).toBeVisible();await expect(popup.getByRole('region',{name:'Air quality',exact:true})).toContainText('Not available');await popup.locator('.environment-alert-details > summary').click();await expect(popup).toContainText('No Google alert source for this country');await page.keyboard.press('Escape');
 }
 await page.getByRole('combobox',{name:'Region',exact:true}).selectOption('Indonesia');await expect(page.locator('.offline-environment-marker')).toHaveCount(0);if(await disclosure.getAttribute('aria-expanded')==='false')await disclosure.click();await expect(page.locator('.map-layer-status')).toContainText('No monitoring locations in this region.');
 await page.getByRole('combobox',{name:'Region',exact:true}).selectOption('Malaysia');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('valid zero values carry adjacent attribution/freshness and disappear at their own deadlines', async ({page}) => {
  const now = new Date('2026-10-16T07:00:00Z');
  await page.clock.install({time:now});
  await page.clock.pauseAt(now);
  const pin = pins.find(p=>p.country==='SG')!;
  const reading = (kind:string, until:number, data:unknown, attribution:string) => ({pinId:pin.pinId,kind,fetchedAt:now.toISOString(),validUntil:new Date(+now+until).toISOString(),attribution,data,
    freshness:{text:'ENV-EXPIRY-FIXTURE: provider timestamp supplied.',cadence:'Cadence not published.',cadenceBasis:'NOT_PUBLISHED'}});
  await page.route('**/public/environment',route=>route.fulfill({json:{...payload,registry:{...payload.registry,pins:1},status:{...payload.status,enabled:true},pins:[{...pin,
    air:reading('AIR_CURRENT',2000,{indexes:[{displayName:'Universal AQI',aqi:0}]},payload.attribution.air),
    weather:{current:reading('WEATHER_CURRENT',5000,{temperature:{degrees:0,unit:'CELSIUS'}},payload.attribution.weather),hourly:null,alerts:null}}]}}));
  await page.goto('/');
  await page.locator('.offline-environment-marker').click();
  const popup = page.getByRole('dialog',{name:/^Air and weather:/});
  const detail=popup;
  const air = detail.getByRole('region',{name:'Air quality',exact:true});
  const weather = detail.getByRole('region',{name:'Current weather',exact:true});
  await expect(air).toContainText('Universal AQI');
  await expect(air.locator('.environment-index .environment-value')).toHaveText('0');
  await expect(air).toContainText(payload.attribution.air);
  await expect(weather).toContainText('0 \u00b0C');
  await expect(weather).toContainText(payload.attribution.weather);
  await expect(air).toContainText('ENV-EXPIRY-FIXTURE');
  await page.clock.runFor(2100);
  await expect(air).toContainText('Not available');
  await expect(air.locator('.environment-value')).toHaveCount(0);
  await expect(weather).toContainText('0 \u00b0C');
  await page.clock.runFor(3000);
  await expect(weather).toContainText('Not available');
  await expect(detail.locator('.environment-value')).toHaveCount(0);
  expect(await page.evaluate(()=>Object.values(localStorage).join('|').includes('ENV-EXPIRY-FIXTURE'))).toBe(false);
});

test('failed monitoring endpoint preserves layer on state and provides retry in the new panel',async({page})=>{
 let fail=true;await page.route('**/public/environment',r=>fail?r.fulfill({status:503,json:{error:'fixture'}}):r.fulfill({json:payload}));await page.goto('/');await page.getByRole('button',{name:'Map layers',exact:true}).click();await expect(page.locator('.map-layer-status')).toContainText('Monitoring readings unavailable.');await expect(toggle(page)).toHaveAttribute('aria-pressed','true');fail=false;await page.getByRole('button',{name:'Retry air & weather',exact:true}).click();await expect(page.locator('.offline-environment-marker').first()).toBeVisible();
});
