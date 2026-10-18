import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const incidentIds = [
  'INC-TENANT-A-SYN-FLOOD-0001',
  'INC-TENANT-A-SYN-STALE-0002',
  'INC-TENANT-A-SYN-BADCOORD-0003',
  'INC-TENANT-A-SYN-B-7781',
];
const screenshotDirectory = fileURLToPath(new URL('../../records/screenshots/card-actions-2026-10-15/regression/', import.meta.url));

async function login(page: Page): Promise<void> {
  await page.goto('/workspace');
  // A signed-in session now survives a reload (login work of 2026-10-16), so the dev sign-in button is only there when no session is held.
  const devLogin = page.getByTestId('dev-login-USER-A-COORD');
  await devLogin.waitFor({ state: 'visible', timeout: 10000 }).then(() => devLogin.click(), () => undefined);
  if ((page.viewportSize()?.width ?? 1280) >= 900) {
    await expect(page.getByTestId('incident-list')).toBeVisible();
  } else {
    await expect(page.getByTestId('chat-panel')).toBeVisible();
  }
  await expect(page.getByTestId('status-models')).toHaveText('Models: disabled');
}

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/session', { data: { userId: 'USER-A-COORD' } });
  expect(response.status()).toBe(200);
  const body = await response.json() as { token: string };
  return body.token;
}

function screenshot(name: string): string {
  mkdirSync(screenshotDirectory, { recursive: true });
  return fileURLToPath(new URL(`../../records/screenshots/card-actions-2026-10-15/regression/${name}`, import.meta.url));
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('AEG-UXD-001 desktop workspace ratio and keyboard divider resize', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByTestId('workspace-left')).toBeVisible();
  await expect(page.getByTestId('workspace-right')).toBeVisible();
  const left = await page.getByTestId('workspace-left').boundingBox();
  const right = await page.getByTestId('workspace-right').boundingBox();
  expect(left).not.toBeNull();
  expect(right).not.toBeNull();
  const ratio = (left?.width ?? 0) / (right?.width ?? 1);
  expect(ratio).toBeGreaterThanOrEqual(1.7);
  expect(ratio).toBeLessThanOrEqual(2.3);
  const divider = page.getByTestId('divider');
  const before = await divider.getAttribute('aria-valuenow');
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).not.toHaveAttribute('aria-valuenow', before ?? '67');
  await page.screenshot({ path: screenshot('desktop-workspace.png'), fullPage: true });
});

test('AEG-TST-007 tenant A incidents show evidence flags and unknown location', async ({ page }) => {
  await expect(page.locator('[data-testid^="incident-item-"]')).toHaveCount(4);
  await page.getByTestId(`incident-item-${incidentIds[0]}`).click();
  await expect(page.getByTestId('evidence-flag-CONFLICTING').first()).toBeVisible();
  await page.getByTestId(`incident-item-${incidentIds[1]}`).click();
  await expect(page.getByTestId('evidence-flag-STALE')).toBeVisible();
  await page.getByTestId(`incident-item-${incidentIds[2]}`).click();
  await expect(page.getByTestId('evidence-flag-COORD_INVALID')).toBeVisible();
  await expect(page.getByTestId('field-location')).toContainText('Unknown');
});

test('AEG-TST-007 assessment shows shortfall and makes no model call when models are disabled', async ({ page, request }) => {
  await page.getByTestId(`incident-item-${incidentIds[0]}`).click();
  await page.getByTestId('input-demand').fill('120');
  await page.getByTestId('run-assessment').click();
  await expect(page.getByTestId('field-shortfallUnits')).toContainText('40');
  await expect(page.getByTestId('epistemic-shortfallUnits')).toHaveText('CALCULATION');
  await expect(page.getByTestId('synthetic-banner')).toBeVisible();
  await expect(page.getByTestId('status-models')).toHaveText('Models: disabled');

  const token = await apiLogin(request);
  const adminLogin = await request.post('/api/session', { data: { userId: 'DEV-ADMIN' } });
  const adminToken = (await adminLogin.json() as { token: string }).token;
  const budget = await request.get('/api/budget', { headers: { authorization: `Bearer ${adminToken}` } });
  expect(budget.status()).toBe(200);
  expect(await budget.json()).toMatchObject({ modelsEnabled: false, committedMicro: 0 });
});

