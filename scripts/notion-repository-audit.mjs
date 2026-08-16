import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const resolve = (relativePath) => path.join(root, relativePath);
const exists = (relativePath) => fs.existsSync(resolve(relativePath));
const read = (relativePath) => fs.readFileSync(resolve(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

const storyFiles = fs.readdirSync(resolve('tests'))
  .filter((name) => name === 'user-journey-stories.spec.ts' || name.endsWith('-user-stories.spec.ts'))
  .sort()
  .map((name) => `tests/${name}`);

const requiredFrontendFiles = [
  'src/platform/route-registry.ts',
  'src/platform/app-router.tsx',
  'src/platform/account-session.tsx',
  'src/platform/CanonicalPages.tsx',
  'src/platform/ResponsivePageShell.tsx',
  'src/platform/pages/AuthPages.tsx',
  'src/platform/pages/AccountPages.tsx',
  'src/platform/pages/WorkspacePages.tsx',
  'src/platform/pages/PublicPages.tsx',
  'src/features/pricing/PricingPage.tsx',
  'src/features/checkout/CheckoutPage.tsx',
  'src/platform/api-client.ts',
  'src/platform/external-navigation.ts',
  'src/platform/deterministic-japanese-mcp-client.ts',
  'src/revision-credit-bridge.ts',
  'public/app-interactions.js',
  'public/process-user-errors.js',
  'public/ui-honesty.js',
  'tests/device-matrix.spec.ts',
  'scripts/user-story-audit.mjs',
  ...storyFiles,
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
  'functions/_account-projection.ts',
  'functions/api/[[path]].ts',
  'functions/api/jobs/estimate.ts',
  'functions/api/jobs/index.ts',
  'contabo/app-api/src/index.ts',
  'contabo/workers/src/index.ts',
  'migrations/d1/0001_identity_billing_credit.sql',
  'migrations/d1/0002_developer_notifications.sql',
  'migrations/d1/0005_revision_credit_provenance.sql',
  'migrations/d1/0007_workspace_result_state.sql',
  'migrations/d1/0008_storage_transfer_state.sql',
  'migrations/d1/0009_result_settlement_trigger.sql',
  'migrations/d1/0010_project_job_access_gate.sql',
  'migrations/d1/0011_share_download_tokens.sql',
  'migrations/d1/0012_notifications_inbox.sql',
  'docs/openapi/openapi.yaml',
  'docs/release-manifest/schema.json',
  'docs/evidence/README.md',
  'docs/brand/asset-recovery-manifest.md',
  'docs/integrations/deterministic-japanese-parser-mcp.md',
  'docs/testing/user-journey-debug-2026-08-04.md',
  'docs/audit/notion-traceability-2026-08-04.json',
  'docs/audit/notion-page-traceability-2026-08-04.md',
  'tsconfig.contracts.json',
];

// Favicon / Apple Touch Icon / OGP / Web App iconは共通正本で別途確認・採用が必要。
// 未承認AssetをCI通過目的で生成・必須化しない。
const requiredLaunchAssets = [];

const sourceMarkers = [
  ['src/platform/app-router.tsx', 'AccountSessionProvider'],
  ['src/platform/route-registry.ts', "route.group === 'auth'"],
  ['src/platform/api-client.ts', 'HISTORY_SEARCH_DEBOUNCE_MS'],
  ['src/features/pricing/PricingPage.tsx', 'CATALOG_TIMEOUT'],
  ['src/features/checkout/CheckoutPage.tsx', 'CHECKOUT_INTENT_TIMEOUT'],
  ['src/platform/pages/AccountPages.tsx', 'API_KEY_SECRET_MISSING'],
  ['src/revision-credit-bridge.ts', 'initializeRevisionCreditBridge'],
  ['src/revision-credit-bridge.ts', 'revision_of_job_id'],
  ['public/app-interactions.js', 'FILE_UPLOAD_PIPELINE_NOT_CONNECTED'],
  ['public/app-interactions.js', 'canonicalSectionsFromObject'],
  ['public/process-user-errors.js', 'AsteraProcessError'],
  ['public/ui-honesty.js', 'PURPOSE_OPTION_SELECTOR'],
  ['scripts/user-story-audit.mjs', 'STORY_ID_COUNT_TOO_LOW'],
];

// Source Gateは現行Build対象のSource実装を確認する。
// Deploy済みかどうかはSource Markerへ混ぜず、Release/Runtime Evidenceへ分離する。
const readinessChecks = [
  ['functions/_account-projection.ts', ['requireAsteraActor', 'ASTERA_DB']],
  ['functions/api/jobs/estimate.ts', ['revisionBillableCharacters', 'promptFingerprint', 'billable_characters']],
  ['functions/api/jobs/index.ts', ['createRuntimeJob', 'credit_reservations', 'requestFingerprint']],
  ['functions/api/[[path]].ts', ['APP_API_ORIGIN', 'APP_API_SERVICE_TOKEN', 'X-Astera-Internal-Authenticated']],
  ['contabo/app-api/src/index.ts', ['export class AsteraRuntimeService', 'validateCreateRequest', 'validateResult']],
  ['contabo/workers/src/index.ts', ['contaboWorkersReadiness', "status: 'contract_source_only'", 'deployed: false']],
];

const scopeExclusions = [
  {
    name: 'Astera deterministic Japanese MCP',
    repository: 'seigo-gace/Deterministic-Japanese-Parser-MCP',
    reason: 'Separate repository, source of truth, deployment unit, and release evidence.',
    appAuditScope: ['connection contract', 'version pinning', 'timeout', 'fail-closed behavior', 'Meaning Graph and Task Graph handoff', 'latency boundary'],
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
  .map((match) => match[1])
  .filter((value, index, array) => array.indexOf(value) === index);
const resolvedIndexAssetReferences = absoluteAssetReferences.map((item) => item.startsWith('src/') ? item : `public/${item}`);
const brokenIndexAssetReferences = resolvedIndexAssetReferences.filter((relativePath) => !exists(relativePath));

const traceabilityPath = 'docs/audit/notion-traceability-2026-08-04.json';
const traceability = exists(traceabilityPath) ? readJson(traceabilityPath) : null;
const traceabilityGroupTotal = traceability?.notionHierarchy?.groups
  ?.reduce((sum, group) => sum + Number(group.count ?? 0), 0) ?? null;

const sourceGaps = [];
for (const file of requiredFrontendFiles) if (!exists(file)) sourceGaps.push(`MISSING_FRONTEND_FILE:${file}`);
for (const file of requiredContractAndEvidenceFiles) if (!exists(file)) sourceGaps.push(`MISSING_CONTRACT_OR_EVIDENCE_FILE:${file}`);
for (const file of requiredLaunchAssets) if (!exists(file)) sourceGaps.push(`MISSING_LAUNCH_ASSET:${file}`);
for (const file of brokenIndexAssetReferences) sourceGaps.push(`BROKEN_INDEX_ASSET_REFERENCE:${file}`);

if (storyFiles.length < 7) sourceGaps.push(`USER_STORY_FILE_COUNT_TOO_LOW:${storyFiles.length}`);
if (declaredRouteCount !== 43 || routeEntries !== 43) sourceGaps.push(`ROUTE_COUNT_MISMATCH:declared=${declaredRouteCount}:detected=${routeEntries}`);

for (const [file, marker] of sourceMarkers) {
  if (!exists(file)) continue;
  if (!read(file).includes(marker)) sourceGaps.push(`SOURCE_MARKER_MISSING:${file}:${marker}`);
}

for (const [file, markers] of readinessChecks) {
  if (!exists(file)) continue;
  const source = read(file);
  for (const marker of markers) if (!source.includes(marker)) sourceGaps.push(`READINESS_MARKER_MISSING:${file}:${marker}`);
}

if (!traceability) {
  sourceGaps.push(`TRACEABILITY_MANIFEST_MISSING:${traceabilityPath}`);
} else {
  if (traceability.notionHierarchy?.pageCount !== 90) sourceGaps.push(`NOTION_PAGE_COUNT_MISMATCH:${traceability.notionHierarchy?.pageCount ?? 'missing'}`);
  if (traceability.notionHierarchy?.unreadPages !== 0) sourceGaps.push(`NOTION_UNREAD_PAGES:${traceability.notionHierarchy?.unreadPages ?? 'missing'}`);
  if (traceabilityGroupTotal !== 90) sourceGaps.push(`NOTION_GROUP_TOTAL_MISMATCH:${traceabilityGroupTotal ?? 'missing'}`);
  if (traceability.verifiedRepositoryReality?.historicLocalCandidateEvidence?.status !== 'not_current_main_evidence') sourceGaps.push('HISTORIC_LOCAL_EVIDENCE_NOT_INVALIDATED');
  if (traceability.verifiedRepositoryReality?.deterministicJapaneseMcp?.mcpStatus !== 'created_in_separate_repository') sourceGaps.push('MCP_SEPARATE_REPOSITORY_STATUS_MISSING');
}

const releaseBlockers = [
  'OFFICIAL_BRAND_BYTES_NOT_RECOVERED',
  'MCP_APP_RUNTIME_CONNECTION_NOT_EXECUTED',
  'CLOUDFLARE_RUNTIME_NOT_DEPLOYED',
  'CONTABO_RUNTIME_NOT_DEPLOYED',
  'D1_MIGRATIONS_NOT_APPLIED',
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
  userStoryFiles: storyFiles,
  scopeExclusions,
  notionHierarchy: traceability?.notionHierarchy ?? null,
  currentMain: {
    frontendFiles: Object.fromEntries(requiredFrontendFiles.map((item) => [item, exists(item)])),
    contractAndEvidenceFiles: Object.fromEntries(requiredContractAndEvidenceFiles.map((item) => [item, exists(item)])),
    launchAssets: Object.fromEntries(requiredLaunchAssets.map((item) => [item, exists(item)])),
    indexAssetReferences: Object.fromEntries(resolvedIndexAssetReferences.map((item) => [item, exists(item)])),
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
  userStoryFiles: storyFiles.length,
  sourceGapCount: sourceGaps.length,
  sourceGaps,
  releaseBlockers,
  report: path.relative(root, outputPath),
}, null, 2));

if (strict && sourceGaps.length > 0) process.exit(1);
