import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAppText } from '../../app-text';
import { asArray, asRecord, recordText, textValue, type JsonObject } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, EmptyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, KeyValueGrid, Panel, SelectField, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './developer-page.css';

const HOLD_PRIORITY = ['security_hold', 'account_suspended', 'plan_entitlement', 'target_suspended', 'credit_insufficient'] as const;
const HOLD_LABELS: Record<string, string> = {
  security_hold: 'Security確認中',
  account_suspended: 'Account停止',
  plan_entitlement: 'Plan変更で停止',
  target_suspended: 'Target停止',
  credit_insufficient: 'Credit不足で停止中',
};

function targetCanIssue(record: JsonObject): boolean {
  const availability = recordText(record, ['availability', 'status']).toLowerCase();
  if (record.key_issuance_allowed === false) return false;
  return availability === 'available' || availability === 'active' || availability === 'ready';
}
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}
function holds(record: JsonObject): string[] {
  return stringList(record.hold_reasons ?? record.holdReasons ?? record.runtime_holds ?? record.holds);
}
function effectiveState(record: JsonObject): string {
  const control = recordText(record, ['control_status', 'controlStatus', 'status'], 'active');
  if (control !== 'active') {
    if (control === 'paused_user') return '利用者が停止中';
    if (control === 'revoked') return '削除済み';
    if (control === 'expired') return '期限切れ';
    return control;
  }
  const reasons = holds(record);
  const primary = HOLD_PRIORITY.find((reason) => reasons.includes(reason));
  return primary ? HOLD_LABELS[primary] : '稼働中';
}
function scopedObject(record: JsonObject, keys: string[]): JsonObject {
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (Object.keys(value).length) return value;
  }
  return {};
}

