import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arguments_ = process.argv.slice(2);
const requireNative = arguments_.includes('--native');
const requestedNativePlatforms = arguments_.filter((value) => value === 'android' || value === 'ios');
const failures = [];
const checks = [];

function read(path) {
  return readFileSync(resolve(path), 'utf8');
}

function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${name}: ${detail}`);
}

const packageJson = JSON.parse(read('package.json'));
const capacitorConfig = read('capacitor.config.ts');
const nativeShell = read('src/native-shell.ts');
const externalNavigation = read('src/platform/external-navigation.ts');
const checkoutPage = read('src/features/checkout/CheckoutPage.tsx');
const authPages = read('src/platform/pages/AuthPages.tsx');
const workspacePages = read('src/platform/pages/WorkspacePages.tsx');
const accountPages = read('src/platform/pages/AccountPages.tsx');
const resultPage = read('src/features/results/ResultPage.tsx');
const compatibilityRuntime = read('src/device-compatibility.ts');
const compatibilityCss = read('src/device-compatibility.css');
const nativeConfigurator = read('scripts/configure-native-platforms.mjs');
const npmConfig = read('.npmrc');

check('private package', packageJson.private === true, 'package.json must remain private=true');
check('Node 22.12 engine', packageJson.engines?.node === '>=22.12 <23', 'Node engine must satisfy Vite 8 on Node 22');

for (const [groupName, dependencies] of Object.entries({
  dependencies: packageJson.dependencies ?? {},
  devDependencies: packageJson.devDependencies ?? {},
})) {
  for (const [name, version] of Object.entries(dependencies)) {
    check(
      `${groupName}:${name} exact version`,
      typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version),
      `version must be exact, received ${String(version)}`,
    );
  }
}

check('Capacitor app id', capacitorConfig.includes("appId: 'jp.asterav8.app'"), 'appId mismatch');
check('secure local hostname', capacitorConfig.includes("hostname: 'localhost'"), 'hostname must remain localhost');
check('Android https scheme', capacitorConfig.includes("androidScheme: 'https'"), 'Android local scheme must remain https');
check('iOS Capacitor scheme', capacitorConfig.includes("iosScheme: 'capacitor'"), 'iOS local scheme must remain capacitor');
check('cleartext disabled', capacitorConfig.includes('cleartext: false'), 'cleartext must remain disabled');
check('native HTTP patch disabled', !capacitorConfig.includes('CapacitorHttp'), 'global fetch patch must not be enabled without auth tests');
check('cold-start deep link', nativeShell.includes('getLaunchUrl()'), 'cold-start URL handling is required');
check('deep-link host allowlist', nativeShell.includes("const ASTERA_APP_HOST = 'app.asterav8.jp'"), 'Astera host allowlist missing');
check('HTTPS external navigation', nativeShell.includes("destination.protocol !== 'https:'"), 'external navigation must reject non-HTTPS');
check('exact install policy', npmConfig.includes('save-exact=true'), '.npmrc must preserve exact direct versions');
check('engine strict policy', npmConfig.includes('engine-strict=true'), '.npmrc must reject unsupported Node versions');
check('delegated download bridge', !nativeShell.includes('HTMLAnchorElement.prototype.click'), 'do not monkey-patch DOM prototypes');

check('capability based runtime', compatibilityRuntime.includes('window.visualViewport'), 'visual viewport compatibility is required');
check('no model allowlist', !/iPhone\s*\d|Pixel\s*\d|Galaxy\s*S|userAgent/.test(compatibilityRuntime), 'device model allowlists are forbidden');
check('old WebKit viewport fallback', compatibilityCss.includes('--app-viewport-height: 100vh'), '100vh fallback missing');
check('old WebKit color fallback', compatibilityCss.includes('@supports not (color: color-mix'), 'color-mix fallback missing');
check('touch input zoom guard', compatibilityCss.includes('font-size: 16px !important'), 'touch inputs must remain 16px or larger');
check('universal iOS project configuration', nativeConfigurator.includes('TARGETED_DEVICE_FAMILY = "1,2";'), 'iPhone and iPad target missing');
check('Android resizable project configuration', nativeConfigurator.includes('android:resizeableActivity="true"'), 'Android resizability missing');

check('programmatic external bridge uses Capacitor', externalNavigation.includes('isNativeRuntime()'), 'programmatic redirects must detect Native');
check('programmatic external bridge uses Browser', externalNavigation.includes('Browser.open'), 'Native external URLs must use system browser');
check('programmatic external bridge HTTPS only', externalNavigation.includes("destination.protocol !== 'https:'"), 'programmatic external URLs must reject non-HTTPS');
check('Native callback centralized', externalNavigation.includes('export function nativeCallback'), 'Native callback builder missing');
check('Native callback path validation', externalNavigation.includes('ASTERA_NATIVE_CALLBACK_PATH_REJECTED'), 'Native callback path must be validated');
check('Native browser closes after callback', nativeShell.includes('Browser.close()'), 'Native browser should close after verified app callback');

check('Square checkout uses external bridge', checkoutPage.includes('await openExternalUrl(destination)'), 'Square must not remain inside Native WebView');
check('Square direct WebView redirect removed', !checkoutPage.includes('window.location.assign(destination)'), 'Square direct redirect is forbidden');
check(
  'Square Native callback',
  /nativeCallback\((['"])\/account\/billing\/status\1\)/.test(checkoutPage),
  'Square Native callback missing',
);

check('OAuth uses canonical social API', authPages.includes("submitForm('/api/auth/sign-in/social'"), 'OAuth must request the redirect URL through the canonical Better Auth social endpoint');
check('OAuth uses external bridge', authPages.includes('await openExternalUrl(redirectUrl)'), 'OAuth redirect must use the verified system-browser bridge on Native');
check('OAuth Native callback', authPages.includes("nativeCallback('/login')"), 'OAuth Native callback must return to registered Login route');
check('OAuth Native session exchange', authPages.includes('/api/auth/native/session-exchange'), 'Native OAuth one-time exchange is required');

check('Storage OAuth uses external bridge', workspacePages.includes('await openExternalUrl(url)'), 'Storage OAuth must use system browser on Native');
check('Storage Native callback', workspacePages.includes("nativeCallback('/app/settings/storage-destinations')"), 'Storage Native callback missing');
check('Credit checkout uses external bridge', accountPages.includes('await openExternalUrl(url)'), 'Credit checkout must use system browser on Native');
check('Credit Native callback', accountPages.includes("nativeCallback('/account/billing/status')"), 'Credit Native callback missing');
check('Result download creates Blob URL', resultPage.includes('URL.createObjectURL(blob)'), 'Result download must use authenticated Blob bridge');
check('Result download names file', resultPage.includes('anchor.download ='), 'Result download file name missing');

if (requireNative) {
  const nativePlatforms = requestedNativePlatforms.length > 0
    ? [...new Set(requestedNativePlatforms)]
    : ['android', 'ios'].filter((platform) => existsSync(platform));

  check('at least one native project', nativePlatforms.length > 0, 'run mobile:bootstrap android and/or ios');

  if (nativePlatforms.includes('android')) {
    check(
      'Android project exists',
      existsSync('android/app/src/main/AndroidManifest.xml'),
      'run mobile:bootstrap android',
    );
  }

  if (nativePlatforms.includes('ios')) {
    check('iOS project exists', existsSync('ios/App/App/Info.plist'), 'run mobile:bootstrap ios');
  }

  if (nativePlatforms.includes('android') && existsSync('android/app/src/main/AndroidManifest.xml')) {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const variables = read('android/variables.gradle');
    check('Android App Link intent', manifest.includes('ASTERA_NATIVE_LINKS_START'), 'App Link intent filter missing');
    check('Android custom scheme', manifest.includes('android:scheme="jp.asterav8.app"'), 'custom callback scheme missing');
    check('Android target API 36', /targetSdkVersion\s*=\s*36/.test(variables), 'targetSdkVersion must be 36');
    check('Android compile API 36', /compileSdkVersion\s*=\s*36/.test(variables), 'compileSdkVersion must be 36');
    check('Android minimum API 24', /minSdkVersion\s*=\s*24/.test(variables), 'minSdkVersion must be 24');
    check('Android phone tablet foldable resizable', manifest.includes('android:resizeableActivity="true"'), 'activity must be resizable');
    check('Android orientation unrestricted', !manifest.includes('android:screenOrientation='), 'screen orientation lock is forbidden');
    check('Android aspect ratio unrestricted', !manifest.includes('android:minAspectRatio=') && !manifest.includes('android:maxAspectRatio='), 'aspect ratio restrictions are forbidden');
    check('Android screen filters absent', !manifest.includes('<supports-screens'), 'screen-size filters are forbidden');
    check('Android required hardware absent', !/<uses-feature\b[^>]*android:required="true"[^>]*\/>/.test(manifest), 'required hardware features restrict devices');
  }

  if (nativePlatforms.includes('ios') && existsSync('ios/App/App/Info.plist')) {
    const info = read('ios/App/App/Info.plist');
    const project = read('ios/App/App.xcodeproj/project.pbxproj');
    const entitlements = existsSync('ios/App/App/App.entitlements')
      ? read('ios/App/App/App.entitlements')
      : '';
    check('iOS custom scheme', info.includes('<string>jp.asterav8.app</string>'), 'custom callback scheme missing');
    check('iOS associated domain', entitlements.includes('applinks:app.asterav8.jp'), 'associated domain missing');
    check(
      'iOS entitlements build setting',
      project.includes('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;'),
      'entitlements are not attached',
    );
    check('iOS deployment target', /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/.test(project), 'deployment target must be iOS 15');
    check('iOS iPhone and iPad universal', project.includes('TARGETED_DEVICE_FAMILY = "1,2";'), 'targeted device family must be iPhone and iPad');
    check('iPhone orientations', info.includes('<key>UISupportedInterfaceOrientations</key>'), 'iPhone orientations missing');
    check('iPad orientations', info.includes('<key>UISupportedInterfaceOrientations~ipad</key>'), 'iPad orientations missing');
    check('iPad all orientations', info.includes('UIInterfaceOrientationPortraitUpsideDown'), 'iPad upside-down orientation missing');
    check('iPad multitasking enabled', !info.includes('<key>UIRequiresFullScreen</key>') && !project.includes('INFOPLIST_KEY_UIRequiresFullScreen'), 'iPad full-screen restriction is forbidden');
    check('iOS hardware restrictions absent', !info.includes('<key>UIRequiredDeviceCapabilities</key>'), 'required device capabilities restrict models');
  }
}

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);

if (failures.length > 0) {
  console.error(`\nAstera mobile audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nAstera mobile audit passed (${checks.length} checks)`);
