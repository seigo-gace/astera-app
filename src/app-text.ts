import { useTranslation } from 'react-i18next';

export const APP_TEXT = {
  ja: {
    navNew: '新しいページ', navSearch: '検索', navProjects: 'プロジェクト', navOptions: 'オプション', navPlanCredit: 'プラン / クレジット', navDeveloper: '開発者モード', navHistory: '履歴', navAbout: 'ASTERAとは？', navSettings: '設定',
    recent: '最近の履歴', recentLoading: '読み込み中…', recentEmpty: 'まだ履歴がありません', openHistory: '履歴を開く', openMenu: 'メニューを開く', closeMenu: 'メニューを閉じる', account: 'アカウント', openGuideAi: 'Astera案内AIを開く',
    settingsTitle: '設定', settingsDescription: '必要な設定だけを分けて管理します。', accountTitle: 'アカウント', accountDescription: '登録情報とGoogle / GitHubのログイン連携、ログアウト、アカウント管理。', securityTitle: 'セキュリティ', securityDescription: 'Password、Passkey、2段階認証、Backup Code、Session管理。', languageTitle: '言語', languageDescription: 'Astera Appで使用する表示言語だけを設定します。', notificationsTitle: '通知', notificationsDescription: 'Credit枯渇・購入・Update・重要なお知らせだけを管理します。', privacyTitle: 'プライバシー・データ', privacyDescription: '保存、Export、削除、Data Rightsを管理します。', legalSupportTitle: '法務・サポート', legalSupportDescription: '利用規約、Privacy Policy、特定商取引法表記、問い合わせ、Help。',
    languageSelect: '表示言語', japanese: '日本語', english: 'English', saved: '保存しました。', save: '保存',
    notificationCredit: 'Credit通知', notificationSystem: 'Asteraからのお知らせ', creditLow: 'Credit残量低下', creditCritical: 'Credit残量が危険域', creditInsufficient: 'Credit不足', creditPurchasePending: '購入処理中', creditCredited: 'Credit反映完了', creditResume: '実行再開可能', updateNotice: 'Astera Update', importantNotice: '重要なお知らせ', notificationChannel: '通知方法', appNotice: 'App内通知', emailNotice: 'Email通知', pushNotice: 'Push通知',
    legalTerms: '利用規約', legalPrivacy: 'プライバシーポリシー', legalCommerce: '特定商取引法表記', contact: '問い合わせ', help: 'Help / FAQ',
    searchTitle: '検索', searchDescription: '保存済みの履歴・Resultを検索します。', searchKeyword: 'キーワード', searchButton: '検索', planCreditTitle: 'プラン / クレジット', planCreditDescription: '契約PlanとCredit残高・購入を一つの入口から確認します。', planLink: 'プランを確認', creditLink: 'クレジットを確認・追加',
    developerVault: 'Libral Vault API', developerVaultDescription: '暗号化、Vault操作、鍵管理、Permission、Usage / LogをDeveloper Modeから管理します。', developerApi: 'Astera API / API Key', developerWebhook: 'Webhook', developerDocs: 'Developer Documentation', developerAvailable: '利用可能', developerUnavailable: 'Catalog未登録',
    loginConnections: 'ログイン連携', google: 'Google', github: 'GitHub', connected: '連携済み', notConnected: '未連携', link: '連携する', unlink: '連携解除', logout: 'ログアウト', accountDanger: 'アカウント管理', deleteAccount: 'アカウント削除', manageSecurity: 'セキュリティ設定を開く',
  },
  en: {
    navNew: 'New page', navSearch: 'Search', navProjects: 'Projects', navOptions: 'Options', navPlanCredit: 'Plan / Credits', navDeveloper: 'Developer Mode', navHistory: 'History', navAbout: 'What is ASTERA?', navSettings: 'Settings',
    recent: 'Recent', recentLoading: 'Loading…', recentEmpty: 'No history yet', openHistory: 'Open history', openMenu: 'Open menu', closeMenu: 'Close menu', account: 'Account', openGuideAi: 'Open Astera Guide AI',
    settingsTitle: 'Settings', settingsDescription: 'Manage each setting in a clear, separate area.', accountTitle: 'Account', accountDescription: 'Profile, Google / GitHub login links, logout, and account management.', securityTitle: 'Security', securityDescription: 'Password, passkey, two-factor authentication, backup codes, and sessions.', languageTitle: 'Language', languageDescription: 'Choose only the display language used by Astera App.', notificationsTitle: 'Notifications', notificationsDescription: 'Manage only credit, purchase, update, and important notices.', privacyTitle: 'Privacy & Data', privacyDescription: 'Manage storage, export, deletion, and data rights.', legalSupportTitle: 'Legal & Support', legalSupportDescription: 'Terms, Privacy Policy, commerce disclosure, contact, and help.',
    languageSelect: 'Display language', japanese: '日本語', english: 'English', saved: 'Saved.', save: 'Save',
    notificationCredit: 'Credit notifications', notificationSystem: 'Astera notices', creditLow: 'Low credit', creditCritical: 'Credit critical', creditInsufficient: 'Insufficient credit', creditPurchasePending: 'Purchase pending', creditCredited: 'Credits added', creditResume: 'Execution can resume', updateNotice: 'Astera Update', importantNotice: 'Important notice', notificationChannel: 'Channels', appNotice: 'In-app', emailNotice: 'Email', pushNotice: 'Push',
    legalTerms: 'Terms of Service', legalPrivacy: 'Privacy Policy', legalCommerce: 'Commerce disclosure', contact: 'Contact', help: 'Help / FAQ',
    searchTitle: 'Search', searchDescription: 'Search saved history and results.', searchKeyword: 'Keyword', searchButton: 'Search', planCreditTitle: 'Plan / Credits', planCreditDescription: 'Review your plan and credit balance or purchases from one place.', planLink: 'View plan', creditLink: 'View / add credits',
    developerVault: 'Libral Vault API', developerVaultDescription: 'Manage encryption, vault operations, keys, permissions, usage, and logs from Developer Mode.', developerApi: 'Astera API / API Keys', developerWebhook: 'Webhooks', developerDocs: 'Developer Documentation', developerAvailable: 'Available', developerUnavailable: 'Not in catalog',
    loginConnections: 'Login connections', google: 'Google', github: 'GitHub', connected: 'Connected', notConnected: 'Not connected', link: 'Connect', unlink: 'Disconnect', logout: 'Log out', accountDanger: 'Account management', deleteAccount: 'Delete account', manageSecurity: 'Open security settings',
  },
} as const;

export type AppTextKey = keyof typeof APP_TEXT.ja;

export function useAppText() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.toLowerCase().startsWith('en') ? 'en' : 'ja';
  return {
    language,
    text: (key: AppTextKey) => APP_TEXT[language][key],
    setLanguage: async (next: 'ja' | 'en') => {
      localStorage.setItem('astera-language', next);
      document.documentElement.lang = next;
      await i18n.changeLanguage(next);
    },
  };
}
