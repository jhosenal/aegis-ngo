import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function login(page: Page): Promise<void> {
  await page.goto('/workspace');
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
}

test('AEG-UXD-001 the model mode picker defaults to Auto and switches Pro and Expert off with a plain note', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('mode-picker')).toBeVisible();
  await expect(page.getByTestId('mode-auto')).toBeChecked();
  await expect(page.getByTestId('mode-normal')).toBeEnabled();
  await expect(page.getByTestId('mode-pro')).toBeDisabled();
  await expect(page.getByTestId('mode-expert')).toBeDisabled();
  await expect(page.getByTestId('mode-note-pro')).toContainText('registered users');
  await expect(page.getByTestId('mode-note-expert')).toContainText('Not available yet');
  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(fileURLToPath(new URL('../../records/screenshots/card-actions-2026-10-15/regression/', import.meta.url)), { recursive: true });
  await page.getByTestId('chat-panel').screenshot({ path: fileURLToPath(new URL('../../records/screenshots/card-actions-2026-10-15/regression/modes-chat.png', import.meta.url)) });
  // Model names never reach the browser.
  expect(await page.locator('body').innerText()).not.toMatch(/gpt-6|claude|gemini|opus/i);
});

test('AEG-UXD-001 the chosen mode is sent with the message, and keyboard users can reach it', async ({ page }) => {
  await login(page);
  const seen: string[] = [];
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() as { mode?: string };
    seen.push(body.mode ?? 'none');
    await route.continue();
  });
  await page.getByTestId('chat-input').fill('help');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message-1')).toBeVisible();
  await page.getByTestId('mode-normal').check();
  await expect(page.getByTestId('mode-note')).toHaveText('Standard model.');
  await page.getByTestId('chat-input').fill('help');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message-2')).toBeVisible();
  expect(seen).toEqual(['auto', 'normal']);
  await page.getByTestId('mode-auto').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('mode-normal')).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('mode-auto')).toBeChecked();   // Pro and Expert are disabled, so the arrow keys skip them and wrap round to Auto
});
