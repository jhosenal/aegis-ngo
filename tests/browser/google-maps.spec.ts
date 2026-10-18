import { readFileSync } from 'node:fs';
import { demoCards } from '../../ui/src/dashboard/data.js';
import { expect, test } from '@playwright/test';

// Build once with VITE_GOOGLE_MAPS_API_KEY=maps-contract-fixture and run with
// AEGIS_MAPS_CONTRACT_TEST=true. Every Google SDK request is fulfilled locally.
test.skip(process.env.AEGIS_MAPS_CONTRACT_TEST !== 'true', 'Requires dedicated fixture-key UI build');

test.beforeEach(async({page})=>{await page.route('**/public/environment',r=>r.fulfill({json:{pins:[],registry:{pins:0},status:{enabled:false},remarks:[]}}));});
async function openLayers(page:import('@playwright/test').Page){const control=page.getByRole('button',{name:'Map layers',exact:true});if(await control.getAttribute('aria-expanded')==='false')await control.click();}

const sdkFixture = `
window.google = { maps: {
  ControlPosition: { TOP_RIGHT: 3 },
  Map: class {
    constructor(node, options) { this.node=node; this.zoom=options.zoom; this.idle=[]; node.dataset.fixtureMap='true'; }
    addListener(event,fn) { this.idle.push(fn); return {remove:()=>{this.idle=this.idle.filter(f=>f!==fn)}}; }
    getCenter() { return {lat:()=>5,lng:()=>115}; }
    panBy() {}
    setCenter(value) { this.node.dataset.fixtureCenter=JSON.stringify(value); }
    getZoom() { return this.zoom; }
    setZoom(value) { this.zoom=value; this.node.dataset.fixtureZoom=String(value); setTimeout(()=>this.idle.forEach(f=>f()),5); }
    fitBounds(bounds) { this.node.dataset.fixtureBounds=JSON.stringify(bounds); if(bounds.cluster) this.setZoom(11); }
    setOptions() {}
    getMapTypeId() { return this.type||'hybrid'; }
    setMapTypeId(type) { this.type=type;setTimeout(()=>this.idle.forEach(f=>f()),5); }
  },
  MaxZoomService: class { async getMaxZoomAtLatLng(){if(window.fixtureMaxError)throw new Error('fixture');return {zoom:window.fixtureMaxZoom??19};} },
  LatLngBounds: class { constructor(){this.cluster=true;} extend(){} },
  event: {
    addListenerOnce(map,event,fn) { const id=setTimeout(fn,20); return {remove(){clearTimeout(id)}}; },
    clearInstanceListeners() {}
  },
  marker: { AdvancedMarkerElement: class {
    constructor(options) { this.element=document.createElement('button');this.element.className='fixture-marker';this.element.setAttribute('aria-label',options.title);this.element.style.cssText='position:absolute;top:200px;left:'+(500+options.map.node.children.length*40)+'px';this.element.append(options.content);this.element.dataset.lat=options.position.lat;this.element.dataset.lng=options.position.lng;options.map.node.append(this.element); }
    addListener(event,fn) { this.element.addEventListener(event,fn);return {remove:()=>this.element.removeEventListener(event,fn)}; }
    set map(value) { if(value===null)this.element.remove(); }
  }}
}};
window.aegisMapsReady();`;

