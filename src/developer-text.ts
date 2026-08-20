import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export const DEVELOPER_TEXT = {
  ja: {
    pageDescription: 'アカウントに連携したAPIカタログ、APIキー状態、停止理由、クレジット、利用量を管理します。APIキーのSecret全文は発行直後だけ表示します。',
    creditWarningTitle: '開発者API クレジット警告', creditCheck: 'クレジット状態を確認してください。', addCredit: 'クレジットを追加',
    summary: '開発者概要', apiCatalog: 'APIカタログ', noCatalog: '現在利用できるAPIカタログはありません。', descriptionMissing: '説明はまだありません。', openApi: 'OpenAPI', openApiMissing: 'OpenAPI未提供',
    sandboxIssue: 'Sandbox APIキー発行', noIssuableTarget: '現在APIキーを発行できる対象はありません。', selectTarget: '対象API', selectPrompt: '選択してください', issueSandbox: 'Sandbox APIキーを発行', productionKey: 'Production APIキー', productionKeyUnavailable: 'Production APIキーはFresh Session／再認証契約が接続されるまで発行しません。',
    targetUnavailable: '現在発行可能な対象APIを選択してください。', sandboxIssued: 'Sandbox APIキーを発行しました。', secretMissing: '一度だけ表示するAPIキーSecretを受信できませんでした。', secretOnce: 'このSecretは今回だけ表示します。', copy: 'コピー',
    apiKeys: 'APIキー', noApiKeys: 'APIキーはありません。', prefixMissing: 'Prefix未提供', none: 'なし', lastUsed: '最終利用', estimatedRemainingRequests: '概算残りリクエスト', usageCredit: '利用量 / クレジット', rateQuota: 'Rate / Quota',
    target: '対象API', environment: '環境', scope: '権限範囲', controlStatus: '制御状態', runtimeHold: '停止理由', autoResume: '自動再開',
    stateSecurityHold: 'セキュリティ確認中', stateAccountSuspended: 'アカウント停止', statePlanEntitlement: 'プラン変更で停止', stateTargetSuspended: '対象API停止', stateCreditInsufficient: 'クレジット不足で停止中', statePausedUser: '利用者が停止中', stateRevoked: '削除済み', stateExpired: '期限切れ', stateActive: '稼働中',
    statusLow: '残量低下', statusCritical: '残量危険域', statusInsufficient: 'クレジット不足', statusDepleted: 'クレジット枯渇', statusAvailable: '利用可能', statusReady: '準備完了', statusUnavailable: '利用不可', statusUnknown: '状態不明',
    rotate: 'キーを更新', pause: '停止', resume: '再開', delete: '削除', lifecycleUnavailable: 'Lifecycle API Routeが正本で確定・接続されるまで送信しません。', productionDeleteUnavailable: 'Production重要操作を含む削除Contractが接続されるまで送信しません。',
    lifecycleBoundary: '未接続Lifecycle境界', lifecycleBoundaryDescription: 'Rotate／Pause／Resume／Delete／Status History／Explorerの実API RouteはDeveloper正本にPathが確定していません。存在しないEndpointをFrontendから推測して呼ばず、外部Backend Contract確定後に接続します。停止されたRequestを自動再送する処理も追加していません。',
    summaryAccount: 'アカウント', summaryWorkspace: 'Tenant / Workspace', summaryPlan: '現在のプラン', summaryEntitlement: 'API利用権限', summaryAvailableCredit: '利用可能クレジット', summaryReservedCredit: '予約中クレジット', summaryKeys: 'APIキー数', summaryTargets: 'カタログ対象数',
    available: '利用可能', notCataloged: 'カタログ未登録', vaultDescription: '暗号化、Vault操作、鍵管理、Permission、Usage / LogをDeveloper Modeから管理します。', api: 'Astera API / APIキー', webhook: 'Webhook', vault: 'Libral Vault API', docs: '開発者ドキュメント', developerMode: '開発者モード', unknown: '状態不明',
  },
  en: {
    pageDescription: 'Manage account-linked API catalog targets, key status, runtime holds, credits, and usage. Full API key secrets are shown only once immediately after issuance.',
    creditWarningTitle: 'Developer API credit warning', creditCheck: 'Check your current credit status.', addCredit: 'Add credits',
    summary: 'Developer Summary', apiCatalog: 'API Catalog', noCatalog: 'No API catalog targets are currently available.', descriptionMissing: 'No description provided', openApi: 'OpenAPI', openApiMissing: 'OpenAPI unavailable',
    sandboxIssue: 'Issue sandbox key', noIssuableTarget: 'No target can currently issue a key.', selectTarget: 'Target', selectPrompt: 'Select a target', issueSandbox: 'Issue sandbox key', productionKey: 'Production Key', productionKeyUnavailable: 'Production keys remain unavailable until the fresh-session / re-authentication contract is connected.',
    targetUnavailable: 'Select a target that can currently issue a key.', sandboxIssued: 'Sandbox API key issued.', secretMissing: 'The one-time API key secret was not received.', secretOnce: 'This secret is shown only once.', copy: 'Copy',
    apiKeys: 'API Keys', noApiKeys: 'No API keys.', prefixMissing: 'Prefix unavailable', none: 'None', lastUsed: 'Last used', estimatedRemainingRequests: 'Estimated requests remaining', usageCredit: 'Usage / Credit', rateQuota: 'Rate / Quota',
    target: 'Target', environment: 'Environment', scope: 'Scope', controlStatus: 'Control Status', runtimeHold: 'Runtime Hold', autoResume: 'Auto Resume',
    stateSecurityHold: 'Security hold', stateAccountSuspended: 'Account suspended', statePlanEntitlement: 'Stopped by plan entitlement', stateTargetSuspended: 'Target suspended', stateCreditInsufficient: 'Stopped for insufficient credits', statePausedUser: 'Paused by user', stateRevoked: 'Revoked', stateExpired: 'Expired', stateActive: 'Active',
    statusLow: 'Low credit', statusCritical: 'Credit critical', statusInsufficient: 'Insufficient credit', statusDepleted: 'Credits depleted', statusAvailable: 'Available', statusReady: 'Ready', statusUnavailable: 'Unavailable', statusUnknown: 'Unknown status',
    rotate: 'Rotate', pause: 'Pause', resume: 'Resume', delete: 'Delete', lifecycleUnavailable: 'This action is not sent until its lifecycle API route is fixed in the canonical spec and connected.', productionDeleteUnavailable: 'Delete is not sent until the contract for production-sensitive deletion is connected.',
    lifecycleBoundary: 'Unconnected lifecycle boundary', lifecycleBoundaryDescription: 'The real API routes for Rotate / Pause / Resume / Delete / Status History / Explorer are not yet fixed in the Developer canonical spec. The frontend does not guess nonexistent endpoints; these actions will be connected after the external backend contract is fixed. Automatic replay of stopped requests is also not added.',
    summaryAccount: 'Account', summaryWorkspace: 'Tenant / Workspace', summaryPlan: 'Current Plan', summaryEntitlement: 'API Entitlement', summaryAvailableCredit: 'Available credits', summaryReservedCredit: 'Reserved credits', summaryKeys: 'API keys', summaryTargets: 'Catalog targets',
    available: 'Available', notCataloged: 'Not in catalog', vaultDescription: 'Manage encryption, vault operations, keys, permissions, usage, and logs from Developer Mode.', api: 'Astera API / API Keys', webhook: 'Webhooks', vault: 'Libral Vault API', docs: 'Developer Documentation', developerMode: 'Developer Mode', unknown: 'Unknown status',
  },
} as const;

export type DeveloperTextKey = keyof typeof DEVELOPER_TEXT.ja;

export function useDeveloperText() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.toLowerCase().startsWith('en') ? 'en' : 'ja';
  const text = useCallback((key: DeveloperTextKey) => DEVELOPER_TEXT[language][key], [language]);
  return { language, text };
}
