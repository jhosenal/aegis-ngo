import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const evidenceDir = 'records/screenshots/map-layer-toolbar-2026-10-17/regression';
test.beforeAll(() => mkdirSync(evidenceDir, { recursive: true }));
test.beforeEach(async ({ page }) => {
  // Browser contract fixture. The real helper/provider/tool loop is integration-tested separately.
  await page.route('**/api/helper', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { messageId: `fixture-${Date.now()}`, route: { routeId: null, source: 'model' },
      blocks: [{ type: 'text', text: body.text.toLowerCase().includes('incidents') ? 'Synthetic card INC-TENANT-A-SYN-FLOOD-0001 is available.' : 'Fixture helper reply: I can help explain your cards.' }],
      attachedRevisions: body.attachments, mode: body.mode, escalatedTo: null, providerNotice: null } });
  });
});

async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Guest preview' }).click();
  await page.getByTestId('dev-login-USER-A-COORD').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.metric-source').first()).toContainText('System records');
  await expect(page.locator('.dashboard-status')).toHaveCount(0);
}

test('regional dashboard has shared chrome, source labels, card drill-down and working filters', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1080 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Regional operations');
  await expect(page.locator('.chat-conversation-header')).toBeVisible();
  await page.getByText('About AEGIS',{exact:true}).click();
  await expect(page.locator('.site-footer')).toBeVisible();
  await expect(page.locator('.dashboard-metrics > button')).toHaveCount(6);
  const hero = await page.locator('.map-panel').boundingBox();
  const metrics = await page.locator('.dashboard-metrics').boundingBox();
  expect(hero!.y).toBeLessThan(metrics!.y);
  const workspace = await page.locator('.dashboard-main').boundingBox();
  const dock = await page.locator('.dashboard-assist').boundingBox();
  expect(workspace!.width / dock!.width).toBeGreaterThan(2.3);
  expect(workspace!.width / dock!.width).toBeLessThan(2.7);
  expect(workspace!.y).toBe(0);
  const sidebar = await page.locator('.dashboard-sidebar').boundingBox();
  const account=await page.locator('.chat-account').boundingBox();
  const search=await page.getByRole('searchbox',{name:'Search chats'}).boundingBox();
  expect(account!.y).toBeGreaterThan(search!.y);
  expect(account!.y+account!.height).toBeLessThanOrEqual(sidebar!.y+sidebar!.height);
  await expect(page.locator('.sidebar-brand > span')).toHaveText('A SAFER TOMORROW, TOGETHER.');
  await expect(page.locator('.solution-headline > span')).toHaveText(['One engine.', 'Seven hazards.', 'One rule.']);
  await expect(page.locator('.solution-description')).toHaveText('Code sets the rules. AI only phrases them.');
  await expect(page.locator('.sidebar-mode')).toHaveCount(0);
  await expect(page.locator('.prototype-status-dot')).toHaveCSS('background-color', 'rgb(255, 152, 0)');
  await expect(page.locator('.solution-headline > span').nth(1)).toHaveCSS('color', 'rgb(41, 182, 255)');
  expect(hero!.y).toBeLessThanOrEqual(122);
  await expect(page.locator('.map-panel > .dashboard-card-heading')).toHaveCount(0);
  await expect(page.locator('.dashboard-page-heading')).toHaveCount(0);
  await expect(page.locator('.site-header .region-select')).toHaveCount(0);
  await expect(page.locator('.map-region-control .region-select')).toBeVisible();
  await expect(page.locator('.chat-conversation-header')).toHaveCSS('background-color','rgb(246, 251, 255)');
  await expect(page.locator('.site-header')).toHaveCount(0);
  expect(metrics!.y).toBeGreaterThan(hero!.y + hero!.height);
  const lowerCards = await page.locator('.dashboard-detail-grid').boundingBox();
  expect(lowerCards!.y).toBeGreaterThan(metrics!.y + metrics!.height);
  const mapCanvas = await page.locator('.google-map-canvas').boundingBox();
  expect(mapCanvas!.x).toBe(workspace!.x);
  expect(mapCanvas!.y).toBe(workspace!.y);
  expect(mapCanvas!.height).toBeGreaterThan(300);
  expect(Math.abs(mapCanvas!.height - (mapCanvas!.width * 9 / 16 - 10))).toBeLessThan(1);
  await expect(page.locator('[data-card-id="page:dashboard"]')).toBeVisible();
  await expect(page.locator('.dashboard-source-banner')).toHaveCount(0);
  await expect(page.locator('.map-overlay-label')).toContainText('Includes demo markers');
  await expect(page.locator('.regional-map-marker')).toHaveCount(7);
  await expect(page.locator('.map-layer-control .layer-hazard')).toHaveCount(7);
  await page.getByRole('button',{name:'Map layers',exact:true}).click();
  await expect(page.locator('.map-layer-control').getByRole('button', { name: 'Air & Weather', exact:true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.regional-card-row')).toHaveCount(5);
  await page.locator('.regional-card-row').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('synthetic-banner')).toContainText('Synthetic');
  await page.getByTestId('attach-toggle').click();
  await expect(page.locator('.card-feedback')).toContainText('cannot be sent to chat');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Search cards')).toHaveCount(0);
  await page.getByLabel('Region', { exact: true }).selectOption('Malaysia');
  await expect(page.locator('.regional-card-row')).toHaveCount(1);
  await expect(page.locator('.regional-card-row')).toContainText('Flooding risk');
  await page.getByLabel('Region', { exact: true }).selectOption('Thailand');
  await expect(page.locator('.regional-card-row')).toHaveCount(1);
  await page.getByLabel('Region', { exact: true }).selectOption('');
  await page.getByRole('button',{name:'Map layers',exact:true}).click();
  await page.getByRole('button', { name: 'wildfire', exact: true }).click();
  await expect(page.locator('.regional-map-marker')).toHaveCount(6);
  await page.getByRole('button', { name: 'wildfire', exact: true }).click();
  await expect(page.locator('.regional-map-marker')).toHaveCount(7);
  await page.locator('.dashboard-main').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: `${evidenceDir}/desktop.png`, fullPage: true });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('merged regional header retains map state and the map scrolls with the page', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const tray = page.locator('.regional-info-tray');
  const map = page.locator('.regional-map');
  await map.evaluate(el => { (el as HTMLElement).dataset.retentionProbe = 'same-map'; });
  const mapBefore = await map.boundingBox();
  await page.mouse.move(mapBefore!.x + mapBefore!.width / 2, mapBefore!.y + 180);
  await page.mouse.wheel(0, 350);
  await expect.poll(() => page.locator('.dashboard-main').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  expect((await map.boundingBox())!.y).toBeLessThan(mapBefore!.y - 100);
  expect(await tray.evaluate(el => el.scrollTop)).toBe(0);
  await page.getByRole('button',{name:'Map layers',exact:true}).click();
  await page.getByRole('button', { name: 'wildfire', exact: true }).click();
  await expect(page.locator('.regional-map-marker')).toHaveCount(6);
  await page.getByRole('button', { name: 'Hide regional overview', exact: true }).click();
  await expect(tray).toBeHidden();
  await expect(page.locator('.map-layer-control')).toBeHidden();
  await expect(map).toBeVisible();
  await page.getByRole('button', { name: 'Show regional overview', exact: true }).click();
  await expect(tray).toBeVisible();
  await expect(map).toHaveAttribute('data-retention-probe', 'same-map');
  await page.getByRole('button',{name:'Map layers',exact:true}).click();
  await expect(page.getByRole('button', { name: 'wildfire', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('signed-in dashboard preserves exact helper attachment revisions and saves system pins', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1080 });
  await login(page);
  await expect(page.locator('.regional-card-row')).toHaveCount(4);
  await expect(page.locator('.metric-card').filter({ hasText: 'People potentially affected' })).toContainText('Unknown');
  await page.locator('.regional-card-row').first().click();
  const cardTestId = await page.locator('.card-view').getAttribute('data-testid');
  const cardId = cardTestId!.replace('card-view-', '');
  // Legacy workspace scenarios may already have pinned this shared fixture.
  if (await page.getByTestId('pin-toggle').getAttribute('aria-pressed') === 'true') {
    await page.getByTestId('pin-toggle').click();
    await expect(page.getByTestId('pin-toggle')).toHaveText('Pin');
  }
  await page.getByTestId('pin-toggle').click();
  await expect(page.getByTestId('pin-toggle')).toHaveText('Unpin');
  await page.getByTestId('attach-toggle').click();
  await expect(page.locator('.card-feedback')).toContainText('Revision 1 attached');
  await page.keyboard.press('Escape');
  await expect(page.locator('.dashboard-pins')).toContainText('Pinned cards');
  await page.getByTestId('chat-input').fill('help');
  const requestPromise = page.waitForRequest((request) => request.url().endsWith('/api/helper') && request.method() === 'POST');
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/helper') && response.request().method() === 'POST');
  await page.getByTestId('chat-send').click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({ text: 'help', mode: 'auto', attachments: [{ cardId, revision: 1 }] });
  expect((await responsePromise).status()).toBe(200);
  await expect(page.getByTestId('chat-message-1')).toBeVisible();
  await expect(page.getByTestId('user-message-1')).toContainText('help');
  await expect(page.getByTestId('error-chat')).toHaveCount(0);
  await page.getByTestId('chat-input').fill('list incidents');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message-2')).toContainText('INC-TENANT-A');
  await page.locator('.dashboard-main').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: `${evidenceDir}/system-chat.png`, fullPage: true });
});

test('system card load errors stay explicit and chat errors allow retry', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1080 });
  await page.route('**/api/cards', (route) => route.fulfill({ status: 503, json: { error: { code: 'E_INTERNAL', message: 'Unavailable' } } }));
  await login(page);
  await expect(page.locator('.dashboard-error')).toContainText('Demo records have not been substituted');
  await expect(page.locator('.regional-card-row')).toHaveCount(0);
  await page.unroute('**/api/cards');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.regional-card-row')).toHaveCount(4);
  await page.route('**/api/helper', (route) => route.fulfill({ status: 503, json: { error: { code: 'E_INTERNAL', message: 'Temporarily unavailable' } } }));
  await page.getByTestId('chat-input').fill('help');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('error-chat')).toContainText('Temporarily unavailable');
  await expect(page.getByTestId('chat-input')).toHaveValue('help');
  await page.unroute('**/api/helper');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message-1')).toBeVisible();
  await expect(page.getByTestId('error-chat')).toHaveCount(0);
});

