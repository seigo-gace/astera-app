#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const REQUIRED_FILES = [
  '.vscode/tasks.json',
  '.vscode/extensions.json',
  'scripts/verify/staging-readback.mjs',
  'scripts/verify/checkout-e2e.mjs',
  'playwright.config.ts',
];
const PLAYWRIGHT_EXTENSION = 'ms-playwright.playwright';

function run(command, args, options = {}) {
  try {
    const result = execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    return result ?? '';
  } catch (error) {
    if (options.allowFailure) return null;
    throw error;
  }
}

function commandExists(command) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'sh';
  const args = process.platform === 'win32' ? [command] : ['-lc', `command -v ${command}`];
  return run(finder, args, { allowFailure: true }) !== null;
}

function requireNode22() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22) {
    console.error(`[FAIL] Node ${process.versions.node} is active. Astera requires Node 22.x.`);
    console.error('Load NVM and run: nvm use 22.23.1');
    process.exit(1);
  }
  console.log(`[PASS] Node ${process.versions.node}`);
}

function requireWorkspaceFiles() {
  const missing = REQUIRED_FILES.filter((file) => !existsSync(resolve(ROOT, file)));
  if (missing.length > 0) {
    console.error('[FAIL] VS Code verification files are missing:');
    for (const file of missing) console.error(`  - ${file}`);
    console.error('Update this workspace to a revision containing the VS Code verification tooling, then rerun npm run vscode:setup.');
    process.exit(1);
  }
  console.log('[PASS] VS Code verification files are present.');
}

function verifyTaskDefinitions() {
  const raw = readFileSync(resolve(ROOT, '.vscode/tasks.json'), 'utf8');
  const requiredLabels = [
    'ASTERAv8: Full Verify',
    'ASTERAv8: Staging Read-Back (safe)',
    'ASTERAv8: Quick Workspace Verify',
    'ASTERAv8: Checkout Browser E2E',
    'ASTERAv8: Debug Failed Checkout E2E',
  ];
  const missing = requiredLabels.filter((label) => !raw.includes(label));
  if (missing.length > 0) {
    console.error(`[FAIL] Missing VS Code tasks: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('[PASS] Required VS Code tasks are configured.');
}

function ensureDependencies() {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  const tsc = resolve(ROOT, 'node_modules', '.bin', `tsc${suffix}`);
  const playwrightPackage = resolve(ROOT, 'node_modules', '@playwright', 'test', 'package.json');

  if (existsSync(tsc) && existsSync(playwrightPackage)) {
    console.log('[PASS] Project dependencies are installed.');
    return;
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('[SETUP] Installing project dependencies...');
  run(npm, ['install', '--no-fund', '--no-audit'], { inherit: true });

  if (!existsSync(tsc) || !existsSync(playwrightPackage)) {
    console.error('[FAIL] npm install completed but required development tools are still missing.');
    process.exit(1);
  }
  console.log('[PASS] Project dependencies installed.');
}

function installRecommendedExtension() {
  if (!commandExists('code')) {
    console.warn(`[WARN] VS Code CLI 'code' is not available in this terminal.`);
    console.warn(`[WARN] Open VS Code Extensions and install '${PLAYWRIGHT_EXTENSION}' if VS Code does not offer it automatically.`);
    return;
  }

  const installed = run('code', ['--list-extensions'], { allowFailure: true }) || '';
  const hasExtension = installed
    .split(/\r?\n/)
    .some((entry) => entry.trim().toLowerCase() === PLAYWRIGHT_EXTENSION);

  if (hasExtension) {
    console.log(`[PASS] VS Code extension installed: ${PLAYWRIGHT_EXTENSION}`);
    return;
  }

  console.log(`[SETUP] Installing VS Code extension: ${PLAYWRIGHT_EXTENSION}`);
  const result = run('code', ['--install-extension', PLAYWRIGHT_EXTENSION, '--force'], { allowFailure: true, inherit: true });
  if (result === null) {
    console.warn(`[WARN] Automatic extension installation failed. Install '${PLAYWRIGHT_EXTENSION}' from VS Code Extensions.`);
    return;
  }
  console.log(`[PASS] VS Code extension installed: ${PLAYWRIGHT_EXTENSION}`);
}

function reportRuntime() {
  console.log('');
  console.log('READY:');
  console.log('  Setup / recheck : npm run vscode:setup');
  console.log('  Full Verify     : npm run verify:vscode');
  console.log('  Safe Read-Back  : npm run verify:staging');
  console.log('  Quick Verify    : npm run verify:quick');
  console.log('  Checkout E2E    : npm run verify:checkout:e2e');
  console.log('');
  console.log('VS Code UI: Terminal -> Run Task... -> ASTERAv8: Full Verify');
  console.log('Checkout E2E prefers the official Playwright Docker image when Docker is available.');
  console.log('Safety: setup does not switch branches, stash/reset/clean/push, modify D1, or access Square personal/payment payloads.');
}

console.log('==================================================');
console.log(' ASTERAv8 VS CODE VERIFICATION SETUP');
console.log('==================================================');
requireNode22();
requireWorkspaceFiles();
verifyTaskDefinitions();
ensureDependencies();
installRecommendedExtension();
reportRuntime();
