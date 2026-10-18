import {expect,test} from '@playwright/test';
const routes=[['domains','/domains'],['history','/history'],['legal','/legal/data-sources'],['assist','/assist'],['overview','/overview'],['workspace','/workspace'],['admin','/admin'],['prototype','/prototype/map']] as const;
test('every route uses landing navigation, a versioned layout recipe and nested page cards',async({page})=>{
 test.setTimeout(120000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [id,path] of routes){
  await page.setViewportSize({width:1680,height:1000});await page.goto(path);
  const shell=page.locator('.workspace-shell');await expect(shell).toHaveAttribute('data-ui-formulation','AEG.UI.PAGE-SHELL/1.0.0');await expect(shell).toHaveAttribute('data-sop','AEG-SOP-004');
  await expect(page.locator('.dashboard-sidebar')).toHaveCount(1);await expect(page.locator(`[data-card-id="layout:${id}"]`)).toBeVisible();
  await expect(page.locator('.dashboard-sidebar > nav a[href="/history"]')).toBeVisible();await expect(page.locator('.dashboard-sidebar a[aria-current="page"]')).toHaveCount(id==='legal'||id==='prototype'||id==='admin'?0:1);
  const sidebar=(await page.locator('.dashboard-sidebar').boundingBox())!;expect(sidebar.width).toBe(260);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.dashboard-sidebar')).toBeHidden();await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(page.locator('.dashboard-sidebar')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.dashboard-sidebar')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 expect(errors).toEqual([]);
});
test('shared admin shell updates account/nav after sign-in and keeps nested admin cards and session across routes',async({page})=>{
 await page.goto('/admin');await page.getByTestId('dev-login-DEV-ADMIN').click();await expect(page.locator('[data-card-id="admin:screening"]')).toBeVisible();await expect(page.locator('.dashboard-sidebar > nav a[href="/admin"]')).toBeVisible();await expect(page.locator('.sidebar-account')).toContainText('Administrator');
 await page.getByRole('tab',{name:'News desk',exact:true}).click();await expect(page.locator('[data-card-id="layout:admin"] [data-card-id="admin:broadcast"] [data-card-id="admin:broadcast-languages"]')).toBeVisible();await expect(page.locator('[data-card-id="admin:broadcast-languages"]')).toContainText('Review required');
 await page.goto('/domains');await expect(page.locator('.sidebar-account')).toContainText('Administrator');await page.goto('/workspace');await expect(page.getByTestId('dev-login-DEV-ADMIN')).toHaveCount(0);await expect(page.locator('.sidebar-account')).toContainText('Administrator');
 await page.locator('.dashboard-sidebar > nav a[href="/?view=resource"]').click();await expect(page.getByRole('heading',{name:'Resources',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Resources',exact:true})).toHaveAttribute('aria-current','page');await page.reload();await expect(page.getByRole('heading',{name:'Resources',exact:true})).toBeVisible();await page.locator('.dashboard-sidebar').getByRole('button',{name:'Evidence',exact:true}).click();await expect(page.getByRole('heading',{name:'Evidence',exact:true})).toBeVisible();await page.goBack();await expect(page.getByRole('heading',{name:'Resources',exact:true})).toBeVisible();
});
