import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useDeveloperText, type DeveloperTextKey } from '../../developer-text';
import { asArray, asRecord, recordText, textValue, type JsonObject } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, EmptyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, KeyValueGrid, Panel, SelectField, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './developer-page.css';

const HOLD_PRIORITY = ['security_hold', 'account_suspended', 'plan_entitlement', 'target_suspended', 'credit_insufficient'] as const;
const HOLD_TEXT_KEYS: Record<string, DeveloperTextKey> = {
  security_hold: 'stateSecurityHold',
  account_suspended: 'stateAccountSuspended',
  plan_entitlement: 'statePlanEntitlement',
  target_suspended: 'stateTargetSuspended',
  credit_insufficient: 'stateCreditInsufficient',
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
function scopedObject(record: JsonObject, keys: string[]): JsonObject {
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (Object.keys(value).length) return value;
  }
  return {};
}

export default function DeveloperPage({ route }: { route: RouteMatch }) {
  const { text } = useDeveloperText();
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

  const holdLabel = (reason: string) => {
    const key = HOLD_TEXT_KEYS[reason];
    return key ? text(key) : reason;
  };
  const effectiveState = (record: JsonObject): string => {
    const control = recordText(record, ['control_status', 'controlStatus', 'status'], 'active');
    if (control !== 'active') {
      if (control === 'paused_user') return text('statePausedUser');
      if (control === 'revoked') return text('stateRevoked');
      if (control === 'expired') return text('stateExpired');
      return control;
    }
    const reasons = holds(record);
    const primary = HOLD_PRIORITY.find((reason) => reasons.includes(reason));
    return primary ? holdLabel(primary) : text('stateActive');
  };
  const statusLabel = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'low': return text('statusLow');
      case 'critical': return text('statusCritical');
      case 'insufficient': return text('statusInsufficient');
      case 'depleted': return text('statusDepleted');
      case 'available': return text('statusAvailable');
      case 'active': return text('stateActive');
      case 'ready': return text('statusReady');
      case 'unavailable': return text('statusUnavailable');
      default: return status || text('statusUnknown');
    }
  };

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    const selected = issuableTargets.find((item) => recordText(item, ['target_id', 'id']) === target);
    if (!selected) {
      setState({ type: 'error', message: text('targetUnavailable'), code: 'DEVELOPER_TARGET_UNAVAILABLE' });
      return;
    }
    setCreatedSecret('');
    const payload = await submitForm(`/api/developer/targets/${encodeURIComponent(target)}/keys`, {
      environment: 'sandbox',
      scopes: ['execute', 'read:usage'],
    }, setState, { success: text('sandboxIssued'), idempotent: true });
    if (!payload) return;
    const secret = recordText(asRecord(payload), ['api_key', 'secret', 'key']);
    if (!secret) {
      setState({ type: 'error', message: text('secretMissing'), code: 'API_KEY_SECRET_MISSING' });
      return;
    }
    setCreatedSecret(secret);
    reloadKeys();
  };

  const summary = useMemo(() => ({
    [text('summaryAccount')]: recordText(accountRecord, ['email', 'display_name', 'user_id', 'id'], '—'),
    [text('summaryWorkspace')]: recordText(accountRecord, ['tenant_name', 'workspace_name', 'tenant_id'], '—'),
    [text('summaryPlan')]: recordText(accountRecord, ['plan_name', 'plan', 'plan_id'], '—'),
    [text('summaryEntitlement')]: textValue(accountRecord.api_entitlement ?? accountRecord.developer_api_enabled, '—'),
    [text('summaryAvailableCredit')]: textValue(creditRecord.available_credits ?? creditRecord.available ?? creditRecord.balance, '—'),
    [text('summaryReservedCredit')]: textValue(creditRecord.reserved_credits ?? creditRecord.reserved, '—'),
    [text('summaryKeys')]: keyItems.length,
    [text('summaryTargets')]: targetItems.length,
  }), [accountRecord, creditRecord, keyItems.length, targetItems.length, text]);

  const creditState = recordText(creditRecord, ['credit_state', 'state', 'status']).toLowerCase();
  const showCreditWarning = ['low', 'critical', 'insufficient', 'depleted'].some((value) => creditState.includes(value));

  return <ResponsivePageShell route={route} description={text('pageDescription')}>
    {showCreditWarning && <div className="developer-credit-banner" role="status"><div><strong>{text('creditWarningTitle')}</strong><span>{statusLabel(creditState)}</span></div><a className="platform-button is-primary" href="/account/credit">{text('addCredit')}</a></div>}

    <Panel title={text('developerMode')}>
      <div className="platform-card-grid">
        <div className="platform-link-card"><strong>{text('api')}</strong><span>{text('available')}</span></div>
        <div className="platform-link-card"><strong>{text('webhook')}</strong><span>{text('available')}</span></div>
        <div className="platform-link-card"><strong>{text('vault')}</strong><span>{text('vaultDescription')}</span><small>{vaultTarget ? statusLabel(recordText(vaultTarget, ['availability', 'status'])) : text('notCataloged')}</small></div>
        <div className="platform-link-card"><strong>{text('docs')}</strong><span>{text('available')}</span></div>
      </div>
    </Panel>

    <Panel title={text('summary')}>
      {(account.status === 'loading' || credit.status === 'loading') && <BusyState />}
      {account.status === 'error' && <ErrorState error={account.error} />}
      {credit.status === 'error' && <ErrorState error={credit.error} />}
      {account.status === 'ready' && credit.status === 'ready' && <KeyValueGrid value={summary} />}
    </Panel>

    <Panel title={text('apiCatalog')}>
      {catalog.status === 'loading' && <BusyState />}
      {catalog.status === 'error' && <ErrorState error={catalog.error} />}
      {catalog.status === 'ready' && targetItems.length === 0 && <EmptyState>{text('noCatalog')}</EmptyState>}
      {catalog.status === 'ready' && targetItems.length > 0 && <div className="developer-target-grid">{targetItems.map((item) => {
        const id = recordText(item, ['target_id', 'id']);
        const openapi = recordText(item, ['openapi_url', 'openapiUrl']);
        return <article key={id}><header><strong>{recordText(item, ['display_name', 'name'], id)}</strong><span>{statusLabel(recordText(item, ['availability', 'status']))}</span></header><p>{recordText(item, ['description']) || text('descriptionMissing')}</p><div className="platform-action-row">{openapi ? <a className="platform-button" href={openapi} target="_blank" rel="noreferrer">{text('openApi')}</a> : <button className="platform-button" type="button" disabled>{text('openApiMissing')}</button>}</div></article>;
      })}</div>}
    </Panel>

    <Panel title={text('sandboxIssue')}>
      {catalog.status === 'ready' && issuableTargets.length === 0 ? <EmptyState>{text('noIssuableTarget')}</EmptyState> : <form className="platform-inline-form" onSubmit={createKey}><SelectField label={text('selectTarget')} name="target" value={target} onChange={setTarget} options={[{ value: '', label: text('selectPrompt') }, ...issuableTargets.map((item) => { const value = recordText(item, ['target_id', 'id']); return { value, label: recordText(item, ['display_name', 'name'], value) }; })]} /><button className="platform-button is-primary" type="submit" disabled={!target || state.type === 'working'}>{text('issueSandbox')}</button><button className="platform-button" type="button" disabled title={text('productionKeyUnavailable')}>{text('productionKey')}</button></form>}
      <FormResult state={state} />
      {createdSecret && <div className="developer-secret" role="status"><strong>{text('secretOnce')}</strong><code>{createdSecret}</code><button className="platform-button" type="button" onClick={() => void navigator.clipboard.writeText(createdSecret)}>{text('copy')}</button></div>}
    </Panel>

    <Panel title={text('apiKeys')}>
      {keys.status === 'loading' && <BusyState />}
      {keys.status === 'error' && <ErrorState error={keys.error} onRetry={reloadKeys} />}
      {keys.status === 'ready' && keyItems.length === 0 && <EmptyState>{text('noApiKeys')}</EmptyState>}
      {keys.status === 'ready' && keyItems.length > 0 && <div className="developer-key-list">{keyItems.map((item) => {
        const id = recordText(item, ['key_id', 'id']);
        const reasons = holds(item);
        const scopes = stringList(item.scopes ?? item.scope);
        const usage = scopedObject(item, ['usage', 'usage_month', 'monthly_usage']);
        const rate = scopedObject(item, ['rate', 'rate_limit', 'quota']);
        return <article className="developer-key-card" key={id}>
          <header><div><strong>{recordText(item, ['label', 'name'], id)}</strong><small>{recordText(item, ['key_prefix', 'prefix'], text('prefixMissing'))}</small></div><b>{effectiveState(item)}</b></header>
          <dl>
            <div><dt>{text('target')}</dt><dd>{recordText(item, ['target_id', 'target'], '—')}</dd></div>
            <div><dt>{text('environment')}</dt><dd>{recordText(item, ['environment'], '—')}</dd></div>
            <div><dt>{text('scope')}</dt><dd>{scopes.join(', ') || '—'}</dd></div>
            <div><dt>{text('controlStatus')}</dt><dd>{statusLabel(recordText(item, ['control_status', 'controlStatus', 'status']))}</dd></div>
            <div><dt>{text('runtimeHold')}</dt><dd>{reasons.map(holdLabel).join(' / ') || text('none')}</dd></div>
            <div><dt>{text('autoResume')}</dt><dd>{textValue(item.auto_resume_after_credit ?? item.autoResumeAfterCredit, '—')}</dd></div>
            <div><dt>{text('lastUsed')}</dt><dd>{recordText(item, ['last_used_at', 'last_used'], '—')}</dd></div>
            <div><dt>{text('estimatedRemainingRequests')}</dt><dd>{textValue(item.estimated_remaining_requests ?? item.remaining_requests, '—')}</dd></div>
          </dl>
          {(Object.keys(usage).length > 0 || Object.keys(rate).length > 0) && <div className="developer-key-detail-grid">{Object.keys(usage).length > 0 && <div><strong>{text('usageCredit')}</strong><KeyValueGrid value={usage} /></div>}{Object.keys(rate).length > 0 && <div><strong>{text('rateQuota')}</strong><KeyValueGrid value={rate} /></div>}</div>}
          <div className="platform-action-row">
            <button className="platform-button" type="button" disabled title={text('lifecycleUnavailable')}>{text('rotate')}</button>
            <button className="platform-button" type="button" disabled title={text('lifecycleUnavailable')}>{text('pause')}</button>
            <button className="platform-button" type="button" disabled title={text('lifecycleUnavailable')}>{text('resume')}</button>
            <button className="platform-button" type="button" disabled title={text('productionDeleteUnavailable')}>{text('delete')}</button>
          </div>
        </article>;
      })}</div>}
    </Panel>

    <Panel title={text('lifecycleBoundary')}>
      <p className="developer-boundary-note">{text('lifecycleBoundaryDescription')}</p>
    </Panel>
  </ResponsivePageShell>;
}
