import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_LIVE_PROCESS_BASE_URL || 'http://127.0.0.1:8083';

export default defineConfig({
  testDir: './tests',
  testMatch: 'live-process-main8-e2e.spec.ts',
  outputDir: process.env.E2E_LIVE_PROCESS_OUTPUT_DIR || '/tmp/playwright-e2e-live-process-test-results',
  timeout: 180_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: process.env.E2E_LIVE_PROCESS_REPORT_DIR || '/tmp/playwright-report-e2e-live-process' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium-live-e2e-process', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } }],
});
