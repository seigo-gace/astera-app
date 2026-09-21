#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');
// Only scan browser-executed / browser-consumed deploy artifacts.
// Source maps can legitimately contain development URLs inside embedded sourceContent;
// they are not executed by the application runtime and must not fail the deploy gate.
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json']);
const LOOPBACK_ORIGIN_WITH_PORT = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+/i;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function main() {
  const distStat = await stat(DIST).catch(() => null);
  if (!distStat?.isDirectory()) {
    throw new Error('Deploy artifact guard: dist/ does not exist. Run the staging frontend build first.');
  }

  const files = await walk(DIST);
  const offenders = [];
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const content = await readFile(file, 'utf8').catch(() => '');
    const match = content.match(LOOPBACK_ORIGIN_WITH_PORT);
    if (match) offenders.push(`${file.slice(DIST.length + 1)} -> ${match[0]}`);
  }

  if (offenders.length > 0) {
    console.error('Deploy artifact guard FAILED: browser runtime artifact contains loopback origin(s).');
    for (const offender of offenders) console.error(`- ${offender}`);
    process.exit(1);
  }

  console.log(`Deploy artifact guard PASS: ${files.length} files checked; no runtime loopback origin with port found.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
