import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Google Maps is blocked so the page uses its offline outline map: deterministic, and the time range and search must work without it.
test.beforeEach(async ({ page }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());
  await page.route('https://maps.gstatic.com/**', (route) => route.abort());
});

async function routeAhaWeekly(page: Page) {
  const ahaWeekly = JSON.parse(readFileSync(join(process.cwd(), 'content', 'aha', 'weekly-update.json'), 'utf8'));
  await page.route('**/public/aha-weekly', route => route.fulfill({ json: ahaWeekly }));
}

async function setWorkspaceView(page: Page, view: 'dashboard' | 'incidents') {
  await page.evaluate(nextView => {
    const url = new URL(window.location.href);
    if (nextView === 'dashboard') url.searchParams.delete('view');
    else url.searchParams.set('view', nextView);
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, view);
}

async function dragRangeTo(page: Page, slider: Locator, targetValue: number) {
  const box = await slider.boundingBox();
  if (!box) throw new Error('History range slider is not visible');
  const min = Number(await slider.getAttribute('min'));
  const max = Number(await slider.getAttribute('max'));
  const current = Number(await slider.inputValue());
  if (max <= min || current === targetValue) return;
  const x = (value: number) => box.x + 7 + (box.width - 14) * (value - min) / (max - min);
  const y = box.y + box.height / 2;
  await page.mouse.move(x(current), y);
  await page.mouse.down();
  await page.mouse.move(x(targetValue), y, { steps: 12 });
  await page.mouse.up();
  await expect(slider).toHaveValue(String(targetValue));
}

test('landing map and archive default to the last three months with visible range sliders', async ({ page }) => {
  await routeAhaWeekly(page);
  await page.goto('/');
  const mapStatus = page.locator('.map-overlay-label');
  await expect(mapStatus).toBeVisible();
  await expect(mapStatus).toContainText('15 historical pins');
  await expect(page.getByRole('button', { name: /Enable historical year range|Disable historical year range/ })).toHaveCount(0);
  const response = await page.request.get('/public/hazards/history?limit=1000');
  const { window: archiveWindow } = await response.json() as { window: { from: string; to: string } };
  const archiveEnd = new Date(`${archiveWindow.to}T23:59:59.999Z`);
  const expectedStartMonth = new Date(Date.UTC(archiveEnd.getUTCFullYear(), archiveEnd.getUTCMonth() - 3, 1)).toISOString().slice(0, 7);
  await expect(page.getByLabel(`Start month, ${expectedStartMonth}`)).toBeVisible();
  await expect(page.getByLabel(`End month, ${archiveWindow.to.slice(0, 7)}`)).toBeVisible();

  await setWorkspaceView(page, 'incidents');
  await page.getByRole('button', { name: /Historical Archive/ }).click();
  await expect(page.locator('.history-count')).toContainText('16 past incidents shown · 15 on the map · 1 without a map location');
  await expect(page.locator('.history-dual-labels strong').first()).toHaveText(expectedStartMonth);
  await expect(page.locator('.history-dual-labels strong').last()).toHaveText(archiveWindow.to.slice(0, 7));
});

test('dragging the range to 2016-2026 shows 274 and leaves Live Feed and hazard badges unchanged', async ({ page }) => {
  await routeAhaWeekly(page);
  await page.goto('/');
  await expect(page.getByLabel(/Start month,/)).toBeVisible();
  await expect(page.getByLabel(/End month,/)).toBeVisible();
  await setWorkspaceView(page, 'incidents');
  const liveFeed = page.getByRole('button', { name: /^Live Feed \(\d+\)$/ });
  await expect(liveFeed).toBeVisible();
  const liveFeedBefore = await liveFeed.innerText();
  const badgeText = await page.locator('.featured-hazard-card').allTextContents();

  await setWorkspaceView(page, 'dashboard');
  const start = page.getByLabel(/Start month,/);
  const end = page.getByLabel(/End month,/);
  const max = Number(await end.getAttribute('max'));
  await dragRangeTo(page, start, 0);
  await dragRangeTo(page, end, max - 1);
  await dragRangeTo(page, end, max);
  await expect(page.getByLabel('Start month, 2016-01')).toBeVisible();

  await setWorkspaceView(page, 'incidents');
  await expect(liveFeed).toHaveText(liveFeedBefore);
  expect(await page.locator('.featured-hazard-card').allTextContents()).toEqual(badgeText);
  await page.getByRole('button', { name: /Historical Archive/ }).click();
  await expect(page.locator('.history-count')).toContainText('274 past incidents shown');
  await expect(page.locator('.history-dual-labels strong').first()).toHaveText('2016-01');
  await expect(liveFeed).toHaveText(liveFeedBefore);
});

test('history page: month range, search, hazard chips, quoted impact and provenance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await routeAhaWeekly(page);
  await page.goto('/history');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Past incidents in ASEAN');
  const count = page.locator('.history-count');
  await expect(count).toContainText('past incidents shown');
  const recentCount = Number(((await count.textContent()) ?? '').match(/^(\d+)/)?.[1]);
  expect(recentCount).toBe(16);
  const from = page.getByLabel('Show incidents from month');
  const max = Number(await from.getAttribute('max'));
  const response = await page.request.get('/public/hazards/history?limit=1000');
  const { window: archiveWindow } = await response.json() as { window: { to: string } };
  const archiveEnd = new Date(`${archiveWindow.to}T23:59:59.999Z`);
  const expectedStartMonth = new Date(Date.UTC(archiveEnd.getUTCFullYear(), archiveEnd.getUTCMonth() - 3, 1)).toISOString().slice(0, 7);
  await expect(page.locator('.history-dual-labels strong').first()).toHaveText(expectedStartMonth);
  await page.getByRole('button', { name: 'All years' }).click();
  const total = Number(((await count.textContent()) ?? '').match(/^(\d+)/)?.[1]);
  expect(total).toBe(274);
  await page.screenshot({ path: 'data/test-results/history-page.png' });
  await expect(page.locator('.history-chips button')).toHaveCount(8);
  await expect(page.locator('.history-svg-dot').first()).toBeVisible();   // offline outline map still plots points

  // search narrows within the shown cards
  await page.getByRole('searchbox', { name: 'Search past incidents' }).fill('Palu');
  await expect(page.locator('.history-card').first()).toContainText('Palu');
  const palu = page.locator('[data-card-id="HX-1-USGS-us1000h3p4"]');
  await expect(palu.locator('.hc-fact.impact').first()).toContainText('2,077');
  await expect(palu.locator('.hc-fact.impact').first()).toContainText('Killed');
  await expect(palu.locator('.hc-fact.impact').first()).toContainText('at least');
  await palu.getByText('Source statement').click();
  await expect(palu.locator('blockquote')).toContainText('2,077 people killed');
  await palu.getByText('Provenance and tags').click();
  await expect(palu.locator('.history-hash').first()).toHaveText(/^[0-9a-f]{64}$/);
  await expect(palu.locator('.history-credit')).toContainText('U.S. Geological Survey');

  // month range: the From slider moves the window; an out-of-range event disappears
  await page.getByRole('searchbox', { name: 'Search past incidents' }).fill('');
  await from.fill(String(Math.floor(max * 0.9)));
  const narrowed = Number(((await count.textContent()) ?? '').match(/^(\d+)/)?.[1]);
  expect(narrowed).toBeLessThan(total);
  await page.getByRole('button', { name: 'All years' }).click();
  expect(Number(((await count.textContent()) ?? '').match(/^(\d+)/)?.[1])).toBe(total);
  await page.getByRole('button', { name: 'Last 3 months' }).click();
  expect(Number(((await count.textContent()) ?? '').match(/^(\d+)/)?.[1])).toBe(recentCount);

  // hazard chip: only that domain
  await page.getByRole('button', { name: 'Hydrological', exact: true }).click();
  await expect(page.locator('.history-card').first()).toBeVisible();
  const ids = await page.locator('.history-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')));
  expect(ids.every((id) => id!.startsWith('HX-2-') || id!.startsWith('HX-AHA-'))).toBe(true);

  // map-only toggle never adds cards, and no-location cards say so
  await page.getByRole('button', { name: 'Meteorological', exact: true }).click();
  await expect(page.locator('.history-nomap').first()).toHaveText('No map location');
  const before = Number(((await count.textContent()) ?? '').match(/^(\d+)/)?.[1]);
  await page.getByLabel('Only with a map location').check();
  expect(Number(((await count.textContent()) ?? '').match(/^(\d+)/)?.[1])).toBeLessThanOrEqual(before);
});

