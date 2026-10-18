import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin='http://127.0.0.1:8787';
const directory='records/screenshots/navigation-audit-2026-10-16';
mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({headless:true});
const result={date:'2026-10-16',origin,scope:'Col 1 menu and related pages; Chromium desktop/mobile; synthetic local login; no model calls',views:[],routes:[],errors:[]};
try {
  const page=await browser.newPage({viewport:{width:1680,height:1080}});
  page.on('pageerror',error=>result.errors.push(error.message));
  await page.goto(origin);
  await expect(page.locator('.dashboard-sidebar')).toBeVisible();
  const assistResponse=await page.request.get(origin+'/public/assist/cards');
  result.publicAssistEndpoint={status:assistResponse.status(),contentType:assistResponse.headers()['content-type'],json:assistResponse.headers()['content-type']?.includes('application/json') ?? false};
  result.exploreLinks=await page.locator('.dashboard-sidebar nav a').evaluateAll(nodes=>nodes.map(node=>({label:node.textContent.trim(),path:node.getAttribute('href')})));
  for(const label of ['Dashboard','Incidents','Resources','Evidence','Communities','Reports']) {
    await page.locator('.dashboard-sidebar nav').getByRole('button',{name:new RegExp('^'+label)}).click();
    result.views.push({label,url:page.url(),heading:await page.locator('h1').allTextContents(),sharedShell:await page.locator('.regional-app').count(),cards:await page.locator('.regional-card-row').count(),main:(await page.locator('.dashboard-main').innerText()).slice(0,1600)});
    if(['Communities','Evidence'].includes(label)) await page.screenshot({path:`${directory}/dashboard-${label.toLowerCase()}.png`});
  }
  await page.locator('.dashboard-sidebar nav').getByRole('button',{name:'Dashboard',exact:true}).click();
  await page.getByRole('button',{name:'Guest preview'}).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await expect(page.locator('.dashboard-profile')).toHaveAttribute('aria-label',/^Account:/);
  await page.locator('.dashboard-sidebar').getByRole('link',{name:'Card workspace',exact:true}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  result.workspaceRequiresNewLogin=await page.getByTestId('dev-login-USER-A-COORD').isVisible();
  if(result.workspaceRequiresNewLogin) await page.getByTestId('dev-login-USER-A-COORD').click();
  await expect(page.locator('.workspace-grid')).toBeVisible();
  await page.screenshot({path:`${directory}/workspace-signed-in-desktop.png`});
  result.signedInWorkspace={incidentRows:await page.locator('[data-testid^="incident-item-"]').count(),leftNavigation:await page.locator('.dashboard-sidebar').count()};
  await page.locator('.site-brand').first().click();
  await expect(page.locator('.regional-app')).toBeVisible();
  result.returnToDashboardIsGuest=await page.getByRole('button',{name:'Guest preview'}).isVisible();
  const routes=[['dashboard','/'],['overview','/overview'],['domains','/domains'],['assist','/assist'],['workspace','/workspace'],['history','/history'],['legal','/legal/data-sources']];
  for(const [name,path] of routes) {
    for(const [size,width,height] of [['desktop',1680,1080],['mobile',390,844]]) {
      await page.setViewportSize({width,height});
      const response=await page.goto(origin+path);
      await expect(page.locator('#root')).not.toBeEmpty();
      // Wait for route text, including read-only public data to finish its initial render.
      await expect(page.locator('h1').first()).toBeAttached();
      if(name==='assist') await expect(page.getByText('Loading guidance',{exact:true})).toHaveCount(0,{timeout:15000});
      const inspection=await page.evaluate(()=>({
        headings:[...document.querySelectorAll('h1')].map(node=>node.textContent.trim()),
        shells:Object.fromEntries(['.regional-app','.dashboard-sidebar','.overview-root','.overview-nav','.aeg-brand-header','.site-header','.site-footer','.app-shell','.assist-page','.workspace-grid'].map(selector=>[selector,document.querySelectorAll(selector).length])),
        mainNavigations:[...document.querySelectorAll('nav')].map(node=>({label:node.getAttribute('aria-label'),links:[...node.querySelectorAll('a')].map(a=>({text:a.textContent.trim(),href:a.getAttribute('href')}))})),
        bodyFont:getComputedStyle(document.body).fontFamily,
        statusTexts:[...document.querySelectorAll('[role="status"]')].map(node=>node.textContent.trim()),
        overflow:document.documentElement.scrollWidth-innerWidth,
        placeholders:(document.body.innerText.match(/not built|not connected|backend pending|coming soon|synthetic|not running|preview/gi)||[]),
      }));
      result.routes.push({name,path,size,status:response?.status(),...inspection});
      await page.screenshot({path:`${directory}/${name}-${size}.png`});
    }
  }
  result.status='AUDIT_COMPLETE';
} catch(error){result.status='AUDIT_INCOMPLETE';result.failure=error.message;process.exitCode=1;}
finally {
  await browser.close();
  writeFileSync('records/reviews/AEG-UX-AUDIT-001_2026-10-16_browser.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({status:result.status,failure:result.failure,views:result.views.map(v=>({label:v.label,cards:v.cards})),routes:result.routes.map(r=>({name:r.name,size:r.size,status:r.status,overflow:r.overflow})),publicAssistEndpoint:result.publicAssistEndpoint,workspaceRequiresNewLogin:result.workspaceRequiresNewLogin,returnToDashboardIsGuest:result.returnToDashboardIsGuest,errors:result.errors}));
}
