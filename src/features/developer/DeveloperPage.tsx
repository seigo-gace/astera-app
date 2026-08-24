import { useEffect, useState } from 'react';
import { useDeveloperText, type DeveloperTextKey } from '../../developer-text';
import { asArray, asRecord, recordText, textValue, type JsonObject } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './developer-page.css';

type ApiDefinition = {
  id: string;
  family: 'astera' | 'platform';
  name: string;
  ja: string;
  en: string;
  descriptionJa: string;
  descriptionEn: string;
  aliases: string[];
};

const APIS: ApiDefinition[] = [
  { id: 'astera.decision-materials', family: 'astera', name: 'Decision Materials', ja: '判断材料生成', en: 'Decision material generation', descriptionJa: '判断・比較・検証に使う材料を生成', descriptionEn: 'Generate material for analysis, comparison, and verification', aliases: ['astera.decision-materials', 'decision-materials', 'decision materials'] },
  { id: 'astera.evidence-search', family: 'astera', name: 'Evidence Search', ja: '根拠検索', en: 'Evidence search', descriptionJa: '必要な根拠を検索・整理', descriptionEn: 'Search and organize supporting evidence', aliases: ['astera.evidence-search', 'evidence-search', 'evidence search'] },
  { id: 'astera.quality-gate', family: 'astera', name: 'Quality Gate', ja: '品質検査', en: 'Quality inspection', descriptionJa: '出力品質・完成条件を検査', descriptionEn: 'Inspect output quality and completion conditions', aliases: ['astera.quality-gate', 'quality-gate', 'quality gate'] },
  { id: 'astera.integrated', family: 'astera', name: 'Integrated', ja: '統合実行', en: 'Integrated execution', descriptionJa: 'Astera正規Flowをまとめて実行', descriptionEn: 'Run the canonical Astera flow as one entry point', aliases: ['astera.integrated', 'integrated'] },
  { id: 'webhook-gateway', family: 'platform', name: 'Webhook Gateway', ja: 'Webhook配信・接続管理', en: 'Webhook delivery and connection management', descriptionJa: 'Destination・Event・Callbackを管理', descriptionEn: 'Manage destinations, events, and callbacks', aliases: ['webhook-gateway', 'webhook gateway', 'webhook'] },
  { id: 'libral-vault', family: 'platform', name: 'Libral Vault', ja: '暗号化・Vault・鍵管理', en: 'Encryption, vault, and key management', descriptionJa: 'Secret・Signature・Keyを安全に管理', descriptionEn: 'Manage secrets, signatures, and keys securely', aliases: ['libral-vault', 'libral vault', 'vault'] },
];

const HOLD_PRIORITY = ['security_hold', 'account_suspended', 'plan_entitlement', 'target_suspended', 'credit_insufficient'] as const;
const HOLD_TEXT_KEYS: Record<string, DeveloperTextKey> = {
  security_hold: 'stateSecurityHold',
  account_suspended: 'stateAccountSuspended',
  plan_entitlement: 'statePlanEntitlement',
  target_suspended: 'stateTargetSuspended',
  credit_insufficient: 'stateCreditInsufficient',
};

function matchesApi(api: ApiDefinition, record: JsonObject): boolean {
  const haystack = `${recordText(record, ['target_id', 'target', 'id'])} ${recordText(record, ['display_name', 'name', 'label'])}`.toLowerCase();
  return api.aliases.some((alias) => haystack.includes(alias));
}

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

function firstScalar(record: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && typeof value !== 'object') return textValue(value, '—');
  }
  return '';
}

function nestedMetric(record: JsonObject, parents: string[], keys: string[]): string {
  const direct = firstScalar(record, keys);
  if (direct) return direct;
  for (const parent of parents) {
    const nested = asRecord(record[parent]);
    const nestedValue = firstScalar(nested, keys);
    if (nestedValue) return nestedValue;
  }
  return '—';
}

