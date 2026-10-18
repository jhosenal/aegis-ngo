import { expect, test } from '@playwright/test';

// Job cards (a UUID per job), the job credit balance, top-up with a reason, and the presenter render speeds with ETA and cost. The API is stubbed.
const NOW = '2026-10-17T22:30:00.000Z';
const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const jobs = [
  { jobId: uuid(1), kind: 'voice', bulletinId: 'BULL-1', language: 'ms', label: 'Voice (ms)', createdBy: 'DEV-ADMIN', createdAt: NOW, finishedAt: NOW, status: 'DONE', estimateStatus: 'ESTIMATE', estimateUsd: '0.001200', settledUsd: '0.001000', lines: [{ item: 'Text-to-Speech standard voice', quantity: '250', unit: 'character', usd: '0.001000' }], params: {}, note: null, priceBookVersion: '1.6.0' },
  { jobId: uuid(2), kind: 'render', bulletinId: 'BULL-1', language: 'en', label: 'Presenter render (en, fast)', createdBy: 'DEV-ADMIN', createdAt: NOW, finishedAt: null, status: 'ESTIMATED', estimateStatus: 'ESTIMATE', estimateUsd: '0.540000', settledUsd: null, lines: [], params: { speed: 'fast' }, note: 'Requested at fast speed', priceBookVersion: '1.6.0' },
  { jobId: uuid(3), kind: 'translate', bulletinId: 'BULL-1', language: 'zh', label: 'Translate to zh', createdBy: 'DEV-ADMIN', createdAt: NOW, finishedAt: NOW, status: 'DONE', estimateStatus: 'UNKNOWN', estimateUsd: null, settledUsd: null, lines: [], params: {}, note: null, priceBookVersion: null },
];
const wallet = { balanceUsd: '3.458800', openingUsd: '4.000000', topupUsd: '0.000000', reservedUsd: '0.540000', spentUsd: '0.001000', note: 'Job credit: an operating balance for jobs.' };

test('job cards: balance, cards with UUIDs, unknown costs stay unknown, filter and top-up with a reason', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'DEV-ADMIN' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  const topups: unknown[] = []; const queries: string[] = [];
  await page.route('**/api/jobs?**', (r) => { queries.push(r.request().url()); r.fulfill({ json: { wallet, scope: 'all', totalUsd: '0.541000', unknown: 1, jobs } }); });
  await page.route('**/api/admin/credit/topup', (r) => { topups.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true, wallet } }); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/admin?tab=spend');
  const cards = page.getByTestId('job-cards');
  await expect(cards).toBeVisible();
  await expect(page.getByTestId('job-balance')).toHaveText('3.4588 USD');
  await expect(cards.getByRole('article')).toHaveCount(3);
  await expect(cards.getByText(uuid(2))).toBeVisible();
  await expect(cards.getByRole('article', { name: `Job ${uuid(3)}` })).toContainText('UNKNOWN');          // never shown as zero
  await expect(cards.getByRole('article', { name: `Job ${uuid(1)}` })).toContainText('0.0010 USD');
  await cards.getByLabel('Kind').selectOption('render');
  await expect.poll(() => queries.some((q) => q.includes('kind=render'))).toBe(true);
  await cards.getByRole('button', { name: 'Top up' }).click();
  await expect(cards.getByRole('button', { name: 'Add to the credit' })).toBeDisabled();
  await cards.getByLabel('Reason').fill('owner top-up for the render test');
  await cards.getByRole('button', { name: 'Add to the credit' }).click();
  await expect.poll(() => topups[0]).toMatchObject({ amountUsd: 1, note: 'owner top-up for the render test' });
});

