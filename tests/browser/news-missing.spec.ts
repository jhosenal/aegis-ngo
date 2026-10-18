import { test, expect } from '@playwright/test';

test('without the news files the page loads and Latest news says it is not available', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A source-built image without the files answers with the HTML app page and status 200.
  await page.route('**/media/news-latest.json*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.route('**/media/news-latest.webm*', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/media/news-jingle.mp3*', (route) => route.fulfill({ status: 404, body: '' }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Latest news', exact: true }).click();
  await page.getByRole('button', { name: /Morning news/ }).click();
  await expect(page.getByText('No news bulletin is available yet.')).toBeVisible();
  expect(errors).toEqual([]);
});
