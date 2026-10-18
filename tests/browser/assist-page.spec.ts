import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// On a phone the chat is the main view and the cards open in a sheet behind "Cards (n)" (AEG-DEC-005); on desktop they are already on screen.
async function openCards(page: Page): Promise<void> {
  // wait for the page to render (the held and failed states have no workspace, so give up quickly there)
  await page.getByTestId('assist-workspace').waitFor({ timeout: 4000 }).catch(() => undefined);
  const button = page.getByTestId('cards-button');
  if (await button.isVisible()) await button.click();
}


// Integration checks for the public /assist page (AEG-PLN-003). The page, offline and coach details are covered by the workers' own
// specs; this one proves the wiring: the route renders real validated content, on a phone, with no login and no cookies.
test.use({ viewport: { width: 360, height: 740 } });

test('/assist renders validated guidance on a 360 px screen with no login and no cookies', async ({ page, context }) => {
  await page.goto('/assist/guidance');
  await openCards(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Aegis Assist' })).toBeVisible();
  await expect(page.getByText('Call first').first()).toBeVisible();
  await expect(page.getByText(/not medical advice/i)).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);

  // A radio input is operated through its label, so the label is the touch target that must be at least 48 px.
  const small = await page.evaluate(() => [...document.querySelectorAll('a,button,summary,label,select,[role=button]')]
    .map((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent ?? '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((r) => r.w > 0 && (r.w < 48 || r.h < 48)));
  expect(small).toEqual([]);

  expect(await context.cookies()).toEqual([]);
});

test('the country choice works without location, keeps the choice, and never shows numbers from another country', async ({ page }) => {
  await page.goto('/assist/guidance');
  await openCards(page);
  await expect(page.getByRole('group', { name: 'Country' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Malaysia' })).toBeChecked();
  await expect(page.getByText(/call 999/i).first()).toBeVisible();
  await page.getByText('Singapore', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Singapore' })).toBeChecked();
  await expect(page.getByText(/\b995\b/).first()).toBeVisible();          // Singapore's own sourced contact line
  await expect(page.getByText(/call 999/i)).toHaveCount(0);                 // never the Malaysian line
  await page.reload();
  await openCards(page);
  await expect(page.getByRole('radio', { name: 'Singapore' })).toBeChecked();   // remembered in the browser
});

test('a country with no checked guidance says so plainly and shows no emergency number', async ({ page }) => {
  await page.route('**/public/assist/cards', async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { cards: { card: { country: string } }[] };
    await route.fulfill({ response, json: { ...body, cards: body.cards.filter((c) => c.card.country === 'MY') } });
  });
  await page.goto('/assist/guidance');
  await openCards(page);
  await page.getByText('Indonesia', { exact: true }).click();
  await expect(page.getByText(/No checked guidance is available for this country yet/)).toBeVisible();
  await expect(page.getByText(/\b(999|995|112)\b/)).toHaveCount(0);
});

test('while the release is held the page says it is under review; once released it does not', async ({ page, request }) => {
  const released = (await request.get('/public/assist/cards')).status() === 200 && JSON.parse(readFileSync('records/releases/assist-release.json', 'utf8')).status === 'APPROVED';
  await page.goto('/assist/guidance');
  await openCards(page);
  const notice = page.getByText(/Under review\. This guidance has not been approved for release/);
  if (released) await expect(notice).toHaveCount(0);
  else await expect(notice).toBeVisible();
});

test('the first line of every rendered card is the emergency contact line', async ({ request }) => {
  const body = await (await request.get('/public/assist/cards')).json() as { cards: { card: { lines: { kind: string }[]; synthetic: boolean }[] }[] };
  expect(body.cards.length).toBeGreaterThan(0);
  for (const { card } of body.cards) expect(card.lines[0]?.kind).toBe('contact');
});

test('the public page does not open the authenticated API', async ({ request }) => {
  expect((await request.get('/api/cards')).status()).toBe(401);
  expect((await request.get('/public/assist/cards')).headers()['set-cookie']).toBeUndefined();
});

test('a failed content load shows a plain message and no invented guidance', async ({ page }) => {
  await page.route('**/public/assist/cards', (route) => route.abort());
  await page.goto('/assist/guidance');
  await openCards(page);
  await expect(page.getByText(/could not be loaded/i)).toBeVisible();
  await expect(page.getByText(/call your local emergency number/i)).toBeVisible();
});

test('the group choice shows each group its own official guidance, keeps the general cards, and says plainly when a group has none', async ({ page }) => {
  await page.goto('/assist/guidance');
  await openCards(page);
  await expect(page.getByRole('group', { name: 'Who is this for?' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Everyone' })).toBeChecked();

  // Singapore: both groups NEA names have their own card
  await page.getByText('Singapore', { exact: true }).click();
  await page.getByText('Chronic lung or heart conditions', { exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: /chronic lung or heart conditions - Singapore/i })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /children, older adults and pregnant women/i })).toHaveCount(0);
  await expect(page.getByText(/\b995\b/).first()).toBeVisible();
  await page.getByText('Children, older adults, pregnant women', { exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: /children, older adults and pregnant women - Singapore/i })).toBeVisible();

  // Malaysia: no group card exists, so the page says so and keeps the general guidance, with the 2008 date visible
  await page.getByText('Malaysia', { exact: true }).click();
  await expect(page.getByText(/No official guidance written for this group was found for Malaysia yet/)).toBeVisible();
  await expect(page.getByText(/Based on guidance published in 2008/)).toBeVisible();
  await expect(page.getByText(/call 999/i).first()).toBeVisible();
  await expect(page.getByText(/\b995\b/)).toHaveCount(0);

  // the choice is remembered, and the touch targets stay at least 48 px
  await page.reload();
  await openCards(page);
  await expect(page.getByRole('radio', { name: 'Children, older adults, pregnant women' })).toBeChecked();
  const small = await page.evaluate(() => [...document.querySelectorAll('label,summary,a,button')]
    .map((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent ?? '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((r) => r.w > 0 && (r.w < 48 || r.h < 48)));
  expect(small).toEqual([]);
});

test('a released page shows what the approval means, and an endorsement is named as the organisation\'s own statement', async ({ page }) => {
  await page.route('**/public/assist/cards', async (route) => {
    const response = await route.fetch();
    const body = await response.json() as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...body,
        released: true,
        approval: { text: 'Approved for release by Synthetic Reviewer on 2026-10-17. The quotes were checked against saved official pages. This guidance has not been clinically reviewed.' },
        endorsements: [{ organisation: 'Synthetic Test Organisation', endorsedBy: 'A. Tester', endorsedOn: '2026-10-16' }],
      },
    });
  });
  await page.goto('/assist/guidance');
  await openCards(page);
  await expect(page.getByText(/This guidance has not been clinically reviewed/)).toBeVisible();
  await expect(page.getByText(/Under review\. This guidance has not been approved for release/)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Endorsed by' })).toBeVisible();
  await expect(page.getByText('Synthetic Test Organisation')).toBeVisible();
  await expect(page.getByText(/statement by the named organisation, not by Aegis/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test('with no endorsements the page shows no endorsement section', async ({ page }) => {
  await page.goto('/assist/guidance');
  await openCards(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Endorsed by' })).toHaveCount(0);
});

test('the page states the MVP remarks, with the remarks of the chosen country only', async ({ page }) => {
  await page.goto('/assist/guidance');
  await openCards(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Remarks' })).toBeVisible();
  await expect(page.getByText(/has not been reviewed by a clinician/)).toBeVisible();
  await expect(page.getByText(/not yet asked the publishers for written permission/)).toBeVisible();
  await expect(page.getByText(/2008 Ministry of Health leaflet/)).toBeVisible();          // Malaysia is the default country
  await expect(page.getByText(/Ministry of Health page\. Its terms require written permission/)).toHaveCount(0);
  await page.getByText('Singapore', { exact: true }).click();
  await expect(page.getByText(/Ministry of Health page\. Its terms require written permission/)).toBeVisible();
  await expect(page.getByText(/2008 Ministry of Health leaflet/)).toHaveCount(0);
  await page.getByText('Indonesia', { exact: true }).click();
  await expect(page.getByText(/found only in Bahasa Indonesia/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
