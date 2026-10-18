import { expect, test } from '@playwright/test';

// The station jingle plays for 4 s before the presenter; the other tests skip it (a jingle that cannot load is skipped) so they stay fast. The jingle test below lets it play.
test.beforeEach(async ({ page }, info) => { if (!info.title.includes('jingle')) await page.route('**/news-jingle.mp3', route => route.abort()); });

test('video progress starts at zero while idle and stays complete at natural end', async ({ page }) => {
  await page.goto('/');
  const slider = page.getByRole('slider', { name: 'Video position', exact: true });
  await expect.poll(async () => Number(await slider.getAttribute('max'))).toBeGreaterThan(1);
  await expect(slider).toHaveValue('0');
  await expect.poll(() => slider.evaluate((element) => getComputedStyle(element).height)).toBe('18px');
  await expect.poll(() => slider.evaluate((element) => getComputedStyle(element).padding)).toBe('0px');
  await expect.poll(() => slider.evaluate((element) => getComputedStyle(element).getPropertyValue('--reader-progress').trim())).toBe('0%');
  await page.getByRole('button', { name: 'Play introduction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause video', exact: true })).toBeVisible({ timeout: 10000 });
  const duration = Number(await slider.getAttribute('max'));
  await page.locator('video').evaluate((element) => {
    const video = element as HTMLVideoElement;
    video.currentTime = video.duration;
    video.dispatchEvent(new Event('ended'));
  });
  await expect.poll(async () => Number(await slider.inputValue())).toBeCloseTo(duration, 1);
  await expect.poll(() => slider.evaluate((element) => getComputedStyle(element).getPropertyValue('--reader-progress').trim())).toBe('100%');
});

test('jingle plays for 4 seconds first, then the presenter starts; stop during the jingle cancels the run', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const time = () => page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime);
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Play introduction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop introduction' })).toBeVisible();   // stop is offered during the jingle
  await page.waitForTimeout(2000);
  expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(true);   // the presenter waits for the jingle
  await expect.poll(time, { timeout: 8000 }).toBeGreaterThan(0.2);                               // then she speaks
  await page.getByRole('button', { name: 'Stop introduction' }).click();
  // stop in the middle of a second run's jingle: the video never starts
  await page.getByRole('button', { name: 'Play introduction', exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Stop introduction' }).click();
  await page.waitForTimeout(4500);
  expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(true);
});

test('presenter remains opt-in and hide/show leaves map cards accessible',async({page})=>{
 await page.goto('/');await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
 await expect(page.getByRole('button',{name:'Transcript',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Hide presenter',exact:true}).click();await expect(page.locator('video')).toHaveCount(0);
 await page.locator('.regional-map-marker').first().click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Show presenter',exact:true}).click();await expect(page.locator('video')).toBeVisible();
});
test('language changes preserve video position and centered fading captions',async({page})=>{
 await page.goto('/');let mainFrameNavigations=0;const mainFrame=page.mainFrame();page.on('framenavigated',frame=>{if(frame===mainFrame)mainFrameNavigations++;});await page.getByRole('button',{name:'Play introduction',exact:true}).click();const subtitle=page.getByRole('region',{name:'Spoken subtitles',exact:true});await expect(subtitle).toBeVisible({timeout:10000});
 const video=page.locator('video');await expect.poll(()=>video.evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(0.4);await page.locator('.regional-map').evaluate(el=>el.setAttribute('data-test-map-instance','stable'));
 const translations = [
  ['Chinese','持续 提供 灾害 监测数据，'],
  ['Malay','menyediakan pemantauan bencana berterusan'],
  ['Tamil','தொடர்ச்சியான பேரிடர் கண்காணிப்புத் தரவுகளை வழங்குகிறோம்,'],
  ['English','providing continuous disaster telemetry'],
 ] as const;
 for(const [name,translation] of translations){await page.getByRole('button',{name:`${name} subtitles`,exact:true}).focus();await page.keyboard.press('Enter');await expect(subtitle).toBeVisible();await expect(subtitle).toContainText(translation);expect(mainFrameNavigations).toBe(0);await expect(page.locator('.regional-map')).toHaveAttribute('data-test-map-instance','stable');}
 expect(await subtitle.evaluate(n=>getComputedStyle(n).textAlign)).toBe('center');
 await page.getByRole('button',{name:'Expand map',exact:true}).click();await expect(page.locator('.regional-map > .news-reader')).toHaveCount(1);await page.getByRole('button',{name:'Exit map fullscreen',exact:true}).click();
});

test('Latest news button sits beside the map layers and plays the news clip with captions', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Latest news', exact:true });
  await expect(button).toBeVisible();
  const layers = await page.getByRole('button', { name: 'Map layers', exact: true }).boundingBox();
  const news = await button.boundingBox();
  expect(news!.x).toBeGreaterThan(layers!.x);
  expect(Math.abs(news!.y - layers!.y)).toBeLessThan(40);   // same row
  const drop=page.getByRole('button',{name:'Drop a pin on the map'});
  await expect(drop).toContainText('Drop');
  await drop.click();await expect(page.getByRole('region',{name:'Drop a pin',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Close drop a pin'})).toBeHidden();await drop.click();
  await button.click();
  await expect(page.getByRole('button',{name:/Night news/})).toBeDisabled();
  await expect(page.getByRole('button',{name:/Evening news/})).toContainText('17:00 MYT');
  await page.getByRole('button',{name:/Morning news/}).click();
  await expect(page.getByRole('button', { name: 'Pause video' })).toBeVisible({timeout:10000});
  await expect(page.locator('video')).toHaveAttribute('src', '/media/news-latest.webm?v=transparent-2');
  await expect(page.locator('.reader-disclosure')).toContainText('Example bulletin');
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime), { timeout: 15000 }).toBeGreaterThan(0.3);
  await expect(page.locator('.reader-subtitles')).toBeVisible();
  const box = await page.locator('video').boundingBox();   // the presenter keeps her place on the right after the clip swaps in
  expect(box!.x).toBeGreaterThan(900);
  expect(box!.height).toBeGreaterThan(300);
  expect(box!.height).toBeLessThan(600);
  await expect.poll(() => page.locator('.reader-subtitles span').evaluate(e => e.textContent!.split(/\s+/).length), { timeout: 5000 }).toBeLessThanOrEqual(12);
  await page.getByRole('button',{name:'Pause video',exact:true}).click();
  for(const time of [.5,2,4,6,8,10]){
    await page.getByRole('slider',{name:'Video position'}).fill(String(time));
    const caption=page.locator('.reader-subtitles span');await expect(caption).toBeVisible();
    expect(await caption.evaluate(n=>n.scrollWidth<=n.clientWidth&&n.scrollHeight<=32)).toBe(true);
    expect((await caption.textContent())!.split(/\s+/).length).toBeLessThanOrEqual(7);
  }
  expect(await page.locator('video').evaluate(v=>{const video=v as HTMLVideoElement;const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;const x=c.getContext('2d')!;x.drawImage(video,0,0);return x.getImageData(5,5,1,1).data[3];})).toBe(0);
  await page.getByRole('button', { name: 'Hide presenter' }).click();
});
