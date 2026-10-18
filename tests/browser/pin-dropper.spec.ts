import { expect, test, type Page } from '@playwright/test';

// Drop a pin (AEG-CREDIT-001, AEG-SAMPLE-001). The keyless test build has no Google map, so the map's side of the flow is simulated with the events it sends and listens for:
// 'aegis-drop' (a click or a drag), 'aegis-drop-marker' (the pin and its tag, which the test records) and the tag's buttons ('aegis-drop-action'). API answers are stubbed: no Google call is made.
const ATTR = { air: 'Source: Includes air quality data from Google', weather: 'Source: Includes weather data from Google' };
const livePin = (now: Date) => ({ pinId: 'cust-3.139_101.687', name: 'Dropped pin (3.139, 101.687)', region: 'Dropped pin', country: 'MY', lat: 3.139, lng: 101.687, roles: ['general'], hazards: [], needs: ['air', 'weather'], unverified: null,
  air: { pinId: 'cust-3.139_101.687', kind: 'AIR_CURRENT', data: { indexes: [{ code: 'uaqi', displayName: 'Universal AQI', aqi: 61, category: 'Good air quality' }], pollutants: [] }, fetchedAt: now.toISOString(), validUntil: new Date(+now + 3600000).toISOString(), attribution: ATTR.air, freshness: { text: 'x' } },
  weather: { current: { pinId: 'cust-3.139_101.687', kind: 'WEATHER_CURRENT', data: { temperature: { degrees: 31.2, unit: 'CELSIUS' }, weatherCondition: { description: { text: 'Cloudy' } } }, fetchedAt: now.toISOString(), validUntil: new Date(+now + 3600000).toISOString(), attribution: ATTR.weather, freshness: { text: 'x' } }, hourly: null, alerts: null },
  lastUpdatedAt: now.toISOString(), readingState: 'fresh', media: null, nearby: null });

async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __marks: unknown[]; __cursor: boolean[] };
    w.__marks = []; w.__cursor = [];
    const root = document.querySelector('.regional-map')!;
    root.addEventListener('aegis-drop-marker', (e) => w.__marks.push((e as CustomEvent).detail));
    root.addEventListener('aegis-drop-cursor', (e) => w.__cursor.push((e as CustomEvent<{ on: boolean }>).detail.on));
  });
}
const lastMark = (page: Page) => page.evaluate(() => { const m = (window as unknown as { __marks: { tag?: { title: string; note: string; actions: { id: string }[] } }[] | null[] }).__marks; return m[m.length - 1] ?? null; });
const dropAt = (page: Page, lat: number, lng: number) => page.evaluate(([la, lo]) => document.querySelector('.regional-map')!.dispatchEvent(new CustomEvent('aegis-drop', { detail: { lat: la, lng: lo } })), [lat, lng]);
const press = (page: Page, id: string) => page.evaluate((i) => window.dispatchEvent(new CustomEvent('aegis-drop-action', { detail: { id: i } })), id);
const dropMode = (page: Page) => page.evaluate(() => (document.querySelector('.regional-map') as HTMLElement).dataset.dropMode ?? null);

test('drop a pin, live: crosshair mode, one click places the pin, the tag asks, Check opens the standard card, save keeps only name and place', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'DEV-PRO' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  let balance = 5; const saved: { bookmarkId: string; name: string; lat: number; lng: number }[] = []; let lookups = 0;
  const summary = () => ({ balance, pinLookupCost: 1, packs: [{ id: 'small', credits: 10, label: '10 credits' }], stub: true, note: 'Demo only.', liveLookup: true });
  await page.route('**/api/credits', (r) => r.fulfill({ json: summary() }));
  await page.route('**/api/credits/buy-stub', (r) => { balance += 10; r.fulfill({ json: { ...summary(), bought: 10 } }); });
  await page.route('**/api/pins/lookup', (r) => { balance -= 1; lookups += 1; r.fulfill({ json: { status: 'fetched', balance, cost: 1, validMinutes: 60, attribution: ATTR, remarks: [], pin: livePin(new Date()) } }); });
  await page.route('**/api/bookmarks', (r) => { if (r.request().method() === 'POST') { const b = r.request().postDataJSON() as { name: string; lat: number; lng: number }; saved.push({ bookmarkId: `B${saved.length}`, ...b }); r.fulfill({ json: { bookmark: saved[saved.length - 1] } }); } else r.fulfill({ json: { bookmarks: saved } }); });
  await page.route('**/public/environment/pin/*/history', (r) => r.fulfill({ json: { days: [], measured: null, credit: 'x', link: 'https://open-meteo.com/' } }));
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await expect(page.getByRole('button', {name:/^Account:/})).toBeVisible();
  await record(page);
  const drop = page.getByRole('button', { name: 'Drop a pin on the map' });
  await drop.click();
  await expect(drop).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Click the map to place a pin|Google map is not connected/)).toBeVisible();   // the keyless build says the map is not connected
  expect(await dropMode(page)).toBe('1');                                   // the map accepts a click and shows a crosshair
  await drop.click();                                                       // pressing Drop again cancels
  await expect(drop).toHaveAttribute('aria-pressed', 'false');
  expect(await dropMode(page)).toBeNull();
  await drop.click(); await page.keyboard.press('Escape');                  // Esc cancels too
  await expect(drop).toHaveAttribute('aria-pressed', 'false');
  await drop.click();
  await dropAt(page, 3.13912, 101.68691);                                   // one click places the pin and ends drop mode
  await expect(drop).toHaveAttribute('aria-pressed', 'false');
  expect(await dropMode(page)).toBeNull();
  await expect.poll(async () => (await lastMark(page) as { tag: { title: string } } | null)?.tag.title).toBe('Check this spot?');
  const ask = (await lastMark(page)) as { lat: number; tag: { note: string; actions: { id: string }[] } };
  expect(ask.tag.actions.map((a) => a.id)).toEqual(['check', 'cancel']);
  expect(ask.tag.note).toContain('Costs 1 credit');
  expect(ask.tag.note).toContain('you have 5');
  await press(page, 'check');                                               // the tag's Check button
  const card = page.getByRole('dialog', { name: /^Air and weather: Dropped pin/ });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('freshness')).toContainText('Live telemetry (Google)');
  await expect(card.locator('.environment-summary')).toContainText('61');
  await expect(card).toContainText('Source: Includes air quality data from Google');
  expect(balance).toBe(4); expect(lookups).toBe(1);
  await page.keyboard.press('Escape');                                      // closes the card; the pin stays
  await expect(card).toHaveCount(0);
  await expect.poll(async () => ((await lastMark(page)) as { tag: { actions: { id: string }[] } } | null)?.tag.actions.map((a) => a.id)).toEqual(['card', 'save', 'remove']);
  await press(page, 'save');
  await page.getByLabel('Place name').fill('Office KL');
  await page.getByRole('button', { name: 'Save place' }).click();
  await expect(page.getByText(/Only the name and place are kept, never the reading/)).toBeVisible();
  expect(saved).toEqual([expect.objectContaining({ name: 'Office KL' })]);
  await press(page, 'remove');
  await expect.poll(async () => (await lastMark(page))).toBeNull();         // the pin is gone
});

