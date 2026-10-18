import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { SCENE_DARKEST } from '../../ui/src/scene/palette.js';

test.describe.configure({ mode: 'serial' });

const screenshotPath = (name: string): string => {
  mkdirSync(fileURLToPath(new URL('../../records/screenshots/shared-shell-2026-10-16/', import.meta.url)), { recursive: true });
  return fileURLToPath(new URL(`../../records/screenshots/shared-shell-2026-10-16/${name}`, import.meta.url));
};

const KNOWN_CSP_NOTE = " Note that 'script-src' was not explicitly set, so 'default-src' is used as a fallback.";

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  let knownNotes = 0;
  // One KNOWN note, matched exactly and only when it comes from the app bundle (decision D5, root cause not removed). Any other console error,
  // including any other CSP message or a second source for this one, is a problem; the count is capped and reported so it cannot grow unseen.
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const known = message.text() === KNOWN_CSP_NOTE && /\/assets\/index-[\w-]+\.js$/.test(message.location().url);
    if (known) { knownNotes += 1; if (knownNotes > 2) problems.push(`known CSP note repeated ${knownNotes} times`); } else problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

async function login(page: Page, path = '/workspace'): Promise<void> {
  await page.goto(path);
  await page.getByTestId('dev-login-USER-A-COORD').click();
  if ((page.viewportSize()?.width ?? 1280) >= 900) await expect(page.locator('[data-testid^="incident-item-"]')).toHaveCount(4);
  else await expect(page.getByTestId('chat-panel')).toBeVisible();
}

async function frameCount(page: Page): Promise<number> {
  return Number(await page.getByTestId('scene-layer').getAttribute('data-scene-frames') ?? '0');
}

async function settledFrames(page: Page): Promise<number> {
  let previous = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const now = await frameCount(page);
    if (now > 0 && now === previous) return now;
    previous = now;
    await page.waitForTimeout(150);
  }
  return previous;
}

function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const parse = (css: string): number[] => (css.match(/[\d.]+/g) ?? []).map(Number);

test('AEG-UXD-001 the WebGL canvas is a decorative layer that never takes focus or pointer events', async ({ page }) => {
  const problems = watchConsole(page);
  await login(page);
  const layer = page.getByTestId('scene-layer');
  await expect(layer).toHaveAttribute('data-scene-state', 'live');
  const canvas = page.getByTestId('scene-canvas');
  await expect(canvas).toHaveAttribute('aria-hidden', 'true');
  await expect(canvas).toHaveAttribute('tabindex', '-1');
  expect(await canvas.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
  expect(await layer.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
  const before = await frameCount(page);
  await page.waitForTimeout(700);
  expect(await frameCount(page)).toBeGreaterThan(before);   // the loop is running
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('CANVAS');
  expect(problems).toEqual([]);
});

test('AEG-UXD-001 the 3D text and the 2D card say the same thing for a real assessment', async ({ page }) => {
  await login(page);
  await page.locator('[data-testid^="incident-item-"]').first().click();
  await page.getByTestId('input-demand').fill('120');
  await page.getByTestId('run-assessment').click();
  await expect(page.getByTestId('field-shortfallUnits')).toContainText('40');
  const cardText = (await page.locator('[data-testid="field-shortfallUnits"] dd span').first().innerText()).trim();
  const title = (await page.locator('.card-view h2').first().innerText()).trim();
  await expect.poll(async () => (JSON.parse(await page.getByTestId('scene-layer').getAttribute('data-scene-lines') ?? '[]') as string[])
    .some((line) => line.includes(` | ${cardText} | `))).toBe(true);
  const lines = JSON.parse(await page.getByTestId('scene-layer').getAttribute('data-scene-lines') ?? '[]') as string[];
  const assessment = lines.find((line) => line.includes(` | ${cardText} | `));
  expect(title.startsWith((assessment?.split(' | ')[1] ?? '').replace(/…$/, ''))).toBe(true);
  expect(lines.filter((line) => line.startsWith('INC-'))).toHaveLength(4);
});

test('AEG-UXD-001 reduced motion draws one static frame and keeps no loop running', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  const layer = page.getByTestId('scene-layer');
  await expect(layer).toHaveAttribute('data-scene-state', 'static');
  const settled = await settledFrames(page);
  await page.waitForTimeout(800);
  expect(await frameCount(page)).toBe(settled);
});

test('AEG-UXD-001 frozen mode is repeatable and saves the scene screenshots', async ({ browser }) => {
  const shots: Buffer[] = [];
  for (let run = 0; run < 2; run += 1) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    const problems = watchConsole(page);
    await login(page, '/workspace?scene=frozen');
    await expect(page.getByTestId('scene-layer')).toHaveAttribute('data-scene-state', 'frozen');
    await settledFrames(page);
    await page.addStyleTag({ content: '.app-shell > *:not(.scene-layer){visibility:hidden !important}' });
    shots.push(await page.getByTestId('scene-layer').screenshot());
    await page.addStyleTag({ content: '.app-shell > *:not(.scene-layer){visibility:visible !important}' });
    if (run === 0) {
      await page.locator('[data-testid^="incident-item-"]').first().click();
      await page.screenshot({ path: screenshotPath('scene-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByTestId('chat-panel')).toBeVisible();
      await page.screenshot({ path: screenshotPath('scene-mobile.png') });
    }
    expect(problems).toEqual([]);
    await context.close();
  }
  expect(shots[0]?.equals(shots[1] ?? Buffer.alloc(0))).toBe(true);
});

test('AEG-UXD-001 text on the glass panels keeps 4.5:1 contrast against the darkest scene colour', async ({ page }) => {
  await login(page);
  const sample = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="workspace-left"]');
    return {
      background: panel ? getComputedStyle(panel).backgroundColor : '',
      text: panel ? getComputedStyle(panel).color : '',
      muted: getComputedStyle(document.querySelector('.status-strip') as Element).color,
    };
  });
  const [r = 255, g = 255, b = 255, alpha = 1] = parse(sample.background);
  const darkest = [1, 3, 5].map((index) => Number.parseInt(SCENE_DARKEST.slice(index, index + 2), 16));
  const blended = [r, g, b].map((channel, index) => channel * alpha + (darkest[index] ?? 0) * (1 - alpha));
  for (const color of [sample.text, sample.muted]) {
    const lighter = Math.max(luminance(blended), luminance(parse(color)));
    const darker = Math.min(luminance(blended), luminance(parse(color)));
    expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});

test('AEG-UXD-001 without WebGL the canvas is absent, the gradient stays and the workspace still works', async ({ page }) => {
  // Same detection path as a browser with WebGL off: every WebGL context request returns null.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return /webgl/i.test(type) ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  const problems = watchConsole(page);
  await login(page);
  await expect(page.getByTestId('scene-layer')).toHaveAttribute('data-scene-state', 'fallback');
  await expect(page.getByTestId('scene-canvas')).toHaveCount(0);
  expect(await page.getByTestId('scene-layer').evaluate((element) => getComputedStyle(element).backgroundImage)).toContain('linear-gradient');
  await page.locator('[data-testid^="incident-item-"]').first().click();
  await expect(page.getByTestId('evidence-flag-CONFLICTING').first()).toBeVisible();
  expect(problems).toEqual([]);
});
