import { expect, test, type Page } from '@playwright/test';

// On a phone the chat is the main view and the cards open in a sheet behind "Cards (n)" (AEG-DEC-005); on desktop they are already on screen.
async function openCards(page: Page): Promise<void> {
  // wait for the page to render (the held and failed states have no workspace, so give up quickly there)
  await page.getByTestId('assist-workspace').waitFor({ timeout: 4000 }).catch(() => undefined);
  const button = page.getByTestId('cards-button');
  if (await button.isVisible()) await button.click();
}


test.use({ viewport: { width: 360, height: 740 } });

test('/assist renders sourced cards, coach controls and disclaimer at 360 px', async ({ page }) => {
  await page.goto('/assist/guidance');
  await openCards(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Aegis Assist' })).toBeVisible();
  const cards = page.locator('.assist-card');
  await expect(cards.first()).toBeVisible();
  await expect(page.getByLabel('Disclaimer')).toBeVisible();

  await page.keyboard.press('Tab');
  const keyboardFocus = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    // On a phone the cards are in a dialog that opens with focus on its Close button, so the first Tab reaches the next control inside the dialog.
    const dialog = document.querySelector('[role="dialog"]');
    const focusable = [...(dialog ?? document).querySelectorAll<HTMLElement>('a[href],button,summary,input,select,[tabindex]')]
      .filter((element) => element.getClientRects().length > 0 && element.tabIndex >= 0 && !element.matches(':disabled'));
    const focusIndicator = active.closest('.assist-country-option') ?? active;
    const style = getComputedStyle(focusIndicator);
    return {
      isFirstFocusable: active === focusable[dialog ? 1 : 0],
      isCallLink: active instanceof HTMLAnchorElement && active.href.startsWith('tel:'),
      isEnabledControl: active.matches('button:not(:disabled),a[href],summary,input:not(:disabled),select:not(:disabled)'),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(keyboardFocus).not.toBeNull();
  expect(keyboardFocus?.isFirstFocusable).toBe(true);
  expect(keyboardFocus?.isCallLink || keyboardFocus?.isEnabledControl).toBe(true);
  expect(keyboardFocus?.outlineStyle).toBe('solid');
  expect(keyboardFocus?.outlineWidth).toBeGreaterThanOrEqual(3);

  for (const card of await cards.all()) {
    const lines = card.locator('.assist-card-lines');
    await expect(lines.locator(':scope > :first-child')).toHaveClass(/assist-contact-line/);
    await expect(lines.locator('.assist-contact-label')).toBeVisible();
    await expect(card.getByRole('region', { name: 'Spoken coach' })).toBeVisible();
    const coach = card.getByRole('region', { name: 'Spoken coach' });
    const readAloud = coach.getByRole('button', { name: 'Read aloud' });
    const stop = coach.getByRole('button', { name: 'Stop' });
    await expect(readAloud).toHaveCSS('min-height', '48px');
    await expect(stop).toHaveCSS('min-height', '48px');
    await expect(card.locator('[aria-live="polite"][role="status"]')).toBeVisible();
    if (await readAloud.isEnabled()) {
      expect(await readAloud.evaluate((element) => element.tabIndex)).toBeGreaterThanOrEqual(0);
    } else {
      await expect(coach.getByText('Reading aloud is not available on this device')).toBeVisible();
      await expect(stop).toBeDisabled();
    }

    const sourceDisclosure = card.locator('details.assist-sources');
    await expect(sourceDisclosure.locator('summary')).toBeVisible();
    await sourceDisclosure.locator('summary').click();
    await expect(sourceDisclosure.locator('li strong').first()).toBeVisible();
    await expect(sourceDisclosure.locator('li a[href^="https://"]').first()).toBeVisible();
    await expect(sourceDisclosure.getByText(/^Status:/).first()).toBeVisible();
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);

  const smallTargets = await page.locator('a[href],button,summary,select,[role="button"],label.assist-country-option')
    .evaluateAll((elements) => elements.filter((element) => element.getClientRects().length > 0).flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width < 48 || rect.height < 48
        ? [{ tag: element.tagName, label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '', width: rect.width, height: rect.height }]
        : [];
    }));
  expect(smallTargets).toEqual([]);
});
