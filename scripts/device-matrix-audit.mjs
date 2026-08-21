import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const index = read('index.html');
const main = read('src/main.tsx');
const runtime = read('src/device-compatibility.ts');
const compatibilityCss = read('src/device-compatibility.css');
const horizontalCss = read('src/horizontal-stability.css');
const orientationCss = read('src/orientation-stability.css');
const bootstrap = read('public/compatibility-bootstrap.js');
const vite = read('vite.config.ts');
const playwright = read('playwright.config.ts');
const deviceTests = read('tests/device-matrix.spec.ts');
const horizontalTests = read('tests/horizontal-stability.spec.ts');
const nativeConfig = read('scripts/configure-native-platforms.mjs');
const failures = [];
const checks = [];

function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) failures.push(`${name}: ${detail}`);
}

function splitCssRules(css) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const start = i;
    let braceStart = -1;
    let depth = 0;
    for (let j = i; j < css.length; j++) {
      if (css[j] === '{') {
        if (depth === 0) braceStart = j;
        depth++;
      } else if (css[j] === '}') {
        depth--;
        if (depth === 0 && braceStart >= 0) {
          rules.push({
            selector: css.slice(start, braceStart).trim(),
            block: css.slice(braceStart + 1, j),
          });
          i = j + 1;
          break;
        }
      }
    }
    if (braceStart < 0) break;
  }
  return rules;
}