export default function DeveloperPage({ route }: { route: RouteMatch }) {
  const { language, text } = useDeveloperText();
  const isJapanese = language !== 'en';
  const [catalog] = useResource('/api/developer/catalog');
  const [keys, reloadKeys] = useResource('/api/developer/keys');
  const [issueStates, setIssueStates] = useState<Record<string, SubmitState>>({});
  const [createdSecrets, setCreatedSecrets] = useState<Record<string, string>>({});

  useEffect(() => {
    document.documentElement.dataset.developerDedicatedOwner = 'true';
    return () => { delete document.documentElement.dataset.developerDedicatedOwner; };
  }, []);

  const targets = catalog.status === 'ready' ? asArray(catalog.data, ['targets', 'catalog', 'items']).map(asRecord) : [];
  const keyItems = keys.status === 'ready' ? asArray(keys.data, ['keys', 'items']).map(asRecord) : [];

  const holdLabel = (reason: string): string => {
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

  const statusFor = (api: ApiDefinition): string => {
    const target = targets.find((item) => matchesApi(api, item));
    if (!target) return text('notCataloged');
    return recordText(target, ['availability', 'status'], text('statusUnknown'));
  };

  const issueKey = async (api: ApiDefinition) => {
    const target = targets.find((item) => matchesApi(api, item));
    const targetId = target ? recordText(target, ['target_id', 'id']) : '';
    if (!target || !targetId || !targetCanIssue(target)) {
      setIssueStates((current) => ({ ...current, [api.id]: { type: 'error', message: text('targetUnavailable'), code: 'DEVELOPER_TARGET_UNAVAILABLE' } }));
      return;
    }

    setCreatedSecrets((current) => ({ ...current, [api.id]: '' }));
    const payload = await submitForm(
      `/api/developer/targets/${encodeURIComponent(targetId)}/keys`,
      { environment: 'sandbox', scopes: ['execute', 'read:usage'] },
      (state) => setIssueStates((current) => ({ ...current, [api.id]: state })),
      { success: text('sandboxIssued'), idempotent: true },
    );
    if (!payload) return;

    const secret = recordText(asRecord(payload), ['api_key', 'secret', 'key']);
    if (!secret) {
      setIssueStates((current) => ({ ...current, [api.id]: { type: 'error', message: text('secretMissing'), code: 'API_KEY_SECRET_MISSING' } }));
      return;
    }

    setCreatedSecrets((current) => ({ ...current, [api.id]: secret }));
    reloadKeys();
  };

  const renderKey = (item: JsonObject, api: ApiDefinition) => {
    const id = recordText(item, ['key_id', 'id']);
    const scopes = stringList(item.scopes ?? item.scope);
    const usage = nestedMetric(item, ['usage', 'usage_month', 'monthly_usage'], ['requests', 'request_count', 'total_requests', 'usage_count', 'credits_used', 'credit_used', 'used']);
    const cost = nestedMetric(item, ['cost', 'billing', 'charges', 'monthly_cost'], ['amount', 'total', 'cost', 'current_cost', 'usage_cost', 'charged_amount']);

    return (
      <article className="developer-key-row" key={`${api.id}-${id}`}>
        <div className="developer-key-identity">
          <div>
            <strong>{recordText(item, ['label', 'name'], id)}</strong>
            <code>{recordText(item, ['key_prefix', 'prefix'], text('prefixMissing'))}</code>
          </div>
          <span>{effectiveState(item)}</span>
        </div>

        <dl className="developer-key-facts">
          <div><dt>{text('environment')}</dt><dd>{recordText(item, ['environment'], '—')}</dd></div>
          <div><dt>{text('scope')}</dt><dd>{scopes.join(', ') || '—'}</dd></div>
          <div><dt>{text('lastUsed')}</dt><dd>{recordText(item, ['last_used_at', 'last_used'], '—')}</dd></div>
          <div><dt>Usage</dt><dd>{usage}</dd></div>
          <div><dt>Cost</dt><dd>{cost}</dd></div>
        </dl>

        <div className="developer-key-actions" aria-label={isJapanese ? 'APIキー個別管理' : 'Individual API key management'}>
          <button className="platform-button" type="button" disabled title={text('lifecycleUnavailable')}>{text('rotate')}</button>
          <button className="platform-button" type="button" disabled title={text('lifecycleUnavailable')}>{text('pause')}</button>
          <button className="platform-button" type="button" disabled title={text('lifecycleUnavailable')}>{text('resume')}</button>
          <button className="platform-button" type="button" disabled title={text('productionDeleteUnavailable')}>{text('delete')}</button>
        </div>
      </article>
    );
  };

  const renderApiCard = (api: ApiDefinition) => {
    const target = targets.find((item) => matchesApi(api, item));
    const apiKeys = keyItems.filter((item) => matchesApi(api, item));
    const canIssue = Boolean(target && targetCanIssue(target));
    const issueState = issueStates[api.id] ?? { type: 'idle' as const };
    const createdSecret = createdSecrets[api.id] ?? '';

    return (
      <article className="developer-api-card" key={api.id}>
        <header className="developer-api-card-head">
          <div className="developer-api-title-block">
            <strong>{api.name}</strong>
            <span>{isJapanese ? api.ja : api.en}</span>
            <small>{isJapanese ? api.descriptionJa : api.descriptionEn}</small>
          </div>
          <span className="developer-status"><i aria-hidden="true" />{statusFor(api)}</span>
        </header>

        <section className="developer-card-section developer-card-keys" aria-label={isJapanese ? `${api.name} APIキー` : `${api.name} API keys`}>
          <div className="developer-card-section-head">
            <div><h3>{text('apiKeys')}</h3><p>{isJapanese ? '発行したKeyを1本ずつ個別に管理' : 'Manage each issued key individually'}</p></div>
            <button className="platform-button is-primary" type="button" disabled={!canIssue || issueState.type === 'working'} onClick={() => void issueKey(api)}>
              + {isJapanese ? 'APIキーを発行' : 'Issue API key'}
            </button>
          </div>

          <FormResult state={issueState} />
          {createdSecret && (
            <div className="developer-secret" role="status">
              <strong>{text('secretOnce')}</strong>
              <code>{createdSecret}</code>
              <button className="platform-button" type="button" onClick={() => void navigator.clipboard.writeText(createdSecret)}>{text('copy')}</button>
            </div>
          )}

          {keys.status === 'loading' && <div className="developer-key-empty">{isJapanese ? 'APIキーを読み込み中…' : 'Loading API keys…'}</div>}
          {keys.status === 'error' && <div className="developer-key-empty">{isJapanese ? 'APIキーを取得できませんでした。' : 'Unable to load API keys.'}</div>}
          {keys.status === 'ready' && apiKeys.length === 0 && <div className="developer-key-empty">{isJapanese ? 'このAPIではまだKeyが発行されていません。' : 'No key has been issued for this API yet.'}</div>}
          {keys.status === 'ready' && apiKeys.length > 0 && <div className="developer-key-list">{apiKeys.map((item) => renderKey(item, api))}</div>}
        </section>
      </article>
    );
  };

  return (
    <ResponsivePageShell route={route} description={isJapanese ? 'APIと外部連携を管理' : 'Manage APIs and external integrations'}>
      <div className="developer-console">
        <header className="developer-page-header">
          <h1>Developer</h1>
          <p>{isJapanese ? 'APIと外部連携を管理' : 'Manage APIs and external integrations'}</p>
        </header>

        <section className="developer-family" aria-labelledby="developer-family-astera">
          <div className="developer-family-heading"><h2 id="developer-family-astera">Astera APIs</h2><p>{isJapanese ? 'Astera本体のAPI' : 'Astera core APIs'}</p></div>
          <div className="developer-api-list">{APIS.filter((api) => api.family === 'astera').map(renderApiCard)}</div>
        </section>

        <section className="developer-family" aria-labelledby="developer-family-platform">
          <div className="developer-family-heading"><h2 id="developer-family-platform">Platform APIs</h2><p>{isJapanese ? '外部接続・暗号化基盤' : 'External integration and secure platform APIs'}</p></div>
          <div className="developer-api-list">{APIS.filter((api) => api.family === 'platform').map(renderApiCard)}</div>
        </section>
      </div>
    </ResponsivePageShell>
  );
}
