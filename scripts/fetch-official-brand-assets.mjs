import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SOURCE_REPOSITORY = 'seigo-gace/astera-hp';
const SOURCE_COMMIT = 'a6859a722366211509ed94508b4691f9c9b61100';
const SOURCE_PATH = 'site/scripts/materialize-binary-assets.mjs';
const TARGET_FILENAME = 'astera-symbol-dark.svg';
const EXPECTED_SIZE = 26011;
const EXPECTED_SHA256 = 'd576d9cc6c4cb09914e807dc2dab62e5b0a2aca049e774599ca43efd24a947bd';
const OUTPUT_DIRECTORY = 'public/assets/astera';
const OUTPUT_PATH = join(OUTPUT_DIRECTORY, TARGET_FILENAME);
const ALIAS_PATH = 'public/logo-mark.svg';
const SOURCE_URL = `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${SOURCE_COMMIT}/${SOURCE_PATH}`;

function githubHeaders() {
  const headers = {
    Accept: 'text/plain',
    'User-Agent': 'astera-app-brand-asset-gate',
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

function verifyBytes(bytes, source) {
  if (bytes.length !== EXPECTED_SIZE) {
    throw new Error(`BRAND_ASSET_SIZE_MISMATCH:${source}:expected=${EXPECTED_SIZE}:actual=${bytes.length}`);
  }
  const actualHash = sha256(bytes);
  if (actualHash !== EXPECTED_SHA256) {
    throw new Error(`BRAND_ASSET_HASH_MISMATCH:${source}:expected=${EXPECTED_SHA256}:actual=${actualHash}`);
  }
  validateSvg(bytes, TARGET_FILENAME);
  return bytes;
}

async function readExistingVerified(path) {
  try {
    return verifyBytes(await readFile(path), path);
  } catch {
    return null;
  }
}

function extractVerifiedSymbol(materializerSource) {
  const match = materializerSource.match(
    /file:\s*['"]astera-symbol-dark\.svg['"]\s*,\s*expectedSize:\s*(\d+)\s*,\s*expectedSha256:\s*['"]([0-9a-f]{64})['"]\s*,\s*gzipBase64:\s*['"]([^'"]+)['"]/s,
  );
  if (!match) throw new Error('BRAND_SOURCE_SYMBOL_NOT_FOUND');

  const [, sourceSize, sourceSha256, gzipBase64] = match;
  if (Number(sourceSize) !== EXPECTED_SIZE || sourceSha256 !== EXPECTED_SHA256) {
    throw new Error(`BRAND_SOURCE_METADATA_MISMATCH:size=${sourceSize}:sha256=${sourceSha256}`);
  }

  return verifyBytes(gunzipSync(Buffer.from(gzipBase64, 'base64')), `${SOURCE_REPOSITORY}@${SOURCE_COMMIT}:${SOURCE_PATH}`);
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });

  let bytes = await readExistingVerified(OUTPUT_PATH);
  let reused = Boolean(bytes);

  if (!bytes) {
    const sourceResponse = await fetchChecked(SOURCE_URL, { headers: githubHeaders() });
    bytes = extractVerifiedSymbol(await sourceResponse.text());
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, bytes);
    reused = false;
  }

  await writeFile(ALIAS_PATH, bytes);

  const manifest = {
    source_repository: SOURCE_REPOSITORY,
    source_commit: SOURCE_COMMIT,
    source_path: SOURCE_PATH,
    generated_at: new Date().toISOString(),
    target: {
      filename: TARGET_FILENAME,
      output_path: OUTPUT_PATH,
      alias_path: ALIAS_PATH,
      size: EXPECTED_SIZE,
      sha256: EXPECTED_SHA256,
      reused,
    },
  };
  await writeFile(join(OUTPUT_DIRECTORY, 'SOURCE.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    event: 'official_brand_symbol_verified',
    source_repository: SOURCE_REPOSITORY,
    source_commit: SOURCE_COMMIT,
    target: TARGET_FILENAME,
    sha256: EXPECTED_SHA256,
    reused,
  }));
}

await main();