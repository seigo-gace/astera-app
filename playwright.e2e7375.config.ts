import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E7375_BASE_URL || 'http://127.0.0.1:8083';

export default defineConfig({
  testDir: './tests',
  testMatch: 'live-process-main8-e2e.spec.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-e2e7375' }]],
  use: {
    baseURL,
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium-live-e2e7375', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } }],
});
