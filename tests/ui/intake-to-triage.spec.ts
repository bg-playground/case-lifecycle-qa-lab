import { expect, test } from '@playwright/test';
import { Bgstm } from '../support/bgstm.js';
import { VALID_INTAKE } from '../support/DxApiClient.js';

test(
  'TC-CLM-001 claimant completes Intake and the claim moves to Triage',
  { annotation: [Bgstm.requirement('REQ-CLM-001')], tag: ['@ui', '@lifecycle'] },
  async ({ page }) => {
    await page.goto('/');

    const stages = page.getByRole('navigation', { name: 'Case stages' });
    await expect(page.getByRole('heading', { level: 2, name: 'Collect incident details' })).toBeVisible();
    await expect(stages.getByRole('listitem').filter({ hasText: 'Intake' })).toHaveAttribute('aria-current', 'step');

    // Test-ID locators (Constellation-style "<testId>:input").
    await page.getByTestId('fullName:input').fill(VALID_INTAKE.fullName);
    await page.getByTestId('email:input').fill(VALID_INTAKE.email);
    await page.getByTestId('phone:input').fill(VALID_INTAKE.phone);
    await page.getByTestId('policyNumber:input').fill(VALID_INTAKE.policyNumber);
    // Role/label locators work too, because every control has a real label.
    await page.getByRole('textbox', { name: 'Vehicle VIN' }).fill(VALID_INTAKE.vin);
    await page.getByLabel('Incident date').fill(VALID_INTAKE.incidentDate);
    await page.getByRole('textbox', { name: 'What happened?' }).fill(VALID_INTAKE.description);

    // The action button has no test ID (mirrors the documented gap), so use its role.
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(page.getByRole('status')).toHaveText(/^Claim C-\d+ moved to Triage\.$/);
    await expect(stages.getByRole('listitem').filter({ hasText: 'Triage' })).toHaveAttribute('aria-current', 'step');
    await expect(stages.getByRole('listitem').filter({ hasText: 'Intake' })).not.toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { level: 2, name: 'Assign severity' })).toBeVisible();
    await expect(page.getByTestId('severity:input')).toBeVisible();
    await expect(page.getByRole('alert')).toBeHidden();
  },
);