test('history page has no horizontal overflow on a phone and the GDACS indicative-only note is shown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/history');
  await expect(page.locator('.history-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'All years' }).click();
  await page.getByRole('searchbox', { name: 'Search past incidents' }).fill('gdacs flood');
  await expect(page.locator('.history-credit').first()).toContainText('Indicative only');
});

test('a hazard page lists its own past incidents under Historical incidents', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?view=incidents&hazard=seismic');
  await expect(page.getByRole('heading', { name: 'Historical incidents', exact: true })).toBeVisible();
  await page.locator('.hazard-history').getByRole('button', { name: 'All years' }).click();
  const cards = page.locator('.hazard-history .history-card');
  await expect(cards.first()).toBeVisible();
  const ids = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')));
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.every((id) => id!.startsWith('HX-1-'))).toBe(true);
});

test('rating badges use their own colours and the month range is one track with two end handles', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/history');
  await page.getByRole('button', { name: 'All years' }).click();
  const green = page.locator('.history-rating', { hasText: /^GREEN$/ }).first();
  await expect(green).toBeVisible();
  await expect(green).toHaveClass(/tone-green/);
  const bg = await green.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g)!.map(Number);
  expect(g).toBeGreaterThan(r);
  expect(g).toBeGreaterThan(b);
  for (const [text, tone] of [['ORANGE', 'orange'], ['RED', 'red'], ['YELLOW', 'yellow']] as const) {
    const badge = page.locator('.history-rating', { hasText: new RegExp(`^${text}$`) }).first();
    if (await badge.count()) await expect(badge).toHaveClass(new RegExp(`tone-${tone}`));
  }
  // one track, two thumbs: both inputs live inside the same track element
  await expect(page.locator('.history-dual-track .history-dual-input')).toHaveCount(2);
  const label = page.locator('.history-dual-labels');
  await expect(label).toContainText('2016-01');
  await page.getByLabel('Show incidents from month').focus();
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowRight');
  await expect(label).toContainText('2017-01');
  await page.getByLabel('Show incidents up to month').focus();
  await page.keyboard.press('Home');
  await expect(label).toContainText('2017-01');   // the end handle cannot pass the start handle
});