test('mobile dashboard has no overflow, drawer navigation and usable chat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.dashboard-assist')).toBeHidden();
  const edge = await page.getByRole('button', { name: 'Show Assist', exact: true }).boundingBox();
  expect(edge!.x + edge!.width).toBeGreaterThanOrEqual(389);
  expect(edge!.height).toBeGreaterThan(edge!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Show navigation', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('button', { name: 'Incidents', exact: false }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Incidents');
  await expect(page.locator('.dashboard-sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Show Assist', exact: true }).click();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to chat', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide Assist', exact: true }).click();
  await login(page);
  await page.getByRole('button', { name: 'Show Assist', exact: true }).click();
  await page.getByTestId('chat-input').fill('help');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message-1')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/mobile-chat.png`, fullPage: true });
  await page.getByRole('button', { name: 'Hide Assist', exact: true }).click();
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
});

test('desktop assistant dock resizes, collapses and retains conversation while sections change', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page);
  await page.getByTestId('chat-input').fill('Hello');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message-1')).toContainText('Fixture helper reply');
  const dock = page.locator('.dashboard-assist'); const before = await dock.boundingBox();
  const divider = page.getByRole('separator', { name: 'Resize workspace and chat panels' });
  await divider.focus(); await page.keyboard.press('ArrowLeft');
  const after = await dock.boundingBox(); expect(after!.width).toBeGreaterThan(before!.width);
  const handle = await divider.boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle!.x - 70, handle!.y + 100, { steps: 5 });
  await page.mouse.up();
  expect((await dock.boundingBox())!.width).toBeGreaterThan(after!.width);
  const leftPuller = page.getByRole('button', { name: 'Hide navigation', exact: true });
  const rightPuller = page.getByRole('button', { name: 'Hide Assist', exact: true });
  expect(Math.abs((await leftPuller.boundingBox())!.y - (await rightPuller.boundingBox())!.y)).toBeLessThan(1);
  await expect(page.locator('.dashboard-assist-heading button')).toHaveCount(0);
  await leftPuller.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.dashboard-sidebar')).toBeHidden();
  await rightPuller.click();
  await expect(dock).toBeHidden();
  await page.getByRole('button', { name: 'Show navigation', exact: true }).click();
  await expect(page.locator('.dashboard-sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Show Assist', exact: true }).click();
  await expect(page.getByTestId('chat-message-1')).toContainText('Fixture helper reply');
  await page.locator('.dashboard-sidebar').getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByTestId('chat-message-1')).toContainText('Fixture helper reply');
});

test('card revision, pin and attach share the bottom action line with matching icon buttons', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1080 });
  await page.goto('/'); await page.locator('.regional-card-row').first().click();
  const footer = page.locator('.card-dialog-footer');
  await expect(footer.getByTestId('revision-select')).toBeVisible();
  await expect(footer.getByTestId('pin-toggle')).toContainText('Pin');
  await expect(footer.getByTestId('pin-toggle').locator('svg')).toHaveCount(1);
  await expect(footer.getByTestId('attach-toggle')).toHaveClass(/card-action-button/);
  const pin = await footer.getByTestId('pin-toggle').boundingBox();
  const attach = await footer.getByTestId('attach-toggle').boundingBox();
  const next = await footer.getByRole('button', { name: 'Continue in Assist' }).boundingBox();
  expect(Math.abs(pin!.y - attach!.y)).toBeLessThan(2);
  // Portrait details keep Pin/Attach together, with continuation below.
  expect(next!.y).toBeGreaterThanOrEqual(pin!.y);
  await page.getByRole('dialog').screenshot({ path: `${evidenceDir}/card-actions-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(footer.getByTestId('pin-toggle')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole('dialog').screenshot({ path: `${evidenceDir}/card-actions-mobile.png` });
});
