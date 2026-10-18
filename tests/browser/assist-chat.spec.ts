import { expect, test, type Page } from '@playwright/test';

// The Assist chat (AEG-DEC-005, AEG-ENG-006): desktop cards and chat at about 2:1 with a resizable divider; on a phone the chat is the main view
// and the cards open in a sheet. The chat answers only from the cards, in the browser, with no model and no network.

async function ask(page: Page, question: string): Promise<void> {
  await page.getByTestId('assist-chat').getByTestId('chat-input').fill(question);
  await page.getByTestId('assist-chat').getByTestId('chat-send').click();
}

test.describe('desktop 1920x1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('cards and chat are on screen together at about 2 to 1, and the divider can be moved with the keyboard', async ({ page }) => {
    await page.goto('/assist/guidance');
    const left = page.getByTestId('assist-left');
    const right = page.getByTestId('assist-right');
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    await expect(page.getByTestId('assist-chat')).toBeVisible();
    const widths = async () => ({ l: (await left.boundingBox())!.width, r: (await right.boundingBox())!.width });
    const before = await widths();
    expect(before.l / before.r).toBeGreaterThan(1.7);
    expect(before.l / before.r).toBeLessThan(2.3);
    const divider = page.getByTestId('assist-workspace').getByTestId('divider');
    await divider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const narrower = await widths();
    expect(narrower.l).toBeLessThan(before.l);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const wider = await widths();
    expect(wider.l).toBeGreaterThan(before.l);
  });

  test('the emergency number of the chosen country is always on screen, and the cards are not duplicated', async ({ page }) => {
    await page.goto('/assist/guidance');
    await expect(page.getByTestId('assist-emergency')).toContainText(/Emergency, Malaysia/);
    await expect(page.getByTestId('assist-emergency')).toContainText(/999/);
    await expect(page.getByRole('group', { name: 'Country' })).toHaveCount(1);
  });

  test('masks in Singapore: the official lines come back word for word with publisher, date and a link', async ({ page }) => {
    await page.goto('/assist/guidance');
    await page.getByText('Singapore', { exact: true }).click();
    await page.getByRole('button', { name: 'Which mask?' }).click();
    const log = page.getByTestId('assist-chat').getByTestId('chat-log');
    await expect(log.getByText(/may wear an N95 mask to reduce exposure/)).toBeVisible();
    await expect(log.getByText(/should consult their doctor before using an N95 mask/)).toBeVisible();
    await expect(log.getByRole('link', { name: /Source: Ministry of Health, Singapore/ }).first()).toHaveAttribute('href', /^https:\/\/www\.moh\.gov\.sg\//);
    await expect(log.getByText(/Accessed 2026-10-14/).first()).toBeVisible();
  });

  test('naming a country in the chat switches the whole page to it and shows only that country\'s number', async ({ page }) => {
    await page.goto('/assist/guidance');
    await ask(page, 'I am in Singapore, what is the emergency number');
    await expect(page.getByTestId('assist-emergency')).toContainText(/Emergency, Singapore/);
    await expect(page.getByTestId('assist-emergency')).toContainText(/995/);
    await expect(page.getByRole('radio', { name: 'Singapore' })).toBeChecked();
    await expect(page.getByTestId('assist-chat').getByTestId('chat-context')).toHaveText('Answering for Singapore');
    await expect(page.getByText(/call 999/i)).toHaveCount(0);
  });

  test('switching country with the radio buttons never leaves the other country\'s answers on screen', async ({ page }) => {
    await page.goto('/assist/guidance');
    await ask(page, 'emergency number');
    await expect(page.getByTestId('assist-chat').getByTestId('chat-log')).toContainText(/999/);
    await page.getByText('Singapore', { exact: true }).click();
    await expect(page.getByTestId('assist-chat').getByTestId('chat-log')).not.toContainText(/999/);
    await expect(page.getByTestId('assist-chat').getByTestId('chat-log')).toContainText(/995/);
    await page.getByText('Malaysia', { exact: true }).click();
    await expect(page.getByTestId('assist-chat').getByTestId('chat-log')).toContainText(/999/);   // the Malaysian conversation is still there
  });

  test('a question the cards cannot answer is said to be unmatched, with the contact line and no advice', async ({ page }) => {
    await page.goto('/assist/guidance');
    await ask(page, 'what is the weather tomorrow');
    const log = page.getByTestId('assist-chat').getByTestId('chat-log');
    await expect(log.getByText(/could not match that to the official guidance/)).toBeVisible();
    await expect(log.getByText(/No AI model is used/)).toBeVisible();
  });

  test('chatting makes no network request, and still works offline', async ({ page, context }) => {
    await page.goto('/assist/guidance');
    await expect(page.getByTestId('assist-chat')).toBeVisible();
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await context.setOffline(true);
    await ask(page, 'which mask should I wear');
    await expect(page.getByTestId('assist-chat').getByTestId('chat-log').getByText(/N95 or P100/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Emergency number' }).click();
    expect(requests.filter((u) => !u.startsWith('data:'))).toEqual([]);
  });

  test('no model, no key and no cookie: the chat does not open the authenticated API', async ({ page, context }) => {
    const api: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/api/') && !request.url().includes('/api/health')) api.push(request.url()); });
    await page.goto('/assist/guidance');
    await ask(page, 'masks');
    await expect(page.getByTestId('assist-chat').getByTestId('chat-log').getByText(/mask/).first()).toBeVisible();
    expect(api).toEqual([]);
    expect(await context.cookies()).toEqual([]);
  });
});

test.describe('phone 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the chat is the main view, and the cards open in a sheet that Escape closes with focus returned', async ({ page }) => {
    await page.goto('/assist/guidance');
    await expect(page.getByTestId('assist-chat')).toBeVisible();
    await expect(page.getByTestId('assist-emergency')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Country' })).toHaveCount(0);   // the cards are not on the page until the sheet opens
    const button = page.getByTestId('cards-button');
    await expect(button).toHaveText(/Cards \(\d+\)/);
    await button.click();
    const sheet = page.getByRole('dialog', { name: 'Guidance cards' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('group', { name: 'Country' })).toBeVisible();
    await expect(sheet.getByText('Call first').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('a quick question works on the phone and there is no horizontal scroll', async ({ page }) => {
    await page.goto('/assist/guidance');
    await page.getByRole('button', { name: 'Emergency number' }).click();
    await expect(page.getByTestId('assist-chat').getByTestId('chat-log').getByText(/999/).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    const small = await page.evaluate(() => [...document.querySelectorAll('a,button,summary,input,[role=button]')]
      .map((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => r.w > 0 && (r.w < 48 || r.h < 48)));
    expect(small).toEqual([]);
  });
});
