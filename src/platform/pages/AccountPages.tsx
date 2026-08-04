import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, asArray, asRecord, queryValue, recordText } from '../api-client';
import { nativeCallback, openExternalUrl } from '../external-navigation';
import type { RouteMatch } from '../route-registry';
import { BusyState, EmptyState, ErrorState, ResponsivePageShell } from '../ResponsivePageShell';
import { FormResult, KeyValueGrid, Panel, RecordList, ResourceShell, SelectField, submitForm, useResource, type SubmitState } from './page-kit';

function AccountPage({ route }: { route: RouteMatch }) {
  return <ResourceShell route={route} endpoint="/api/account" description="Profile、Account状態、Plan、Creditの現在値を表示します。">{(payload) => <><Panel title="Account"><KeyValueGrid value={asRecord(payload).account ?? asRecord(payload).data ?? payload} /></Panel><div className="platform-card-grid"><a className="platform-link-card" href="/account/security"><strong>Security</strong><span>Password、Passkey、2FA、Session</span><b>›</b></a><a className="platform-link-card" href="/account/subscription"><strong>Plan</strong><span>Subscription管理</span><b>›</b></a><a className="platform-link-card" href="/account/credit"><strong>Credit</strong><span>残高とLedger</span><b>›</b></a></div></>}</ResourceShell>;
}

function SecurityPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/account/security');
  return <ResponsivePageShell route={route} description="Password、Passkey、2FA、Backup Code、Sessionを管理します。">
    <Panel title="Security状態">{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <KeyValueGrid value={asRecord(resource.data).security ?? asRecord(resource.data).data ?? resource.data} />}</Panel>
    <Panel title="Security操作">
      <p className="platform-form-result" role="status">Passkey登録、2FA設定、Backup Code再生成は、Browser Credential／QR／Secretの完全Flowが接続されるまで停止しています。成功したように見せる空POSTは行いません。</p>
      <div className="platform-action-row">
        <button className="platform-button" type="button" disabled aria-disabled="true">Passkeyを追加</button>
        <button className="platform-button" type="button" disabled aria-disabled="true">2FAを有効化</button>
        <button className="platform-button" type="button" disabled aria-disabled="true">Backup Code再生成</button>
      </div>
    </Panel>
  </ResponsivePageShell>;
}

function SubscriptionPage({ route }: { route: RouteMatch }) {
  return <ResourceShell route={route} endpoint="/api/account/catalog" description="現在Planと変更可能なPlanを同じCatalog Versionから表示します。">{(payload) => {
    const root = asRecord(payload); const plans = asArray(payload, ['plans', 'available_plans']);
    return <><Panel title="現在の契約"><KeyValueGrid value={root.account ?? root.subscription ?? root.data ?? root} /></Panel><Panel title="変更可能なPlan"><RecordList items={plans} titleKeys={['display_name', 'name', 'plan_id', 'id']} subtitleKeys={['price_label', 'description', 'status']} link={(record) => { const id = recordText(record, ['plan_id', 'id']); return id ? `/account/checkout?plan=${encodeURIComponent(id)}&return_to=account` : null; }} /></Panel><a className="platform-button" href="/pricing">公開料金Pageを確認</a></>;
  }}</ResourceShell>;
}

function allowedCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin) return true;
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'square.link' || host.endsWith('.square.site') || host.endsWith('.squareup.com');
  } catch {
    return false;
  }
}

function CreditPage({ route }: { route: RouteMatch }) {
  const [balance] = useResource('/api/credit/balance');
  const [ledger, reload] = useResource('/api/credit/ledger');
  const [catalog] = useResource('/api/account/catalog');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const [productId, setProductId] = useState('');

  const products = useMemo(() => {
    if (catalog.status !== 'ready') return [];
    return asArray(catalog.data, ['creditProducts', 'credit_products', 'products'])
      .map(asRecord)
      .filter((product) => product.active !== false && recordText(product, ['product_id', 'id']));
  }, [catalog]);

  useEffect(() => {
    if (!productId && products.length) setProductId(recordText(products[0], ['product_id', 'id']));
  }, [productId, products]);

  const productOptions = products.map((product) => {
    const value = recordText(product, ['product_id', 'id']);
    const name = recordText(product, ['display_name', 'name'], value);
    const amount = recordText(product, ['price_label', 'amount_label', 'amount']);
    const credits = recordText(product, ['credits_label', 'credits']);
    return { value, label: [name, amount, credits].filter(Boolean).join(' / ') };
  });

  const purchase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!productId || !products.some((product) => recordText(product, ['product_id', 'id']) === productId)) {
      setState({ type: 'error', message: 'Catalogに存在するCredit商品を選択してください。', code: 'CREDIT_PRODUCT_REQUIRED' });
      return;
    }
    const payload = await submitForm('/api/billing/checkout-intents', {
      product_id: productId,
      return_to: 'credit',
      native_callback: nativeCallback('/account/billing/status'),
    }, setState, { success: 'Checkoutを準備しました。', idempotent: true });
    if (!payload) return;
    const url = recordText(asRecord(payload), ['checkout_url', 'url', 'redirect_url']);
    if (!url || !allowedCheckoutUrl(url)) {
      setState({ type: 'error', message: '許可されたCheckout URLを確認できません。', code: 'CHECKOUT_URL_REJECTED' });
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
    <Panel title="Creditを追加">
      {catalog.status === 'loading' ? <BusyState label="購入可能なCredit商品を確認しています…" /> : catalog.status === 'error' ? <ErrorState error={catalog.error} /> : products.length === 0 ? <EmptyState>現在購入可能なCredit商品はありません。</EmptyState> : <form className="platform-inline-form" onSubmit={purchase}><SelectField label="Credit商品" name="product_id" value={productId} onChange={setProductId} options={productOptions} /><button className="platform-button is-primary" type="submit" disabled={!productId || state.type === 'working'}>Checkoutへ</button></form>}
      <FormResult state={state} />
    </Panel>
    <Panel title="Ledger">{ledger.status === 'loading' ? <BusyState /> : ledger.status === 'error' ? <ErrorState error={ledger.error} onRetry={reload} /> : <RecordList items={asArray(ledger.data, ['ledger', 'entries', 'items'])} titleKeys={['type', 'description', 'transaction_id', 'id']} subtitleKeys={['amount', 'created_at', 'status']} />}</Panel>
  </ResponsivePageShell>;
}

