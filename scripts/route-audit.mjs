import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../src/platform/route-registry.ts');
const main = read('../src/main.tsx');
const implementation = [
  read('../src/platform/app-router.tsx'),
  read('../src/platform/CanonicalPages.tsx'),
  read('../src/platform/pages/AuthPages.tsx'),
  read('../src/platform/pages/WorkspacePages.tsx'),
  read('../src/platform/pages/AccountPages.tsx'),
  read('../src/platform/pages/PublicPages.tsx'),
].join('\n');
const expected = Number(source.match(/CANONICAL_ROUTE_COUNT\s*=\s*(\d+)/)?.[1] ?? 0);
const routeMatches = [...source.matchAll(/\{\s*id:\s*'([^']+)',\s*pattern:\s*'([^']+)'/g)];
const ids = routeMatches.map((match) => match[1]);
const patterns = routeMatches.map((match) => match[2]);
const failures = [];

if (!expected) failures.push('CANONICAL_ROUTE_COUNT is missing');
if (routeMatches.length !== expected) failures.push(`expected ${expected} routes, found ${routeMatches.length}`);
if (new Set(ids).size !== ids.length) failures.push('route IDs must be unique');
if (new Set(patterns).size !== patterns.length) failures.push('route patterns must be unique');
if (patterns.at(-1) !== '*') failures.push('catch-all route must be last');
if (!main.includes("import AppRouter from './platform/app-router'")) failures.push('main.tsx must mount AppRouter');
if (/normalizedPath[\s\S]*<App\s*\/>/.test(main)) failures.push('legacy fallback router must not remain in main.tsx');

const required = [
  '/pricing', '/login', '/register', '/verify-email', '/forgot-password', '/reset-password',
  '/account/password/setup', '/auth/2fa', '/app/new', '/app/results/:id', '/app/projects',
  '/app/history', '/app/settings', '/app/settings/options', '/app/settings/language',
  '/app/settings/templates', '/app/settings/storage-destinations', '/app/settings/astera-storage',
  '/app/settings/data-privacy', '/app/settings/notifications', '/account', '/account/security',
  '/account/subscription', '/account/credit', '/account/checkout', '/account/billing/status',
  '/app/developer', '/s/:token', '/share/:id', '/app/shares', '/legal', '/status', '/offline',
  '/maintenance', '/support', '*',
];
for (const pattern of required) if (!patterns.includes(pattern)) failures.push(`required route missing: ${pattern}`);

for (const id of ids) {
  if (id === 'not-found') continue;
  if (!implementation.includes(`'${id}'`)) failures.push(`route has no implementation dispatch: ${id}`);
}

for (const [index, match] of routeMatches.entries()) {
  console.log(`PASS ${String(index + 1).padStart(2, '0')} ${match[1]} ${match[2]}`);
}

if (failures.length) {
  console.error(`\nAstera route audit failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`\nAstera route and implementation audit passed (${routeMatches.length}/${expected})`);
