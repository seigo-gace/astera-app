import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');

const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const requiredFrontendFiles = [
  'src/platform/route-registry.ts',
  'src/platform/app-router.tsx',
  'src/platform/CanonicalPages.tsx',
  'src/platform/ResponsivePageShell.tsx',
  'src/platform/pages/AuthPages.tsx',
  'src/platform/pages/AccountPages.tsx',
  'src/platform/pages/WorkspacePages.tsx',
  'src/platform/pages/PublicPages.tsx',
  'src/features/pricing/PricingPage.tsx',
  'src/features/checkout/CheckoutPage.tsx',
  'src/platform/api-client.ts',
  'tests/device-matrix.spec.ts',
];

// These paths are explicitly named as implementation targets in the current
// Astera App Notion Code/GitHub source-of-truth pages. They must not be called
// "reflected" or "implemented" until the paths exist in this repository.
const notionDeclaredImplementationPaths = [
  'packages/contracts',
  'packages/commercial-contracts',
  'packages/config-schema',
  'cloudflare/functions',
  'contabo/app-api',
  'contabo/workers',
  'migrations/d1',
  'migrations/postgres',
  'docs/openapi',
  'docs/release-manifest',
  'docs/evidence',
];

// Astera's deterministic Japanese MCP was developed as a separate product and
// release unit. Its source belongs to seigo-gace/Deterministic-Japanese-Parser-MCP,
// not to asterа-app. The app audit verifies only the future connection contract;
// it must never report the separate MCP source as an app repository gap.
const scopeExclusions = [
  {
    name: 'Astera deterministic Japanese MCP',
    repository: 'seigo-gace/Deterministic-Japanese-Parser-MCP',
    reason: 'Separate repository, source of truth, deployment unit, and release evidence.',
    appAuditScope: [
      'connection contract',
      'version pinning',
      'timeout',
      'fail-closed behavior',
      'Meaning Graph and Task Graph handoff',
      'latency boundary',
    ],
  },
  {
    name: 'Developer API Skill Runtime',
    repository: null,
    reason: 'Different module from the deterministic Japanese MCP; status must be tracked independently.',
    appAuditScope: ['registry status', 'availability gate', 'key issuance prohibition while unavailable'],
  },
];

const requiredOfficialBrandAssets = [
  'public/logo-mark.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'public/apple-touch-icon.png',
  'public/site.webmanifest',
];

const packageJson = JSON.parse(read('package.json'));
const routeSource = read('src/platform/route-registry.ts');
const routeCountMatch = routeSource.match(/CANONICAL_ROUTE_COUNT\s*=\s*(\d+)/);
const declaredRouteCount = routeCountMatch ? Number(routeCountMatch[1]) : null;
const routeEntries = [...routeSource.matchAll(/\{\s*id:\s*'[^']+'\s*,\s*pattern:/g)].length;

const indexHtml = read('index.html');
const absoluteAssetReferences = [...indexHtml.matchAll(/(?:href|src)="\/(?!\/)([^"?#]+)(?:[?#][^"]*)?"/g)]
  .map((match) => `public/${match[1]}`)
  .filter((value, index, array) => array.indexOf(value) === index);
const brokenIndexAssetReferences = absoluteAssetReferences.filter((relativePath) => !exists(relativePath));

const report = {
  generatedAt: new Date().toISOString(),
  repository: 'seigo-gace/astera-app',
  branch: 'main',
  packageVersion: packageJson.version,
  declaredRouteCount,
  detectedRouteEntries: routeEntries,
  scopeExclusions,
  currentMain: {
    frontendFiles: Object.fromEntries(requiredFrontendFiles.map((item) => [item, exists(item)])),
    notionDeclaredImplementationPaths: Object.fromEntries(notionDeclaredImplementationPaths.map((item) => [item, exists(item)])),
    officialBrandAssets: Object.fromEntries(requiredOfficialBrandAssets.map((item) => [item, exists(item)])),
    indexAssetReferences: Object.fromEntries(absoluteAssetReferences.map((item) => [item, exists(item)])),
  },
  evidenceBoundary: {
    githubActionsRun: 'not provable from repository source',
    cloudflareDeployment: 'not provable from repository source',
    backendSandbox: 'not provable from repository source',
    physicalDevices: 'not provable from repository source',
    rule: 'Source presence and authored tests must never be reported as executed external evidence.',
  },
};

const missingFrontendFiles = requiredFrontendFiles.filter((item) => !exists(item));
const missingNotionPaths = notionDeclaredImplementationPaths.filter((item) => !exists(item));
const missingBrandAssets = requiredOfficialBrandAssets.filter((item) => !exists(item));
const routeMismatch = declaredRouteCount !== 43 || routeEntries !== 43;

const hardGaps = [
  ...missingFrontendFiles.map((item) => `MISSING_FRONTEND_FILE:${item}`),
  ...missingNotionPaths.map((item) => `NOTION_DECLARED_BUT_MISSING:${item}`),
  ...missingBrandAssets.map((item) => `MISSING_OFFICIAL_BRAND_ASSET:${item}`),
  ...brokenIndexAssetReferences.map((item) => `BROKEN_INDEX_ASSET_REFERENCE:${item}`),
  ...(routeMismatch ? [`ROUTE_COUNT_MISMATCH:declared=${declaredRouteCount}:detected=${routeEntries}`] : []),
];

report.hardGaps = hardGaps;
report.verdict = hardGaps.length === 0 ? 'PASS' : 'FAIL';

const outputDir = path.join(root, 'audit-results');
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'notion-repository-audit.json');
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  verdict: report.verdict,
  packageVersion: report.packageVersion,
  routes: `${routeEntries}/${declaredRouteCount ?? 'unknown'}`,
  scopeExclusions: scopeExclusions.map((item) => item.name),
  hardGapCount: hardGaps.length,
  hardGaps,
  report: path.relative(root, outputPath),
}, null, 2));

if (strict && hardGaps.length > 0) process.exit(1);