test('AEG-TST-007 pins remain listed after reload and login', async ({ page }) => {
  for (const cardId of incidentIds.slice(0, 3)) {
    await page.getByTestId(`incident-item-${cardId}`).click();
    await page.getByTestId('pin-toggle').click();
  }
  await page.reload();
  await login(page);
  for (const cardId of incidentIds.slice(0, 3)) {
    await expect(page.getByTestId(`dock-chip-${cardId}`)).toBeVisible();
  }
});

test('AEG-TST-007 attaches selected older revision to the chat request', async ({ page }) => {
  const flood = incidentIds[0];
  await page.getByTestId(`incident-item-${flood}`).click();
  await page.getByTestId('revision-select').selectOption('1');
  await page.getByTestId('attach-toggle').click();
  await expect(page.getByTestId(`attachment-chip-${flood}`)).toContainText(`${flood} r1`);
  await expect(page.getByTestId(`attachment-chip-${flood}`)).toContainText('newer r2 available');

  let observedRevision: number | undefined;
  await page.route('**/api/chat', async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (typeof body === 'object' && body !== null && 'attachments' in body && Array.isArray(body.attachments)) {
      const first: unknown = body.attachments[0];
      if (typeof first === 'object' && first !== null && 'revision' in first && typeof first.revision === 'number') {
        observedRevision = first.revision;
      }
    }
    await route.continue();
  });
  await page.getByTestId('chat-input').fill('help');
  await page.getByTestId('chat-send').click();
  await expect.poll(() => observedRevision).toBe(1);
});

test('AEG-UXD-001 mobile sheet focus and six-card dock overflow', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cardsButton = page.getByTestId('cards-button');
  await cardsButton.click();
  await expect(page.getByTestId('sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sheet')).toHaveCount(0);
  await expect(cardsButton).toBeFocused();

  const token = await apiLogin(request);
  const assessmentIds: string[] = [];
  for (const unitId of ['UNIT.WATER_KIT', 'UNIT.TENT']) {
    const response = await request.post('/api/workflows/resource-assessment', {
      headers: { authorization: `Bearer ${token}` },
      data: { incidentCardId: incidentIds[0], incidentRevision: 2, unitId, regionId: 'REGION.DEMO_A', demandUnits: 10 },
    });
    expect(response.status()).toBe(200);
    const body = await response.json() as { card: { cardId: string } };
    assessmentIds.push(body.card.cardId);
  }
  for (const cardId of [...incidentIds, ...assessmentIds]) {
    const response = await request.put(`/api/pins/${encodeURIComponent(cardId)}`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status()).toBe(200);
  }

  await page.reload();
  await login(page);
  await expect(page.getByTestId('dock-overflow')).toHaveText('+1');
  await page.getByTestId('dock-overflow').click();
  await expect(page.getByTestId('sheet')).toBeVisible();
});

test('AEG-UXD-001 keyboard navigation reaches cards, chat input and send with focus rings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  const cardsButton = page.getByTestId('cards-button');
  let cardsReached = false;
  for (let index = 0; index < 12 && !cardsReached; index += 1) {
    await page.keyboard.press('Tab');
    cardsReached = await cardsButton.evaluate((element) => element === document.activeElement);
  }
  expect(cardsReached).toBe(true);
  await expect(cardsButton).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Conversation history')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Add context',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('chat-input')).toBeFocused();
  await page.getByTestId('chat-input').fill('help');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('chat-send')).toBeFocused();
  await expect(page.getByTestId('chat-send')).toHaveCSS('outline-style', 'solid');
});

test('AEG-TST-007 saves desktop and mobile workspace screenshots with loaded tenant data', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('[data-testid^="incident-item-"]')).toHaveCount(4);
  await page.getByTestId(`incident-item-${incidentIds[0]}`).click();
  await expect(page.getByTestId('evidence-flag-CONFLICTING').first()).toBeVisible();
  await page.screenshot({ path: screenshot('desktop-workspace.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId(`dock-chip-${incidentIds[0]}`)).toBeVisible();
  await expect(page.getByTestId('dock-overflow')).toHaveText('+1');
  await page.getByTestId('chat-input').fill('help');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message-1')).toBeVisible();
  await page.screenshot({ path: screenshot('mobile-chat.png'), fullPage: true });

  await page.getByTestId('cards-button').click();
  await expect(page.getByTestId('sheet')).toBeVisible();
  await expect(page.getByTestId('sheet').getByRole('button', { name: incidentIds[0] })).toBeVisible();
  await page.screenshot({ path: screenshot('mobile-sheet.png'), fullPage: true });
});
