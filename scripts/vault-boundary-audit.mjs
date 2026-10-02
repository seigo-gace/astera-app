import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'functions', 'contabo', 'packages'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_PARTS = new Set(['node_modules', 'dist', 'build', '.wrangler', 'coverage']);

// Astera App must consume cryptographic and secret-management capabilities through
// Libral Vault APIs. Direct GPG/OpenPGP/GnuPG integration belongs behind Vault and
// must not re-enter the App codebase.
const FORBIDDEN = [
  { name: 'gpg executable/API', pattern: /(?:^|[^a-z0-9])gpg(?:2)?(?:[^a-z0-9]|$)/i },
  { name: 'GnuPG', pattern: /gnupg/i },
  { name: 'OpenPGP', pattern: /openpgp/i },
  { name: 'GPG Core', pattern: /gpg[-_ ]?core/i },
  { name: 'Aegis PGP', pattern: /aegis[-_ ]?pgp/i },
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_PARTS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) yield path;
  }
}

const failures = [];
for (const rootName of SCAN_ROOTS) {
  const root = join(ROOT, rootName);
  try {
    if (!(await stat(root)).isDirectory()) continue;
  } catch {
    continue;
  }
  for await (const path of walk(root)) {
    const text = await readFile(path, 'utf8');
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(text)) failures.push(`${relative(ROOT, path)}: direct ${rule.name} reference`);
    }
  }
}

const requiredVaultFiles = [
  'contabo/app-api/src/vault-client.ts',
  'contabo/billing-service/src/feature/libral-vault.ts',
];
for (const file of requiredVaultFiles) {
  try {
    const text = await readFile(join(ROOT, file), 'utf8');
    if (!/Libral Vault|VaultClient|LibralVault/i.test(text)) failures.push(`${file}: Vault client contract missing`);
  } catch {
    failures.push(`${file}: required Vault integration file missing`);
  }
}

if (failures.length) {
  console.error(`Vault boundary audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Vault boundary audit PASS: no direct GPG/OpenPGP/GnuPG integration in Astera App runtime source.');
