import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Owner request 2026-10-17: after Send the message box locks, a Cancel button appears, and Cancel really cancels the request
// (the browser aborts the connection; the server aborts the model call: tests/integration/helper-cancel.test.ts).
// The helper is a browser fixture that holds the request open until the test releases it.
const evidenceDir = 'records/screenshots/assist-cancel-2026-10-17';
test.beforeAll(() => mkdirSync(evidenceDir, { recursive: true }));

interface Held { release: () => void; calls: number; aborted: number }
async function holdHelper(page: Page): Promise<Held> {
  const held: Held = { release: () => {}, calls: 0, aborted: 0 };
  page.on('requestfailed', (request) => { if (request.url().endsWith('/api/helper') && /ABORTED/i.test(request.failure()?.errorText ?? '')) held.aborted += 1; });
  await page.route('**/api/helper', async (route: Route) => {
    held.calls += 1;
    const body = route.request().postDataJSON() as { text: string; mode: string; attachments: unknown[] };
    await new Promise<void>((resolve) => { held.release = resolve; });
    await route.fulfill({ json: { messageId: `fixture-${held.calls}`, route: { routeId: null, source: 'model' }, blocks: [{ type: 'text', text: `Fixture answer ${held.calls}.` }], attachedRevisions: body.attachments, mode: body.mode, escalatedTo: null, providerNotice: null } }).catch(() => { /* the page cancelled it */ });
  });
  return held;
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Guest preview' }).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.metric-source').first()).toContainText('System records');
}

test('the message box locks while the request is in flight and unlocks with the answer', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1080 });
  const held = await holdHelper(page); await login(page);
  const input = page.getByTestId('chat-input');
  await input.fill('what is the major disaster for today');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-cancel')).toBeVisible();
  await expect(input).toHaveAttribute('readonly', ''); await expect(input).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('chat-send')).toBeDisabled(); await expect(page.getByTestId('chat-send')).toHaveText('Sending…');
  await expect(page.getByTestId('mode-auto')).toBeDisabled();
  await input.click({ force: true }); await page.keyboard.type('more words'); await expect(input).toHaveValue('what is the major disaster for today');   // typing is ignored while locked
  await page.screenshot({ path: `${evidenceDir}/locked-desktop.png` });
  expect(held.calls).toBe(1);
  held.release();
  await expect(page.getByTestId('chat-message-1')).toContainText('Fixture answer 1.');
  await expect(page.getByTestId('chat-cancel')).toHaveCount(0); await expect(input).not.toHaveAttribute('readonly', ''); await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
});

test('Cancel aborts the request in the browser, says so, keeps the text and lets the person send again', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1080 });
  const held = await holdHelper(page); await login(page);
  const input = page.getByTestId('chat-input');
  await input.fill('what is the major disaster for today');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-cancel')).toBeVisible();
  await page.getByTestId('chat-cancel').click();
  await expect.poll(() => held.aborted).toBe(1);                                   // the connection was really aborted, not just hidden
  await expect(page.getByTestId('chat-message-1')).toContainText('Cancelled. No system action was taken.');
  await expect(page.getByTestId('error-chat')).toHaveCount(0);
  await expect(page.getByTestId('chat-cancel')).toHaveCount(0); await expect(input).not.toHaveAttribute('readonly', '');
  await expect(input).toHaveValue('what is the major disaster for today');          // kept, so it can be edited and sent again
  await page.screenshot({ path: `${evidenceDir}/cancelled-desktop.png` });
  await page.getByTestId('chat-send').click(); await expect(page.getByTestId('chat-cancel')).toBeVisible(); held.release();
  await expect(page.getByTestId('chat-message-2')).toContainText('Fixture answer 2.');
  expect(held.calls).toBe(2);
});

test('Escape cancels too, and the late answer of a cancelled request is never shown', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1080 });
  const held = await holdHelper(page); await login(page);
  const input = page.getByTestId('chat-input'); await input.fill('help');
  await page.getByTestId('chat-send').click(); await expect(page.getByTestId('chat-cancel')).toBeVisible();
  await input.press('Escape');
  await expect.poll(() => held.aborted).toBe(1);
  await expect(page.getByTestId('chat-message-1')).toContainText('Cancelled.');
  held.release();                                                                  // the fixture answers late
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid^="chat-message-"]')).toHaveCount(1);     // only the "Cancelled" line: the late answer is not shown
  await expect(page.getByText('Fixture answer 1.')).toHaveCount(0);
});

test('phone width: the Cancel button is visible, on screen and large enough to tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const held = await holdHelper(page); await login(page);
  const input = page.getByTestId('chat-input'); await input.scrollIntoViewIfNeeded(); await input.fill('help');
  await page.getByTestId('chat-send').click();
  const cancel = page.getByTestId('chat-cancel'); await cancel.scrollIntoViewIfNeeded(); await expect(cancel).toBeVisible();
  const box = (await cancel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390); expect(box.height).toBeGreaterThanOrEqual(34);
  await page.screenshot({ path: `${evidenceDir}/locked-phone.png` });
  await cancel.click(); await expect.poll(() => held.aborted).toBe(1);
});
