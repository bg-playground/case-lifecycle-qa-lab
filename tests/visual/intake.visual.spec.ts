import { expect, test, type Page } from '@playwright/test';
import { Bgstm } from '../support/bgstm.js';

// Fixed viewport and a bundled web font (Inter, served by the mock) keep the
// rendering stable across machines. The case ID and SLA timestamps change on
// every run, so they are masked.
test.use({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', timezoneId: 'America/New_York' });

async function openIntake(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'Collect incident details' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return [page.getByTestId('caseId:text'), page.getByTestId('sla:text')];
}

test(
  'TC-CLM-004 Intake screen matches its visual baseline (empty and validation states)',
  { annotation: [Bgstm.requirement('REQ-CLM-004')], tag: ['@visual'] },
  async ({ page }) => {
    const mask = await openIntake(page);
    await expect(page).toHaveScreenshot('intake-empty.png', { fullPage: true, mask });

    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByRole('alert')).toHaveText('Validation failed');
    await expect(page).toHaveScreenshot('intake-validation.png', { fullPage: true, mask });
  },
);