test('render speed: Normal, Fast and Max show ETA and cost, Max is greyed when the quota is lower, the request carries the speed', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'DEV-ADMIN' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  const posted: unknown[] = [];
  const opt = (speed: string, parallel: number, eta: number, micro: number, available: boolean) => ({ speed, parallel, instanceSecondsEach: eta, etaSeconds: eta, estimate: { status: 'ESTIMATE', micro }, available, note: available ? `${parallel} GPU job` : `Needs ${parallel} GPUs; the project quota allows 2` });
  const bulletin = { bulletinId: 'BULL-1', slotId: 'emergency', language: 'en', captureAt: NOW, airAt: NOW, generatedAt: NOW, estimatedSeconds: 30, credits: { lines: [] }, segments: [{ id: 'emergency-headline', title: 'Emergency information', text: 'Earthquake: magnitude 6.1.', lowerThird: 'x', durationSec: 5 }] };
  const stored = { ...bulletin, review: { decision: 'APPROVED', decidedBy: 'a', decidedAt: NOW, note: null }, log: [], bulletin, plan: { scenario: 'emergency', output: 'voice_presenter', languages: ['en'], explicit: true },
    steps: [{ seq: 1, step: 'VOICE_READY', at: NOW, by: 'a', mode: 'google-tts', note: null }], timeline: {}, kpi: [], translations: [], editLog: [], protectedSegments: [] };
  await page.route('**/api/admin/screening', (r) => r.fulfill({ json: { now: NOW, languageCatalog: { languages: [] }, approvalRequired: true, draft: { problems: [], bulletin: { estimatedSeconds: 30 } }, stored: [stored] } }));
  await page.route('**/api/admin/screening/bulletin/*', (r) => r.fulfill({ json: { preview: true, bulletin, review: null } }));
  await page.route('**/api/admin/screening/BULL-1/render-options**', (r) => r.fulfill({ json: { bulletinId: 'BULL-1', language: 'en', speechSeconds: 60, maxParallel: 2, assumption: 'An estimate.', options: [opt('normal', 1, 1380, 470000, true), opt('fast', 2, 780, 530000, true), opt('max', 3, 590, 590000, false)] } }));
  await page.route('**/api/admin/screening/BULL-1/presenter', (r) => { posted.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true } }); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/admin?tab=approval');
  await page.getByRole('tab', { name: /^06/ }).click();   // the media controls are in step 06
  const box = page.getByRole('group', { name: 'Presenter render speed' });
  await expect(box).toBeVisible();
  await expect(box.getByText('about 23 min')).toBeVisible(); await expect(box.getByText('about 13 min')).toBeVisible();
  await expect(box.getByText('about 0.47 USD')).toBeVisible();
  await expect(box.getByRole('radio', { name: /Max/ })).toBeDisabled();
  await box.getByRole('radio', { name: /Fast/ }).check();
  await box.getByRole('button', { name: /Request presenter render \(Fast\)/ }).click();
  await expect.poll(() => posted[0]).toMatchObject({ action: 'requested', speed: 'fast' });
});

test('Google bill: gross, credits, net to the card and the by-service table; an unconnected export says estimates only', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'DEV-ADMIN' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  let connected = true;
  await page.route('**/api/jobs?**', (r) => r.fulfill({ json: { wallet, scope: 'all', totalUsd: '0.541000', unknown: 0, jobs: [] } }));
  await page.route('**/api/admin/billing**', (r) => r.fulfill({ json: connected
    ? { report: { available: true, month: '2026-10', costUsd: 4.322458, creditsUsd: -4.322535, netUsd: -0.000077, firstUse: NOW, lastUse: '2026-10-17T10:00:00.000Z', fetchedAt: NOW, note: 'From the Cloud Billing export.', rows: [{ service: 'Cloud Run', costUsd: 4.32245, creditsUsd: -4.322535, netUsd: -0.000085 }, { service: 'Gemini API', costUsd: 0.000008, creditsUsd: 0, netUsd: 0.000008 }, { service: 'Maps API', costUsd: 0, creditsUsd: 0, netUsd: 0 }] }, jobCards: { count: 16, usd: '0.035598', note: 'x' } }
    : { report: { available: false, reason: 'The billing export is not connected on this server.' }, jobCards: { count: 0, usd: '0.000000', note: 'x' } } }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/admin?tab=spend');
  const bill = page.getByTestId('billing-card');
  await expect(bill).toBeVisible();
  await expect(page.getByTestId('billed-net')).toHaveText('0.00 USD');
  await expect(bill).toContainText('4.32 USD');                              // gross
  await expect(bill).toContainText('100%');                                  // covered by credit
  await expect(bill.getByRole('row', { name: /Cloud Run/ })).toBeVisible();
  await expect(bill.getByRole('row', { name: /Maps API/ })).toHaveCount(0);   // zero lines are not listed
  connected = false;
  await bill.getByRole('button', { name: 'Refresh' }).click();
  await expect(bill).toContainText('not connected');
  await expect(bill).toContainText('estimates only');
});
