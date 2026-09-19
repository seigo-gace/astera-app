#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const IMAGE = process.env.ASTERA_PLAYWRIGHT_IMAGE || 'mcr.microsoft.com/playwright:v1.62.0-noble';
const TEST_ARGS = [
  'playwright',
  'test',
  'tests/checkout-resilience-user-stories.spec.ts',
  '--project=chromium-desktop',
  '--workers=1',
];

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      ...options,
    });
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

function ensureDependencies() {
  const playwrightPackage = resolve(ROOT, 'node_modules', '@playwright', 'test', 'package.json');
  if (!existsSync(playwrightPackage)) {
    console.error('[FAIL] Project dependencies are not installed. Run: npm run vscode:setup');
    process.exit(1);
  }
}

function directDockerAvailable() {
  return commandExists('docker') && run('docker', ['info'], { allowFailure: true }) !== null;
}

function passwordlessSudoDockerAvailable() {
  if (!commandExists('sudo')) return false;
  return run('sudo', ['-n', 'docker', 'info'], { allowFailure: true }) !== null;
}

function runDocker(prefix) {
  if (process.platform === 'win32') return false;

  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : '1000';
  const gid = typeof process.getgid === 'function' ? String(process.getgid()) : '1000';
  const dockerArgs = [
    'run',
    '--rm',
    '--init',
    '--ipc=host',
    '--user', `${uid}:${gid}`,
    '-e', 'HOME=/tmp',
    '-e', 'CI=1',
    '-e', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    '-v', `${ROOT}:/work`,
    '-w', '/work',
    IMAGE,
    'bash',
    '-lc',
    'npx playwright test tests/checkout-resilience-user-stories.spec.ts --project=chromium-desktop --workers=1',
  ];

  console.log(`[E2E] Running in official Playwright container: ${IMAGE}`);
  if (prefix === 'sudo') {
    run('sudo', ['docker', ...dockerArgs], { inherit: true });
  } else {
    run('docker', dockerArgs, { inherit: true });
  }
  return true;
}

function runLocal() {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  console.log('[E2E] Docker is unavailable; running local Playwright.');
  run(npx, TEST_ARGS, { inherit: true });
}

console.log('==================================================');
console.log(' ASTERAv8 CHECKOUT E2E');
console.log('==================================================');
console.log('No Square payload/personal data, D1 writes, branch changes, reset/clean/push.');

ensureDependencies();

if (process.env.ASTERA_PLAYWRIGHT_MODE === 'local') {
  runLocal();
} else if (directDockerAvailable()) {
  runDocker('docker');
} else if (passwordlessSudoDockerAvailable()) {
  runDocker('sudo');
} else {
  runLocal();
}