test('Google map keeps hazard filters, coordinates, card links and zoom; auth failure restores offline map', async ({ page }) => {
  let requests = 0;
  await page.route('https://maps.googleapis.com/**', async route => {
    requests++;
    expect(new URL(route.request().url()).searchParams.get('key')).toBe('maps-contract-fixture');
    await route.fulfill({ contentType: 'application/javascript', body: sdkFixture });
  });
  await page.goto('/');await openLayers(page);
  await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider', 'google');
  await expect(page.locator('.offline-map')).toBeHidden();
  await expect(page.locator('.fixture-marker')).toHaveCount(7);
  await expect(page.locator('.map-attribution')).toHaveCount(0);
  const fire = page.getByRole('button', { name: 'Open Forest fire monitoring, demo', exact: true });
  await expect(fire).toHaveAttribute('data-lat', '-1.2');
  await expect(fire).toHaveAttribute('data-lng', '114.1');
  await page.getByRole('button', { name: 'wildfire', exact: true }).click();
  await expect(page.locator('.fixture-marker')).toHaveCount(6);
  await page.getByRole('button', { name: 'wildfire', exact: true }).click();
  await page.getByRole('button',{name:'Map layers',exact:true}).click();
  await fire.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('synthetic-banner')).toContainText('Synthetic');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.google-map-canvas')).toHaveAttribute('data-fixture-zoom', '5');
  expect(requests).toBe(1);
  await page.evaluate(() => (window as Window & { gm_authFailure: () => void }).gm_authFailure());
  await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider', 'offline');
  await expect(page.locator('.offline-map')).toBeVisible();
  await expect(page.locator('.map-overlay-label')).toContainText('Google Maps unavailable');
  await expect(page.locator('.offline-map .regional-map-marker')).toHaveCount(7);
});

test('SDK network failure leaves offline map usable without crashing the dashboard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://maps.googleapis.com/**', route => route.abort());
  await page.goto('/');await openLayers(page);
  await expect(page.locator('.map-overlay-label')).toContainText('Google Maps unavailable');
  await expect(page.locator('.offline-map .regional-map-marker')).toHaveCount(7);
  await page.getByRole('button', { name: 'Open Forest fire monitoring, demo', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const mixed of [false, true]) test(`dense ${mixed ? 'mixed' : 'wildfire'} incidents show a tinted icon and shadowed count, preserving zoom and card links`, async ({ page }) => {
  await page.route('https://maps.googleapis.com/**', route => route.fulfill({ contentType:'application/javascript', body:sdkFixture }));
  const cards = Array.from({ length: 24 }, (_, i) => {
    const item = structuredClone(demoCards[2]!);
    item.card.cardId = `DENSE-${i}`;
    item.card.title = `Cluster fixture ${i}`;
    item.card.body.fields.find(f => f.key === 'hazardType')!.value = mixed && i % 2 ? 'flood' : 'wildfire';
    item.card.body.synthetic = false;
    item.card.body.fields.find(f => f.key === 'location')!.value = `${10000000+i*1000},120000000`;
    return item;
  });
  await page.route('**/api/cards**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: cards.find(c => path.endsWith('/'+c.card.cardId)) ?? { cards: cards.map(c => ({ cardId:c.card.cardId, latestRevision:1 })) } });
  });
  await page.goto('/');await openLayers(page);
  await page.getByRole('button', { name:'Guest preview' }).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await expect(page.locator('.live-map-cluster')).toHaveCount(1);
  await expect(page.locator('.live-map-cluster')).toHaveText('24');
  const cluster = page.locator('.live-map-cluster');
  await expect(cluster).toHaveAttribute('data-cluster-kind', mixed ? 'mixed' : 'wildfire');
  expect(await cluster.locator('.cluster-icon').evaluate(el => getComputedStyle(el).opacity)).toBe('0.7');
  expect(await cluster.locator('.cluster-count').evaluate(el => getComputedStyle(el).textShadow)).not.toBe('none');
  expect(await cluster.locator('linearGradient stop').count()).toBe(mixed ? 7 : 0);
  await page.addStyleTag({content:'[data-testid="news-reader"]{visibility:hidden !important}'});
  await cluster.screenshot({path:`records/screenshots/map-layer-toolbar-2026-10-17/cluster-${mixed ? 'mixed' : 'wildfire'}.png`});
  await page.locator('.live-map-cluster').click();
  await expect(page.locator('.google-hazard-marker')).toHaveCount(24);
  await page.locator('.fixture-marker').first().dispatchEvent('click');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Air and weather clusters all 125 monitoring pins and opens an unknown reading popup', async ({ page }) => {
  await page.route('https://maps.googleapis.com/**', route => route.fulfill({ contentType:'application/javascript', body:sdkFixture }));
  const registry = JSON.parse(readFileSync(new URL('../../fixtures/environment-pins.json', import.meta.url), 'utf8')) as {pins:{pinId:string;country:string;name:string;lat:number;lng:number}[]};
  await page.route('**/public/environment', route => route.fulfill({json:{asOf:new Date().toISOString(),registry:{id:'fixture',pins:125},status:{enabled:false},remarks:['Fixture refresh is switched off'],
    pins:registry.pins.map(pin => ({...pin,air:null,weather:{current:null,hourly:null,alerts:null},unverified:null}))}}));
  await page.goto('/');await openLayers(page);
  const clusters = page.locator('.environment-map-cluster');
  await expect(clusters.first()).toBeVisible();
  await expect(clusters.first()).toHaveAttribute('data-cluster-kind','weather');
  await expect(clusters.first().locator('.cluster-icon')).toBeVisible();
  const total = async () => page.locator('.environment-map-cluster,.environment-pin').evaluateAll(nodes=>nodes.reduce((n,node)=>n+Number((node as HTMLElement).dataset.locationCount),0));
  expect(await total()).toBe(125);
  expect(await page.locator('.environment-map-cluster,.environment-pin').count()).toBeLessThan(125);
  await clusters.first().dispatchEvent('click');
  await expect(page.locator('.environment-pin')).toHaveCount(125);
  expect(await total()).toBe(125);
  await page.locator('.environment-pin').first().dispatchEvent('click');
  const popup = page.getByRole('dialog',{name:/^Air and weather:/});
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('region',{name:'Air quality',exact:true})).toContainText('Not available');
  await expect(popup.getByRole('region',{name:'Current weather',exact:true})).toContainText('Not available');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await openLayers(page);
  await page.locator('.map-layer-control').getByRole('button',{name:'Air & Weather',exact:true}).click();
  await expect(page.locator('.environment-pin,.environment-map-cluster')).toHaveCount(0);
});


