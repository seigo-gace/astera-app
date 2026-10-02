import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'packages/contracts/src/app-events.ts');
const targetPath = resolve(root, 'contabo/app-api/src/generated/app-events.ts');
const banner = '// GENERATED FROM packages/contracts/src/app-events.ts. DO NOT EDIT.\n\n';
const source = await readFile(sourcePath, 'utf8');
const next = `${banner}${source}`;

await mkdir(dirname(targetPath), { recursive: true });
let current = '';
try {
  current = await readFile(targetPath, 'utf8');
} catch {
  // Missing generated output is expected on a clean checkout.
}
if (current !== next) await writeFile(targetPath, next, 'utf8');
