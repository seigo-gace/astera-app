import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const resolve = (relativePath) => path.join(root, relativePath);
const read = (relativePath) => fs.readFileSync(resolve(relativePath), 'utf8');

const storyPaths = [
  'tests/user-journey-stories.spec.ts',
  'tests/composer-user-stories.spec.ts',
  'tests/canonical-result-user-stories.spec.ts',
  'tests/process-boundary-user-stories.spec.ts',
  'tests/checkout-resilience-user-stories.spec.ts',
  'tests/ui-honesty-user-stories.spec.ts',
  'tests/account-commercial-user-stories.spec.ts',
];
const storySources = Object.fromEntries(storyPaths.map((relativePath) => [relativePath, read(relativePath)]));
const combinedStorySource = Object.values(storySources).join('\n');
const journeySource = storySources['tests/user-journey-stories.spec.ts'];

function arrayLiteralEntries(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

const storyIds = [...new Set(combinedStorySource.match(/STORY-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}/g) ?? [])].sort();
const protectedPaths = arrayLiteralEntries(journeySource, 'protectedPaths');
const publicPaths = arrayLiteralEntries(journeySource, 'publicPaths');
const composerStoryIds = storyIds.filter((storyId) => storyId.startsWith('STORY-COMPOSER-'));

const sourceRequirements = [
  ['src/platform/app-router.tsx', 'route.access === \'authenticated\''],
  ['src/platform/app-router.tsx', 'AccountSessionProvider'],
  ['src/platform/ResponsivePageShell.tsx', 'useVerifiedAccountSession'],
  ['src/platform/pages/AuthPages.tsx', 'requiredAuthenticationPath'],
  ['src/platform/pages/AuthPages.tsx', 'RESET_TOKEN_REQUIRED'],
  ['src/platform/pages/AuthPages.tsx', "state.auth_stage === 'pending_2fa'"],
  ['src/platform/pages/AuthPages.tsx', '/api/auth/two-factor/verify-totp'],
  ['src/platform/pages/AuthPages.tsx', '/api/auth/two-factor/verify-backup-code'],
  ['src/platform/pages/page-kit.tsx', 'inFlightIdempotentSubmissions'],
  ['src/platform/api-client.ts', 'HISTORY_SEARCH_DEBOUNCE_MS'],
  ['src/platform/api-client.ts', 'errorPayload'],
  ['src/platform/api-client.ts', 'idempotencyKey?: string'],
  ['src/platform/route-registry.ts', "route.group === 'auth'"],
  ['src/platform/route-registry.ts', 'decodePathSegment'],
  ['src/features/pricing/PricingPage.tsx', 'CATALOG_TIMEOUT'],
  ['src/features/checkout/CheckoutPage.tsx', 'checkoutRef'],
  ['src/features/checkout/CheckoutPage.tsx', 'CHECKOUT_INTENT_TIMEOUT'],
  ['src/platform/pages/AccountPages.tsx', '成功したように見せる空POSTは行いません。'],
  ['src/platform/pages/AccountPages.tsx', 'creditProducts'],
  ['src/platform/pages/AccountPages.tsx', 'targetCanIssue'],
  ['src/platform/pages/AccountPages.tsx', 'API_KEY_SECRET_MISSING'],
  ['public/app-interactions.js', 'ASTERA_PROCESS_ALREADY_RUNNING'],
  ['public/app-interactions.js', 'ASTERA_RESPONSE_SECTIONS_INCOMPLETE'],
  ['public/app-interactions.js', 'canonicalSectionsFromObject'],
  ['public/app-interactions.js', 'FILE_UPLOAD_PIPELINE_NOT_CONNECTED'],
  ['public/app-interactions.js', 'ASTERA_INPUT_TOO_LARGE'],
  ['public/app-interactions.js', "headers.set('Idempotency-Key', requestId)"],
  ['public/ui-honesty.js', 'PURPOSE_OPTION_SELECTOR'],
  ['public/ui-honesty.js', 'data-project-source-unavailable'],
  ['public/ui-honesty.js', 'data-session-settings-notice'],
  ['functions/_auth.ts', 'expiresIn: 60 * 60 * 24 * 7'],
  ['functions/_auth.ts', 'updateAge: 60 * 60 * 24'],
  ['functions/_auth.ts', 'freshAge: 60 * 15'],
  ['functions/_account-projection.ts', 'requireFreshAsteraActor'],
  ['functions/api/billing/checkout-intents.ts', 'requireFreshAsteraActor'],
  ['functions/api/auth/[[path]].ts', 'FRESH_MANAGEMENT_PATHS'],
  ['functions/api/auth/[[path]].ts', "'/api/auth/passkey/add-passkey'"],
  ['functions/api/auth/[[path]].ts', "'/api/auth/two-factor/enable'"],
];

const forbiddenSourceMarkers = [
  ['functions/api/[[path]].ts', "headers.set('X-Astera-Email'"],
  ['contabo/app-api/src/workspace-api.ts', "headers.get('x-astera-email')"],
];

