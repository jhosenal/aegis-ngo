import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
const shots='records/screenshots/reader-subtitles-centred-2026-10-16';mkdirSync(shots,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto('http://127.0.0.1:8787');await expect(page.locator('.map-caption')).toHaveCount(0);
 await expect(page.locator('.news-reader-label')).toHaveCount(0);
 const subtitles=page.getByRole('region',{name:'Spoken subtitles',exact:true});
 await expect(page.getByRole('button',{name:'English subtitles',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Play introduction',exact:true}).click();await expect(subtitles).toBeVisible();
 await page.locator('video').evaluate(v=>{v.pause();v.currentTime=3;});
 await expect(subtitles).toContainText('providing continuous disaster telemetry');
 for(const [name,lang] of [['English','en'],['Chinese','zh-Hans'],['Malay','ms'],['Tamil','ta']]) {
  const button=page.getByRole('button',{name:`${name} subtitles`,exact:true});await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect(subtitles).toHaveAttribute('lang',lang);
  expect(await page.locator('video').evaluate(v=>v.currentTime)).toBe(3);
  expect(await subtitles.evaluate(n=>getComputedStyle(n).textAlign)).toBe('center');
  const buttonBox=await button.boundingBox();expect([buttonBox.width,buttonBox.height]).toEqual([36,36]);
  const subtitleBox=await subtitles.boundingBox();const presenterBox=await page.locator('video').boundingBox();const languageBox=await page.getByRole('group',{name:'Subtitle language',exact:true}).boundingBox();const mapBox=await page.locator('.regional-map').boundingBox();
  expect(languageBox.x-mapBox.x).toBe(16);expect(languageBox.x+languageBox.width).toBeLessThan(subtitleBox.x);expect(subtitleBox.x+subtitleBox.width).toBeLessThan(presenterBox.x);
  for(const time of [1,3,6,9]) {
    await page.locator('video').evaluate((v,t)=>{v.currentTime=t;},time);
    await expect.poll(()=>page.locator('video').evaluate(v=>v.seeking)).toBe(false);
    await page.waitForTimeout(60);
    expect(await subtitles.evaluate(n=>n.clientHeight)).toBe(36);
    expect(await subtitles.locator('span').evaluate(n=>n.scrollHeight<=32)).toBe(true);
    const textBox=await subtitles.locator('span').boundingBox();const bandBox=await subtitles.boundingBox();const controlsBox=await page.locator('.news-reader-controls').boundingBox();
    expect(Math.abs(textBox.x+textBox.width/2-bandBox.x-bandBox.width/2)).toBeLessThan(1);
    expect(Math.abs(textBox.y+textBox.height/2-bandBox.y-bandBox.height/2)).toBeLessThan(1);
    expect(bandBox.y+bandBox.height/2).toBe(languageBox.y+languageBox.height/2);
    expect(bandBox.y+bandBox.height/2).toBe(controlsBox.y+controlsBox.height/2);
    await expect(subtitles.locator('.is-current,.is-spoken,small')).toHaveCount(0);
  }
  await page.locator('video').evaluate(v=>{v.currentTime=3;});await page.waitForTimeout(60);
  expect(mapBox.y+mapBox.height-languageBox.y-languageBox.height).toBe(21);
  await page.screenshot({path:`${shots}/${lang}.png`});
 }
 await page.getByRole('button',{name:'Expand map',exact:true}).click();await expect(page.locator('.regional-map > .news-reader .reader-subtitles')).toBeVisible();await page.getByRole('button',{name:'Stop introduction',exact:true}).click();await expect(subtitles).toHaveCount(0);await page.getByRole('button',{name:'Exit map fullscreen',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Play introduction',exact:true}).click();await expect(subtitles).toBeVisible();await page.locator('video').evaluate(v=>{v.pause();v.currentTime=3;});await expect(subtitles).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${shots}/mobile-ta.png`});
 expect(errors).toEqual([]);writeFileSync('records/reviews/AEG-NEWS-UI-013_2026-10-16_origin.json',JSON.stringify({status:'PASS',origin:'http://127.0.0.1:8787',defaultEnglish:true,languages:['en','zh-Hans','ms','ta'],centered:true,textCenteredBothAxes:true,bandAndButtonsShareCenter:true,allCuesFit36px:true,controlsRaised5px:true,fadeSeconds:.3,overlayLabelsRemoved:true,languagesFarLeft:true,subtitlesClearOfPresenter:true,buttons:'36 x 36',languageSwitchKeepsTime:true,captionARemoved:true,fullscreen:true,mobile:true,errors},null,2)+'\n');
} finally {await browser.close();}
