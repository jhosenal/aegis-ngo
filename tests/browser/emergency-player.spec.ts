import { expect, test } from '@playwright/test';
import { PLAYER_JS, playerHtml } from '../../src/services/broadcast/player.js';
import { buildCues } from '../../src/services/broadcast/subtitles.js';

// The emergency card player (AEG-NEWS-007): card, voice and subtitles in step. The server routes are stubbed with the real page and script; the recorded voice is "missing", so the page
// falls back to the browser voice, which is replaced here by a fake that reports each caption as it starts.
const texts = ['This is an AEGIS emergency information bulletin. Tropical Cyclone NOUL-26. GDACS rates it orange.', 'In Malaysia, MetMalaysia advises: Avoid going to sea in a small ship or boat. Follow the instructions of the local disaster management authorities.', 'This is an AEGIS summary of an official source, not an official warning.'];
const ids = ['emergency-headline', 'emergency-actions', 'emergency-notice'];

test('the player shows the card, plays the voice and shows the subtitles; without the recording the browser reads each caption and the subtitle follows', async ({ page }) => {
  const html = playerHtml({ bulletinId: 'BULL-X1', language: 'ms', languages: ['en', 'ms'], headline: texts[0]!, actions: texts[1]!, notice: texts[2]!, guidanceSources: ['Malaysia: METMalaysia - Fenomena Cuaca, https://www.met.gov.my/pendidikan/fenomena-cuaca/'] });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#123"/></svg>';
  await page.route('**/public/emergency/BULL-X1*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.route('**/public/emergency-player.js', (r) => r.fulfill({ contentType: 'application/javascript', body: PLAYER_JS }));
  await page.route('**/public/broadcast/cues/BULL-X1*', (r) => r.fulfill({ json: { language: 'ms', cues: buildCues(texts, ids) } }));
  await page.route('**/public/broadcast/card/BULL-X1*', (r) => r.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.route('**/public/broadcast/voice/BULL-X1*', (r) => r.fulfill({ status: 404, json: { error: 'E_NOT_FOUND' } }));
  await page.addInitScript(() => {
    const spoken: string[] = []; (window as unknown as { __spoken: string[] }).__spoken = spoken;
    class U { text: string; lang = ''; onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = U;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(u: U) { spoken.push(`${u.lang}|${u.text}`); setTimeout(() => { u.onstart?.(); setTimeout(() => u.onend?.(), 60); }, 10); } } });
  });
  await page.goto('/public/emergency/BULL-X1?lang=ms');
  await expect(page.getByRole('img', { name: /AEGIS emergency information bulletin/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bahasa Melayu' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('Avoid going to sea in a small ship or boat.').first()).toBeVisible();   // the guidance is also plain text on the page
  await expect(page.getByText('METMalaysia - Fenomena Cuaca')).toBeVisible();
  await page.getByRole('button', { name: 'Mainkan suara' }).click();
  await expect(page.getByRole('status').filter({ hasText: /./ }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length), { timeout: 8000 }).toBeGreaterThan(3);
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  expect(spoken.every((s) => s.startsWith('ms-MY|'))).toBe(true);            // read in the chosen language
  expect(spoken.join(' ')).toContain('small ship or boat');
  await expect(page.locator('#cap')).toHaveText('', { timeout: 8000 });         // subtitles clear at the end
  await expect(page.getByRole('button', { name: 'Mainkan suara' })).toBeVisible();
});
