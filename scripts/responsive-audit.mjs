import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/platform/platform.css', import.meta.url), 'utf8');
const nativeCss = readFileSync(new URL('../src/features/composer/native-composer.css', import.meta.url), 'utf8');
const nativeComposer = readFileSync(new URL('../src/features/composer/NativeComposerPage.tsx', import.meta.url), 'utf8');
const compatibilityCss = readFileSync(new URL('../src/device-compatibility.css', import.meta.url), 'utf8');
const horizontalCss = readFileSync(new URL('../src/horizontal-stability.css', import.meta.url), 'utf8');
const orientationCss = readFileSync(new URL('../src/orientation-stability.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/platform/ResponsivePageShell.tsx', import.meta.url), 'utf8');
const settingsHome = readFileSync(new URL('../src/features/settings/SettingsHomePage.tsx', import.meta.url), 'utf8');
const languageSettings = readFileSync(new URL('../src/features/settings/LanguageSettingsPage.tsx', import.meta.url), 'utf8');
const optionSettings = readFileSync(new URL('../src/features/settings/OptionSettingsPage.tsx', import.meta.url), 'utf8');
const notificationSettings = readFileSync(new URL('../src/platform/canonical-notification-management.tsx', import.meta.url), 'utf8');
const securityPage = readFileSync(new URL('../src/features/security/SecurityPage.tsx', import.meta.url), 'utf8');
const securityManagement = readFileSync(new URL('../src/platform/canonical-account-security-management.tsx', import.meta.url), 'utf8');
const subscriptionManagement = readFileSync(new URL('../src/platform/canonical-subscription-management.tsx', import.meta.url), 'utf8');
const creditManagement = readFileSync(new URL('../src/platform/canonical-credit-management.tsx', import.meta.url), 'utf8');
const canonicalPages = readFileSync(new URL('../src/platform/CanonicalPages.tsx', import.meta.url), 'utf8');
const customerAi = readFileSync(new URL('../public/customer-ai-bubble.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
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

check('native composer route', router.includes('<NativeComposerPage route={route} />'), 'main app route must render NativeComposerPage');
check('native composer safe area', nativeCss.includes('env(safe-area-inset-bottom'), 'native composer safe area missing');
check('native composer tablet', /@media\s*\(max-width:\s*1100px\)/.test(nativeCss), 'native composer tablet breakpoint missing');
check('native composer mobile', /@media\s*\(max-width:\s*600px\)/.test(nativeCss), 'native composer smartphone breakpoint missing');
check('native composer landscape', /@media\s*\(orientation:\s*landscape\)/.test(nativeCss), 'native composer landscape handling missing');
check('native composer coarse pointer', /@media\s*\(pointer:\s*coarse\)/.test(nativeCss), 'native composer touch target rule missing');
check('native composer reduced motion', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(nativeCss), 'native composer reduced motion rule missing');
check('native composer dynamic viewport', nativeCss.includes('100dvh'), 'native composer dynamic viewport unit missing');
check('native composer overflow guard', nativeCss.includes('overflow-x: hidden'), 'native composer horizontal overflow guard missing');
check('native composer 16px input', /\.native-composer textarea[\s\S]*?font-size:\s*16px/.test(nativeCss), 'native composer mobile input must avoid iOS zoom');
check('native composer explicit controls', nativeComposer.includes("setPicker('purpose')") && nativeComposer.includes("setPicker('add')") && nativeComposer.includes('openContextPicker'), '/, + and @ controls are not independently implemented');
check('native composer device compatibility', compatibilityCss.includes('.native-composer textarea') && compatibilityCss.includes('.native-round-button'), 'native composer is missing touch/input compatibility guards');
check('native composer horizontal stability', horizontalCss.includes('.native-composer-workspace') && horizontalCss.includes('.native-result-section p'), 'native composer is missing horizontal and long-content guards');
check('native composer orientation stability', orientationCss.includes('.native-composer-dock') && orientationCss.includes('.native-composer textarea'), 'native composer is missing rotation and short-landscape guards');

const sidebarLabels = ['新しいページ', '検索', 'プロジェクト', 'オプション', 'プラン/クレジット', '開発者モード', '履歴'];
let priorIndex = -1;
let sidebarOrderOk = true;
for (const label of sidebarLabels) {
  const index = shell.indexOf(`label: '${label}'`);
  if (index <= priorIndex) sidebarOrderOk = false;
  priorIndex = index;
}
check('decided sidebar order', sidebarOrderOk, 'sidebar items must remain in the user-decided order');
check('sidebar bottom order', shell.indexOf("label: 'ASTERAとは？'") >= 0 && shell.indexOf("label: '設定'") > shell.indexOf("label: 'ASTERAとは？'"), 'About must sit immediately above Settings at the bottom');
check('AI and account top-right cluster', shell.includes('platform-global-actions') && shell.includes('data-customer-ai-anchor="true"') && shell.includes('aria-label="アカウント"'), 'AI and account must share the top-right control cluster');

check('settings account and security are dedicated pages', settingsHome.includes('href="/account"') && settingsHome.includes('href="/account/security"'), 'Account and Security must be separate dedicated pages');
check('language is a simple dropdown', settingsHome.includes('<select aria-label="言語"') && !settingsHome.includes('Theme') && !settingsHome.includes('Reduced Motion'), 'Settings language must stay a language-only dropdown');
check('language deep link remains language only', languageSettings.includes('<select aria-label="言語"') && !languageSettings.includes('theme') && !languageSettings.includes('reduced_motion'), 'Direct language route must not reintroduce appearance or motion settings');
check('notifications are only credit and updates', settingsHome.includes('クレジット残量のお知らせ') && settingsHome.includes('Asteraアップデートのお知らせ') && notificationSettings.includes('クレジット残量のお知らせ') && notificationSettings.includes('Asteraアップデートのお知らせ') && !notificationSettings.includes('実行完了通知'), 'Notification UI must remain limited to credit depletion and update notices');
check('legal and support are available from settings', settingsHome.includes('/legal/terms') && settingsHome.includes('/legal/privacy') && settingsHome.includes('/legal/commercial') && settingsHome.includes('/support'), 'Terms, privacy, commercial disclosure and support must be reachable from Settings');
check('logout is implemented', settingsHome.includes('authClient.signOut()') && settingsHome.includes("window.location.assign('/login')"), 'Settings must provide a real logout action');
check('option owns data privacy and external transfer connection', optionSettings.includes('/app/settings/data-privacy') && optionSettings.includes('/app/settings/storage-destinations'), 'Data/privacy and external transfer connection management must remain under Options');
check('external transfer is marked paid', optionSettings.includes('有料実行オプション') && optionSettings.includes('Server Estimate'), 'External storage transfer must remain a paid execution option with server-side pricing authority');

check('legacy settings aggregation disabled', !indexHtml.includes('/exterior-all-surfaces.js') && !indexHtml.includes('/canonical-interaction-contract.js'), 'legacy DOM mutation scripts must not rebuild Settings');
check('global management portals removed', !main.includes('CanonicalAccountSecurityManagement') && !main.includes('CanonicalSubscriptionManagement') && !main.includes('CanonicalCreditManagement'), 'Account/Security/Plan/Credit must not be globally injected by portal');
check('security is one direct page', securityPage.includes('<AccountSecurityManagementSurface') && !securityManagement.includes('createPortal(') && !securityManagement.includes('MutationObserver'), 'Security management must be rendered inside the dedicated Security page');
check('plan is direct page', canonicalPages.includes('<SubscriptionManagementPage route={route} />') && !subscriptionManagement.includes('createPortal(') && !subscriptionManagement.includes('MutationObserver'), 'Plan management must use a direct dedicated page');
check('credit is direct page', canonicalPages.includes('<CreditManagementPage route={route} />') && !creditManagement.includes('createPortal(') && !creditManagement.includes('MutationObserver'), 'Credit management must use a direct dedicated page');
check('notification route owns one page', canonicalPages.includes("route.id === 'settings-notifications'") && canonicalPages.includes('<NotificationSettingsPage route={route} />'), 'notification route must dispatch directly to NotificationSettingsPage');
check('official HP AI icon', customerAi.includes("'/assets/astera/ai-guide-robot.svg'") && !customerAi.includes('>✦<') && !customerAi.includes('aca-orbit'), 'customer AI must use the vendored HP robot icon, not the star/orbit mark');

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
if (failures.length) {
  console.error(`\nAstera responsive audit failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`\nAstera responsive audit passed (${checks.length} checks)`);