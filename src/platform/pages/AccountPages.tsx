import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isAllowedCheckoutUrl } from '../../features/checkout/checkout-security';
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

function CreditPage({ route }: { route: RouteMatch }) {
  const [balance] = useResource('/api/credit/balance');
  const [ledger, reload] = useResource('/api/credit/ledger');
  const [catalog] = useResource('/api/account/catalog');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const [productId, setProductId] = useState('');
  const loginReturn = encodeURIComponent(window.location.pathname + window.location.search);
  const authenticationState = state.code === 'FRESH_SESSION_REQUIRED'
    ? 'reauth-required'
    : state.code === 'SESSION_REQUIRED'
      ? 'login-required'
      : null;

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
    if (!url || !isAllowedCheckoutUrl(url)) {
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
      <FormResult state={authenticationState === 'reauth-required' ? { type: 'error', message: '安全な決済操作のため再認証してください。', code: state.code } : authenticationState === 'login-required' ? { type: 'error', message: '決済へ進むにはLoginが必要です。', code: state.code } : state} />
      {authenticationState && <a className="platform-button" href={`/login?return_to=${loginReturn}`}>{authenticationState === 'reauth-required' ? '再認証' : 'Login'}</a>}
    </Panel>
    <Panel title="Ledger">{ledger.status === 'loading' ? <BusyState /> : ledger.status === 'error' ? <ErrorState error={ledger.error} onRetry={reload} /> : <RecordList items={asArray(ledger.data, ['ledger', 'entries', 'items'])} titleKeys={['type', 'description', 'transaction_id', 'id']} subtitleKeys={['amount', 'created_at', 'status']} />}</Panel>
  </ResponsivePageShell>;
}

function numericValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(amount: number | null, currency: string): string {
  if (amount === null) return '—';
  try {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: currency || 'JPY',
      maximumFractionDigits: currency === 'JPY' || !currency ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('ja-JP')} ${currency || 'JPY'}`;
  }
}

function formatCredit(amount: number | null): string {
  return amount === null ? '—' : `${amount.toLocaleString('ja-JP')} C`;
}

function friendlyProductName(kind: string, productId: string, catalogPayload: unknown): string {
  if (kind === 'plan') {
    const plans = asArray(catalogPayload, ['plans', 'available_plans']).map(asRecord);
    const plan = plans.find((item) => recordText(item, ['plan_id', 'id']) === productId);
    const catalogName = plan ? recordText(plan, ['display_name', 'name']) : '';
    if (catalogName) return catalogName;
    const normalized = productId.split(/[-_]/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
    return normalized ? `${normalized} Plan` : 'Plan';
  }
  if (kind === 'credit') return 'Credit追加';
  if (kind === 'storage') return 'Astera Storage';
  return productId || 'ご購入内容';
}

function BillingStatusPage({ route }: { route: RouteMatch }) {
  const intent = queryValue('intent') || queryValue('intent_id');
  const endpoint = intent ? `/api/billing/status/${encodeURIComponent(intent)}` : null;
  const [resource, reload] = useResource(endpoint);
  const [balance] = useResource('/api/credit/balance');
  const [catalog] = useResource('/api/account/catalog');
  const customerRoute = useMemo(() => ({ ...route, title: 'お支払い' }), [route]);

  if (!intent) {
    return <ResponsivePageShell route={customerRoute} description="お支払い内容を確認します。"><ErrorState error={new ApiError('お支払い情報を確認できませんでした。', 0, 'INTENT_ID_REQUIRED')} /></ResponsivePageShell>;
  }
  if (resource.status === 'loading') {
    return <ResponsivePageShell route={customerRoute} description="お支払い内容を確認します。"><BusyState label="お支払いの反映を確認しています…" /></ResponsivePageShell>;
  }
  if (resource.status === 'error') {
    return <ResponsivePageShell route={customerRoute} description="お支払い内容を確認します。"><ErrorState error={resource.error} onRetry={reload} /></ResponsivePageShell>;
  }

  const data = asRecord(resource.data);
  const kind = recordText(data, ['product_kind']).toLowerCase();
  const productId = recordText(data, ['product_id']);
  const status = recordText(data, ['status']).toLowerCase();
  const failureCode = recordText(data, ['failure_code']);
  const money = asRecord(data.money);
  const amount = numericValue(money.amount);
  const currency = recordText(money, ['currency'], 'JPY');
  const creditAmount = numericValue(data.credit_amount);
  const creditPosted = data.credit_posted === true;
  const completedAt = recordText(data, ['completed_at']);
  const failed = Boolean(failureCode) || ['failed', 'expired', 'cancelled', 'canceled'].includes(status);
  const creditStillPosting = kind === 'credit' && status === 'completed' && (creditAmount ?? 0) > 0 && !creditPosted;
  const complete = status === 'completed' && !failed && !creditStillPosting;
  const pending = !failed && !complete;

  const balanceRoot = balance.status === 'ready' ? asRecord(balance.data) : {};
  const balanceRecord = asRecord(balanceRoot.credit ?? balanceRoot.data ?? balanceRoot);
  const currentCredit = numericValue(balanceRecord.available_balance ?? balanceRecord.balance ?? balanceRecord.current_balance);
  const catalogPayload = catalog.status === 'ready' ? catalog.data : null;
  const productName = friendlyProductName(kind, productId, catalogPayload);

  const title = complete
    ? kind === 'plan' ? 'プランの登録が完了しました' : 'お支払いが完了しました'
    : failed
      ? 'お支払いを確認できませんでした'
      : 'お支払いを確認しています';
  const message = complete
    ? kind === 'plan'
      ? '購入したプランとCreditがAsteraアカウントへ反映されています。'
      : '購入内容がAsteraアカウントへ反映されました。'
    : failed
      ? '同じお支払いを繰り返さず、状態を確認するかサポートをご利用ください。'
      : 'Squareからの確定情報を確認しています。二重決済を防ぐため、もう一度支払わずこの画面で状態を確認してください。';

  const shellStyle = { width: '100%', maxWidth: '760px', margin: '0 auto', display: 'grid', gap: '16px' } as const;
  const heroStyle = {
    display: 'grid',
    justifyItems: 'center',
    gap: '12px',
    padding: 'clamp(24px, 5vw, 40px) clamp(18px, 5vw, 36px)',
    border: '1px solid var(--platform-border)',
    borderRadius: '24px',
    background: 'var(--platform-surface)',
    textAlign: 'center',
  } as const;
  const iconStyle = {
    width: '56px',
    height: '56px',
    display: 'grid',
    placeItems: 'center',
    borderRadius: '999px',
    border: '1px solid color-mix(in srgb, var(--platform-accent) 58%, var(--platform-border))',
    background: 'color-mix(in srgb, var(--platform-accent) 10%, var(--platform-surface))',
    color: 'var(--platform-text)',
    fontSize: '26px',
    fontWeight: 700,
  } as const;
  const summaryStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '1px',
    overflow: 'hidden',
    border: '1px solid var(--platform-border)',
    borderRadius: '18px',
    background: 'var(--platform-border)',
  } as const;
  const summaryCellStyle = {
    minWidth: 0,
    padding: '16px 18px',
    background: 'var(--platform-surface)',
  } as const;
  const summaryLabelStyle = { margin: 0, color: 'var(--platform-muted)', fontSize: '12px' } as const;
  const summaryValueStyle = { margin: '6px 0 0', color: 'var(--platform-text)', fontSize: '18px', fontWeight: 700, overflowWrap: 'anywhere' } as const;
  const actionsStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' } as const;

  return <ResponsivePageShell route={customerRoute} description={complete ? 'お支払い内容と反映結果をご確認ください。' : pending ? 'お支払いの反映状況を確認しています。' : 'お支払い状況をご確認ください。'}>
    <div style={shellStyle}>
      <section style={heroStyle} aria-live="polite">
        <div style={iconStyle} aria-hidden="true">{complete ? '✓' : failed ? '!' : '…'}</div>
        <div>
          <h2 style={{ margin: 0, fontSize: 'clamp(24px, 5vw, 34px)', lineHeight: 1.2 }}>{title}</h2>
          <p style={{ margin: '10px auto 0', maxWidth: '560px', color: 'var(--platform-muted)', lineHeight: 1.7 }}>{message}</p>
        </div>
      </section>

      <section aria-labelledby="billing-summary-heading">
        <h2 id="billing-summary-heading" style={{ margin: '0 0 10px', fontSize: '18px' }}>ご購入内容</h2>
        <dl style={summaryStyle}>
          <div style={summaryCellStyle}><dt style={summaryLabelStyle}>{kind === 'plan' ? 'プラン' : '内容'}</dt><dd style={summaryValueStyle}>{productName}</dd></div>
          <div style={summaryCellStyle}><dt style={summaryLabelStyle}>今回のお支払い</dt><dd style={summaryValueStyle}>{formatMoney(amount, currency)}</dd></div>
          {(creditAmount ?? 0) > 0 && <div style={summaryCellStyle}><dt style={summaryLabelStyle}>{complete ? '付与Credit' : '付与予定Credit'}</dt><dd style={summaryValueStyle}>{complete ? '+' : ''}{formatCredit(creditAmount)}</dd></div>}
          {currentCredit !== null && <div style={summaryCellStyle}><dt style={summaryLabelStyle}>現在のCredit</dt><dd style={summaryValueStyle}>{formatCredit(currentCredit)}</dd></div>}
          {complete && completedAt && <div style={summaryCellStyle}><dt style={summaryLabelStyle}>反映日時</dt><dd style={{ ...summaryValueStyle, fontSize: '15px' }}>{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(completedAt))}</dd></div>}
        </dl>
      </section>

      {complete && <p style={{ margin: 0, color: 'var(--platform-muted)', textAlign: 'center', lineHeight: 1.6 }}>{kind === 'plan' ? '契約内容や変更・解約は「プランを管理」から確認できます。' : '購入履歴はCredit管理からいつでも確認できます。'}</p>}
      {pending && <div className="platform-form-result" role="status"><strong>反映待ちです。</strong><span> 数秒〜数分かかる場合があります。二重決済を避けるため、支払いボタンへ戻らず状態を更新してください。</span></div>}
      {failed && <div className="platform-form-result is-error" role="alert"><strong>追加のお支払いは行わないでください。</strong><span> 状態を更新しても解消しない場合はサポートへお問い合わせください。</span></div>}

      <div style={actionsStyle}>
        {complete && <a className="platform-button is-primary" href="/app/new">Asteraを使う</a>}
        {pending && <button className="platform-button is-primary" type="button" onClick={reload}>状態を更新</button>}
        {failed && <button className="platform-button is-primary" type="button" onClick={reload}>状態を更新</button>}
        {kind === 'plan' && <a className="platform-button" href="/account/subscription">プランを管理</a>}
        {(kind === 'credit' || (creditAmount ?? 0) > 0) && <a className="platform-button" href="/account/credit">Creditを確認</a>}
        {failed && <a className="platform-button" href="/support">サポート</a>}
      </div>
    </div>
  </ResponsivePageShell>;
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