test('individual live labels expire independently while monitoring pins and seven-day details remain clickable',async({page})=>{
 const now=new Date('2026-10-17T00:00:00Z');await page.clock.install({time:now});await page.clock.pauseAt(now);
 await page.route('https://maps.googleapis.com/**',r=>r.fulfill({contentType:'application/javascript',body:sdkFixture}));
 const reading=(kind:string,seconds:number,data:unknown)=>({kind,fetchedAt:now.toISOString(),validUntil:new Date(+now+seconds*1000).toISOString(),data,attribution:'Source: Includes data from Google'});
 const pin={pinId:'my-01',name:'Fixture place',country:'MY',region:'Fixture',lat:4,lng:102,needs:['air','weather'],unverified:null,air:reading('AIR_CURRENT',60,{indexes:[{code:'uaqi',displayName:'Universal AQI',aqi:23,category:'Low air quality'}]}),weather:{current:reading('WEATHER_CURRENT',120,{temperature:{degrees:28,unit:'CELSIUS'}}),hourly:null,alerts:null}};
 await page.route('**/public/environment',r=>r.fulfill({json:{pins:[pin],registry:{pins:1},status:{enabled:true},remarks:[]}}));
 await page.route('**/public/environment/pin/*/history',r=>r.fulfill({json:{days:[{date:'2026-10-16',tempMin:22,tempMax:29,rainMm:3,pm25Max:10,hours:24}],credit:'Open-Meteo modelled fixture, CC BY 4.0',link:'https://open-meteo.com/',measured:null}}));
 await page.goto('/');await openLayers(page);await expect(page.locator('[data-fixture-map=true]')).toBeAttached();await page.clock.runFor(100);
 const label=page.locator('.environment-reading-label');await expect(label).toHaveCount(1);await expect(label).toContainText('28 \u00b0C');await expect(label).toContainText('Universal AQI 23');await expect(label).toContainText('Google');expect(await label.evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
 await page.addStyleTag({content:'[data-testid="news-reader"]{visibility:hidden !important}'});await label.screenshot({path:'records/screenshots/map-layer-toolbar-2026-10-17/fresh-label.png'});
 await page.clock.runFor(60001);await expect(label).toContainText('28 \u00b0C');await expect(label).not.toContainText('AQI');await page.clock.runFor(60001);await expect(label).toHaveCount(0);await expect(page.locator('.environment-pin')).toHaveCount(1);
 await page.locator('.environment-pin').dispatchEvent('click');const popup=page.getByRole('dialog',{name:'Air and weather: Fixture place',exact:true});await expect(popup).toBeVisible();await expect(popup.getByRole('region',{name:'Last 7 days',exact:true})).toContainText('22');await expect(popup.getByRole('region',{name:'Air quality',exact:true})).toContainText('Not available');await page.keyboard.press('Escape');await expect(popup).toHaveCount(0);await expect(page.locator('.environment-pin')).toHaveCount(1);
});

 test('country selector frames all eleven countries and All ASEAN restores regional view', async ({page})=>{
 await page.route('https://maps.googleapis.com/**',r=>r.fulfill({contentType:'application/javascript',body:sdkFixture}));
 await page.goto('/');const canvas=page.locator('[data-fixture-map=true]');await expect(canvas).toBeVisible();
 const regions=page.getByRole('combobox',{name:'Region',exact:true});
 for(const name of ['Brunei','Cambodia','Indonesia','Laos','Malaysia','Myanmar','Philippines','Singapore','Thailand','Timor-Leste','Viet Nam']){
 await regions.selectOption({value:name});const centre=JSON.parse((await canvas.getAttribute('data-fixture-center'))!);expect(centre.lat).toBeGreaterThan(-15);expect(centre.lat).toBeLessThan(35);if(name==='Singapore'){expect(Number(await canvas.getAttribute('data-fixture-zoom'))).toBeGreaterThan(8);expect(centre.lng).toBeCloseTo(103.85,4);expect(centre.lng).toBeGreaterThan(103);expect(centre.lng).toBeLessThan(105);}
 }
 await regions.selectOption('');await expect(canvas).toHaveAttribute('data-fixture-bounds',/"north":48/);
 });

 test('unavailable satellite detail offers zoom recovery, tile errors remain distinct and controls stay usable',async({page})=>{
 await page.route('https://maps.googleapis.com/**',r=>r.fulfill({contentType:'application/javascript',body:sdkFixture}));
 await page.goto('/');await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider','google');
 await page.evaluate(()=>{(window as Window&{fixtureMaxZoom?:number}).fixtureMaxZoom=12;});
 const slider=page.getByRole('slider',{name:'Map zoom',exact:true});await slider.fill('18');
 const notice=page.locator('.map-imagery-notice');await expect(notice).toContainText('Imagery unavailable at this zoom');await expect(notice).not.toContainText('monitoring');
 await expect(notice.getByRole('button')).toHaveCount(0);await slider.fill('12');await expect(slider).toHaveValue('12');await expect(notice).toHaveCount(0);
 await page.getByRole('button',{name:'Map',exact:true}).click();await slider.fill('18');await expect(notice).toHaveCount(0);await slider.fill('19');await expect(notice).toContainText('No more map detail at this zoom');await slider.fill('18');await expect(notice).toHaveCount(0);
 await page.locator('.google-map-canvas').evaluate(el=>{const image=document.createElement('img');image.src='https://mt1.google.com/vt/lyrs=m&x=1&y=1&z=3';el.append(image);image.dispatchEvent(new Event('error'));});await expect(notice).toContainText('Map imagery unavailable');await expect(page.getByRole('button',{name:'Latest news',exact:true})).toBeVisible();
 });
