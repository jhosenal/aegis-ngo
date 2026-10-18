import { expect, test } from '@playwright/test';

// News approval, pipeline panel (AEG-NEWS-007): scenario, output, languages (tick and +), timing against targets, and the emergency bulletin. The API is stubbed.
const catalog = [
  { code: 'en', label: 'English', native: 'English', group: 'pilot', state: 'active' }, { code: 'ms', label: 'Malay', native: 'Bahasa Melayu', group: 'pilot', state: 'locked' },
  { code: 'zh', label: 'Mandarin (Simplified)', native: '中文', group: 'pilot', state: 'locked' }, { code: 'ta', label: 'Tamil', native: 'தமிழ்', group: 'pilot', state: 'locked' },
  { code: 'th', label: 'Thai', native: 'ไทย', group: 'asean', state: 'locked' }, { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt', group: 'asean', state: 'locked' },
];
const NOW = '2026-10-17T22:30:00.000Z';
const bulletin = { bulletinId: 'BULL-1', slotId: '07:00', language: 'en', captureAt: '2026-10-17T22:00:00.000Z', airAt: '2026-10-17T23:00:00.000Z', generatedAt: '2026-10-17T22:00:30.000Z', estimatedSeconds: 60, credits: { lines: [] }, segments: [{ id: 'headline', text: 'Good morning.', lowerThird: 'x', durationSec: 5 }] };
const kpi = [
  { id: 'draft', label: 'Script drafted and checked', target: 'within 2 min of the capture', dueAt: null, doneAt: bulletin.generatedAt, actualMs: 30000, status: 'ok' },
  { id: 'approval', label: 'Approved by an administrator', target: 'at least 15 min before air time', dueAt: '2026-10-17T22:45:00.000Z', doneAt: null, actualMs: null, status: 'at_risk' },
  { id: 'voice', label: 'Voice ready', target: 'within 5 min of approval', dueAt: null, doneAt: null, actualMs: null, status: 'pending' },
  { id: 'presenter', label: 'Presenter ready', target: 'by air time', dueAt: bulletin.airAt, doneAt: null, actualMs: null, status: 'pending' },
];

test('news approval pipeline: scenario, timing rows, languages with tick and plus, and an emergency draft', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'DEV-ADMIN' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  let languages = ['en']; const plans: unknown[] = []; let emergencyBody: unknown = null;
  const stored = () => ({ ...bulletin, review: null, log: [], bulletin, plan: { scenario: 'daily', output: 'voice_presenter', languages, explicit: false }, steps: [], timeline: {}, kpi });
  await page.route('**/api/admin/screening', (r) => r.fulfill({ json: { now: NOW, languageCatalog: { languages: catalog }, approvalRequired: true, draft: { problems: [], bulletin: { estimatedSeconds: 60 } }, stored: [stored()] } }));
  await page.route('**/api/admin/screening/bulletin/*', (r) => r.fulfill({ json: { preview: true, bulletin, review: null } }));
  await page.route('**/api/admin/screening/BULL-1/plan', (r) => { const b = r.request().postDataJSON() as { languages?: string[] }; plans.push(b); if (b.languages) languages = ['en', ...b.languages.filter((c) => c !== 'en')]; r.fulfill({ json: { ok: true } }); });
  await page.route('**/api/admin/screening/emergency/candidates', (r) => r.fulfill({ json: { now: NOW, candidates: [{ evidenceId: 'EV-9', title: 'M 6.1 - 20 km NE of Kota Kinabalu, Malaysia', hazardType: 'EARTHQUAKE', alertLevel: 'ORANGE', eventTime: NOW, sourceId: 'SRC.USGS.LIVE' }] } }));
  await page.route('**/api/admin/screening/emergency', (r) => { emergencyBody = r.request().postDataJSON(); r.fulfill({ json: { ok: true, bulletinId: 'BULL-E1', estimatedSeconds: 30, note: 'Draft made and checked. It is not published until an administrator approves it.' } }); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/admin?tab=approval&preview=1');
  await page.getByRole('button', { name: /^07:00/ }).click();
  // the map preview (in the Preview landing page dialog) starts locked (page scrolls, map does not trap it); the button unlocks and locks it again
  await page.getByRole('button', { name: 'Preview landing page' }).click();
  const lock = page.getByRole('button', { name: /^(Un)?[Ll]ock map$/ });
  await expect(lock).toHaveAttribute('aria-label', 'Unlock map');
  await expect(page.locator('.news-approval-frame')).toHaveCSS('pointer-events', 'none');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-label', 'Lock map');
  await expect(page.locator('.news-approval-frame')).toHaveCSS('pointer-events', 'auto');
  await lock.click();
  await expect(page.locator('.news-approval-frame')).toHaveCSS('pointer-events', 'none');
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('tab', { name: /^06/ }).click();   // the media controls are in step 06
  const panel = page.getByTestId('news-pipeline');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('DAILY');
  await expect(panel.getByRole('listitem')).toHaveCount(4);
  await expect(panel.getByRole('listitem').nth(1)).toContainText('At risk');
  await expect(panel.getByRole('listitem').nth(0)).toContainText('On target');
  await expect(panel.getByRole('radio', { name: 'Voice, then presenter' })).toBeChecked();
  // languages (step 04): English ticked and fixed, a + to add others, and they are stubs
  await page.getByRole('tab', { name: /^04/ }).click();
  const langs = page.getByTestId('news-languages-part').getByRole('group', { name: 'Languages' });
  await expect(langs.getByRole('button', { name: /English/ })).toBeDisabled();
  await expect(langs).toContainText('translated on request');
  await langs.getByRole('button', { name: 'Add a language' }).click();
  const menu = langs.getByRole('group', { name: 'Add a language' });
  await expect(menu).toContainText('Pilot countries');
  await expect(menu).toContainText('Other ASEAN languages');
  await menu.getByRole('button', { name: /Thai/ }).click();
  await expect.poll(() => plans.length).toBe(1);
  expect(plans[0]).toEqual({ languages: ['en', 'th'] });
  await expect(langs.getByRole('button', { name: /Thai/ })).toHaveAttribute('aria-pressed', 'true');
  await langs.getByRole('button', { name: /Thai/ }).click();                // untick
  await expect.poll(() => plans.length).toBe(2);
  expect(plans[1]).toEqual({ languages: ['en'] });
  // emergency (step 01)
  await page.getByRole('tab', { name: /^01/ }).click();
  const emergency = page.getByTestId('news-emergency');
  await emergency.getByRole('button', { name: 'New emergency bulletin' }).click();
  const dialog = page.getByRole('dialog', { name: 'New emergency bulletin' });
  await expect(dialog).toContainText('never an official warning');
  await expect(dialog.getByRole('combobox')).toContainText('ORANGE · M 6.1');
  await dialog.getByRole('radio', { name: 'Voice only' }).check();
  await dialog.getByRole('button', { name: 'Create emergency draft' }).click();
  await expect(emergency).toContainText('not published until an administrator approves it');
  expect(emergencyBody).toEqual({ evidenceId: 'EV-9', output: 'voice' });
});
