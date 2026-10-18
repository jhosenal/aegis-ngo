import {expect,test} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
const shots='records/screenshots/map-layer-toolbar-2026-10-17';
mkdirSync(shots,{recursive:true});
const registry=JSON.parse(readFileSync(new URL('../../fixtures/environment-pins.json',import.meta.url),'utf8'));
const base=registry.pins.find((p:{name:string})=>p.name==='Bentong');
const now=new Date('2026-10-16T10:30:00Z');
const credits={air:'Source: Includes air quality data from Google',weather:'Source: Includes weather data from Google'};
const updates={perDay:4,timesLocal:['07:00','12:00','17:00','22:00'],timezone:'MYT',valueShownMinutes:60};
const reading=(kind:string,data:unknown,source:string)=>({pinId:base.pinId,kind,data,fetchedAt:now.toISOString(),validUntil:new Date(+now+3600000).toISOString(),attribution:source,freshness:{text:'Fixture source timing',cadence:'Publisher timing supplied',cadenceBasis:'PUBLISHER_STATED'}});
const air=reading('AIR_CURRENT',{indexes:[{code:'uaqi',displayName:'Universal AQI',aqi:23,category:'Low air quality'},{code:'mys_doe',displayName:'API (MY)',aqi:60,category:'Moderate air quality'}],pollutants:[{code:'pm25',concentration:{value:8,units:'MICROGRAMS_PER_CUBIC_METER'}},{code:'pm10',concentration:{value:14,units:'MICROGRAMS_PER_CUBIC_METER'}}]},credits.air);
const weather=reading('WEATHER_CURRENT',{temperature:{degrees:28,unit:'CELSIUS'},weatherCondition:{description:{text:'Partly cloudy'}},relativeHumidity:74,wind:{speed:{value:6,unit:'KILOMETERS_PER_HOUR'}},feelsLikeTemperature:{degrees:30,unit:'CELSIUS'}},credits.weather);
const media={status:'matched',wikipediaUrl:'https://en.wikipedia.org/wiki/Bentong',articleTitle:'Bentong',image:{thumb250:'https://upload.wikimedia.org/test250.png',thumb500:'https://upload.wikimedia.org/test500.png',width:500,height:281,alt:'Fixture Bentong article image',credit:'Photo: Fixture author, CC BY-SA 4.0, via Wikimedia Commons',licence:'CC BY-SA 4.0',licenceUrl:'https://creativecommons.org/licenses/by-sa/4.0/',commonsUrl:'https://commons.wikimedia.org/wiki/File:Fixture.jpg'},fallback:'hide-image-keep-link'};
const nearby={radiusKm:100,total:0,counts:{earthquake:0,flood:0,storm:0,wildfire:0,volcano:0,other:0},items:[],note:'Current incidents within 100 km recorded by USGS and GDACS live feeds only. Zero means none recorded, not that nothing is happening. Storm point is its position, not an impact area.'};
const pin={...base,air,weather:{current:weather,hourly:null,alerts:null},unverified:null,lastUpdatedAt:now.toISOString(),readingState:'fresh',media,nearby};
async function open(page:import('@playwright/test').Page, value:unknown){
 await page.clock.install({time:now});
 await page.route('**/public/environment',r=>r.fulfill({json:{asOf:now.toISOString(),status:{enabled:true,scheduled:false},attribution:credits,updates,registry:{pins:1},pins:[value],remarks:[]}}));
 await page.route('**/public/environment/pin/*/history',r=>r.fulfill({json:{days:[{date:'2026-10-16',tempMin:23,tempMax:30,rainMm:2,pm25Max:12,hours:24}],measured:null,credit:'Modelled fixture, Open-Meteo CC BY 4.0',link:'https://open-meteo.com/'}}));
 await page.goto('/');await page.locator('.offline-environment-marker').click();return page.getByRole('dialog',{name:/^Air and weather:/});
}
test('monitoring popup shares disaster dialog, retains named indexes, history, media credit and close behaviour',async({page})=>{
 await page.route('https://upload.wikimedia.org/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAt8AAAAASUVORK5CYII=','base64')}));
 await page.setViewportSize({width:1920,height:1080});const card=await open(page,pin);
 await expect(card).toHaveClass(/dashboard-dialog.*card-portrait-dialog/);await expect(card.locator('[data-ui-formulation]')).toHaveAttribute('data-ui-formulation','AEG.UI.MONITORING-CARD/2.0.0');
 const close=(await card.getByRole('button',{name:'Close air and weather',exact:true}).boundingBox())!;expect(close.width).toBe(close.height);
 const indexes=card.locator('.environment-index');await expect(indexes.nth(0)).toContainText('Universal AQI');await expect(indexes.nth(0)).toContainText('23');await expect(indexes.nth(0)).toContainText('Low air quality');await expect(indexes.nth(1)).toContainText('API (MY)');await expect(indexes.nth(1)).toContainText('Moderate air quality');
 await expect(card.locator('.environment-pollutants')).toContainText('8 \u00b5g/m\u00b3');await expect(card.locator('.environment-pollutants')).not.toContainText('Good');await expect(card.getByRole('region',{name:'Current weather',exact:true})).toContainText('28 \u00b0C');await expect(card).toContainText(credits.air);await expect(card).toContainText(credits.weather);
 await expect(card.getByRole('link',{name:/Read more on Wikipedia/})).toHaveAttribute('href',media.wikipediaUrl);await expect(card.getByAltText(media.image.alt)).toHaveAttribute('srcset',/250w.*500w/);await expect(card).toContainText(media.image.credit);
 const history=card.getByRole('region',{name:'Last 7 days',exact:true});await expect(history).toContainText('23');await expect(history).toContainText('modelled');await history.scrollIntoViewIfNeeded();await page.screenshot({path:shots+'/desktop-history.png'});
 await card.locator('.environment-nearby-details > summary').click();await expect(card).toContainText(nearby.note);await expect(card.locator('footer')).toContainText('Last updated 18:30 MYT \u00b7 Updated 4 times a day');
 const size=(await card.boundingBox())!;await page.keyboard.press('Escape');await expect(card).toHaveCount(0);
 await page.locator('.offline-map .regional-map-marker').first().dispatchEvent('click');const disaster=page.getByRole('dialog',{name:'Card details & evidence',exact:true});await expect(disaster).toBeVisible();const disasterSize=(await disaster.boundingBox())!;expect(disasterSize.width).toBe(size.width);expect(disasterSize.height).toBe(size.height);await page.keyboard.press('Escape');
 await page.locator('.offline-environment-marker').click();await page.setViewportSize({width:390,height:844});await expect(card).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:shots+'/mobile-dialog.png'});await card.getByRole('button',{name:'Close air and weather',exact:true}).click();await expect(card).toHaveCount(0);
});