export default function DeveloperPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  const [account] = useResource('/api/account');
  const [credit] = useResource('/api/credit/balance');
  const [catalog] = useResource('/api/developer/catalog');
  const [keys, reloadKeys] = useResource('/api/developer/keys');
  const [target, setTarget] = useState('');
  const [createdSecret, setCreatedSecret] = useState('');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });

  useEffect(() => {
    document.documentElement.dataset.developerDedicatedOwner = 'true';
    return () => { delete document.documentElement.dataset.developerDedicatedOwner; };
  }, []);

  const accountRecord = account.status === 'ready' ? asRecord(asRecord(account.data).account ?? asRecord(account.data).data ?? account.data) : {};
  const creditRecord = credit.status === 'ready' ? asRecord(asRecord(credit.data).credit ?? asRecord(credit.data).balance ?? credit.data) : {};
  const targetItems = catalog.status === 'ready' ? asArray(catalog.data, ['targets', 'catalog', 'items']).map(asRecord) : [];
  const keyItems = keys.status === 'ready' ? asArray(keys.data, ['keys', 'items']).map(asRecord) : [];
  const issuableTargets = targetItems.filter(targetCanIssue);
  const vaultTarget = targetItems.find((item) => {
    const value = `${recordText(item, ['target_id', 'id'])} ${recordText(item, ['display_name', 'name'])}`.toLowerCase();
    return value.includes('libral') && value.includes('vault');
  });

  useEffect(() => {
    if (!target && issuableTargets.length) setTarget(recordText(issuableTargets[0], ['target_id', 'id']));
  }, [issuableTargets, target]);

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    const selected = issuableTargets.find((item) => recordText(item, ['target_id', 'id']) === target);
    if (!selected) {
      setState({ type: 'error', message: '現在発行可能なTargetを選択してください。', code: 'DEVELOPER_TARGET_UNAVAILABLE' });
      return;
    }
    setCreatedSecret('');
    const payload = await submitForm(`/api/developer/targets/${encodeURIComponent(target)}/keys`, {
      environment: 'sandbox',
      scopes: ['execute', 'read:usage'],
    }, setState, { success: 'Sandbox API Keyを発行しました。', idempotent: true });
    if (!payload) return;
    const secret = recordText(asRecord(payload), ['api_key', 'secret', 'key']);
    if (!secret) {
      setState({ type: 'error', message: '一度だけ表示するAPI Key Secretを受信できませんでした。', code: 'API_KEY_SECRET_MISSING' });
      return;
    }
    setCreatedSecret(secret);
    reloadKeys();
  };

  const summary = useMemo(() => ({
    account: recordText(accountRecord, ['email', 'display_name', 'user_id', 'id'], '—'),
    tenant_workspace: recordText(accountRecord, ['tenant_name', 'workspace_name', 'tenant_id'], '—'),
    current_plan: recordText(accountRecord, ['plan_name', 'plan', 'plan_id'], '—'),
    api_entitlement: textValue(accountRecord.api_entitlement ?? accountRecord.developer_api_enabled, '—'),
    available_credit: textValue(creditRecord.available_credits ?? creditRecord.available ?? creditRecord.balance, '—'),
    reserved_credit: textValue(creditRecord.reserved_credits ?? creditRecord.reserved, '—'),
    api_keys: keyItems.length,
    catalog_targets: targetItems.length,
  }), [accountRecord, creditRecord, keyItems.length, targetItems.length]);

  const creditState = recordText(creditRecord, ['credit_state', 'state', 'status']).toLowerCase();
  const showCreditWarning = ['low', 'critical', 'insufficient', 'depleted'].some((value) => creditState.includes(value));

  return <ResponsivePageShell route={route} description="Account-linked API Catalog、Key状態、Runtime Hold、Credit、Usageを管理します。Public Key全文は発行直後だけ表示します。">
    {showCreditWarning && <div className="developer-credit-banner" role="status"><div><strong>Developer API Credit警告</strong><span>{creditState || 'Credit状態を確認してください。'}</span></div><a className="platform-button is-primary" href="/account/credit">Creditを追加</a></div>}

    <Panel title={text('navDeveloper')}>
      <div className="platform-card-grid">
        <div className="platform-link-card"><strong>{text('developerApi')}</strong><span>{text('developerAvailable')}</span></div>
        <div className="platform-link-card"><strong>{text('developerWebhook')}</strong><span>{text('developerAvailable')}</span></div>
        <div className="platform-link-card"><strong>{text('developerVault')}</strong><span>{text('developerVaultDescription')}</span><small>{vaultTarget ? recordText(vaultTarget, ['availability', 'status'], text('developerAvailable')) : text('developerUnavailable')}</small></div>
        <div className="platform-link-card"><strong>{text('developerDocs')}</strong><span>{text('developerAvailable')}</span></div>
      </div>
    </Panel>

    <Panel title="Developer Summary">
      {(account.status === 'loading' || credit.status === 'loading') && <BusyState />}
      {account.status === 'error' && <ErrorState error={account.error} />}
      {credit.status === 'error' && <ErrorState error={credit.error} />}
      {account.status === 'ready' && credit.status === 'ready' && <KeyValueGrid value={summary} />}
    </Panel>

    <Panel title="API Catalog">
      {catalog.status === 'loading' && <BusyState />}
      {catalog.status === 'error' && <ErrorState error={catalog.error} />}
      {catalog.status === 'ready' && targetItems.length === 0 && <EmptyState>利用可能なTarget Catalogはありません。</EmptyState>}
      {catalog.status === 'ready' && targetItems.length > 0 && <div className="developer-target-grid">{targetItems.map((item) => {
        const id = recordText(item, ['target_id', 'id']);
        const openapi = recordText(item, ['openapi_url', 'openapiUrl']);
        return <article key={id}><header><strong>{recordText(item, ['display_name', 'name'], id)}</strong><span>{recordText(item, ['availability', 'status'], 'unknown')}</span></header><p>{recordText(item, ['description']) || '説明未提供'}</p><div className="platform-action-row">{openapi ? <a className="platform-button" href={openapi} target="_blank" rel="noreferrer">OpenAPI</a> : <button className="platform-button" type="button" disabled>OpenAPI未提供</button>}</div></article>;
      })}</div>}
    </Panel>

    <Panel title="Sandbox Key発行">
      {catalog.status === 'ready' && issuableTargets.length === 0 ? <EmptyState>現在Keyを発行できるTargetはありません。</EmptyState> : <form className="platform-inline-form" onSubmit={createKey}><SelectField label="Target" name="target" value={target} onChange={setTarget} options={[{ value: '', label: '選択してください' }, ...issuableTargets.map((item) => { const value = recordText(item, ['target_id', 'id']); return { value, label: recordText(item, ['display_name', 'name'], value) }; })]} /><button className="platform-button is-primary" type="submit" disabled={!target || state.type === 'working'}>Sandbox Keyを発行</button><button className="platform-button" type="button" disabled title="Production KeyはFresh Session／再認証契約が接続されるまで発行しません。">Production Key</button></form>}
      <FormResult state={state} />
      {createdSecret && <div className="developer-secret" role="status"><strong>このSecretは今回だけ表示します。</strong><code>{createdSecret}</code><button className="platform-button" type="button" onClick={() => void navigator.clipboard.writeText(createdSecret)}>Copy</button></div>}
    </Panel>

    <Panel title="API Keys">
      {keys.status === 'loading' && <BusyState />}
      {keys.status === 'error' && <ErrorState error={keys.error} onRetry={reloadKeys} />}
      {keys.status === 'ready' && keyItems.length === 0 && <EmptyState>API Keyはありません。</EmptyState>}
      {keys.status === 'ready' && keyItems.length > 0 && <div className="developer-key-list">{keyItems.map((item) => {
        const id = recordText(item, ['key_id', 'id']);
        const reasons = holds(item);
        const scopes = stringList(item.scopes ?? item.scope);
        const usage = scopedObject(item, ['usage', 'usage_month', 'monthly_usage']);
        const rate = scopedObject(item, ['rate', 'rate_limit', 'quota']);
        return <article className="developer-key-card" key={id}>
          <header><div><strong>{recordText(item, ['label', 'name'], id)}</strong><small>{recordText(item, ['key_prefix', 'prefix'], 'Prefix未提供')}</small></div><b>{effectiveState(item)}</b></header>
          <dl>
            <div><dt>Target</dt><dd>{recordText(item, ['target_id', 'target'], '—')}</dd></div>
            <div><dt>Environment</dt><dd>{recordText(item, ['environment'], '—')}</dd></div>
            <div><dt>Scope</dt><dd>{scopes.join(', ') || '—'}</dd></div>
            <div><dt>Control Status</dt><dd>{recordText(item, ['control_status', 'controlStatus', 'status'], '—')}</dd></div>
            <div><dt>Runtime Hold</dt><dd>{reasons.map((reason) => HOLD_LABELS[reason] || reason).join(' / ') || 'なし'}</dd></div>
            <div><dt>Auto Resume</dt><dd>{textValue(item.auto_resume_after_credit ?? item.autoResumeAfterCredit, '—')}</dd></div>
            <div><dt>最終利用</dt><dd>{recordText(item, ['last_used_at', 'last_used'], '—')}</dd></div>
            <div><dt>概算残りRequest</dt><dd>{textValue(item.estimated_remaining_requests ?? item.remaining_requests, '—')}</dd></div>
          </dl>
          {(Object.keys(usage).length > 0 || Object.keys(rate).length > 0) && <div className="developer-key-detail-grid">{Object.keys(usage).length > 0 && <div><strong>Usage / Credit</strong><KeyValueGrid value={usage} /></div>}{Object.keys(rate).length > 0 && <div><strong>Rate / Quota</strong><KeyValueGrid value={rate} /></div>}</div>}
          <div className="platform-action-row">
            <button className="platform-button" type="button" disabled title="Lifecycle API Routeが正本で確定・接続されるまで送信しません。">Rotate</button>
            <button className="platform-button" type="button" disabled title="Lifecycle API Routeが正本で確定・接続されるまで送信しません。">Pause</button>
            <button className="platform-button" type="button" disabled title="Lifecycle API Routeが正本で確定・接続されるまで送信しません。">Resume</button>
            <button className="platform-button" type="button" disabled title="Production重要操作を含む削除Contractが接続されるまで送信しません。">Delete</button>
          </div>
        </article>;
      })}</div>}
    </Panel>

    <Panel title="未接続Lifecycle境界">
      <p className="developer-boundary-note">Rotate／Pause／Resume／Delete／Status History／Explorerの実API RouteはDeveloper正本にPathが確定していません。存在しないEndpointをFrontendから推測して呼ばず、外部Backend Contract確定後に接続します。停止されたRequestを自動再送する処理も追加していません。</p>
    </Panel>
  </ResponsivePageShell>;
}
