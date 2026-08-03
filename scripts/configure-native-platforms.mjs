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
    write(manifestPath, manifest);
  }

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
    write(infoPath, info);
  }

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
  project = project.replace(
    /IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g,
    `IPHONEOS_DEPLOYMENT_TARGET = ${IOS_DEPLOYMENT_TARGET};`,
  );
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
