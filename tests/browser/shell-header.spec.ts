import { expect, test } from '@playwright/test';
for (const viewport of [{width:1280,height:800},{width:390,height:844},{width:360,height:740}]) {
 for (const route of ['/assist','/domains']) {
  test(`${route} shared navigation at ${viewport.width}x${viewport.height}`,async({page})=>{
   await page.setViewportSize(viewport);await page.goto(route);
   await expect(page.locator('.site-header')).toBeVisible();
   if(viewport.width<761) await page.getByRole('button',{name:'Open navigation',exact:true}).click();
   const nav=page.getByRole('navigation',{name:'Workspace pages'});
   await expect(nav).toBeVisible();
   for(const [name,href] of [['Emergency Assist','/assist'],['Hazard domains','/domains'],['Incident overview','/overview']]) {
    const link=nav.getByRole('link',{name,exact:true});await expect(link).toHaveAttribute('href',href);
    if(route===href)await expect(link).toHaveAttribute('aria-current','page');
   }
   if(viewport.width<761)await page.keyboard.press('Escape');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
   if(route==='/assist')await expect(page.getByTestId('assist-emergency')).toBeVisible();
  });
 }
}
