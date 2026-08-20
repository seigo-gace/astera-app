import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const ROUTE_TITLES = {
  ja: {
    root: 'Astera App', pricing: '料金・プラン', login: 'ログイン', register: 'アカウント登録', 'verify-email': 'メール確認', 'forgot-password': 'パスワードを忘れた場合', 'reset-password': 'パスワード再設定', 'password-setup': 'Astera用パスワード設定', 'two-factor': '2段階認証', app: 'Astera App', 'new-run': '新しいページ', search: '検索', 'result-detail': '結果詳細', projects: 'プロジェクト', 'plan-credit': 'プラン / クレジット', history: '履歴', about: 'ASTERAとは？', settings: '設定', 'settings-options': 'オプション', 'settings-language': '言語', 'settings-templates': '個別テンプレート管理', 'settings-storage-destinations': '外部ストレージ接続', 'settings-astera-storage': 'Astera Storage', 'settings-data-privacy': 'プライバシー・データ', 'settings-notifications': '通知', 'settings-legal-support': '法務・サポート', account: 'アカウント', 'account-security': 'セキュリティ', 'account-subscription': 'プラン・契約', 'account-credit': 'クレジット購入・履歴', 'account-checkout': '購入確認', 'billing-status': '決済状態', developer: '開発者モード', 'public-share': '公開共有', 'private-share': '非公開共有', shares: '共有管理', legal: '規約・法務', 'legal-terms': '利用規約', 'legal-privacy': 'プライバシーポリシー', 'legal-commercial': '特定商取引法表記', 'legal-api-terms': 'API利用規約', status: 'システム状態', offline: 'オフライン', maintenance: 'メンテナンス', support: 'サポート', 'not-found': 'ページが見つかりません',
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
  },
  en: {
    checking: 'Checking…', processFailedTitle: 'Could not complete the operation', processFailed: 'The operation failed.', retry: 'Retry', accountSessionChecking: 'Checking account and session…',
    creditLoading: 'Checking credit balance', creditUnavailable: 'Could not load credit balance', usableCredit: 'Available credits', reservedCredit: 'Reserved',
    publicPricing: 'Pricing', publicLogin: 'Log in', publicRegister: 'Register', appNavigation: 'Astera App navigation',
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
