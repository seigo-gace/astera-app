import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const resolve = (relativePath) => path.join(root, relativePath);
const read = (relativePath) => fs.readFileSync(resolve(relativePath), 'utf8');

const storyPaths = [
  'tests/user-journey-stories.spec.ts',
  'tests/composer-user-stories.spec.ts',
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
  ['src/platform/pages/AuthPages.tsx', 'TWO_FACTOR_CHALLENGE_REQUIRED'],
  ['src/platform/pages/page-kit.tsx', 'inFlightIdempotentSubmissions'],
  ['src/platform/api-client.ts', 'errorPayload'],
  ['src/platform/api-client.ts', 'idempotencyKey?: string'],
  ['src/platform/route-registry.ts', 'decodePathSegment'],
  ['public/app-interactions.js', 'ASTERA_PROCESS_ALREADY_RUNNING'],
  ['public/app-interactions.js', 'ASTERA_RESPONSE_SECTIONS_INCOMPLETE'],
  ['public/app-interactions.js', "headers.set('Idempotency-Key', requestId)"],
];

const requiredStories = [
  'STORY-AUTH-001',
  'STORY-AUTH-003',
  'STORY-AUTH-004',
  'STORY-CHECKOUT-002',
  'STORY-LOGIN-002',
  'STORY-LOGIN-003',
  'STORY-LOGIN-004',
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
];

const gaps = [];
if (storyIds.length < 28) gaps.push(`STORY_ID_COUNT_TOO_LOW:${storyIds.length}`);
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
    'pricing and checkout login boundary',
    'trusted checkout destination',
    'password setup and two-factor continuation',
    'open redirect rejection',
    'registration validation and duplicate submission',
    'email verification return context',
    'missing reset token and missing 2FA challenge',
    'nested API error visibility',
    'network failure input preservation',
    'preference read/write failure safety',
    'retry without full reload',
    'malformed path fail-closed behavior',
    'plain Enter line breaks and explicit shortcut execution',
    'process request identity and duplicate run prevention',
    'fixed eight-section result validation',
    'composer draft retention after failure',
    'fullscreen input behavior and user message accordion',
  ],
  gaps,
  verdict: gaps.length === 0 ? 'PASS' : 'FAIL',
  evidenceLevel: 'authored-source-only-until-playwright-run-completes',
};

fs.mkdirSync(resolve('audit-results'), { recursive: true });
fs.writeFileSync(resolve('audit-results/user-story-audit.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

if (strict && gaps.length > 0) process.exit(1);