const requiredStories = [
  'STORY-AUTH-001',
  'STORY-AUTH-003',
  'STORY-AUTH-004',
  'STORY-CHECKOUT-002',
  'STORY-CHECKOUT-003',
  'STORY-LOGIN-002',
  'STORY-LOGIN-003',
  'STORY-LOGIN-004',
  'STORY-LOGIN-005',
  'STORY-REGISTER-002',
  'STORY-VERIFY-001',
  'STORY-PASSWORD-001',
  'STORY-2FA-001',
  'STORY-ERROR-001',
  'STORY-ERROR-002',
  'STORY-SETTINGS-001',
  'STORY-SETTINGS-002',
  'STORY-RECOVERY-001',
  'STORY-ROUTE-001',
  'STORY-COMPOSER-001',
  'STORY-COMPOSER-002',
  'STORY-COMPOSER-003',
  'STORY-COMPOSER-004',
  'STORY-COMPOSER-005',
  'STORY-COMPOSER-006',
  'STORY-COMPOSER-007',
  'STORY-COMPOSER-008',
  'STORY-RESULT-001',
  'STORY-PROCESS-001',
  'STORY-PROCESS-002',
  'STORY-PROCESS-003',
  'STORY-UI-001',
  'STORY-UI-002',
  'STORY-UI-003',
  'STORY-PRICING-001',
  'STORY-HISTORY-001',
  'STORY-SECURITY-001',
  'STORY-CREDIT-001',
  'STORY-CREDIT-002',
  'STORY-DEVELOPER-001',
  'STORY-DEVELOPER-002',
];

const gaps = [];
if (storyIds.length < 48) gaps.push(`STORY_ID_COUNT_TOO_LOW:${storyIds.length}`);
if (composerStoryIds.length < 8) gaps.push(`COMPOSER_STORY_COUNT_TOO_LOW:${composerStoryIds.length}`);
if (protectedPaths.length < 20) gaps.push(`PROTECTED_PATH_COUNT_TOO_LOW:${protectedPaths.length}`);
if (publicPaths.length < 5) gaps.push(`PUBLIC_PATH_COUNT_TOO_LOW:${publicPaths.length}`);

for (const relativePath of storyPaths) {
  if (!fs.existsSync(resolve(relativePath))) gaps.push(`STORY_FILE_MISSING:${relativePath}`);
}

for (const storyId of requiredStories) {
  if (!storyIds.includes(storyId)) gaps.push(`REQUIRED_STORY_MISSING:${storyId}`);
}

for (const [relativePath, marker] of sourceRequirements) {
  if (!fs.existsSync(resolve(relativePath))) {
    gaps.push(`SOURCE_FILE_MISSING:${relativePath}`);
    continue;
  }
  if (!read(relativePath).includes(marker)) gaps.push(`SOURCE_MARKER_MISSING:${relativePath}:${marker}`);
}

for (const [relativePath, marker] of forbiddenSourceMarkers) {
  if (!fs.existsSync(resolve(relativePath))) {
    gaps.push(`SOURCE_FILE_MISSING:${relativePath}`);
    continue;
  }
  if (read(relativePath).includes(marker)) gaps.push(`FORBIDDEN_SOURCE_MARKER_PRESENT:${relativePath}:${marker}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  storyFiles: storyPaths,
  storyIds,
  counts: {
    uniqueStoryTests: storyIds.length,
    composerStoryTests: composerStoryIds.length,
    protectedRoutesExercised: protectedPaths.length,
    publicRoutesExercised: publicPaths.length,
    minimumUserJourneyAssertions: storyIds.length + protectedPaths.length + publicPaths.length,
  },
  representativeProjects: ['chromium-desktop', 'webkit-iphone-large'],
  coverage: [
    'authenticated route redirect and exact return context',
    'account state continuation and security hold',
    'single account projection per protected page',
    'authentication return-loop prevention',
    'pricing failure recovery and catalog timeout boundary',
    'history search debounce',
    'pricing and checkout login boundary',
    'trusted checkout destination and duplicate intent prevention',
    'password setup and two-factor continuation',
    'open redirect rejection',
    'registration validation and duplicate submission',
    'email verification return context',
    'reset token validation and pending_2fa session verification',
    'nested API error visibility',
    'network failure input preservation',
    'preference read/write failure safety',
    'retry without full reload',
    'malformed path fail-closed behavior',
    'plain Enter line breaks and explicit shortcut execution',
    'process request identity and duplicate run prevention',
    'fixed eight-section result validation',
    'canonical eight-key object normalization',
    'unresolved attachment data fail-closed behavior',
    '200000-character input boundary',
    'non-JSON process response rejection',
    'single Purpose selection',
    'disabled unavailable Project Source controls',
    'session-only legacy Settings disclosure',
    'disabled incomplete Passkey and 2FA mutations',
    'catalog-owned Credit products and Checkout URL trust',
    'Developer target availability and one-time Secret handling',
    'composer draft retention after failure',
    'fullscreen input behavior and user message accordion',
    'Cloudflare-to-Contabo PII boundary does not forward account email',
    'seven-day rolling session with 24-hour refresh and 15-minute fresh-session gate',
    'fresh-session enforcement for checkout and sensitive authentication management actions',
  ],
  gaps,
  verdict: gaps.length === 0 ? 'PASS' : 'FAIL',
  evidenceLevel: 'authored-source-only-until-playwright-run-completes',
};

fs.mkdirSync(resolve('audit-results'), { recursive: true });
fs.writeFileSync(resolve('audit-results/user-story-audit.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

if (strict && gaps.length > 0) process.exit(1);
