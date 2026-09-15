import { defineConfig } from '@playwright/test';

const previewPort = process.env.PLAYWRIGHT_PREVIEW_PORT ?? '4173';
const canonicalPreviewPort = process.env.PLAYWRIGHT_CANONICAL_PREVIEW_PORT ?? '4174';
const baseURL = `http://127.0.0.1:${previewPort}`;
const canonicalBaseURL = `http://127.0.0.1:${canonicalPreviewPort}`;

function project(
  name: string,
  browserName: 'chromium' | 'webkit',
  width: number,
  height: number,
  options: {
    touch?: boolean;
    mobile?: boolean;
    scale?: number;
    base?: string;
    testMatch?: string | RegExp;
    testIgnore?: string | RegExp;
  } = {},
) {
  return {
    name,
    testMatch: options.testMatch,
    testIgnore: options.testIgnore,
    use: {
      browserName,
      baseURL: options.base ?? baseURL,
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
  testIgnore: '**/live-process-main8-e2e.spec.ts',
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
  webServer: [
    {
      command: `VITE_PREVIEW_WITHOUT_AUTH=true VITE_E2E_BUILD_OUT_DIR=pages-dist npm run build && npm run preview -- --host 127.0.0.1 --port ${previewPort}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        CI: '1',
        VITE_ASTERA_API_BASE: baseURL,
        VITE_PREVIEW_WITHOUT_AUTH: 'true',
        VITE_E2E_CANONICAL_COMPOSER: 'false',
      },
    },
    {
      command: `VITE_PREVIEW_WITHOUT_AUTH=true VITE_E2E_CANONICAL_COMPOSER=true VITE_E2E_BUILD_OUT_DIR=pages-dist-canonical-e2e npm run build && npm run preview -- --host 127.0.0.1 --port ${canonicalPreviewPort} --outDir pages-dist-canonical-e2e`,
      url: canonicalBaseURL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        CI: '1',
        VITE_ASTERA_API_BASE: canonicalBaseURL,
        VITE_PREVIEW_WITHOUT_AUTH: 'true',
        VITE_E2E_CANONICAL_COMPOSER: 'true',
      },
    },
  ],
  projects: [
    project('webkit-iphone-small', 'webkit', 320, 568, { touch: true, mobile: true, scale: 2, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('webkit-iphone-large', 'webkit', 430, 932, { touch: true, mobile: true, scale: 3, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('webkit-iphone-landscape', 'webkit', 844, 390, { touch: true, mobile: true, scale: 3, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('webkit-ipad-split', 'webkit', 375, 1024, { touch: true, mobile: true, scale: 2, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('webkit-ipad-full', 'webkit', 1024, 1366, { touch: true, mobile: true, scale: 2, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('chromium-android-small', 'chromium', 360, 640, { touch: true, mobile: true, scale: 3, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('chromium-android-large', 'chromium', 412, 915, { touch: true, mobile: true, scale: 2.625, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('chromium-android-landscape', 'chromium', 915, 412, { touch: true, mobile: true, scale: 2.625, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('chromium-tablet', 'chromium', 800, 1280, { touch: true, mobile: true, scale: 2, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('chromium-foldable', 'chromium', 673, 841, { touch: true, mobile: true, scale: 2, testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('chromium-desktop', 'chromium', 1440, 900, { testIgnore: '**/ui-honesty-user-stories.spec.ts' }),
    project('ui-honesty-chromium-desktop', 'chromium', 1440, 900, {
      base: canonicalBaseURL,
      testMatch: '**/ui-honesty-user-stories.spec.ts',
    }),
    project('ui-honesty-webkit-iphone-large', 'webkit', 430, 932, {
      touch: true,
      mobile: true,
      scale: 3,
      base: canonicalBaseURL,
      testMatch: '**/ui-honesty-user-stories.spec.ts',
    }),
  ],
});
