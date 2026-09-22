#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const REPO = process.env.ASTERA_GITHUB_REPO || 'seigo-gace/astera-app';
const WORKFLOW = process.env.ASTERA_STAGING_WORKFLOW || 'pages-staging.yml';
const STAGING_ORIGIN = (process.env.ASTERA_STAGING_ORIGIN || 'https://staging.asterav8.jp').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.ASTERA_VERIFY_TIMEOUT_MS || 15000);

const results = [];

function record(status, name, detail) {
  results.push({ status, name, detail });
  const stream = status === 'FAIL' ? process.stderr : process.stdout;
  stream.write(`[${status}] ${name}: ${detail}\n`);
}

function pass(name, detail) {
  record('PASS', name, detail);
}

function warn(name, detail) {
  record('WARN', name, detail);
}

function fail(name, detail) {
  record('FAIL', name, detail);
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

async function request(url, { json = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: json ? 'application/vnd.github+json, application/json' : 'text/plain, application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'astera-vscode-verifier',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return json ? response.json() : response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function containsAll(source, values) {
  return values.every((value) => source.includes(value));
}

function localWorkspaceDiagnostics() {
  const branch = git(['branch', '--show-current']) || 'UNKNOWN';
  const head = git(['rev-parse', 'HEAD']) || 'UNKNOWN';
  const status = git(['status', '--porcelain=v1', '-uall']);
  const clean = status !== null && status.length === 0;

  console.log('');
  console.log('LOCAL_WORKSPACE:');
  console.log(`branch=${branch}`);
  console.log(`HEAD=${head}`);
  console.log(`clean=${clean ? 'YES' : 'NO'}`);

  return { branch, head, clean };
}

async function main() {
  console.log('==================================================');
  console.log(' ASTERAv8 STAGING READ-BACK (SAFE / READ-ONLY)');
  console.log('==================================================');
  console.log('This verifier does not switch branches, stash/reset files, push, write D1,');
  console.log('or read Square payloads/personal data. Local workspace state is diagnostic only.');

  const local = localWorkspaceDiagnostics();

  let mainSha = '';
  try {
    const branch = await request(`https://api.github.com/repos/${REPO}/branches/main`, { json: true });
    mainSha = branch?.commit?.sha || '';
    if (mainSha) pass('REMOTE_MAIN', mainSha);
    else fail('REMOTE_MAIN', 'main SHA missing from GitHub response');
  } catch (error) {
    fail('REMOTE_MAIN', error instanceof Error ? error.message : String(error));
  }

  if (mainSha && local.head === mainSha && local.branch === 'main' && local.clean) {
    pass('LOCAL_WORKSPACE_MATCH', 'local main is clean and matches deployed verification target');
  } else {
    warn(
      'LOCAL_WORKSPACE_MATCH',
      `local branch=${local.branch}, HEAD=${local.head}, clean=${local.clean ? 'YES' : 'NO'}; staging read-back continues without modifying it`,
    );
  }

  let workflowRun = null;
  if (mainSha) {
    try {
      const workflow = await request(
        `https://api.github.com/repos/${REPO}/actions/workflows/${encodeURIComponent(WORKFLOW)}/runs?branch=main&per_page=20`,
        { json: true },
      );
      const runs = Array.isArray(workflow?.workflow_runs) ? workflow.workflow_runs : [];
      workflowRun = runs.find((run) => run?.head_sha === mainSha) || null;
      if (!workflowRun) {
        fail('GITHUB_ACTIONS', `no ${WORKFLOW} run found for ${mainSha}`);
      } else if (workflowRun.status !== 'completed' || workflowRun.conclusion !== 'success') {
        fail(
          'GITHUB_ACTIONS',
          `run=${workflowRun.id} status=${workflowRun.status || 'missing'} conclusion=${workflowRun.conclusion || 'missing'} sha=${workflowRun.head_sha || 'missing'}`,
        );
      } else {
        pass('GITHUB_ACTIONS', `run=${workflowRun.id} conclusion=success sha=${workflowRun.head_sha}`);
      }
    } catch (error) {
      fail('GITHUB_ACTIONS', error instanceof Error ? error.message : String(error));
    }
  }

  let marker = null;
  try {
    marker = await request(`${STAGING_ORIGIN}/__staging_deployment.json?verify=${Date.now()}`, { json: true });
    const markerSha = marker?.github_sha || '';
    const markerBranch = marker?.branch || '';
    const authMode = marker?.auth_mode || '';
    if (markerSha && markerBranch === 'main' && authMode === 'real') {
      pass('STAGING_MARKER', `sha=${markerSha} branch=${markerBranch} auth_mode=${authMode}`);
    } else {
      fail(
        'STAGING_MARKER',
        `sha=${markerSha || 'missing'} branch=${markerBranch || 'missing'} auth_mode=${authMode || 'missing'}`,
      );
    }
  } catch (error) {
    fail('STAGING_MARKER', error instanceof Error ? error.message : String(error));
  }

  if (mainSha && workflowRun?.head_sha && marker?.github_sha) {
    const match = mainSha === workflowRun.head_sha && mainSha === marker.github_sha;
    if (match) pass('SHA_MATCH', `main/actions/staging=${mainSha}`);
    else {
      fail(
        'SHA_MATCH',
        `main=${mainSha} actions=${workflowRun.head_sha || 'missing'} staging=${marker.github_sha || 'missing'}`,
      );
    }
  } else {
    fail('SHA_MATCH', 'one or more SHA authorities are unavailable');
  }

  if (mainSha) {
    try {
      const rawBase = `https://raw.githubusercontent.com/${REPO}/${mainSha}`;
      const [security, checkout, contractTest, resilienceTest] = await Promise.all([
        request(`${rawBase}/src/features/checkout/checkout-security.ts`),
        request(`${rawBase}/src/features/checkout/CheckoutPage.tsx`),
        request(`${rawBase}/tests/checkout-security-contract.test.mjs`),
        request(`${rawBase}/tests/checkout-resilience-user-stories.spec.ts`),
      ]);

      const validatorOk = containsAll(security, [
        "url.protocol !== 'https:'",
        "host === 'square.link'",
        "host === 'sandbox.square.link'",
        "host.endsWith('.squareupsandbox.com')",
        "host.endsWith('.square.site')",
        "host.endsWith('.squareup.com')",
      ]);
      validatorOk
        ? pass('CHECKOUT_URL_VALIDATOR', 'HTTPS-only Square allowlist includes sandbox and production checkout hosts')
        : fail('CHECKOUT_URL_VALIDATOR', 'expected HTTPS-only Square allowlist is incomplete');

      const classifierOk = containsAll(security, [
        "status === 401",
        "'login-required'",
        "status === 403 && code === 'FRESH_SESSION_REQUIRED'",
        "'reauth-required'",
        'authentication: null',
      ]);
      classifierOk
        ? pass('AUTH_CLASSIFIER', '401=login, fresh 403=reauth, other errors preserved')
        : fail('AUTH_CLASSIFIER', 'shared checkout authentication classifier is incomplete');

      const sharedKinds = containsAll(checkout, [
        'type CheckoutKind = "plan" | "credit" | "storage"',
        'readCheckoutResponseError(response, `${kind.toUpperCase()}_CATALOG_HTTP_${response.status}`)',
        'readCheckoutResponseError(response, `CHECKOUT_INTENT_HTTP_${response.status}`)',
      ]);
      if (sharedKinds) {
        pass('PLAN_AUTH_CLASSIFICATION', 'plan uses the shared checkout classifier');
        pass('CREDIT_AUTH_CLASSIFICATION', 'credit uses the shared checkout classifier');
        pass('STORAGE_AUTH_CLASSIFICATION', 'storage uses the shared checkout classifier');
      } else {
        fail('PLAN_AUTH_CLASSIFICATION', 'shared plan/credit/storage checkout path could not be verified');
        fail('CREDIT_AUTH_CLASSIFICATION', 'shared plan/credit/storage checkout path could not be verified');
        fail('STORAGE_AUTH_CLASSIFICATION', 'shared plan/credit/storage checkout path could not be verified');
      }

      const contractOk = containsAll(contractTest, [
        'https://sandbox.square.link/u/test',
        'https://checkout.squareupsandbox.com/pay/test',
        'http://sandbox.square.link/u/test',
        'https://squareupsandbox.com.evil.example/pay/test',
        'https://square.link.evil.example/u/test',
        'FRESH_SESSION_REQUIRED',
      ]);
      contractOk
        ? pass('CHECKOUT_CONTRACT_TEST', 'sandbox/production allowlist and auth classification contract cases are present')
        : fail('CHECKOUT_CONTRACT_TEST', 'expected checkout security contract cases are incomplete');

      const storiesOk = ['STORY-CHECKOUT-003', 'STORY-CHECKOUT-004', 'STORY-CHECKOUT-005', 'STORY-CHECKOUT-006']
        .every((story) => resilienceTest.includes(story));
      storiesOk
        ? pass('CHECKOUT_BROWSER_STORIES', 'duplicate, reauth, 401, and non-auth 403 stories are present')
        : fail('CHECKOUT_BROWSER_STORIES', 'one or more checkout resilience stories are missing');
    } catch (error) {
      fail('DEPLOYED_SOURCE_CONTRACTS', error instanceof Error ? error.message : String(error));
    }
  }

  pass(
    'PRIVACY_BOUNDARY',
    'verifier accessed only GitHub source/deploy metadata and public staging marker; no D1, private billing, Square payload, or Square personal data',
  );

  console.log('');
  console.log('SUMMARY:');
  for (const result of results) {
    console.log(`${result.name}=${result.status}`);
  }

  const failures = results.filter((result) => result.status === 'FAIL');
  const warnings = results.filter((result) => result.status === 'WARN');
  console.log(`FAILURES=${failures.length}`);
  console.log(`WARNINGS=${warnings.length}`);
  console.log(`OVERALL=${failures.length === 0 ? 'SUCCESS' : 'FAILED'}`);

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[FAIL] UNHANDLED: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
