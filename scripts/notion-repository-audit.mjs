import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const resolve = (relativePath) => path.join(root, relativePath);
const exists = (relativePath) => fs.existsSync(resolve(relativePath));
const read = (relativePath) => fs.readFileSync(resolve(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

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
  'src/platform/deterministic-japanese-mcp-client.ts',
  'tests/device-matrix.spec.ts',
];

const requiredContractAndEvidenceFiles = [
  'packages/contracts/src/auth.ts',
  'packages/contracts/src/billing.ts',
  'packages/contracts/src/jobs.ts',
  'packages/contracts/src/results.ts',
  'packages/contracts/src/developer-api.ts',
  'packages/contracts/src/mcp.ts',
  'packages/contracts/src/index.ts',
  'packages/commercial-contracts/src/index.ts',
  'packages/config-schema/src/index.ts',
  'cloudflare/functions/src/index.ts',
  'contabo/app-api/src/index.ts',
  'contabo/workers/src/index.ts',
  'migrations/d1/0001_identity_billing_credit.sql',
  'migrations/d1/0002_developer_notifications.sql',
  'migrations/postgres/0001_results_projects_shares.sql',
  'docs/openapi/openapi.yaml',
  'docs/release-manifest/schema.json',
  'docs/evidence/README.md',
  'docs/brand/asset-recovery-manifest.md',
  'docs/integrations/deterministic-japanese-parser-mcp.md',
  'docs/audit/notion-traceability-2026-08-04.json',
  'docs/audit/notion-page-traceability-2026-08-04.md',
  'tsconfig.contracts.json',
];

const requiredOfficialBrandAssets = [
  'public/logo-mark.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'public/apple-touch-icon.png',
  'public/site.webmanifest',
];

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
    reason: 'Different unfinished module from the deterministic Japanese MCP.',
    appAuditScope: ['registry status', 'availability gate', 'key issuance prohibition while unavailable'],
  },
];

