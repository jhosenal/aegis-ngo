#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const recordings = join(root, 'data', 'recordings');
const baseScenes = ['assist-sg-mask', 'assist-my-offline', 'assist-phone', 'domains', 'overview-desktop', 'overview-phone', 'overview-states', 'workspace', 'hazard-map'];
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  const port = address?.port;
  if (!port || port === 8799 || port === 8801) return freePort();
  return port;
}

function cursorScript() {
  const install = () => {
    if (document.getElementById('aegis-recording-cursor')) return;
    const style = document.createElement('style');
    style.textContent = '#aegis-recording-cursor{position:fixed;z-index:2147483647;left:0;top:0;width:16px;height:16px;border:2px solid #173a5e;border-radius:50%;background:#ffffff;box-shadow:0 1px 5px #173a5e;pointer-events:none;transform:translate(-50%,-50%);transition:left 80ms linear,top 80ms linear}';
    document.documentElement.append(style);
    const dot = document.createElement('div');
    dot.id = 'aegis-recording-cursor';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.left = `${Math.round(innerWidth * 0.5)}px`;
    dot.style.top = `${Math.round(innerHeight * 0.5)}px`;
    document.documentElement.append(dot);
    document.addEventListener('pointermove', (event) => {
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
    }, { passive: true });
  };
  if (document.documentElement) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
}

async function typeHuman(locator, text) {
  await locator.click();
  await locator.pressSequentially(text, { delay: 60 });
}

async function smoothScroll(page, top) {
  await page.evaluate((scrollTop) => window.scrollTo({ top: scrollTop, behavior: 'smooth' }), top);
  await wait(900);
}

async function ready(page, selector, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.locator(selector).waitFor({ state: 'visible', timeout: 20_000 });
}

