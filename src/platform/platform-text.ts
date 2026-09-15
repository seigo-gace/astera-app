import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const ROUTE_TITLES = {
  ja: {
    root: 'Astera App', pricing: '料金・プラン', login: 'ログイン', register: 'アカウント登録', 'verify-email': 'メール確認', 'forgot-password': 'パスワードを忘れた場合', 'reset-password': 'パスワード再設定', 'password-setup': 'Astera用パスワード設定', 'two-factor': '2段階認証', app: 'Astera App', 'new-run': '新しいページ', search: '検索', 'result-detail': '結果詳細', projects: 'Project', 'plan-credit': 'プラン / クレジット', history: '履歴', about: 'ASTERAとは？', settings: '設定', 'settings-options': 'オプション', 'settings-language': '言語', 'settings-templates': '個別テンプレート管理', 'settings-storage-destinations': '外部ストレージ接続', 'settings-astera-storage': 'Astera Storage', 'settings-data-privacy': 'プライバシー・データ', 'settings-notifications': '通知', 'settings-legal-support': '法務・サポート', account: 'アカウント', 'account-security': 'セキュリティ', 'account-subscription': 'プラン・契約', 'account-credit': 'クレジット購入・履歴', 'account-checkout': '購入確認', 'billing-status': '決済状態', developer: '開発者モード', 'public-share': '公開共有', 'private-share': '非公開共有', shares: '共有管理', legal: '規約・法務', 'legal-terms': '利用規約', 'legal-privacy': 'プライバシーポリシー', 'legal-commercial': '特定商取引法表記', 'legal-api-terms': 'API利用規約', status: 'システム状態', offline: 'オフライン', maintenance: 'メンテナンス', support: 'サポート', 'not-found': 'Page Not Found',
  },
  en: {
    root: 'Astera App', pricing: 'Pricing & Plans', login: 'Log in', register: 'Create account', 'verify-email': 'Verify email', 'forgot-password': 'Forgot password', 'reset-password': 'Reset password', 'password-setup': 'Set Astera password', 'two-factor': 'Two-factor authentication', app: 'Astera App', 'new-run': 'New page', search: 'Search', 'result-detail': 'Result details', projects: 'Projects', 'plan-credit': 'Plan / Credits', history: 'History', about: 'What is ASTERA?', settings: 'Settings', 'settings-options': 'Options', 'settings-language': 'Language', 'settings-templates': 'Personal templates', 'settings-storage-destinations': 'External storage connections', 'settings-astera-storage': 'Astera Storage', 'settings-data-privacy': 'Privacy & Data', 'settings-notifications': 'Notifications', 'settings-legal-support': 'Legal & Support', account: 'Account', 'account-security': 'Security', 'account-subscription': 'Plan & Subscription', 'account-credit': 'Credit purchase & ledger', 'account-checkout': 'Checkout confirmation', 'billing-status': 'Billing status', developer: 'Developer Mode', 'public-share': 'Public share', 'private-share': 'Private share', shares: 'Share management', legal: 'Legal', 'legal-terms': 'Terms of Service', 'legal-privacy': 'Privacy Policy', 'legal-commercial': 'Commerce disclosure', 'legal-api-terms': 'API Terms', status: 'System status', offline: 'Offline', maintenance: 'Maintenance', support: 'Support', 'not-found': 'Page not found',
  },
} as const;