test('a map pin highlights its card on the page and pops the card up in full screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/history?domain=1');
  await page.getByRole('button', { name: 'All years' }).click();
  await expect(page.locator('.history-svg-dot').first()).toBeVisible();

  // normal page: the card is selected, flashed and in view
  const dot = page.locator('.history-svg-dot').nth(3);
  const label = (await dot.getAttribute('aria-label')) ?? '';
  const title = label.replace(/^Select /, '');
  await dot.dispatchEvent('click');               // dots overlap on a dense map, so target this exact one
  const card = page.locator('.history-list .history-card.selected');
  await expect(card).toHaveCount(1);
  await expect(card.locator('h4')).toHaveAttribute('aria-label', title);
  await expect(card).toBeInViewport();
  await expect(page.getByRole('dialog', { name: /Incident details/ })).toHaveCount(0);

  // full screen: the same pin shows the card as a popup over the map
  const supported = await page.evaluate(() => document.fullscreenEnabled);
  test.skip(!supported, 'Full screen is not available in this browser');
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await page.locator('.history-svg-dot').nth(5).dispatchEvent('click');
  const popup = page.getByRole('dialog', { name: /Incident details/ });
  await expect(popup).toBeVisible();
  await expect(popup.locator('.history-card')).toHaveCount(1);
  await popup.getByRole('button', { name: 'Close incident details' }).click();
  await expect(popup).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

