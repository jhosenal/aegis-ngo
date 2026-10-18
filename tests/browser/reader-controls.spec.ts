import {expect,test} from '@playwright/test';
test('right rail stacks languages, human visibility and expand; standard player pauses, seeks and mutes',async({page})=>{
 await page.setViewportSize({width:1680,height:1000});await page.goto('/');
 const language=page.getByRole('group',{name:'Subtitle language'});const hide=page.getByRole('button',{name:'Hide presenter',exact:true});const expand=page.getByRole('button',{name:'Expand map',exact:true});
 const languages=await language.boundingBox();const human=await hide.boundingBox();const full=await expand.boundingBox();expect(languages!.y+languages!.height).toBeLessThan(human!.y);expect(human!.y+human!.height).toBeLessThan(full!.y);expect(human!.x).toBe(full!.x);
 await expect(page.getByRole('button',{name:'Transcript',exact:true})).toHaveCount(0);
 await hide.click();await expect(page.locator('video')).toHaveCount(0);await page.getByRole('button',{name:'Show presenter',exact:true}).click();await expect(page.locator('video')).toBeVisible();
 await page.getByRole('button',{name:'Play introduction',exact:true}).click();await expect(page.getByRole('button',{name:'Pause video',exact:true})).toBeVisible({timeout:10000});await page.getByRole('button',{name:'Pause video',exact:true}).click();expect(await page.locator('video').evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
 await page.getByRole('slider',{name:'Video position'}).fill('5');await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeCloseTo(5,0);await page.getByRole('button',{name:'Mute video',exact:true}).click();expect(await page.locator('video').evaluate(v=>(v as HTMLVideoElement).muted)).toBe(true);await page.getByRole('button',{name:'Resume video',exact:true}).click();expect(await page.locator('video').evaluate(v=>(v as HTMLVideoElement).paused)).toBe(false);
});