function BillingStatusPage({ route }: { route: RouteMatch }) {
  const intent = queryValue('intent') || queryValue('intent_id');
  const endpoint = intent ? `/api/billing/status/${encodeURIComponent(intent)}` : null;
  const [resource, reload] = useResource(endpoint);
  return <ResponsivePageShell route={route} description="Redirectだけを信用せず、Webhook反映済みBilling状態を確認します。">{!intent ? <ErrorState error={new ApiError('Billing Intent IDがありません。', 0, 'INTENT_ID_REQUIRED')} /> : resource.status === 'loading' ? <BusyState label="決済反映を確認しています…" /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <><Panel title="Billing状態"><KeyValueGrid value={resource.data} /></Panel><button className="platform-button" type="button" onClick={reload}>再照合</button></>}</ResponsivePageShell>;
}

function targetCanIssue(record: ReturnType<typeof asRecord>): boolean {
  const availability = recordText(record, ['availability', 'status']).toLowerCase();
  if (record.key_issuance_allowed === false) return false;
  return availability === 'available' || availability === 'active' || availability === 'ready';
}

function DeveloperPage({ route }: { route: RouteMatch }) {
  const [catalog] = useResource('/api/developer/catalog');
  const [keys, reload] = useResource('/api/developer/keys');
  const [target, setTarget] = useState('');
  const [createdSecret, setCreatedSecret] = useState('');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const targets = catalog.status === 'ready' ? asArray(catalog.data, ['targets', 'catalog', 'items']) : [];
  const issuableTargets = targets.map(asRecord).filter(targetCanIssue);

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    const selected = issuableTargets.find((item) => recordText(item, ['target_id', 'id']) === target);
    if (!selected) {
      setState({ type: 'error', message: '現在発行可能なTargetを選択してください。', code: 'DEVELOPER_TARGET_UNAVAILABLE' });
      return;
    }
    setCreatedSecret('');
    const payload = await submitForm(`/api/developer/targets/${encodeURIComponent(target)}/keys`, { environment: 'sandbox', scopes: ['execute', 'read:usage'] }, setState, { success: 'API Keyを発行しました。', idempotent: true });
    if (!payload) return;
    const secret = recordText(asRecord(payload), ['api_key', 'secret', 'key']);
    if (!secret) {
      setState({ type: 'error', message: '一度だけ表示するAPI Key Secretを受信できませんでした。', code: 'API_KEY_SECRET_MISSING' });
      return;
    }
    setCreatedSecret(secret);
    reload();
  };

  return <ResponsivePageShell route={route} description="Account-linked API Catalog、Key、Usage、OpenAPIを管理します。">
    <Panel title="API Catalog">{catalog.status === 'loading' ? <BusyState /> : catalog.status === 'error' ? <ErrorState error={catalog.error} /> : <RecordList items={targets} titleKeys={['display_name', 'name', 'target_id', 'id']} subtitleKeys={['availability', 'status', 'description']} />}</Panel>
    <Panel title="Sandbox Key発行">
      {catalog.status === 'ready' && issuableTargets.length === 0 ? <EmptyState>現在Keyを発行できるTargetはありません。</EmptyState> : <form className="platform-inline-form" onSubmit={createKey}><SelectField label="Target" name="target" value={target} onChange={setTarget} options={[{ value: '', label: '選択してください' }, ...issuableTargets.map((record) => { const value = recordText(record, ['target_id', 'id']); return { value, label: recordText(record, ['display_name', 'name'], value) }; })]} /><button className="platform-button is-primary" type="submit" disabled={!target || state.type === 'working'}>発行</button></form>}
      <FormResult state={state} />
      {createdSecret && <div className="platform-form-result is-success" role="status"><strong>このSecretは再表示されません。今すぐ安全な場所へ保存してください。</strong><code>{createdSecret}</code></div>}
    </Panel>
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
