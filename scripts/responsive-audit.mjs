import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/platform/platform.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/platform/ResponsivePageShell.tsx', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/platform/app-router.tsx', import.meta.url), 'utf8');
const failures = [];
const checks = [];

function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) failures.push(`${name}: ${detail}`);
}

check('safe area top', css.includes('env(safe-area-inset-top'), 'missing iOS/Android safe area');
check('safe area bottom', css.includes('env(safe-area-inset-bottom'), 'missing bottom safe area');
check('tablet breakpoint', /@media\s*\(max-width:\s*1100px\)/.test(css), 'tablet breakpoint missing');
check('mobile breakpoint', /@media\s*\(max-width:\s*760px\)/.test(css), 'mobile breakpoint missing');
check('landscape breakpoint', /@media\s*\(orientation:\s*landscape\)/.test(css), 'landscape handling missing');
check('coarse pointer targets', /@media\s*\(pointer:\s*coarse\)/.test(css), 'touch target rules missing');
check('reduced motion', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css), 'reduced motion missing');
check('dynamic viewport', css.includes('100dvh'), 'dynamic viewport unit missing');
check('mobile input zoom guard', /font-size:\s*16px/.test(css), 'mobile form inputs must be at least 16px');
check('mobile drawer', shell.includes('platform-mobile-drawer'), 'mobile drawer missing');
check('desktop sidebar', shell.includes('platform-sidebar'), 'desktop/tablet sidebar missing');
check('authenticated app gate', router.includes('AccountSessionGate'), 'main execution route must be guarded by current AccountSessionGate');
check('root canonical redirect', router.includes("window.location.replace('/app/new')"), 'root must resolve to canonical app route');

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
if (failures.length) {
  console.error(`\nAstera responsive audit failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`\nAstera responsive audit passed (${checks.length} checks)`);
