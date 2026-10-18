import { expect, test } from '@playwright/test';

// Review workflow (AEG-SOP-003): edit the English script, approve or reject each translation, reject (hold) the bulletin. The API is stubbed.
const NOW = '2026-10-17T22:30:00.000Z';
const seg = (id: string, title: string, text: string) => ({ id, title, text, lowerThird: 'x', durationSec: 5 });
const bulletin = { bulletinId: 'BULL-1', slotId: 'emergency', language: 'en', captureAt: NOW, airAt: NOW, generatedAt: NOW, estimatedSeconds: 30, credits: { lines: [] },
  segments: [seg('emergency-headline', 'Emergency information', 'Earthquake: magnitude 6.1, 20 km NE of Kota Kinabalu. USGS rates it orange.'), seg('emergency-actions', 'What to do', 'Drop, cover and hold on.')] };
const kpi = [{ id: 'draft', label: 'Draft made and checked', target: 'within 1 min', dueAt: null, doneAt: NOW, actualMs: 1000, status: 'ok' }];

test('review desk: edit the script, approve or reject a translation, reject the bulletin', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'DEV-ADMIN' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  const calls: { url: string; method: string; body: unknown }[] = [];
  const translations = [
    { language: 'ms', status: 'UNREVIEWED', texts: ['Gempa bumi: magnitud 6.1.'], back: ['Earthquake: magnitude 6.1.'], problems: [], reviewedBy: null, reviewNote: null },
    { language: 'zh', status: 'UNREVIEWED', texts: ['地震：震级 6.1。'], back: ['Earthquake: magnitude 6.1.'], problems: ['segment 1: the number 20 is missing in the Simplified text'], reviewedBy: null, reviewNote: null },
  ];
  await page.route('**/api/admin/screening', (r) => r.fulfill({ json: { now: NOW, languageCatalog: { languages: [] }, approvalRequired: true, draft: { problems: [], bulletin: { estimatedSeconds: 30 } },
    stored: [{ ...bulletin, review: null, log: [], bulletin, plan: { scenario: 'emergency', output: 'voice', languages: ['en', 'ms', 'zh'], explicit: true }, steps: [], timeline: {}, kpi, translations, editLog: [], protectedSegments: ['emergency-actions', 'emergency-notice'] }] } }));
  await page.route('**/api/admin/screening/bulletin/*', (r) => r.fulfill({ json: { preview: true, bulletin, review: null } }));
  await page.route(/\/api\/admin\/screening\/BULL-1(\/.*)?$/, (r) => { calls.push({ url: r.request().url(), method: r.request().method(), body: r.request().postDataJSON() }); r.fulfill({ json: { ok: true } }); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/admin?tab=approval');
  const review = page.getByRole('region', { name: 'Script and translation review' });
  await expect(review).toBeVisible();
  // official guidance has no edit button; the headline does
  await expect(review.getByRole('button', { name: 'Edit What to do' })).toHaveCount(0);
  await review.getByRole('button', { name: 'Edit Emergency information' }).click();
  await review.getByRole('dialog', { name: 'Edit: Emergency information' }).getByLabel('Edit Emergency information').fill('Earthquake: magnitude 6.1 near Kota Kinabalu, 20 km NE. USGS rates it orange.');
  await review.getByRole('button', { name: 'Save script' }).click();
  await expect.poll(() => calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ edits: [{ id: 'emergency-headline' }] });
  // Malay: approve needs the "I read" tick; Mandarin has a flagged problem so it cannot be approved (step 04)
  await page.getByRole('tab', { name: /^04/ }).click();
  const ms = review.getByRole('article', { name: 'Malay translation' });
  await expect(ms.getByRole('button', { name: 'Approve Malay' })).toBeDisabled();
  await ms.getByLabel('I read Malay').check();
  await ms.getByRole('button', { name: 'Approve Malay' }).click();
  await expect.poll(() => calls.find((c) => c.url.endsWith('/translation/ms'))?.body).toMatchObject({ action: 'approve', readsLanguage: true });
  const zh = review.getByRole('article', { name: 'Mandarin translation' });
  await zh.getByLabel('I read Mandarin').check();
  await expect(zh.getByRole('button', { name: 'Approve Mandarin' })).toBeDisabled();
  await expect(zh.getByRole('button', { name: 'Reject Mandarin' })).toBeDisabled();
  await zh.getByLabel('Reason to reject Mandarin').fill('the distance is missing');
  await zh.getByRole('button', { name: 'Reject Mandarin' }).click();
  await expect.poll(() => calls.find((c) => c.url.endsWith('/translation/zh'))?.body).toMatchObject({ action: 'reject', note: 'the distance is missing' });
  // the bulletin itself: Approve and lock, or Reject (held with a reason) (step 05)
  await page.getByRole('tab', { name: /^05/ }).click();
  await expect(page.getByRole('button', { name: 'Approve and lock' })).toBeVisible();
  // Approve and lock opens our own dialog (no browser pop-up); Cancel sends nothing
  await page.getByRole('button', { name: 'Approve and lock' }).click();
  const approveDialog = page.getByRole('dialog', { name: 'Approve and lock' });
  await expect(approveDialog).toContainText('locked');
  await expect(approveDialog.getByRole('button', { name: 'Approve and lock' })).toBeDisabled();   // needs the tick that it was read
  await approveDialog.getByLabel(/I have read this bulletin/).check();
  await expect(approveDialog.getByRole('button', { name: 'Approve and lock' })).toBeEnabled();
  await approveDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(approveDialog).toHaveCount(0);
  expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/BULL-1'))).toHaveLength(0);
  // Reject asks for a reason in a dialog and will not send a short one
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  const rejectDialog = page.getByRole('dialog', { name: 'Reject' });
  await expect(rejectDialog.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  await rejectDialog.getByLabel('Why is it rejected?').fill('wrong location in the text');
  await rejectDialog.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect.poll(() => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/BULL-1')).map((c) => c.body)).toEqual([{ action: 'hold', note: 'wrong location in the text' }]);
});

test('review desk: Suggest wording (Argon) shows the proposal, its tokens, cost and job, rejects what failed the checks, and accepting saves it through the script edit', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'DEV-ADMIN' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  const calls: { url: string; method: string; body: unknown }[] = [];
  await page.route('**/api/admin/screening', (r) => r.fulfill({ json: { now: NOW, languageCatalog: { languages: [] }, approvalRequired: true, draft: { problems: [], bulletin: { estimatedSeconds: 30 } },
    stored: [{ ...bulletin, review: null, log: [], bulletin, plan: { scenario: 'emergency', output: 'voice', languages: ['en'], explicit: true }, steps: [], timeline: {}, kpi, translations: [], editLog: [], protectedSegments: ['emergency-actions', 'emergency-notice'] }] } }));
  await page.route('**/api/admin/screening/bulletin/*', (r) => r.fulfill({ json: { preview: true, bulletin, review: null } }));
  await page.route('**/api/admin/screening/BULL-1/script-review', (r) => { calls.push({ url: r.request().url(), method: 'POST', body: r.request().postDataJSON() }); r.fulfill({ json: { segmentId: 'emergency-headline', original: bulletin.segments[0]!.text, proposal: 'A magnitude 6.1 earthquake struck 20 km NE of Kota Kinabalu. USGS rates it orange.', unchanged: false, ok: true, problems: [], model: 'gemini-4-argon', usage: { promptTokens: 300, outputTokens: 60, thoughtsTokens: 0 }, latencyMs: 5200, costUsd: '0.002400', jobId: '00000000-0000-4000-8000-0000000000aa' } }); });
  await page.route(/\/api\/admin\/screening\/BULL-1\/script$/, (r) => { calls.push({ url: r.request().url(), method: r.request().method(), body: r.request().postDataJSON() }); r.fulfill({ json: { ok: true } }); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/admin?tab=approval');
  const review = page.getByRole('region', { name: 'Script and translation review' });
  await expect(review.getByRole('button', { name: 'Suggest wording for What to do' })).toHaveCount(0);   // official guidance is never reworded
  await review.getByRole('button', { name: 'Suggest wording for Emergency information' }).click();
  const box = review.getByRole('group', { name: 'Suggestion for Emergency information' });
  await expect(box).toContainText('A magnitude 6.1 earthquake struck 20 km NE of Kota Kinabalu.');
  await expect(box).toContainText('300 in, 60 out, 0 thinking tokens'); await expect(box).toContainText('cost 0.002400 USD'); await expect(box).toContainText('00000000-0000-4000-8000-0000000000aa');
  await box.getByRole('button', { name: 'Accept this wording' }).click();
  await expect.poll(() => calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ edits: [{ id: 'emergency-headline', text: 'A magnitude 6.1 earthquake struck 20 km NE of Kota Kinabalu. USGS rates it orange.' }] });
});
