import { expect, test } from '@playwright/test';

// The editable limits on Governance and costs: a pen beside the monthly budget and the auto-approve number; click it and that number becomes a field with a Why box, OK and Cancel.
// The save request is intercepted, so the real budget file is never touched by this spec.
test('pen beside the limits: the number becomes a field, OK needs a change and a reason, the request carries them, a refusal is shown', async ({ page }) => {
  const puts: { monthlyBudgetUsd: string; autoApproveUsd: string; reason: string }[] = [];
  let refuse = false;
  await page.route('**/api/admin/spend-limits', async (route) => {
    puts.push(route.request().postDataJSON() as { monthlyBudgetUsd: string; autoApproveUsd: string; reason: string });
    if (refuse) { await route.fulfill({ status: 400, json: { error: { code: 'E_VALIDATION', message: 'The per-action limit must be between 0.01 USD and the monthly budget (12.00 USD).' } } }); return; }
    await route.fulfill({ json: { ok: true, monthlyBudgetUsd: '12.00', autoApproveUsd: '0.50' } });
  });
  await page.goto('/admin');
  await page.getByTestId('dev-login-DEV-ADMIN').click();
  await page.getByRole('tab', { name: 'Governance and costs' }).click();
  const card = page.locator('[data-card-id="admin:spend"]');
  await expect(card).toBeVisible();
  // only the two limits have a pen; Committed and Remaining are results
  await expect(card.getByRole('button', { name: /^Edit the / })).toHaveCount(2);
  const autoText = await card.getByRole('button', { name: 'Edit the auto-approve up to' }).innerText();
  const currentAuto = Number(autoText.replace(/[^\d.]/g, ''));
  // monthly budget: the pen opens a field, OK stays off until the number changed and a reason is given
  await card.getByRole('button', { name: 'Edit the monthly budget' }).click();
  const monthlyForm = card.getByRole('form', { name: 'Save the monthly budget' });
  const monthly = monthlyForm.getByLabel('Monthly budget (USD)');
  expect(Number(await monthly.inputValue())).toBeGreaterThan(0);           // prefilled with the current limit
  const ok = monthlyForm.getByRole('button', { name: 'OK' });
  await expect(ok).toBeDisabled();                                         // nothing changed yet
  await monthly.fill('12');
  await expect(ok).toBeDisabled();                                         // changed, but no reason
  await monthlyForm.getByLabel('Why').fill('abc');
  await expect(ok).toBeDisabled();                                         // a reason shorter than 5 characters
  await monthlyForm.getByLabel('Why').fill('More render trials for judging');
  await expect(ok).toBeEnabled();
  await ok.click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]!.monthlyBudgetUsd).toBe('12'); expect(Number(puts[0]!.autoApproveUsd)).toBeCloseTo(currentAuto, 4); expect(puts[0]!.reason).toBe('More render trials for judging');
  await expect(card.getByRole('form', { name: 'Save the monthly budget' })).toHaveCount(0);   // closed after OK
  // auto-approve: a refusal from the server is shown inside its box and the box stays open until Cancel
  refuse = true;
  await card.getByRole('button', { name: 'Edit the auto-approve up to' }).click();
  const autoForm = card.getByRole('form', { name: 'Save the auto-approve up to' });
  await autoForm.getByLabel('Auto-approve up to (USD)').fill('30');         // the browser accepts it (max 50) but the server refuses a per-action limit above the monthly budget
  await autoForm.getByLabel('Why').fill('Trying too much');
  await autoForm.getByRole('button', { name: 'OK' }).click();
  await expect(autoForm.getByRole('alert')).toContainText('between 0.01 USD and the monthly budget');
  await autoForm.getByRole('button', { name: 'Cancel' }).click();
  await expect(card.getByRole('button', { name: 'Edit the auto-approve up to' })).toBeVisible();
});

test('Period dropdown and the info icons on the Spend card', async ({ page }) => {
  await page.goto('/admin');
  await page.getByTestId('dev-login-DEV-ADMIN').click();
  await page.getByRole('tab', { name: 'Governance and costs' }).click();
  const card = page.locator('[data-card-id="admin:spend"]');
  await expect(card).toBeVisible();
  const period = card.getByLabel('Period');
  const options = await period.locator('option').allInnerTexts();
  expect(options[0]).toMatch(/\(current\)$/); expect(options).toHaveLength(4);        // the current month and the three before it
  await expect(card.getByRole('button', { name: 'Edit the monthly budget' })).toBeVisible();
  await period.selectOption({ index: 1 });                                            // an earlier month: no figures, said plainly
  await expect(card.getByRole('status')).toContainText('No figures for');
  await expect(card.getByRole('button', { name: 'Edit the monthly budget' })).toHaveCount(0);
  await period.selectOption({ index: 0 });
  await expect(card.getByRole('button', { name: 'Edit the monthly budget' })).toBeVisible();
  // the three lines each have an info icon with a plain explanation
  const credit = card.getByRole('button', { name: 'What does credit coverage assumed mean?' });
  await credit.hover();
  await expect(card.getByRole('tooltip').filter({ hasText: 'billing report' })).toBeVisible();
  await expect(card.getByRole('button', { name: /What do card exposure, unexplained charges/ })).toBeVisible();
});
