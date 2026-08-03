import { useState, type FormEvent } from 'react';
import { ApiError, asArray, asRecord, queryValue, recordText, textValue, type JsonObject } from '../api-client';
import { nativeCallback, openExternalUrl } from '../external-navigation';
import type { RouteMatch } from '../route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../ResponsivePageShell';
import { Field, FormResult, KeyValueGrid, Panel, RecordList, ResourceShell, SelectField, submitForm, useResource, type SubmitState } from './page-kit';

function AccountPage({ route }: { route: RouteMatch }) {
  return <ResourceShell route={route} endpoint="/api/account" description="Profile、Account状態、Plan、Creditの現在値を表示します。">{(payload) => <><Panel title="Account"><KeyValueGrid value={asRecord(payload).account ?? asRecord(payload).data ?? payload} /></Panel><div className="platform-card-grid"><a className="platform-link-card" href="/account/security"><strong>Security</strong><span>Password、Passkey、2FA、Session</span><b>›</b></a><a className="platform-link-card" href="/account/subscription"><strong>Plan</strong><span>Subscription管理</span><b>›</b></a><a className="platform-link-card" href="/account/credit"><strong>Credit</strong><span>残高とLedger</span><b>›</b></a></div></>}</ResourceShell>;
}

function SecurityPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/account/security');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const action = async (endpoint: string, body: JsonObject = {}) => {
    await submitForm(endpoint, body, setState, { success: 'Security設定を更新しました。', idempotent: true }); reload();
  };
  return <ResponsivePageShell route={route} description="Password、Passkey、2FA、Backup Code、Sessionを管理します。">
    <Panel title="Security状態">{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <KeyValueGrid value={asRecord(resource.data).security ?? asRecord(resource.data).data ?? resource.data} />}</Panel>
    <Panel title="Security操作"><div className="platform-action-row"><button className="platform-button" type="button" onClick={() => void action('/api/account/passkeys')}>Passkeyを追加</button><button className="platform-button" type="button" onClick={() => void action('/api/account/2fa/enable')}>2FAを有効化</button><button className="platform-button" type="button" onClick={() => void action('/api/account/2fa/backup-codes/regenerate')}>Backup Code再生成</button></div><FormResult state={state} /></Panel>
  </ResponsivePageShell>;
}

function SubscriptionPage({ route }: { route: RouteMatch }) {
  return <ResourceShell route={route} endpoint="/api/account/catalog" description="現在Planと変更可能なPlanを同じCatalog Versionから表示します。">{(payload) => {
    const root = asRecord(payload); const plans = asArray(payload, ['plans', 'available_plans']);
    return <><Panel title="現在の契約"><KeyValueGrid value={root.account ?? root.subscription ?? root.data ?? root} /></Panel><Panel title="変更可能なPlan"><RecordList items={plans} titleKeys={['display_name', 'name', 'plan_id', 'id']} subtitleKeys={['price_label', 'description', 'status']} link={(record) => { const id = recordText(record, ['plan_id', 'id']); return id ? `/account/checkout?plan=${encodeURIComponent(id)}&return_to=account` : null; }} /></Panel><a className="platform-button" href="/pricing">公開料金Pageを確認</a></>;
  }}</ResourceShell>;
}

function CreditPage({ route }: { route: RouteMatch }) {
  const [balance] = useResource('/api/credit/balance');
  const [ledger, reload] = useResource('/api/credit/ledger');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const purchase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = await submitForm('/api/billing/checkout-intents', {
      product_id: textValue(data.get('product_id')),
      return_to: 'credit',
      native_callback: nativeCallback('/account/billing/status'),
    }, setState, { success: 'Checkoutを準備しました。', idempotent: true });
    const url = recordText(asRecord(payload), ['checkout_url', 'url', 'redirect_url']);
    if (!url) {
      setState({ type: 'error', message: 'Checkout URLがありません。', code: 'CHECKOUT_URL_MISSING' });
      return;
    }
    try {
      await openExternalUrl(url);
      setState({ type: 'idle' });
    } catch (error) {
      setState({ type: 'error', message: error instanceof Error ? error.message : 'Checkoutを開けませんでした。', code: 'CHECKOUT_OPEN_FAILED' });
    }
  };
  return <ResponsivePageShell route={route} description="Credit残高、取引Ledger、追加購入を管理します。">
    <Panel title="残高">{balance.status === 'loading' ? <BusyState /> : balance.status === 'error' ? <ErrorState error={balance.error} /> : <KeyValueGrid value={balance.data} />}</Panel>
    <Panel title="Creditを追加"><form className="platform-inline-form" onSubmit={purchase}><Field label="Credit Product ID" name="product_id" required /><button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>Checkoutへ</button></form><FormResult state={state} /></Panel>
    <Panel title="Ledger">{ledger.status === 'loading' ? <BusyState /> : ledger.status === 'error' ? <ErrorState error={ledger.error} onRetry={reload} /> : <RecordList items={asArray(ledger.data, ['ledger', 'entries', 'items'])} titleKeys={['type', 'description', 'transaction_id', 'id']} subtitleKeys={['amount', 'created_at', 'status']} />}</Panel>
  </ResponsivePageShell>;
}

