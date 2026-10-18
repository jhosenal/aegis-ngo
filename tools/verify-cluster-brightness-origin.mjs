import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
const shots='records/screenshots/cluster-brightness-2026-10-16';mkdirSync(shots,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1680,height:1000}});
const receipt={origin:'http://127.0.0.1:8787',status:'RUNNING',errors:[]};page.on('pageerror',e=>receipt.errors.push(e.message));
try {
 await page.goto(receipt.origin);await page.getByRole('button',{name:'Guest preview'}).click();await page.getByTestId('dev-login-USER-A-COORD').click();
 await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider','google',{timeout:30000});
 const green=page.getByRole('button',{name:/Include GREEN/});if(await green.getAttribute('aria-pressed')==='false')await green.click();
 const clusters=page.locator('.live-map-cluster');await expect(clusters.first()).toBeVisible({timeout:30000});
 receipt.incidentClusters=await clusters.evaluateAll(ns=>ns.map(n=>({kind:n.dataset.clusterKind,count:Number(n.textContent),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,opacity:getComputedStyle(n.querySelector('.cluster-icon')).opacity,shadow:getComputedStyle(n.querySelector('.cluster-count')).textShadow})));
 for(const c of receipt.incidentClusters){expect(c.width).toBe(34);expect(c.height).toBe(34);expect(c.opacity).toBe('0.7');expect(c.shadow).not.toBe('none');expect(c.count).toBeGreaterThan(1);}
 await page.locator('.map-layer-control').getByRole('button',{name:'Air & Weather',exact:true}).click();
 const weather=page.locator('.environment-map-cluster');await expect(weather.first()).toBeVisible();await expect(weather.first()).toHaveAttribute('data-cluster-kind','weather');
 receipt.environmentTotal=await page.locator('.environment-map-cluster,.environment-pin').evaluateAll(ns=>ns.reduce((sum,n)=>sum+Number(n.dataset.locationCount),0));expect(receipt.environmentTotal).toBe(125);
 await page.screenshot({path:shots+'/actual-map.png'});expect(receipt.errors).toEqual([]);receipt.status='PASS';
} catch(error){receipt.status='FAIL';receipt.failure=error.message;process.exitCode=1;}finally{await browser.close();writeFileSync('records/reviews/AEG-MAP-UI-025_2026-10-16_origin.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
