import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const auth = read('functions/_auth.ts');
const authHandler = read('functions/api/auth/[[path]].ts');
const projection = read('functions/_account-projection.ts');
const accountApi = read('functions/api/account.ts');
const accountPage = read('src/features/settings/AccountSettingsPage.tsx');
const securityPage = read('src/features/security/SecurityPage.tsx');
const loginPage = read('src/features/auth/LoginPage.tsx');
const twoFactorPage = read('src/features/auth/TwoFactorPage.tsx');

const failures = [];
function check(name, condition, message) {
  if (!condition) failures.push(`${name}: ${message}`);
}

check('password length contract', auth.includes('minPasswordLength: 6') && auth.includes('maxPasswordLength: 128'), 'Better Auth password length must remain 6-128');
check('email change enabled', auth.includes('changeEmail:') && auth.includes('enabled: true') && auth.includes('updateEmailWithoutVerification: false'), 'Account email change must require verification');
check('email 2FA sender', auth.includes("template: 'two-factor'") && auth.includes('sendOTP'), '2FA email OTP sender is missing');
check('password registration contract', !auth.includes('allowPasswordless: true'), '2FA must not silently bypass the registration password contract');

const freshBlock = authHandler.match(/const FRESH_MANAGEMENT_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
check('linked accounts readable', !freshBlock.includes("'/api/auth/list-accounts'"), 'reading linked accounts must not require a fresh session');
check('linked account writes protected', freshBlock.includes("'/api/auth/link-social'") && freshBlock.includes("'/api/auth/unlink-account'"), 'link/unlink writes must remain fresh-session protected');

for (const [name, source] of [['projection', projection], ['account api', accountApi]]) {
  check(`${name} active persistence`, source.includes("existing?.account_status === 'active'") || source.includes("existing?.account_status === 'active'"), 'active accounts must never be sent back through registration');
  check(`${name} new password gate`, source.includes("'pending_password_setup'") && source.includes('passwordConfigured'), 'new registrations must require the initial password step');
}

check('Account email management', accountPage.includes('authClient.changeEmail') && accountPage.includes("name=\"new_email\"") && accountPage.includes('emailVerified'), 'Account must own email display/change/verification state');
check('Account password management', accountPage.includes('authClient.changePassword') && accountPage.includes('current_password') && accountPage.includes('new_password_confirmation'), 'Account must own password changes');
check('linked state error separation', accountPage.includes('connectionError') && !accountPage.includes('catch { setConnections([]); }'), 'a failed linked-account read must not be shown as disconnected');

check('Security has no password creation', !securityPage.includes("'/api/auth/set-password'") && !securityPage.includes('Astera用Passwordを設定'), 'Security must never create the Account password');
check('Security uses Account email', securityPage.includes('emailMethod') && securityPage.includes('emailVerified') && securityPage.includes('href=\"/account\"'), 'Security must use the Account email and link email management back to Account');
check('Security authenticator enrollment', securityPage.includes('QRCode.toDataURL') && securityPage.includes('authClient.twoFactor.enable') && securityPage.includes('verifyTotp'), 'Authenticator setup must produce QR and verify TOTP');
check('Login 2FA methods', twoFactorPage.includes("type TwoFactorMethod = 'totp' | 'otp'") && twoFactorPage.includes('/api/auth/two-factor/send-otp'), 'Login must let users select authenticator or email OTP');
check('new social registration password step', loginPage.includes('newUserCallbackURL') && loginPage.includes('/account/password/setup'), 'new Google/GitHub registration must complete the initial Astera password step');

if (failures.length) {
  console.error('Account/Auth audit failed:\n' + failures.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Account/Auth audit: PASS');
