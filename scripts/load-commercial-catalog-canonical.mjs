import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANONICAL_PATH = join(dirname(fileURLToPath(import.meta.url)), '../catalog/commercial-catalog.canonical.json');

/** @returns {import('./commercial-catalog-canonical.types.mjs').CommercialCatalogCanonical} */
export function loadCommercialCatalogCanonical() {
  return JSON.parse(readFileSync(CANONICAL_PATH, 'utf8'));
}
