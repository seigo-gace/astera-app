import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export const DEVELOPER_TEXT = {
  ja: {
    pageDescription: 'Account連携済みAPI Catalog、Key状態、Runtime Hold、Credit、Usageを管理します。API Key Secret全文は発行直後だけ表示します。',
    creditWarningTitle: 'Developer API Credit警告', creditCheck: 'Credit状態を確認してください。', addCredit: 'Creditを追加',
    summary: 'Developer Summary', apiCatalog: 'API Catalog', noCatalog: '利用可能なTarget Catalogはありません。', descriptionMissing: '説明未提供', openApiMissing: 'OpenAPI未提供',
    sandboxIssue: 'Sandbox Key発行', noIssuableTarget: '現在Keyを発行できるTargetはありません。', selectTarget: 'Target', selectPrompt: '選択してください', issueSandbox: 'Sandbox Keyを発行', productionKey: 'Production Key', productionKeyUnavailable: 'Production KeyはFresh Session／再認証契約が接続されるまで発行しません。',
    targetUnavailable: '現在発行可能なTargetを選択してください。', sandboxIssued: 'Sandbox API Keyを発行しました。', secretMissing: '一度だけ表示するAPI Key Secretを受信できませんでした。', secretOnce: 'このSecretは今回だけ表示します。', copy: 'Copy',
    apiKeys: 'API Keys', noApiKeys: 'API Keyはありません。', prefixMissing: 'Prefix未提供', none: 'なし', lastUsed: '最終利用', estimatedRemainingRequests: '概算残りRequest', usageCredit: 'Usage / Credit', rateQuota: 'Rate / Quota',
    target: 'Target', environment: 'Environment', scope: 'Scope', controlStatus: 'Control Status', runtimeHold: 'Runtime Hold', autoResume: 'Auto Resume',
    stateSecurityHold: 'Security確認中', stateAccountSuspended: 'Account停止', statePlanEntitlement: 'Plan変更で停止', stateTargetSuspended: 'Target停止', stateCreditInsufficient: 'Credit不足で停止中', statePausedUser: '利用者が停止中', stateRevoked: '削除済み', stateExpired: '期限切れ', stateActive: '稼働中',
    rotate: 'Rotate', pause: 'Pause', resume: 'Resume', delete: 'Delete', lifecycleUnavailable: 'Lifecycle API Routeが正本で確定・接続されるまで送信しません。', productionDeleteUnavailable: 'Production重要操作を含む削除Contractが接続されるまで送信しません。',
    lifecycleBoundary: '未接続Lifecycle境界', lifecycleBoundaryDescription: 'Rotate／Pause／Resume／Delete／Status History／Explorerの実API RouteはDeveloper正本にPathが確定していません。存在しないEndpointをFrontendから推測して呼ばず、外部Backend Contract確定後に接続します。停止されたRequestを自動再送する処理も追加していません。',
    summaryAccount: 'Account', summaryWorkspace: 'Tenant / Workspace', summaryPlan: 'Current Plan', summaryEntitlement: 'API Entitlement', summaryAvailableCredit: '利用可能Credit', summaryReservedCredit: '予約中Credit', summaryKeys: 'API Key数', summaryTargets: 'Catalog Target数',
    available: '利用可能', notCataloged: 'Catalog未登録', vaultDescription: '暗号化、Vault操作、鍵管理、Permission、Usage / LogをDeveloper Modeから管理します。', api: 'Astera API / API Key', webhook: 'Webhook', vault: 'Libral Vault API', docs: 'Developer Documentation', developerMode: '開発者モード', unknown: 'unknown',
  },
  en: {
    pageDescription: 'Manage account-linked API catalog targets, key status, runtime holds, credits, and usage. Full API key secrets are shown only once immediately after issuance.',
    creditWarningTitle: 'Developer API credit warning', creditCheck: 'Check your current credit status.', addCredit: 'Add credits',
    summary: 'Developer Summary', apiCatalog: 'API Catalog', noCatalog: 'No API catalog targets are currently available.', descriptionMissing: 'No description provided', openApiMissing: 'OpenAPI unavailable',
    sandboxIssue: 'Issue sandbox key', noIssuableTarget: 'No target can currently issue a key.', selectTarget: 'Target', selectPrompt: 'Select a target', issueSandbox: 'Issue sandbox key', productionKey: 'Production Key', productionKeyUnavailable: 'Production keys remain unavailable until the fresh-session / re-authentication contract is connected.',
    targetUnavailable: 'Select a target that can currently issue a key.', sandboxIssued: 'Sandbox API key issued.', secretMissing: 'The one-time API key secret was not received.', secretOnce: 'This secret is shown only once.', copy: 'Copy',
    apiKeys: 'API Keys', noApiKeys: 'No API keys.', prefixMissing: 'Prefix unavailable', none: 'None', lastUsed: 'Last used', estimatedRemainingRequests: 'Estimated requests remaining', usageCredit: 'Usage / Credit', rateQuota: 'Rate / Quota',
    target: 'Target', environment: 'Environment', scope: 'Scope', controlStatus: 'Control Status', runtimeHold: 'Runtime Hold', autoResume: 'Auto Resume',
    stateSecurityHold: 'Security hold', stateAccountSuspended: 'Account suspended', statePlanEntitlement: 'Stopped by plan entitlement', stateTargetSuspended: 'Target suspended', stateCreditInsufficient: 'Stopped for insufficient credits', statePausedUser: 'Paused by user', stateRevoked: 'Revoked', stateExpired: 'Expired', stateActive: 'Active',
    rotate: 'Rotate', pause: 'Pause', resume: 'Resume', delete: 'Delete', lifecycleUnavailable: 'This action is not sent until its lifecycle API route is fixed in the canonical spec and connected.', productionDeleteUnavailable: 'Delete is not sent until the contract for production-sensitive deletion is connected.',
    lifecycleBoundary: 'Unconnected lifecycle boundary', lifecycleBoundaryDescription: 'The real API routes for Rotate / Pause / Resume / Delete / Status History / Explorer are not yet fixed in the Developer canonical spec. The frontend does not guess nonexistent endpoints; these actions will be connected after the external backend contract is fixed. Automatic replay of stopped requests is also not added.',
    summaryAccount: 'Account', summaryWorkspace: 'Tenant / Workspace', summaryPlan: 'Current Plan', summaryEntitlement: 'API Entitlement', summaryAvailableCredit: 'Available credits', summaryReservedCredit: 'Reserved credits', summaryKeys: 'API keys', summaryTargets: 'Catalog targets',
    available: 'Available', notCataloged: 'Not in catalog', vaultDescription: 'Manage encryption, vault operations, keys, permissions, usage, and logs from Developer Mode.', api: 'Astera API / API Keys', webhook: 'Webhooks', vault: 'Libral Vault API', docs: 'Developer Documentation', developerMode: 'Developer Mode', unknown: 'unknown',
  },
} as const;

export type DeveloperTextKey = keyof typeof DEVELOPER_TEXT.ja;

export function useDeveloperText() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.toLowerCase().startsWith('en') ? 'en' : 'ja';
  const text = useCallback((key: DeveloperTextKey) => DEVELOPER_TEXT[language][key], [language]);
  return { language, text };
}