export const PLATFORM_TEXT = {
  ja: {
    checking: '確認しています…', processFailedTitle: '処理を完了できませんでした', processFailed: '処理に失敗しました。', retry: '再確認', accountSessionChecking: 'アカウントとSessionを確認しています…',
    creditLoading: 'クレジット残高を確認中', creditUnavailable: 'クレジット残高を取得できません', usableCredit: '利用可能クレジット', reservedCredit: '予約中',
    publicPricing: '料金', publicLogin: 'ログイン', publicRegister: '登録', appNavigation: 'Astera App navigation',
    headerPage: 'ページ', headerEvidence: '根拠', headerToggleAria: 'ページと根拠の切替', organizeResultAria: 'Resultを整理', organizeResultTitle: '整理',
    formSubmitting: '送信しています…',
    authEmail: 'Email', authPassword: 'Password', authPasswordRange: 'Password（12〜128文字）', authPasswordConfirm: 'Password確認', authNewPassword: '新しいPassword', authAsteraPassword: 'Astera用Password',
    authOr: 'または', authLogin: 'Login', authForgotPassword: 'Passwordを忘れた場合', authCreateAccount: 'Accountを作成',
    authAccountActionsAria: 'Account操作', authLoginActionsAria: 'Login操作',
    authLoginDescription: 'Email、Passkey、Google、GitHubからAstera Accountへ安全にLoginします。',
    authRegisterDescription: 'Email、Google、GitHubからAstera Accountを作成します。',
    authVerifyEmailDescription: '確認Tokenを検証し、Accountを有効化します。',
    authForgotPasswordDescription: 'Accountの存在を第三者へ露出せず再設定を開始します。',
    authResetPasswordDescription: '有効なTokenで新しいPasswordを設定します。',
    authPasswordSetupDescription: 'Google／GitHubのPasswordは取得せず、Astera専用Passwordを設定します。',
    authTwoFactorDescription: 'Authenticator CodeまたはBackup Codeを検証します。',
    authEmailLogin: 'EmailでLogin', authPasskeyLogin: 'PasskeyでLogin', authGoogleContinue: 'Googleで続ける', authGithubContinue: 'GitHubで続ける',
    authEmailRegister: 'EmailでAccount登録', authGoogleRegister: 'Googleアカウントで登録', authGithubRegister: 'GitHubで登録',
    authVerificationEmailResend: '確認Emailを再送', authResetEmailSend: '再設定Emailを送信', authPasswordUpdate: 'Passwordを更新', authPasswordSetupContinue: '設定して続ける',
    authTwoFactorMethod: '認証方式', authTwoFactorTotp: 'Authenticator Code', authTwoFactorBackup: 'Backup Code', authTwoFactorCode: '認証Code', authTwoFactorSubmit: '認証',
    authNativeSessionSuccess: 'Native Sessionを確立しました。', authLoginSuccess: 'Loginしました。', authPasskeySuccess: 'Passkeyで認証しました。',
    authGoogleLoginStarting: 'Google認証を開始します。', authGithubLoginStarting: 'GitHub認証を開始します。',
    authVerificationEmailSent: '確認Emailを送信しました。', authVerificationEmailResent: '確認Emailを再送しました。',
    authGoogleRegisterStarting: 'Google登録を開始します。', authGithubRegisterStarting: 'GitHub登録を開始します。',
    authResetEmailSent: '該当Accountがある場合、再設定Emailを送信しました。', authPasswordUpdated: 'Passwordを更新しました。', authAsteraPasswordSet: 'Astera用Passwordを設定しました。', authTwoFactorSuccess: '認証しました。',
    authPasswordMismatch: 'Passwordが一致しません。', authResetTokenMissing: 'Password再設定Tokenがありません。', authOAuthRedirectMissing: 'OAuth Redirect URLを受信できませんでした。',
    authNativeSessionFailed: 'Native Sessionを確立できませんでした。', authLoginFailed: 'Loginできませんでした。', authPasskeySignInFailed: 'Passkey認証に失敗しました。', authPasskeyStartFailed: 'Passkey認証を開始できませんでした。', authOAuthStartFailed: 'OAuthを開始できませんでした。',
    authRegisterFailed: 'Account登録に失敗しました。', authOAuthRegisterStartFailed: 'OAuth登録を開始できませんでした。', authVerifyEmailFailed: 'Email確認に失敗しました。', authVerifyEmailResendFailed: '確認Emailを再送できませんでした。',
    authPasswordResetRequestFailed: 'Password再設定Emailを送信できませんでした。', authPasswordResetFailed: 'Passwordを更新できませんでした。', authPasswordSetupFailed: 'Astera用Passwordを設定できませんでした。', authTwoFactorFailed: '認証に失敗しました。',
    authErrorInvalidCredentials: 'EmailまたはPasswordが正しくありません。', authErrorEmailNotVerified: 'Email確認が完了していません。', authErrorAccountAlreadyExists: 'このEmailのAccountは既に登録されています。',
    authErrorPasswordLength: 'Passwordは12〜128文字で入力してください。', authErrorInvalidPassword: 'Passwordが正しくありません。', authErrorRateLimited: '操作が多すぎます。しばらく待ってから再試行してください。',
    authErrorInvalidToken: 'Tokenが無効または期限切れです。', authErrorSessionExpired: 'Sessionの有効期限が切れています。もう一度Loginしてください。', authErrorOAuthFailed: '外部Account認証を開始できませんでした。', authErrorPasskeyFailed: 'Passkey認証に失敗しました。',
  },
  en: {
    checking: 'Checking…', processFailedTitle: 'Could not complete the operation', processFailed: 'The operation failed.', retry: 'Retry', accountSessionChecking: 'Checking account and session…',
    creditLoading: 'Checking credit balance', creditUnavailable: 'Could not load credit balance', usableCredit: 'Available credits', reservedCredit: 'Reserved',
    publicPricing: 'Pricing', publicLogin: 'Log in', publicRegister: 'Register', appNavigation: 'Astera App navigation',
    headerPage: 'Page', headerEvidence: 'Evidence', headerToggleAria: 'Switch between page and evidence', organizeResultAria: 'Organize result', organizeResultTitle: 'Organize',
    formSubmitting: 'Sending…',
    authEmail: 'Email', authPassword: 'Password', authPasswordRange: 'Password (12–128 characters)', authPasswordConfirm: 'Confirm password', authNewPassword: 'New password', authAsteraPassword: 'Astera password',
    authOr: 'or', authLogin: 'Log in', authForgotPassword: 'Forgot password', authCreateAccount: 'Create account',
    authAccountActionsAria: 'Account actions', authLoginActionsAria: 'Login actions',
    authLoginDescription: 'Log in securely to your Astera Account with email, passkey, Google, or GitHub.',
    authRegisterDescription: 'Create an Astera Account with email, Google, or GitHub.',
    authVerifyEmailDescription: 'Verify the confirmation token and activate your account.',
    authForgotPasswordDescription: 'Start password recovery without revealing whether an account exists.',
    authResetPasswordDescription: 'Set a new password using a valid token.',
    authPasswordSetupDescription: 'Set an Astera-only password without accessing your Google or GitHub password.',
    authTwoFactorDescription: 'Verify an authenticator code or backup code.',
    authEmailLogin: 'Log in with email', authPasskeyLogin: 'Log in with passkey', authGoogleContinue: 'Continue with Google', authGithubContinue: 'Continue with GitHub',
    authEmailRegister: 'Create account with email', authGoogleRegister: 'Create account with Google', authGithubRegister: 'Create account with GitHub',
    authVerificationEmailResend: 'Resend verification email', authResetEmailSend: 'Send reset email', authPasswordUpdate: 'Update password', authPasswordSetupContinue: 'Set password and continue',
    authTwoFactorMethod: 'Authentication method', authTwoFactorTotp: 'Authenticator code', authTwoFactorBackup: 'Backup code', authTwoFactorCode: 'Authentication code', authTwoFactorSubmit: 'Verify',
    authNativeSessionSuccess: 'Native session established.', authLoginSuccess: 'Logged in.', authPasskeySuccess: 'Authenticated with passkey.',
    authGoogleLoginStarting: 'Starting Google authentication.', authGithubLoginStarting: 'Starting GitHub authentication.',
    authVerificationEmailSent: 'Verification email sent.', authVerificationEmailResent: 'Verification email resent.',
    authGoogleRegisterStarting: 'Starting Google registration.', authGithubRegisterStarting: 'Starting GitHub registration.',
    authResetEmailSent: 'If an account exists, a password reset email has been sent.', authPasswordUpdated: 'Password updated.', authAsteraPasswordSet: 'Astera password set.', authTwoFactorSuccess: 'Authenticated.',
    authPasswordMismatch: 'Passwords do not match.', authResetTokenMissing: 'Password reset token is missing.', authOAuthRedirectMissing: 'Could not receive the OAuth redirect URL.',
    authNativeSessionFailed: 'Could not establish the native session.', authLoginFailed: 'Could not log in.', authPasskeySignInFailed: 'Passkey authentication failed.', authPasskeyStartFailed: 'Could not start passkey authentication.', authOAuthStartFailed: 'Could not start OAuth authentication.',
    authRegisterFailed: 'Could not create the account.', authOAuthRegisterStartFailed: 'Could not start OAuth registration.', authVerifyEmailFailed: 'Email verification failed.', authVerifyEmailResendFailed: 'Could not resend the verification email.',
    authPasswordResetRequestFailed: 'Could not send the password reset email.', authPasswordResetFailed: 'Could not update the password.', authPasswordSetupFailed: 'Could not set the Astera password.', authTwoFactorFailed: 'Authentication failed.',
    authErrorInvalidCredentials: 'The email or password is incorrect.', authErrorEmailNotVerified: 'Email verification is not complete.', authErrorAccountAlreadyExists: 'An account with this email already exists.',
    authErrorPasswordLength: 'Enter a password between 12 and 128 characters.', authErrorInvalidPassword: 'The password is incorrect.', authErrorRateLimited: 'Too many attempts. Please wait and try again.',
    authErrorInvalidToken: 'The token is invalid or has expired.', authErrorSessionExpired: 'Your session has expired. Please log in again.', authErrorOAuthFailed: 'Could not start external account authentication.', authErrorPasskeyFailed: 'Passkey authentication failed.',
  },
} as const;

export type PlatformTextKey = keyof typeof PLATFORM_TEXT.ja;

export function usePlatformText() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.toLowerCase().startsWith('en') ? 'en' : 'ja';
  const text = useCallback((key: PlatformTextKey) => PLATFORM_TEXT[language][key], [language]);
  const routeTitle = useCallback((routeId: string, fallback: string) => {
    const titles = ROUTE_TITLES[language] as Record<string, string>;
    return titles[routeId] ?? fallback;
  }, [language]);
  const locale = language === 'en' ? 'en-US' : 'ja-JP';
  return { language, locale, text, routeTitle };
}