test('pin tools are locked while signed out; Pro without credits is offered demo credits', async ({ page, request }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await record(page);
  await expect(page.getByRole('button', { name: 'Drop a pin on the map' })).toBeDisabled();
  await dropAt(page, 3.139, 101.687);
  await expect.poll(async () => (await lastMark(page))).toBeNull();
  const { token } = await (await request.post('/api/session', { data: { userId: 'DEV-PRO' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  await page.route('**/api/credits', (r) => r.fulfill({ json: { balance: 0, pinLookupCost: 1, packs: [{ id: 'small', credits: 10, label: '10 credits' }], stub: true, note: 'Demo only.', liveLookup: true } }));
  await page.route('**/api/bookmarks', (r) => r.fulfill({ json: { bookmarks: [] } }));
  await page.reload();
  await record(page);
  await page.getByRole('button', { name: 'Drop a pin on the map' }).click();
  await dropAt(page, 3.139, 101.687);
  await expect.poll(async () => ((await lastMark(page)) as { tag: { actions: { id: string }[] } } | null)?.tag.actions.map((a) => a.id)).toEqual(['credits', 'cancel']);
});

test('Pro sample mode shows a sample custom-pin card without a credit charge or live call', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'DEV-PRO' } })).json();
  await page.addInitScript(t => sessionStorage.setItem('aegis.session', t), token);
  let liveLookups = 0;
  await page.route('**/api/pins/lookup', (r) => { liveLookups += 1; r.abort(); });
  await page.route('**/public/environment/pin/*/history', (r) => r.fulfill({ json: { days: [], measured: null, credit: 'x', link: 'https://open-meteo.com/' } }));
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await record(page);
  const toggle = page.getByRole('button', { name: /Sample data: Off/ });
  await expect(page.getByTestId('sample-banner')).toHaveCount(0);
  await toggle.click();
  const banner = page.getByTestId('sample-banner');
  await expect(banner).toContainText('SIMULATION MODE');
  await expect(banner).toContainText('Mock Telemetry Active');
  await expect(page.getByRole('button', { name: /Sample data: On/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Drop a pin on the map' }).click();
  await dropAt(page, 3.139, 101.687);
  await expect.poll(async () => ((await lastMark(page)) as { tag: { title: string; actions: { id: string }[] } } | null)?.tag.actions.map((a) => a.id)).toEqual(['check', 'cancel']);
  expect(((await lastMark(page)) as { tag: { title: string } }).tag.title).toBe('Show a sample for this spot?');
  await press(page, 'check');
  const card = page.getByRole('dialog', { name: /^Air and weather: Dropped pin/ });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('freshness')).toContainText('Sample data');
  await expect(card.getByTestId('freshness').getByRole('button')).toHaveCount(0);   // no live refresh in sample mode
  await expect(card).toContainText('DEMO DATA');
  expect(liveLookups).toBe(0);
  await card.getByRole('button', { name: 'Close air and weather' }).click();
  await page.getByRole('button', { name: /Sample data: On/ }).click();
  await expect(page.getByTestId('sample-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Sample data: Off/ })).toBeVisible();
});

test('Standard cannot activate pin tools through toolbar or custom map events', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'USER-A-COORD' } })).json();
  await page.addInitScript(t => sessionStorage.setItem('aegis.session', t), token);
  let lookups = 0;
  await page.route('**/api/pins/lookup', route => { lookups++; return route.abort(); });
  await page.goto('/assist');
  await expect(page.getByRole('button', { name: 'Drop a pin on the map' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Drop a pin on the map' })).toHaveAttribute('title', 'Requires Pro or Admin access');
  await record(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aegis-open-pin-dropper')));
  await dropAt(page, 3.139, 101.687);
  await press(page, 'check');
  expect(await dropMode(page)).toBeNull();
  expect(await lastMark(page)).toBeNull();
  expect(lookups).toBe(0);
});