test('no live label or invented zero when data is unavailable; pin still opens history and broken photo keeps credit',async({page})=>{
 await page.route('https://upload.wikimedia.org/**',r=>r.abort());const hazard=registry.pins.find((p:{needs:string[]})=>!p.needs.includes('air'));
 const card=await open(page,{...pin,...hazard,unverified:null,air:null,weather:{current:null,hourly:null,alerts:null},readingState:'expired',nearby:null});
 await expect(page.locator('.offline-environment-reading')).toHaveCount(0);await expect(card).toContainText('Air quality not monitored here');await expect(card.locator('.environment-summary')).not.toContainText('0');await expect(card.locator('.environment-summary')).toContainText('\u2014');await expect(card).not.toContainText('No issues');await expect(card.getByRole('img',{name:'Monitoring location illustration',exact:true})).toBeVisible();await expect(card).toContainText(media.image.credit);await expect(card.getByRole('link',{name:/Read more on Wikipedia/})).toBeVisible();await expect(card.getByRole('region',{name:'Last 7 days',exact:true})).toContainText('23');
});

test('NEA PSI remains independent of missing Google readings',async({page})=>{
 await page.route('**/public/air/psi',r=>r.fulfill({json:{reading:{observedAt:now.toISOString(),updatedAt:now.toISOString(),regions:[{region:'central',psi:227,band:'Very Unhealthy',pm25_24h:177}]},attribution:'Contains information from NEA via data.gov.sg, Singapore Open Data Licence version 1.0'}}));
 const card=await open(page,{...pin,pinId:'sg-01',name:'Central Singapore',country:'SG',lat:1.357,lng:103.82,air:null,weather:{current:null,hourly:null,alerts:null},media:null,readingState:'expired'});
 const psi=card.getByRole('region',{name:'Singapore NEA PSI',exact:true});await expect(psi).toContainText('227');await expect(psi).toContainText('Regional reading, not a measurement at this pin');await expect(psi).toContainText('Singapore Open Data Licence');await expect(page.locator('.offline-environment-reading')).toHaveCount(0);
});