// Google-map code path with a fake SDK. Build once with VITE_GOOGLE_MAPS_API_KEY=maps-contract-fixture and run with AEGIS_MAPS_CONTRACT_TEST=true
// (the same convention as google-maps.spec.ts); every Google request is fulfilled locally.
const clusterSdk = `
window.google = { maps: {
  Map: class {
    constructor(node, options) { this.node = node; this.zoom = options.zoom; this.idle = []; node.dataset.fixtureMap = 'true'; setTimeout(() => this.idle.forEach((f) => f()), 10); }
    getZoom() { return this.zoom; }
    setZoom(z) { this.zoom = z; this.node.dataset.fixtureZoom = String(z); setTimeout(() => this.idle.forEach((f) => f()), 5); }
    fitBounds() { this.setZoom(9); }
    panTo() {} setOptions() {} setMapTypeId() {}
    addListener(event, fn) { if (event === 'idle') this.idle.push(fn); return { remove: () => { this.idle = this.idle.filter((x) => x !== fn); } }; }
  },
  LatLngBounds: class { constructor() { this.n = 0; } extend() { this.n += 1; } },
  event: { addListenerOnce(map, event, fn) { const id = setTimeout(fn, 20); return { remove() { clearTimeout(id); } }; }, clearInstanceListeners() {} },
  marker: { AdvancedMarkerElement: class {
    constructor(o) { this.el = o.content; this.el.setAttribute('title', o.title || ''); this.map_ = o.map; o.map.node.appendChild(this.el); }
    addListener(e, fn) { this.el.addEventListener(e, fn); return { remove: () => this.el.removeEventListener(e, fn) }; }
    set map(v) { if (v === null) this.el.remove(); }
  } },
} };
window.aegisMapsReady();`;

test('Google map: dense pins cluster with a count, a cluster click zooms in and splits it, and a pin click still selects its card', async ({ page }) => {
  test.skip(process.env.AEGIS_MAPS_CONTRACT_TEST !== 'true', 'Requires the fixture-key UI build');
  await page.route('https://maps.googleapis.com/**', (route) => route.fulfill({ contentType: 'application/javascript', body: clusterSdk }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/history?domain=1');
  await page.getByRole('button', { name: 'All years' }).click();
  await expect(page.locator('.history-google-map')).toHaveAttribute('data-fixture-map', 'true');
  const clusters = page.locator('.history-cluster');
  await expect(clusters.first()).toBeVisible();
  const countOnMap = async () => {
    const counts = await clusters.evaluateAll((els) => els.map((e) => Number(e.textContent)));
    return counts.reduce((a, b) => a + b, 0) + (await page.locator('.history-marker').count());
  };
  const located = Number(((await page.locator('.history-count').textContent()) ?? '').match(/(\d+) on the map/)?.[1]);
  expect(await countOnMap()).toBe(located);                       // every located incident is on the map exactly once
  const before = await clusters.count();
  const biggest = await clusters.evaluateAll((els) => Math.max(...els.map((e) => Number(e.textContent))));
  expect(biggest).toBeGreaterThan(1);
  await clusters.filter({ hasText: String(biggest) }).first().click();
  await expect(page.locator('.history-google-map')).toHaveAttribute('data-fixture-zoom', '9');
  await expect.poll(async () => (await clusters.count()) + (await page.locator('.history-marker').count())).toBeGreaterThan(before);
  expect(await countOnMap()).toBe(located);
  // a single pin still selects its card
  const marker = page.locator('.history-marker').first();
  await marker.click();
  await expect(page.locator('.history-list .history-card.selected')).toHaveCount(1);
});
