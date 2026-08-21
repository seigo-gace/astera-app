import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

function project(
  name: string,
  browserName: 'chromium' | 'webkit',
  width: number,
  height: number,
  options: { touch?: boolean; mobile?: boolean; scale?: number } = {},
) {
  return {
    name,
    use: {
      browserName,
      baseURL,
      viewport: { width, height },
      screen: { width, height },
      deviceScaleFactor: options.scale ?? 1,
      hasTouch: options.touch ?? false,
      isMobile: options.mobile ?? false,
      locale: 'ja-JP',
      colorScheme: 'dark' as const,
    },
  };
}

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: 4,
  retries: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_ASTERA_API_BASE: baseURL,
    },
  },
  projects: [
    project('webkit-iphone-small', 'webkit', 320, 568, { touch: true, mobile: true, scale: 2 }),
    project('webkit-iphone-large', 'webkit', 430, 932, { touch: true, mobile: true, scale: 3 }),
    project('webkit-iphone-landscape', 'webkit', 844, 390, { touch: true, mobile: true, scale: 3 }),
    project('webkit-ipad-split', 'webkit', 375, 1024, { touch: true, mobile: true, scale: 2 }),
    project('webkit-ipad-full', 'webkit', 1024, 1366, { touch: true, mobile: true, scale: 2 }),
    project('chromium-android-small', 'chromium', 360, 640, { touch: true, mobile: true, scale: 3 }),
    project('chromium-android-large', 'chromium', 412, 915, { touch: true, mobile: true, scale: 2.625 }),
    project('chromium-android-landscape', 'chromium', 915, 412, { touch: true, mobile: true, scale: 2.625 }),
    project('chromium-tablet', 'chromium', 800, 1280, { touch: true, mobile: true, scale: 2 }),
    project('chromium-foldable', 'chromium', 673, 841, { touch: true, mobile: true, scale: 2 }),
    project('chromium-desktop', 'chromium', 1440, 900),
  ],
});
