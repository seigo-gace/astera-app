import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const index = read('index.html');
const main = read('src/main.tsx');
const runtime = read('src/device-compatibility.ts');
const compatibilityCss = read('src/device-compatibility.css');
const nativeConfig = read('scripts/configure-native-platforms.mjs');
const failures = [];
const checks = [];

function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) failures.push(`${name}: ${detail}`);
}

check('viewport fit cover', index.includes('viewport-fit=cover'), 'notch and safe area support is required');
check('interactive keyboard viewport', index.includes('interactive-widget=resizes-content'), 'Android keyboard must resize content');
check('zoom remains available', !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?(?:[,"'])/i.test(index), 'do not disable accessibility zoom');

check('compatibility CSS imported last', /AppRouter[^]*device-compatibility\.css/.test(main), 'compatibility CSS must load after route styles');
check('compatibility runtime initialized', main.includes('initializeDeviceCompatibility();'), 'device runtime must initialize before render');
check('visual viewport measured', runtime.includes('window.visualViewport'), 'iOS and Android visual viewport handling missing');
check('pageshow recovery', runtime.includes("addEventListener('pageshow'"), 'iOS back-forward cache recovery missing');
check('orientation recovery', runtime.includes("addEventListener('orientationchange'"), 'rotation handling missing');
check('capability not model detection', !/iPhone\s*\d|Pixel\s*\d|Galaxy\s*S|userAgent/i.test(runtime), 'model or user-agent allowlists are forbidden');
check('touch capability detection', runtime.includes("matchMedia('(pointer: coarse)')"), 'touch capability detection missing');
check('hover capability detection', runtime.includes("matchMedia('(hover: hover)')"), 'hover capability detection missing');

check('legacy viewport fallback', compatibilityCss.includes('--app-viewport-height: 100vh'), '100vh fallback missing for old WKWebView');
check('runtime viewport height', compatibilityCss.includes('var(--app-viewport-height, 100vh)'), 'runtime viewport variable missing');
check('legacy color mix fallback', compatibilityCss.includes('@supports not (color: color-mix'), 'iOS 15 color-mix fallback missing');
check('backdrop filter fallback', compatibilityCss.includes('@supports not ((-webkit-backdrop-filter'), 'old WebKit backdrop fallback missing');
check('hoverless controls visible', compatibilityCss.includes('.history-menu-trigger') && compatibilityCss.includes('opacity: 1 !important'), 'touch-only action visibility missing');
check('iOS input zoom guard', /\.composer textarea[^]*font-size:\s*16px\s*!important/.test(compatibilityCss), 'all touch inputs must be at least 16px');
check('touch manipulation', compatibilityCss.includes('touch-action: manipulation'), 'tap handling rule missing');
check('small phone layout', compatibilityCss.includes('@media (max-width: 360px)'), 'small phone fallback missing');
check('short landscape layout', compatibilityCss.includes('(orientation: landscape) and (max-height: 500px)'), 'short landscape fallback missing');

check('iPhone and iPad universal', nativeConfig.includes('TARGETED_DEVICE_FAMILY = "1,2";'), 'iOS target must include iPhone and iPad');
check('iPhone orientations', nativeConfig.includes('UISupportedInterfaceOrientations'), 'iPhone orientation list missing');
check('iPad orientations', nativeConfig.includes('UISupportedInterfaceOrientations~ipad'), 'iPad orientation list missing');
check('iPad upside down', nativeConfig.includes('UIInterfaceOrientationPortraitUpsideDown'), 'iPad all-orientation support missing');
check('iPad full screen restriction removed', nativeConfig.includes("removePlistBooleanKey(info, 'UIRequiresFullScreen')"), 'iPad multitasking restriction must be removed');
check('iOS hardware restrictions forbidden', nativeConfig.includes('ASTERA_IOS_REQUIRED_DEVICE_CAPABILITIES_FORBIDDEN'), 'iOS device capability restrictions must fail');

check('Android resizable', nativeConfig.includes('android:resizeableActivity="true"'), 'Android phone tablet foldable resizability missing');
check('Android orientation locks removed', nativeConfig.includes('android:screenOrientation'), 'Android screen orientation removal missing');
check('Android aspect restrictions removed', nativeConfig.includes('android:minAspectRatio') && nativeConfig.includes('android:maxAspectRatio'), 'Android aspect ratio restriction removal missing');
check('Android screen filters removed', nativeConfig.includes('<supports-screens'), 'Android screen-size filters must be removed');
check('Android hardware restrictions forbidden', nativeConfig.includes('ASTERA_ANDROID_REQUIRED_HARDWARE_FEATURE_FORBIDDEN'), 'Android required hardware features must fail');

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
if (failures.length) {
  console.error(`\nAstera device matrix audit failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`\nAstera device matrix audit passed (${checks.length} checks)`);
