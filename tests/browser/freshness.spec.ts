import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The one-hour life of a live Google reading (AEG-FRESH-001): green with a countdown, yellow in the last ten minutes, red and cleared when expired, with a refresh that is an on-demand lookup.
const registry = JSON.parse(readFileSync(new URL('../../fixtures/environment-pins.json', import.meta.url), 'utf8'));
const base = registry.pins.find((p: { name: string }) => p.name === 'Bentong');
const now = new Date('2026-10-16T10:30:00Z');
const credits = { air: 'Source: Includes air quality data from Google', weather: 'Source: Includes weather data from Google' };
const reading = (kind: string, data: unknown, at: Date) => ({ pinId: base.pinId, kind, data, fetchedAt: at.toISOString(), validUntil: new Date(+at + 3600000).toISOString(), attribution: kind === 'AIR_CURRENT' ? credits.air : credits.weather, freshness: { text: 'Fixture', cadence: 'x', cadenceBasis: 'PUBLISHER_STATED' } });
const view = (at: Date) => ({ ...base, air: reading('AIR_CURRENT', { indexes: [{ code: 'uaqi', displayName: 'Universal AQI', aqi: 42, category: 'Moderate air quality' }], pollutants: [] }, at),
  weather: { current: reading('WEATHER_CURRENT', { temperature: { degrees: 28, unit: 'CELSIUS' }, weatherCondition: { description: { text: 'Cloudy' } } }, at), hourly: null, alerts: null }, unverified: null, lastUpdatedAt: at.toISOString(), readingState: 'fresh', media: null, nearby: null });

test('countdown goes green, yellow, red; numbers clear at 60 minutes; refresh is an on-demand lookup', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.install({ time: now });
  await page.route('**/public/environment', (r) => r.fulfill({ json: { asOf: now.toISOString(), status: { enabled: true, scheduled: false }, onDemand: { enabled: true }, attribution: credits, updates: { perDay: 4, timesLocal: ['07:00'], timezone: 'MYT', valueShownMinutes: 60 }, registry: { pins: 1 }, pins: [view(now)], remarks: [] } }));
  await page.route('**/public/environment/pin/*/history', (r) => r.fulfill({ json: { days: [], measured: null, credit: 'x', link: 'https://open-meteo.com/' } }));
  let refreshed = 0;
  await page.route(/\/public\/environment\/pin\/[^/]+$/, (r) => { refreshed += 1; const at = new Date(Date.now()); return r.fulfill({ json: { asOf: at.toISOString(), lookup: { status: 'fetched', detail: null }, attribution: credits, pin: view(at), remarks: [] } }); });
  await page.goto('/');
  await page.locator('.offline-environment-marker').click();
  const card = page.getByRole('dialog', { name: /^Air and weather:/ });
  const badge = card.getByTestId('freshness');
  await expect(badge).toContainText('Live telemetry (Google)');
  await expect(badge).toContainText('Expires in 60:00');
  await expect(badge).toHaveClass(/is-live/);
  await expect(card.locator('.environment-summary')).toContainText('42');
  await page.clock.fastForward(51 * 60 * 1000);
  await expect(badge).toHaveClass(/is-warning/);
  await expect(badge).toContainText('Stale warning');
  await expect(badge).toContainText(/Expires in 0\d:\d\d/);
  await expect(card.getByRole('button', { name: /Refresh telemetry/ })).toHaveCount(0);   // not before it has expired
  await page.clock.fastForward(10 * 60 * 1000);
  await expect(badge).toHaveClass(/is-expired/);
  await expect(badge).toContainText('Data expired (60 min limit)');
  await expect(card.locator('.environment-summary')).not.toContainText('42');             // the numbers are cleared
  await expect(card.locator('.environment-summary')).not.toContainText('28');
  await card.getByRole('button', { name: /Refresh telemetry/ }).click();
  await expect.poll(() => refreshed).toBe(1);
  await expect(badge).toHaveClass(/is-live/);
  await expect(card.locator('.environment-summary')).toContainText('42');
});

test('refresh button is not offered when live lookups are off on the server', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.install({ time: now });
  const old = new Date(+now - 2 * 3600000);
  await page.route('**/public/environment', (r) => r.fulfill({ json: { asOf: now.toISOString(), status: { enabled: true, scheduled: false }, onDemand: { enabled: false }, attribution: credits, registry: { pins: 1 }, pins: [{ ...view(old), air: null, weather: { current: null, hourly: null, alerts: null }, readingState: 'expired' }], remarks: [] } }));
  await page.route('**/public/environment/pin/*/history', (r) => r.fulfill({ json: { days: [], measured: null, credit: 'x', link: 'https://open-meteo.com/' } }));
  await page.goto('/');
  await page.locator('.offline-environment-marker').click();
  const badge = page.getByRole('dialog', { name: /^Air and weather:/ }).getByTestId('freshness');
  await expect(badge).toContainText('Data expired (60 min limit)');
  await expect(badge.getByRole('button')).toHaveCount(0);
});
