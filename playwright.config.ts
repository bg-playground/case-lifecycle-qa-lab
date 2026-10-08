import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.MOCK_PORT ?? 3333);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: {
    // Visual baselines are Linux/Chromium; allow tiny anti-aliasing noise only.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: BASE_URL,
    // Constellation-style test IDs render as data-testid="<testId>:input".
    // A Theme UI-Kit (Traditional UI) app would set this to 'data-test-id'.
    testIdAttribute: 'data-testid',
    trace: 'on',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start:mock',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { MOCK_PORT: String(PORT) },
  },
});
