import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP_ID = 'jp.asterav8.app';
const APP_HOST = 'app.asterav8.jp';
const ANDROID_API_LEVEL = 36;
const IOS_DEPLOYMENT_TARGET = '15.0';

function read(path) {
  return readFileSync(resolve(path), 'utf8');
}

function write(path, content) {
  writeFileSync(resolve(path), content, 'utf8');
}

function removePlistArrayKey(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(new RegExp(`\\n\\s*<key>${escaped}<\\/key>\\s*<array>[\\s\\S]*?<\\/array>`, 'g'), '');
}

function removePlistBooleanKey(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(new RegExp(`\\n\\s*<key>${escaped}<\\/key>\\s*<(?:true|false)\\s*\\/>`, 'g'), '');
}

function configureAndroid() {
  const manifestPath = 'android/app/src/main/AndroidManifest.xml';
  const variablesPath = 'android/variables.gradle';
  if (!existsSync(manifestPath) || !existsSync(variablesPath)) return false;

  let manifest = read(manifestPath);
  if (!manifest.includes('ASTERA_NATIVE_LINKS_START')) {
    const filters = `
            <!-- ASTERA_NATIVE_LINKS_START -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${APP_HOST}" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${APP_ID}" />
            </intent-filter>
            <!-- ASTERA_NATIVE_LINKS_END -->
`;
    const activityEnd = manifest.indexOf('</activity>');
    if (activityEnd < 0) throw new Error('ASTERA_ANDROID_ACTIVITY_NOT_FOUND');
    manifest = `${manifest.slice(0, activityEnd)}${filters}${manifest.slice(activityEnd)}`;
  }

  manifest = manifest
    .replace(/\s+android:screenOrientation="[^"]*"/g, '')
    .replace(/\s+android:minAspectRatio="[^"]*"/g, '')
    .replace(/\s+android:maxAspectRatio="[^"]*"/g, '')
    .replace(/\s+android:resizeableActivity="false"/g, ' android:resizeableActivity="true"')
    .replace(/\n\s*<supports-screens\b[^>]*\/>/g, '');

  const mainActivityPattern = /<activity\b(?=[^>]*android:name="\.MainActivity")[^>]*>/;
  const anyActivityPattern = /<activity\b[^>]*>/;
  const activityPattern = mainActivityPattern.test(manifest) ? mainActivityPattern : anyActivityPattern;
  if (!activityPattern.test(manifest)) throw new Error('ASTERA_ANDROID_ACTIVITY_NOT_FOUND');
  manifest = manifest.replace(activityPattern, (tag) => {
    if (/android:resizeableActivity="[^"]*"/.test(tag)) {
      return tag.replace(/android:resizeableActivity="[^"]*"/, 'android:resizeableActivity="true"');
    }
    return tag.replace(/>$/, ' android:resizeableActivity="true">');
  });

  if (/<uses-feature\b[^>]*android:required="true"[^>]*\/>/.test(manifest)) {
    throw new Error('ASTERA_ANDROID_REQUIRED_HARDWARE_FEATURE_FORBIDDEN');
  }

  write(manifestPath, manifest);

  let variables = read(variablesPath);
  variables = variables
    .replace(/compileSdkVersion\s*=\s*\d+/, `compileSdkVersion = ${ANDROID_API_LEVEL}`)
    .replace(/targetSdkVersion\s*=\s*\d+/, `targetSdkVersion = ${ANDROID_API_LEVEL}`)
    .replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 24');
  write(variablesPath, variables);
  return true;
}

function configureIos() {
  const infoPath = 'ios/App/App/Info.plist';
  const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
  const entitlementsPath = 'ios/App/App/App.entitlements';
  if (!existsSync(infoPath) || !existsSync(projectPath)) return false;

  let info = read(infoPath);
  info = info.replace(/\n\s*<!-- ASTERA_UNIVERSAL_ORIENTATIONS_START -->[\s\S]*?<!-- ASTERA_UNIVERSAL_ORIENTATIONS_END -->/g, '');
  info = removePlistArrayKey(info, 'UISupportedInterfaceOrientations');
  info = removePlistArrayKey(info, 'UISupportedInterfaceOrientations~ipad');
  info = removePlistBooleanKey(info, 'UIRequiresFullScreen');

  if (info.includes('<key>UIRequiredDeviceCapabilities</key>')) {
    throw new Error('ASTERA_IOS_REQUIRED_DEVICE_CAPABILITIES_FORBIDDEN');
  }

  if (!info.includes('ASTERA_CUSTOM_URL_SCHEME_START')) {
    const block = `
	<!-- ASTERA_CUSTOM_URL_SCHEME_START -->
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeRole</key>
			<string>Editor</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>${APP_ID}</string>
			</array>
		</dict>
	</array>
	<!-- ASTERA_CUSTOM_URL_SCHEME_END -->
`;
    const rootEnd = info.lastIndexOf('\n</dict>');
    if (rootEnd < 0) throw new Error('ASTERA_IOS_INFO_PLIST_ROOT_NOT_FOUND');
    info = `${info.slice(0, rootEnd)}${block}${info.slice(rootEnd)}`;
  }

  const orientationBlock = `
	<!-- ASTERA_UNIVERSAL_ORIENTATIONS_START -->
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	<key>UISupportedInterfaceOrientations~ipad</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationPortraitUpsideDown</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	<!-- ASTERA_UNIVERSAL_ORIENTATIONS_END -->
`;
  const rootEnd = info.lastIndexOf('\n</dict>');
  if (rootEnd < 0) throw new Error('ASTERA_IOS_INFO_PLIST_ROOT_NOT_FOUND');
  info = `${info.slice(0, rootEnd)}${orientationBlock}${info.slice(rootEnd)}`;
  write(infoPath, info);

  const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:${APP_HOST}</string>
	</array>
</dict>
</plist>
`;
  write(entitlementsPath, entitlements);

  let project = read(projectPath);
  project = project
    .replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, `IPHONEOS_DEPLOYMENT_TARGET = ${IOS_DEPLOYMENT_TARGET};`)
    .replace(/TARGETED_DEVICE_FAMILY = [^;]+;/g, 'TARGETED_DEVICE_FAMILY = "1,2";')
    .replace(/^.*INFOPLIST_KEY_UIRequiresFullScreen.*\n/gm, '');

  if (!project.includes('TARGETED_DEVICE_FAMILY = "1,2";')) {
    project = project.replace(
      new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${APP_ID.replace(/\./g, '\\.')};`, 'g'),
      `PRODUCT_BUNDLE_IDENTIFIER = ${APP_ID};\n\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";`,
    );
  }

  if (!project.includes('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;')) {
    project = project.replace(
      /CODE_SIGN_STYLE = Automatic;/g,
      'CODE_SIGN_STYLE = Automatic;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;',
    );
  }
  write(projectPath, project);
  return true;
}

const configured = [];
if (configureAndroid()) configured.push('android');
if (configureIos()) configured.push('ios');
if (configured.length === 0) throw new Error('ASTERA_NATIVE_PROJECTS_NOT_FOUND');

console.log(`Astera native platform configuration applied: ${configured.join(', ')}`);