function BillingStatusPage({ route }: { route: RouteMatch }) {
  const intent = queryValue('intent') || queryValue('intent_id');
  const endpoint = intent ? `/api/billing/status/${encodeURIComponent(intent)}` : null;
  const [resource, reload] = useResource(endpoint);
  return <ResponsivePageShell route={route} description="Redirectだけを信用せず、Webhook反映済みBilling状態を確認します。">{!intent ? <ErrorState error={new ApiError('Billing Intent IDがありません。', 0, 'INTENT_ID_REQUIRED')} /> : resource.status === 'loading' ? <BusyState label="決済反映を確認しています…" /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <><Panel title="Billing状態"><KeyValueGrid value={resource.data} /></Panel><button className="platform-button" type="button" onClick={reload}>再照合</button></>}</ResponsivePageShell>;
}

function DeveloperPage({ route }: { route: RouteMatch }) {
  const [catalog] = useResource('/api/developer/catalog');
  const [keys, reload] = useResource('/api/developer/keys');
  const [target, setTarget] = useState('');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const createKey = async (event: FormEvent) => {
    event.preventDefault(); if (!target) return;
    await submitForm(`/api/developer/targets/${encodeURIComponent(target)}/keys`, { environment: 'sandbox', scopes: ['execute', 'read:usage'] }, setState, { success: 'API Keyを発行しました。Secretはこの画面で一度だけ確認してください。', idempotent: true }); reload();
  };
  const targets = catalog.status === 'ready' ? asArray(catalog.data, ['targets', 'catalog', 'items']) : [];
  return <ResponsivePageShell route={route} description="Account-linked API Catalog、Key、Usage、OpenAPIを管理します。">
    <Panel title="API Catalog">{catalog.status === 'loading' ? <BusyState /> : catalog.status === 'error' ? <ErrorState error={catalog.error} /> : <RecordList items={targets} titleKeys={['display_name', 'name', 'target_id', 'id']} subtitleKeys={['status', 'description']} />}</Panel>
    <Panel title="Sandbox Key発行"><form className="platform-inline-form" onSubmit={createKey}><SelectField label="Target" name="target" value={target} onChange={setTarget} options={[{ value: '', label: '選択してください' }, ...targets.map((item) => { const record = asRecord(item); const value = recordText(record, ['target_id', 'id']); return { value, label: recordText(record, ['display_name', 'name'], value) }; }).filter((item) => item.value)]} /><button className="platform-button is-primary" type="submit" disabled={!target}>発行</button></form><FormResult state={state} /></Panel>
    <Panel title="API Keys">{keys.status === 'loading' ? <BusyState /> : keys.status === 'error' ? <ErrorState error={keys.error} onRetry={reload} /> : <RecordList items={asArray(keys.data, ['keys', 'items'])} titleKeys={['label', 'target_id', 'key_id', 'id']} subtitleKeys={['status', 'environment', 'created_at']} />}</Panel>
  </ResponsivePageShell>;
}

export function AccountPlatformPage({ route }: { route: RouteMatch }) {
  switch (route.id) {
    case 'account': return <AccountPage route={route} />;
    case 'account-security': return <SecurityPage route={route} />;
    case 'account-subscription': return <SubscriptionPage route={route} />;
    case 'account-credit': return <CreditPage route={route} />;
    case 'billing-status': return <BillingStatusPage route={route} />;
    case 'developer': return <DeveloperPage route={route} />;
    default: return null;
  }
}
