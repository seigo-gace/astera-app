import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const SOURCE_REPOSITORY = 'seigo-gace/astera-hp';
const SOURCE_COMMIT = 'aa8a40d84dee94c81bf614cbd19adf307593f87e';
const OUTPUT_DIRECTORY = 'public/assets/astera';
const TREE_API = `https://api.github.com/repos/${SOURCE_REPOSITORY}/git/trees/${SOURCE_COMMIT}?recursive=1`;

const EXPECTED = Object.freeze({
  'astera-symbol-light.svg': '3e5c62a81f450df3336e67110fe840ff6a1acca7af78e9862ce35c51cceb3c20',
  'astera-symbol-dark.svg': 'd576d9cc6c4cb09914e807dc2dab62e5b0a2aca049e774599ca43efd24a947bd',
  'astera-wordmark-light.svg': '700a3ab3610ac40f194d028a4ab51faf2cdd14f2284b69d266d18700d7fe6de4',
  'astera-wordmark-dark.svg': 'b4f2c7eee4a50efc6d67668dba85567eb04545c3562053d6d029899258d6b6a4',
  'astera-logo-light.svg': 'b9bc0b8afcdfb1ca72182960bc049d4518f1790e22e95a66187e1f860badc004',
  'astera-logo-dark.svg': 'cab61af560b3165130f7e8d922c093911f41e822ff01ea0c139db494c4612e52',
});

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'astera-app-brand-asset-gate',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.ASTERA_BRAND_ASSET_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchChecked(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`BRAND_ASSET_FETCH_FAILED:${response.status}:${url}:${body.slice(0, 240)}`);
  }
  return response;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateSvg(buffer, filename) {
  const text = buffer.toString('utf8').trim();
  if (!text.startsWith('<svg') && !text.startsWith('<?xml')) {
    throw new Error(`BRAND_ASSET_NOT_SVG:${filename}`);
  }
  if (/<image\b[^>]*(?:href|xlink:href)\s*=\s*["']data:/i.test(text)) {
    throw new Error(`BRAND_ASSET_EMBEDDED_RASTER_FORBIDDEN:${filename}`);
  }
  if (!/viewBox\s*=\s*["'][^"']+["']/i.test(text)) {
    throw new Error(`BRAND_ASSET_VIEWBOX_REQUIRED:${filename}`);
  }
}

async function existingValid(outputPath, expectedHash) {
  try {
    const bytes = await readFile(outputPath);
    return sha256(bytes) === expectedHash;
  } catch {
    return false;
  }
}

async function main() {
  const treeResponse = await fetchChecked(TREE_API, { headers: githubHeaders() });
  const treePayload = await treeResponse.json();
  if (treePayload.truncated === true) throw new Error('BRAND_SOURCE_TREE_TRUNCATED');
  if (!Array.isArray(treePayload.tree)) throw new Error('BRAND_SOURCE_TREE_INVALID');

  const blobs = treePayload.tree.filter((entry) => entry?.type === 'blob' && typeof entry.path === 'string');
  const resolved = new Map();
  for (const filename of Object.keys(EXPECTED)) {
    const matches = blobs.filter((entry) => basename(entry.path) === filename);
    if (matches.length !== 1) {
      throw new Error(`BRAND_ASSET_PATH_AMBIGUOUS:${filename}:matches=${matches.length}`);
    }
    resolved.set(filename, matches[0].path);
  }

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const manifest = {
    source_repository: SOURCE_REPOSITORY,
    source_commit: SOURCE_COMMIT,
    generated_at: new Date().toISOString(),
    assets: {},
  };

  for (const [filename, expectedHash] of Object.entries(EXPECTED)) {
    const outputPath = join(OUTPUT_DIRECTORY, filename);
    const sourcePath = resolved.get(filename);
    if (await existingValid(outputPath, expectedHash)) {
      manifest.assets[filename] = { source_path: sourcePath, sha256: expectedHash, reused: true };
      continue;
    }
    const rawUrl = `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${SOURCE_COMMIT}/${sourcePath.split('/').map(encodeURIComponent).join('/')}`;
    const assetResponse = await fetchChecked(rawUrl, { headers: githubHeaders() });
    const bytes = Buffer.from(await assetResponse.arrayBuffer());
    const actualHash = sha256(bytes);
    if (actualHash !== expectedHash) {
      throw new Error(`BRAND_ASSET_HASH_MISMATCH:${filename}:expected=${expectedHash}:actual=${actualHash}`);
    }
    validateSvg(bytes, filename);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
    manifest.assets[filename] = { source_path: sourcePath, sha256: actualHash, reused: false };
  }

  const symbolBytes = await readFile(join(OUTPUT_DIRECTORY, 'astera-symbol-light.svg'));
  if (sha256(symbolBytes) !== EXPECTED['astera-symbol-light.svg']) throw new Error('BRAND_SYMBOL_ALIAS_SOURCE_MISMATCH');
  await writeFile('public/logo-mark.svg', symbolBytes);
  await writeFile(join(OUTPUT_DIRECTORY, 'SOURCE.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({
    event: 'official_brand_assets_verified',
    source_repository: SOURCE_REPOSITORY,
    source_commit: SOURCE_COMMIT,
    asset_count: Object.keys(EXPECTED).length,
  }));
}

await main();
