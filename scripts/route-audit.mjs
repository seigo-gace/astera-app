import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/platform/route-registry.ts', import.meta.url), 'utf8');
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

for (const [index, match] of routeMatches.entries()) {
  console.log(`PASS ${String(index + 1).padStart(2, '0')} ${match[1]} ${match[2]}`);
}

if (failures.length) {
  console.error(`\nAstera route audit failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`\nAstera route audit passed (${routeMatches.length}/${expected})`);
