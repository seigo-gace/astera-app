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
const npmConfig = read('.npmrc');

check('private package', packageJson.private === true, 'package.json must remain private=true');
check('Node 22 engine', packageJson.engines?.node === '>=22 <23', 'Node engine must be pinned to major 22');

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
  }
}

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);

if (failures.length > 0) {
  console.error(`\nAstera mobile audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nAstera mobile audit passed (${checks.length} checks)`);