const packageJson = readJson('package.json');
const routeSource = read('src/platform/route-registry.ts');
const routeCountMatch = routeSource.match(/CANONICAL_ROUTE_COUNT\s*=\s*(\d+)/);
const declaredRouteCount = routeCountMatch ? Number(routeCountMatch[1]) : null;
const routeEntries = [...routeSource.matchAll(/\{\s*id:\s*'[^']+'\s*,\s*pattern:/g)].length;

const indexHtml = read('index.html');
const absoluteAssetReferences = [...indexHtml.matchAll(/(?:href|src)="\/(?!\/)([^"?#]+)(?:[?#][^"]*)?"/g)]
  .map((match) => `public/${match[1]}`)
  .filter((value, index, array) => array.indexOf(value) === index);
const brokenIndexAssetReferences = absoluteAssetReferences.filter((relativePath) => !exists(relativePath));

const traceabilityPath = 'docs/audit/notion-traceability-2026-08-04.json';
const traceability = exists(traceabilityPath) ? readJson(traceabilityPath) : null;
const traceabilityGroupTotal = traceability?.notionHierarchy?.groups
  ?.reduce((sum, group) => sum + Number(group.count ?? 0), 0) ?? null;

const readinessChecks = [
  {
    path: 'cloudflare/functions/src/index.ts',
    expected: ["status: 'contract_source_only'", 'deployed: false'],
  },
  {
    path: 'contabo/app-api/src/index.ts',
    expected: ["status: 'contract_source_only'", 'deployed: false', 'deterministicJapaneseMcpConnected: false'],
  },
  {
    path: 'contabo/workers/src/index.ts',
    expected: ["status: 'contract_source_only'", 'deployed: false'],
  },
];

const readinessMismatches = readinessChecks.flatMap(({ path: relativePath, expected }) => {
  if (!exists(relativePath)) return [`READINESS_FILE_MISSING:${relativePath}`];
  const source = read(relativePath);
  return expected
    .filter((marker) => !source.includes(marker))
    .map((marker) => `READINESS_MARKER_MISSING:${relativePath}:${marker}`);
});

const missingFrontendFiles = requiredFrontendFiles.filter((item) => !exists(item));
const missingContractAndEvidenceFiles = requiredContractAndEvidenceFiles.filter((item) => !exists(item));
const missingBrandAssets = requiredOfficialBrandAssets.filter((item) => !exists(item));
const routeMismatch = declaredRouteCount !== 43 || routeEntries !== 43;

const traceabilityGaps = [];
if (!traceability) {
  traceabilityGaps.push(`TRACEABILITY_MANIFEST_MISSING:${traceabilityPath}`);
} else {
  if (traceability.notionHierarchy?.pageCount !== 90) {
    traceabilityGaps.push(`NOTION_PAGE_COUNT_MISMATCH:${traceability.notionHierarchy?.pageCount ?? 'missing'}`);
  }
  if (traceability.notionHierarchy?.unreadPages !== 0) {
    traceabilityGaps.push(`NOTION_UNREAD_PAGES:${traceability.notionHierarchy?.unreadPages ?? 'missing'}`);
  }
  if (traceabilityGroupTotal !== 90) {
    traceabilityGaps.push(`NOTION_GROUP_TOTAL_MISMATCH:${traceabilityGroupTotal ?? 'missing'}`);
  }
  if (traceability.verifiedRepositoryReality?.historicLocalCandidateEvidence?.status !== 'not_current_main_evidence') {
    traceabilityGaps.push('HISTORIC_LOCAL_EVIDENCE_NOT_INVALIDATED');
  }
  if (traceability.verifiedRepositoryReality?.deterministicJapaneseMcp?.mcpStatus !== 'created_in_separate_repository') {
    traceabilityGaps.push('MCP_SEPARATE_REPOSITORY_STATUS_MISSING');
  }
}

const sourceGaps = [
  ...missingFrontendFiles.map((item) => `MISSING_FRONTEND_FILE:${item}`),
  ...missingContractAndEvidenceFiles.map((item) => `MISSING_CONTRACT_OR_EVIDENCE_FILE:${item}`),
  ...missingBrandAssets.map((item) => `MISSING_OFFICIAL_BRAND_ASSET:${item}`),
  ...brokenIndexAssetReferences.map((item) => `BROKEN_INDEX_ASSET_REFERENCE:${item}`),
  ...readinessMismatches,
  ...traceabilityGaps,
  ...(routeMismatch ? [`ROUTE_COUNT_MISMATCH:declared=${declaredRouteCount}:detected=${routeEntries}`] : []),
];

const releaseBlockers = [
  'OFFICIAL_BRAND_BYTES_NOT_RECOVERED',
  'MCP_APP_RUNTIME_CONNECTION_NOT_EXECUTED',
  'CLOUDFLARE_RUNTIME_NOT_DEPLOYED',
  'CONTABO_RUNTIME_NOT_DEPLOYED',
  'D1_MIGRATIONS_NOT_APPLIED',
  'POSTGRES_MIGRATIONS_NOT_APPLIED',
  'SQUARE_OAUTH_STORAGE_VAULT_SANDBOX_NOT_EXECUTED',
  'GITHUB_ACTIONS_SUCCESS_NOT_CONFIRMED',
  'BROWSER_EMULATOR_SIMULATOR_PHYSICAL_DEVICE_EVIDENCE_NOT_CONFIRMED',
];

const report = {
  generatedAt: new Date().toISOString(),
  repository: 'seigo-gace/astera-app',
  branch: 'main',
  packageVersion: packageJson.version,
  declaredRouteCount,
  detectedRouteEntries: routeEntries,
  scopeExclusions,
  notionHierarchy: traceability?.notionHierarchy ?? null,
  currentMain: {
    frontendFiles: Object.fromEntries(requiredFrontendFiles.map((item) => [item, exists(item)])),
    contractAndEvidenceFiles: Object.fromEntries(requiredContractAndEvidenceFiles.map((item) => [item, exists(item)])),
    officialBrandAssets: Object.fromEntries(requiredOfficialBrandAssets.map((item) => [item, exists(item)])),
    indexAssetReferences: Object.fromEntries(absoluteAssetReferences.map((item) => [item, exists(item)])),
  },
  evidenceBoundary: {
    githubActionsRun: 'not confirmed by current repository evidence',
    cloudflareDeployment: 'not confirmed',
    backendSandbox: 'not confirmed',
    emulatorSimulatorPhysicalDevices: 'not confirmed',
    rule: 'Design, source presence and authored tests never prove executed external evidence.',
  },
  sourceGaps,
  releaseBlockers,
  sourceVerdict: sourceGaps.length === 0 ? 'PASS' : 'FAIL',
  releaseVerdict: releaseBlockers.length === 0 ? 'GO' : 'NO-GO',
};

const outputDir = resolve('audit-results');
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'notion-repository-audit.json');
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  sourceVerdict: report.sourceVerdict,
  releaseVerdict: report.releaseVerdict,
  packageVersion: report.packageVersion,
  routes: `${routeEntries}/${declaredRouteCount ?? 'unknown'}`,
  notionPages: traceability?.notionHierarchy?.pageCount ?? 'unknown',
  scopeExclusions: scopeExclusions.map((item) => item.name),
  sourceGapCount: sourceGaps.length,
  sourceGaps,
  releaseBlockers,
  report: path.relative(root, outputPath),
}, null, 2));

if (strict && sourceGaps.length > 0) process.exit(1);