function selectorIncludesSelectionRow(selector) {
  return selector.split(',').some((part) => {
    const token = part.trim();
    return /^\.selection-row$/.test(token) || /^\.selection-row(?:$|[\s:>+~\[.])/.test(token);
  });
}

function cssRuleHasSelectionRowWrap(css) {
  return splitCssRules(css).some(
    (rule) =>
      selectorIncludesSelectionRow(rule.selector) &&
      /flex-wrap:\s*wrap/.test(rule.block) &&
      /overflow-x:\s*visible/.test(rule.block),
  );
}

check('viewport fit cover', index.includes('viewport-fit=cover'), 'notch and safe area support is required');
check('interactive keyboard viewport', index.includes('interactive-widget=resizes-content'), 'Android keyboard must resize content');
check('zoom remains available', !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?(?:[,"'])/i.test(index), 'do not disable accessibility zoom');
check('preflight before module', index.indexOf('/compatibility-bootstrap.js') >= 0 && index.indexOf('/compatibility-bootstrap.js') < index.indexOf('/src/main.tsx'), 'runtime preflight must execute before modules');
check('unsupported runtime guarded', main.includes('__ASTERA_RUNTIME_UNSUPPORTED__') && main.includes('if (!runtimeUnsupported)'), 'React must not cover the compatibility notice');

const deviceCssIndex = main.indexOf("import './device-compatibility.css'");
const horizontalCssIndex = main.indexOf("import './horizontal-stability.css'");
const orientationCssIndex = main.indexOf("import './orientation-stability.css'");
check('compatibility CSS imported after route styles', /AppRouter[^]*device-compatibility\.css/.test(main), 'device compatibility CSS must load after route styles');
check('horizontal stability CSS imported after device CSS', deviceCssIndex >= 0 && horizontalCssIndex > deviceCssIndex, 'horizontal stability guard must load after device styles');
check('orientation stability CSS imported last', horizontalCssIndex >= 0 && orientationCssIndex > horizontalCssIndex, 'rotation stability CSS must be the final style guard');
check('compatibility runtime initialized', main.includes('initializeDeviceCompatibility();'), 'device runtime must initialize before render');
check('visual viewport measured', runtime.includes('window.visualViewport'), 'iOS and Android visual viewport handling missing');
check('layout width avoids visual viewport jitter', runtime.includes('root.clientWidth || window.innerWidth') && runtime.includes('--app-layout-width'), 'horizontal layout width must use the stable layout viewport');
check('layout width updates are deduplicated', runtime.includes('setPixelVariable') && runtime.includes('value === previousValue'), 'unchanged viewport values must not churn CSS variables');
check('pageshow recovery', runtime.includes("addEventListener('pageshow'"), 'iOS back-forward cache recovery missing');
check('orientation recovery', runtime.includes("addEventListener('orientationchange'"), 'rotation handling missing');
check('orientation media recovery', runtime.includes("matchMedia('(orientation: landscape)')"), 'orientation media-query fallback missing');
check('orientation staged settling', runtime.includes('const settleDelays = [0, 80, 180, 360]'), 'iOS rotation must be recalculated across staged viewport updates');
check('orientation scroll preservation', runtime.includes('captureScrollSnapshot') && runtime.includes('restoreScrollSnapshot'), 'rotation must preserve vertical position and force horizontal position to zero');
check('orientation drawer closure', runtime.includes('closeTransientNavigation') && runtime.includes("'.mobile-backdrop'") && runtime.includes("'.platform-backdrop'"), 'open mobile navigation must close before rotation settles');
check('orientation lifecycle events', runtime.includes('astera:orientationchange') && runtime.includes('astera:orientation-settled'), 'components and tests need explicit rotation lifecycle events');
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

check('document horizontal lock', horizontalCss.includes('overscroll-behavior-x: none') && horizontalCss.includes('overflow-x: hidden'), 'root horizontal scrolling must be blocked');
check('overflow clip enhancement', horizontalCss.includes('@supports (overflow: clip)') && horizontalCss.includes('overflow-x: clip'), 'modern engines must clip transformed off-canvas content');
check('stable desktop scrollbar gutter', horizontalCss.includes('scrollbar-gutter: stable'), 'vertical scrollbar appearance must not shift the layout');
check('viewport based drawer width', horizontalCss.includes("var(--app-layout-width, 100%)") && horizontalCss.includes('.mobile-sidebar'), 'drawers must not size from raw 100vw');
check('chip row wraps', cssRuleHasSelectionRowWrap(horizontalCss), 'selection chips must wrap instead of creating a horizontal scroller');
check('long content wraps', horizontalCss.includes('overflow-wrap: anywhere') && horizontalCss.includes('word-break: break-word'), 'long URLs and identifiers must not widen the document');
check('fixed overlays constrained', horizontalCss.includes('.dialog-content') && horizontalCss.includes('.toast') && horizontalCss.includes('max-width: calc(100% - 24px)'), 'dialogs and toasts must remain inside the viewport');
check('tables remain inside page', horizontalCss.includes('table-layout: fixed') && horizontalCss.includes('td {'), 'table content must wrap without page overflow');

check('rotation transitions disabled', orientationCss.includes('html.astera-rotating') && orientationCss.includes('transition: none !important'), 'layout transitions must not animate through intermediate rotation widths');
check('landscape safe areas', orientationCss.includes("data-astera-orientation='landscape'") && orientationCss.includes('safe-area-inset-left') && orientationCss.includes('safe-area-inset-right'), 'landscape notch and rounded-corner safe areas missing');
check('short landscape toolbar', orientationCss.includes('astera-short-viewport') && orientationCss.includes('height: 52px'), 'short landscape height adaptation missing');
check('landscape composer height', orientationCss.includes('.composer textarea') && orientationCss.includes('max-height: 88px'), 'landscape keyboard and composer height constraint missing');

check('feature based unsupported notice', bootstrap.includes('missingFeatures()') && bootstrap.includes('Asteraを安全に起動できません'), 'outdated WebView must show a usable notice');
check('secure UUID fallback', bootstrap.includes('getRandomValues') && bootstrap.includes("window.crypto, 'randomUUID'"), 'randomUUID fallback missing');
check('bootstrap avoids modern padStart', !bootstrap.includes('.padStart('), 'preflight must not rely on padStart');
check('bootstrap avoids user agent gates', !bootstrap.includes('navigator.userAgent'), 'preflight must use features instead of device strings');
check('Safari 15 build target', vite.includes("'safari15'"), 'Safari 15 compilation target missing');
check('Android WebView build target', vite.includes("'chrome80'"), 'Android WebView baseline target missing');
check('ES2019 build target', vite.includes("'es2019'"), 'JavaScript syntax baseline is too new');

check('WebKit small iPhone matrix', playwright.includes('webkit-iphone-small'), 'small iPhone WebKit project missing');
check('WebKit iPad split matrix', playwright.includes('webkit-ipad-split'), 'iPad split view WebKit project missing');
check('WebKit iPad full matrix', playwright.includes('webkit-ipad-full'), 'iPad full view WebKit project missing');
check('Chromium Android small matrix', playwright.includes('chromium-android-small'), 'small Android project missing');
check('Chromium tablet matrix', playwright.includes('chromium-tablet'), 'Android tablet project missing');
check('Chromium foldable matrix', playwright.includes('chromium-foldable'), 'foldable project missing');
check('all route device test', deviceTests.includes('all canonical routes render without horizontal overflow or blocked controls'), 'all routes must run in every browser project');
check('tap interception test', deviceTests.includes('document.elementFromPoint'), 'click interception check missing');
check('iOS focus zoom test', deviceTests.includes('touch inputs do not trigger iOS focus zoom'), 'touch input zoom test missing');
check('horizontal wheel regression', horizontalTests.includes('horizontal wheel and drawer interactions cannot move the document sideways') && horizontalTests.includes('page.mouse.wheel(1200, 0)'), 'horizontal gesture regression test missing');
check('long string regression', horizontalTests.includes('long unbroken content and many chips wrap') && horizontalTests.includes('horizontal-long-code'), 'long content overflow test missing');
check('scrollbar layout shift regression', horizontalTests.includes('vertical scrollbar appearance and viewport restoration do not shift the page horizontally'), 'scrollbar and viewport restoration test missing');
check('document scroll coordinates checked', horizontalTests.includes('windowScrollX') && horizontalTests.includes('documentScrollLeft') && horizontalTests.includes('bodyScrollLeft'), 'horizontal scroll coordinates must be asserted');
check('portrait landscape round trip', horizontalTests.includes('portrait landscape round trip preserves input and scroll without horizontal movement'), 'rotation must test portrait to landscape and back');
check('rotation input persistence', horizontalTests.includes("toHaveValue('rotation@example.test')") && horizontalTests.includes("toHaveValue('rotation-password-123')"), 'rotation must not erase in-progress form input');
check('rotation drawer closure test', horizontalTests.includes('open compact drawer closes before landscape layout settles'), 'open mobile drawer must be tested during rotation');
check('rotation events asserted', horizontalTests.includes('__ASTERA_ORIENTATION_EVENTS__') && horizontalTests.includes("toContain('landscape')") && horizontalTests.includes("toContain('portrait')"), 'both rotation directions must emit and be asserted');

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
