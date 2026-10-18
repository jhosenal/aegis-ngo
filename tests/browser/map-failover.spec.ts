import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// AEG-ENG-012 phase 0: the schematic fallback is labelled honestly, Google failures (the SDK, or its tiles after it loaded) switch to it, and Retry brings Google back.
// Build once with VITE_GOOGLE_MAPS_API_KEY=maps-contract-fixture and run with AEGIS_MAPS_CONTRACT_TEST=true (the same fixture build as google-maps.spec.ts).
test.skip(process.env.AEGIS_MAPS_CONTRACT_TEST !== 'true', 'Requires dedicated fixture-key UI build');
const specText = readFileSync('tests/browser/google-maps.spec.ts', 'utf8');
const sdkFixture = specText.slice(specText.indexOf('const sdkFixture = `') + 'const sdkFixture = `'.length, specText.indexOf('window.aegisMapsReady();`;') + 'window.aegisMapsReady();'.length);

test.beforeEach(async ({ page }) => { await page.route('**/public/environment', (r) => r.fulfill({ json: { pins: [], registry: { pins: 0 }, status: { enabled: false }, remarks: [] } })); });

test('the Google SDK fails: honest schematic label and a Retry that brings Google back', async ({ page }) => {
  let blocked = true;
  await page.route('https://maps.googleapis.com/**', (route) => (blocked ? route.abort() : route.fulfill({ contentType: 'application/javascript', body: sdkFixture })));
  await page.goto('/');
  await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider', 'offline');
  const label = page.locator('.map-overlay-label');
  await expect(label).toContainText('Google Maps unavailable · schematic map only, no streets or imagery');
  await expect(label).not.toContainText('offline basemap');          // it is a schematic outline, not an offline street map
  blocked = false;
  await page.getByRole('button', { name: 'Retry Google Maps' }).click();
  await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider', 'google');
  await expect(page.getByRole('button', { name: 'Retry Google Maps' })).toHaveCount(0);
});

test('the SDK loads but its map tiles fail: the page falls back; a broken marker photo does not', async ({ page }) => {
  await page.route('https://maps.googleapis.com/maps/api/**', (route) => route.fulfill({ contentType: 'application/javascript', body: sdkFixture }));
  await page.goto('/');
  await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider', 'google');
  const fire = (src: string, n: number) => page.evaluate(({ src, n }) => { const box = document.querySelector('[data-fixture-map]')!; for (let i = 0; i < n; i += 1) { const img = document.createElement('img'); img.src = src; box.append(img); img.dispatchEvent(new Event('error')); } }, { src, n });
  await fire('https://maps.gstatic.com/mapfiles/photo.png', 12);       // not a tile: ignored
  await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider', 'google');
  await fire('https://maps.googleapis.com/maps/vt?pb=!1m5', 6);        // six tile failures: the basemap has failed
  await expect(page.locator('.regional-map')).toHaveAttribute('data-map-provider', 'offline');
  await expect(page.locator('.map-overlay-label')).toContainText('schematic map only');
});
