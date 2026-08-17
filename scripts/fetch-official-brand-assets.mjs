import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE_REPOSITORY = 'seigo-gace/astera-hp';
const SOURCE_COMMIT = 'a6859a722366211509ed94508b4691f9c9b61100';
const SOURCE_PATH = 'site/scripts/materialize-binary-assets.mjs';
const TARGET_FILENAME = 'astera-symbol-dark.svg';
const EXPECTED_SIZE = 26011;
const EXPECTED_SHA256 = 'd576d9cc6c4cb09914e807dc2dab62e5b0a2aca049e774599ca43efd24a947bd';
const OUTPUT_DIRECTORY = 'public/assets/astera';
const OUTPUT_PATH = join(OUTPUT_DIRECTORY, TARGET_FILENAME);
const ALIAS_PATH = 'public/logo-mark.svg';
const EMBEDDED_GZIP_BASE64 = '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';

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

function embeddedVerifiedSymbol() {
  return verifyBytes(
    gunzipSync(Buffer.from(EMBEDDED_GZIP_BASE64, 'base64')),
    `embedded:${SOURCE_REPOSITORY}@${SOURCE_COMMIT}:${SOURCE_PATH}`,
  );
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });

  let bytes = await readExistingVerified(OUTPUT_PATH);
  const reused = Boolean(bytes);
  if (!bytes) bytes = embeddedVerifiedSymbol();

  await writeFile(OUTPUT_PATH, bytes);
  await writeFile(ALIAS_PATH, bytes);

  const manifest = {
    source_repository: SOURCE_REPOSITORY,
    source_commit: SOURCE_COMMIT,
    source_path: SOURCE_PATH,
    storage: 'embedded-gzip-base64',
    target: {
      filename: TARGET_FILENAME,
      output_path: OUTPUT_PATH,
      alias_path: ALIAS_PATH,
      size: EXPECTED_SIZE,
      sha256: EXPECTED_SHA256,
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
    network_required: false,
  }));
}

await main();