const scenes = {
  'assist-sg-mask': { viewport: { width: 1920, height: 1080 }, async ready(page) { await ready(page, '[data-testid="assist-workspace"]', '/assist'); await page.getByTestId('assist-chat').waitFor(); }, async run(c) {
    const { page, step, hold } = c;
    await step('Choose Singapore guidance', async () => { await page.getByText('Singapore', { exact: true }).click(); await wait(900); });
    await step('Choose chronic lung or heart conditions', async () => { await page.getByText('Chronic lung or heart conditions', { exact: true }).click(); await wait(1000); });
    await step('Ask which mask', async () => { await page.getByRole('button', { name: 'Which mask?', exact: true }).click(); await page.getByTestId('chat-log').getByText(/N95 mask/).first().waitFor({ state: 'visible' }); await wait(1900); });
    await step('Show the cited source line', async () => { await page.getByTestId('chat-log').locator('.assist-chat-source').last().scrollIntoViewIfNeeded(); await wait(1600); });
    await step('Scroll the guidance cards a little', async () => { await page.locator('.assist-left').evaluate((el) => el.scrollTo({ top: 210, behavior: 'smooth' })); await wait(1300); });
    await hold();
  } },
  'assist-my-offline': { viewport: { width: 1920, height: 1080 }, async ready(page) { await ready(page, '[data-testid="assist-workspace"]', '/assist'); await page.getByTestId('assist-chat').waitFor(); }, async run(c) {
    const { page, context, step, hold } = c;
    await step('Show the Malaysia leaflet date and remarks', async () => { await expectText(page, /Based on guidance published in 2008/); await page.getByRole('heading', { name: 'Remarks' }).scrollIntoViewIfNeeded(); await wait(1100); });
    await step('Ask what the weather will be tomorrow', async () => { await typeHuman(page.getByTestId('chat-input'), 'what is the weather tomorrow'); await page.getByTestId('chat-send').click(); await page.getByTestId('chat-log').getByText(/could not match that to the official guidance/).waitFor({ state: 'visible' }); await wait(1300); });
    await step('Go offline and ask which mask', async () => { await context.setOffline(true); await page.getByRole('button', { name: 'Which mask?', exact: true }).click(); await page.getByTestId('chat-log').getByText(/N95 or P100/).first().waitFor({ state: 'visible' }); await wait(1500); });
    await step('Return to the remarks section', async () => { await page.getByRole('heading', { name: 'Remarks' }).scrollIntoViewIfNeeded(); await wait(1200); });
    await hold();
  } },
  'assist-phone': { viewport: { width: 390, height: 844 }, async ready(page) { await ready(page, '[data-testid="assist-chat"]', '/assist'); await page.getByTestId('assist-emergency').waitFor({ state: 'visible' }); }, async run(c) {
    const { page, step, hold } = c;
    await step('Frame the compact header, emergency contact and chat', async () => { await page.mouse.move(190, 210); await wait(1400); });
    await step('Open the Cards sheet', async () => { await page.getByTestId('cards-button').click(); await page.getByRole('dialog', { name: 'Guidance cards' }).waitFor(); await wait(1200); });
    await step('Switch country to Singapore', async () => { await page.getByText('Singapore', { exact: true }).click(); await wait(1100); });
    await step('Close the sheet', async () => { await page.getByTestId('sheet-close').click(); await wait(900); });
    await hold();
  } },
  domains: { viewport: { width: 1920, height: 1080 }, async ready(page) { await ready(page, '.domains-hero img', '/domains'); await page.locator('.domain-card').first().waitFor(); }, async run(c) {
    const { page, step, hold } = c;
    await step('Show the hazard-domain hero and statement', async () => { await page.locator('.domains-statement').scrollIntoViewIfNeeded(); await smoothScroll(page, 0); await wait(1200); });
    await step('Scroll through the seven domain cards', async () => { const cards = page.locator('.domain-card'); for (let i = 0; i < await cards.count(); i += 1) { await cards.nth(i).scrollIntoViewIfNeeded(); await wait(550); } });
    await step('Open the source audit', async () => { const card = page.locator('.domain-card').first(); await card.scrollIntoViewIfNeeded(); await card.locator('.domain-audit summary').click(); await card.getByRole('heading', { name: /Supported by a saved source/ }).waitFor(); await card.getByRole('heading', { name: /Held back: not used/ }).waitFor(); await wait(1700); });
    await hold();
  } },
  'overview-desktop': { viewport: { width: 1920, height: 1080 }, async ready(page) { await ready(page, '.incident-card', '/overview'); await page.locator('.synthetic-strip').waitFor(); }, async run(c) {
    const { page, step, hold } = c;
    await step('Highlight a community from the map legend', async () => { await page.locator('.map-legend-row').first().hover(); await wait(1100); });
    await step('Summarize this incident', async () => { await page.getByRole('button', { name: 'Summarize this incident', exact: true }).click(); await page.getByRole('heading', { name: 'Haze Incident Summary' }).waitFor(); await wait(1700); });
    await step('Suggest required resources', async () => { await page.getByRole('button', { name: 'Suggest required resources', exact: true }).click(); await page.locator('.desktop-assist').getByRole('heading', { name: 'Resource shortfall', exact: true }).waitFor(); await wait(1700); });
    await hold();
  } },
  'overview-phone': { viewport: { width: 390, height: 844 }, async ready(page) { await ready(page, '.incident-card', '/overview'); await page.locator('.synthetic-strip').waitFor(); }, async run(c) {
    const { page, step, hold } = c;
    await step('Scroll the overview from top to bottom', async () => { const height = await page.evaluate(() => document.documentElement.scrollHeight); await smoothScroll(page, Math.round(height * 0.38)); await smoothScroll(page, Math.round(height * 0.72)); await smoothScroll(page, height); await smoothScroll(page, 0); });
    await step('Open the docked AI Assist sheet', async () => { await page.getByRole('button', { name: 'Open AI Assist' }).click(); await page.getByRole('dialog', { name: 'AI Assist' }).waitFor(); await wait(900); });
    await step('Run an incident summary', async () => { await page.getByRole('button', { name: 'Summarize this incident', exact: true }).last().click(); await page.getByRole('heading', { name: 'Haze Incident Summary' }).waitFor(); await wait(1400); });
    await step('Close the Assist sheet', async () => { await page.getByTestId('sheet-close').click(); await wait(900); });
    await hold();
  } },
  'overview-states': { viewport: { width: 1672, height: 941 }, async ready(page, preflight) {
    await ready(page, '.synthetic-strip', '/overview?scenario=unknown');
    await page.getByText('Unknown', { exact: true }).first().waitFor();
    await preflight('Show unknown scenario', async () => wait(1800));
    await preflight('Show empty scenario', async () => { await page.goto('/overview?scenario=empty', { waitUntil: 'domcontentloaded' }); await page.getByText('No affected communities in this data.').waitFor(); await wait(1800); });
    await preflight('Show error scenario', async () => { await page.goto('/overview?scenario=error', { waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: 'The overview could not be loaded' }).waitFor(); await wait(1800); });
  }, async run(c) {
    const { step, hold } = c;
    await step('Hold on the designed error-state card', async () => wait(900));
    await hold();
  } },
  workspace: { viewport: { width: 1920, height: 1080 }, async ready(page) { await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.getByTestId('dev-login-USER-A-COORD').waitFor(); }, async run(c) {
    const { page, step, hold, getSessionToken } = c;
    await step('Sign in as the demo coordinator', async () => { await page.getByTestId('dev-login-USER-A-COORD').click(); await page.locator('[data-testid^="incident-item-"]').first().waitFor(); await wait(1000); });
    await step('Open the first incident and enter resource figures', async () => { await page.locator('[data-testid^="incident-item-"]').first().click(); for (const [id, value] of [['input-demand', '120'], ['input-available', '85'], ['input-reserve', '5']]) await typeHuman(page.getByTestId(id), value); await wait(900); });
    await step('Run the assessment and show the shortfall of 40', async () => { await page.getByTestId('run-assessment').click(); await page.waitForFunction(() => document.querySelector('[data-testid="field-shortfallUnits"]')?.textContent?.includes('40') ?? false); await wait(1600); });
    await step('Verify the audit chain for the signed-in demo tenant', async () => { const result = await page.evaluate(async (token) => { const response = await fetch('/api/audit/verify', { headers: { authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Audit verification request failed'); return await response.json(); }, await getSessionToken()); if (result.valid === false) throw new Error('Audit chain verification reported invalid'); c.auditResult = result; await wait(1000); });
    await hold();
  } },
  'hazard-map': { viewport: { width: 1672, height: 941 }, async ready(page) {
    await ready(page, '[data-testid="hazard-map-stage"]', '/prototype/map');
    await page.getByTestId('hazard-map-stage').waitFor({ state: 'visible' });
    await page.getByTestId('hazard-map-canvas').waitFor({ state: 'visible' });
    await page.getByText('PROTOTYPE', { exact: true }).waitFor({ state: 'visible' });
  }, async run(c) {
    const { page, step, hold } = c;
    const stage = page.getByTestId('hazard-map-stage');
    await step('Show all nine synthetic hazard events', async () => { await page.locator('.hazard-map-event-row').first().waitFor(); await wait(1100); });
    await step('Select an event and show its detail card', async () => { await page.getByRole('button', { name: /Quake zone 1/ }).click(); await page.getByTestId('hazard-map-detail').waitFor(); await wait(1300); });
    await step('Filter to wildfire areas', async () => { await page.getByRole('button', { name: 'Wildfire', exact: true }).click(); await stage.waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelector('[data-testid="hazard-map-stage"]')?.getAttribute('data-events') === '2'); await wait(1200); });
    await step('Restore all events and pause the soft severity pulse', async () => { await page.getByRole('button', { name: 'All', exact: true }).click(); await page.getByRole('button', { name: 'Pause animation' }).click(); await page.getByRole('button', { name: 'Play animation' }).waitFor(); await wait(1200); });
    await hold();
  } },
};

async function expectText(page, expression) {
  const locator = page.getByText(expression).first();
  await locator.waitFor({ state: 'visible' });
}

async function startServer(tempDirectory, port) {
  const dbPath = join(tempDirectory, 'recording.db');
  const child = spawn(process.execPath, [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/api/main.ts'], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, AEGIS_ENV: 'local', AEGIS_DB_PATH: dbPath, AEGIS_MODELS_ENABLED: 'false', AEGIS_PROVIDER_MODE: 'stub', AEGIS_ASSIST_ENABLED: 'true', AEGIS_HOST: '127.0.0.1', PORT: String(port) },
  });
  const origin = `http://127.0.0.1:${port}`;
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 30_000) {
    if (child.exitCode !== null) throw new Error('The local recording server exited before becoming ready.');
    try { const response = await fetch(`${origin}/api/health`); if (response.ok) { ready = true; break; } } catch { /* wait until Fastify listens */ }
    await wait(250);
  }
  if (!ready) { child.kill(); throw new Error('The local recording server did not become ready within 30 seconds.'); }
  return { child, origin };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), wait(8000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function recordScene(id, definition, browser, origin) {
  const outputDirectory = join(recordings, id);
  const tempVideoDirectory = await mkdtemp(join(tmpdir(), 'aegis-video-'));
  await mkdir(outputDirectory, { recursive: true });
  const videoStartedAt = Date.now();
  const context = await browser.newContext({ baseURL: origin, viewport: definition.viewport, deviceScaleFactor: 2, recordVideo: { dir: tempVideoDirectory, size: definition.viewport } });
  const page = await context.newPage();
  const consoleErrors = [];
  const preflightConsoleErrors = [];
  const failedRequests = [];
  const httpFailures = [];
  const absolutePath = (url) => { try { return new URL(url).pathname; } catch { return '[invalid address]'; } };
  let sceneStarted = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const messageText = message.text();
    const event = { type: 'console', path: new URL(page.url() || origin).pathname, message: messageText.slice(0, 240) };
    if (!sceneStarted) { preflightConsoleErrors.push(event); return; }
    if (id === 'workspace' && event.path === '/' && /script-src.*default-src.*fallback/i.test(messageText)) return;
    consoleErrors.push(event);
  });
  page.on('pageerror', (error) => (sceneStarted ? consoleErrors : preflightConsoleErrors).push({ type: 'pageerror', path: new URL(page.url() || origin).pathname, message: error.message.slice(0, 240) }));
  page.on('requestfailed', (request) => failedRequests.push({ path: absolutePath(request.url()), error: request.failure()?.errorText ?? 'request failed' }));
  page.on('response', (response) => { if (response.status() >= 400) httpFailures.push({ path: absolutePath(response.url()), status: response.status() }); });
  let token = null;
  let auditResult = null;
  page.on('response', (response) => {
    if (response.url().endsWith('/api/session') && response.request().method() === 'POST' && response.ok()) void response.json().then((body) => { token = body.token; });
  });
  const steps = [];
  const preflight = async (name, action) => { const item = { name, startedMs: Date.now() - videoStartedAt }; steps.push(item); await action(); item.endedMs = Date.now() - videoStartedAt; };
  await definition.ready(page, preflight);
  await page.evaluate(cursorScript);
  await page.mouse.move(Math.round(definition.viewport.width * 0.48), Math.round(definition.viewport.height * 0.44));
  const sceneStartedAt = Date.now();
  sceneStarted = true;
  const step = async (name, action) => { const item = { name, startedMs: Date.now() - videoStartedAt }; steps.push(item); await action(); item.endedMs = Date.now() - videoStartedAt; };
  const hold = async () => { const remaining = Math.max(0, 22_500 - (Date.now() - sceneStartedAt)); if (remaining > 0) await step('Hold the final composed frame for reading', () => wait(remaining)); };
  try {
    await definition.run({ page, context, step, hold, getSessionToken: async () => { const deadline = Date.now() + 3000; while (!token && Date.now() < deadline) await wait(50); if (!token) throw new Error('The demo session token was not captured.'); return token; }, get auditResult() { return auditResult; }, set auditResult(value) { auditResult = value; } });
    await hold();
    await page.mouse.move(Math.round(definition.viewport.width * 0.83), Math.round(definition.viewport.height * 0.82));
    const checks = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, ready: document.readyState }));
    if (checks.scrollWidth > checks.width) throw new Error(`Scene ${id} has horizontal overflow.`);
    if (consoleErrors.length || failedRequests.length || httpFailures.length) throw new Error(`Scene ${id} had browser errors or failed requests: ${JSON.stringify({ consoleErrors, failedRequests, httpFailures })}`);
    const durationMs = Date.now() - videoStartedAt;
    if (durationMs < 20_000 || durationMs > 45_000) throw new Error(`Scene ${id} duration ${durationMs} ms is outside 20 to 45 seconds.`);
    const screenshotPath = join(outputDirectory, `${id}-end.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
    const video = page.video();
    await context.close();
    if (!video) throw new Error(`Scene ${id} did not produce a video.`);
    await video.saveAs(join(outputDirectory, `${id}.webm`));
    await writeFile(join(outputDirectory, `${id}.json`), `${JSON.stringify({ scene: id, viewport: definition.viewport, durationMs, sceneDurationMs: Date.now() - sceneStartedAt, steps, checks, preflightConsoleErrors, consoleErrors, failedRequests, httpFailures, ...(auditResult ? { auditResult } : {}) }, null, 2)}\n`, 'utf8');
    const bytes = (await stat(join(outputDirectory, `${id}.webm`))).size + (await stat(screenshotPath)).size;
    console.log(`PASS ${id}: ${(durationMs / 1000).toFixed(1)} s; ${(bytes / 1_048_576).toFixed(2)} MiB outputs`);
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  } finally {
    await rm(tempVideoDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const requested = process.argv[2] ?? 'all';
  const ids = requested === 'all' ? baseScenes : [requested];
  if (!ids.every((id) => Object.hasOwn(scenes, id))) throw new Error(`Unknown scene "${requested}". Choose: ${[...baseScenes, 'all'].join(', ')}.`);
  try { await stat(join(root, 'ui', 'dist', 'index.html')); }
  catch { throw new Error('The existing ui/dist build is missing; run npm run build:ui, then retry.'); }
  await mkdir(recordings, { recursive: true });
  const tempDirectory = await mkdtemp(join(tmpdir(), 'aegis-record-server-'));
  let server;
  let browser;
  try {
    const port = await freePort();
    server = await startServer(tempDirectory, port);
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    for (const id of ids) await recordScene(id, scenes[id], browser, server.origin);
  } finally {
    await browser?.close().catch(() => undefined);
    if (server) await stopServer(server.child);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Recording failed.'); process.exitCode = 1; });
