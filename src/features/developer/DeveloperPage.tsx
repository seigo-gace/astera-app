import { useEffect, useMemo, useState } from 'react';
import { useDeveloperText, type DeveloperTextKey } from '../../developer-text';
import { asArray, asRecord, recordText, textValue, type JsonObject } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { useResource } from '../../platform/pages/page-kit';
import './developer-page.css';

type ApiId =
  | 'astera.decision-materials'
  | 'astera.evidence-search'
  | 'astera.quality-gate'
  | 'astera.integrated'
  | 'webhook-gateway'
  | 'libral-vault';

type DetailTab = 'keys' | 'usage' | 'cost';
type ApiFamilyId = 'astera' | 'platform';

type ApiDefinition = {
  id: ApiId;
  family: ApiFamilyId;
  primary: string;
  secondary: { ja: string; en: string };
  description: { ja: string; en: string };
  aliases: readonly string[];
};

const HOLD_PRIORITY = ['security_hold', 'account_suspended', 'plan_entitlement', 'target_suspended', 'credit_insufficient'] as const;
const HOLD_TEXT_KEYS: Record<string, DeveloperTextKey> = {
  security_hold: 'stateSecurityHold',
  account_suspended: 'stateAccountSuspended',
  plan_entitlement: 'statePlanEntitlement',
  target_suspended: 'stateTargetSuspended',
  credit_insufficient: 'stateCreditInsufficient',
};

const API_DEFINITIONS: readonly ApiDefinition[] = [
  {
    id: 'astera.decision-materials',
    family: 'astera',
    primary: 'Decision Materials',
    secondary: { ja: '判断材料生成', en: 'Decision material generation' },
    description: { ja: '判断・比較・検証に使う材料を生成', en: 'Generate material for analysis, comparison, and verification' },
    aliases: ['astera.decision-materials', 'decision-materials', 'decision materials'],
  },
  {
    id: 'astera.evidence-search',
    family: 'astera',
    primary: 'Evidence Search',
    secondary: { ja: '根拠検索', en: 'Evidence search' },
    description: { ja: '必要な根拠を検索・整理', en: 'Search and organize supporting evidence' },
    aliases: ['astera.evidence-search', 'evidence-search', 'evidence search'],
  },
  {
    id: 'astera.quality-gate',
    family: 'astera',
    primary: 'Quality Gate',
    secondary: { ja: '品質検査', en: 'Quality inspection' },
    description: { ja: '出力品質・完成条件を検査', en: 'Inspect output quality and completion conditions' },
    aliases: ['astera.quality-gate', 'quality-gate', 'quality gate'],
  },
  {
    id: 'astera.integrated',
    family: 'astera',
    primary: 'Integrated',
    secondary: { ja: '統合実行', en: 'Integrated execution' },
    description: { ja: 'Astera正規Flowをまとめて実行', en: 'Run the canonical Astera flow as one entry point' },
    aliases: ['astera.integrated', 'integrated'],
  },
  {
    id: 'webhook-gateway',
    family: 'platform',
    primary: 'Webhook Gateway',
    secondary: { ja: 'Webhook配信・接続管理', en: 'Webhook delivery and connection management' },
    description: { ja: 'Destination・Event・Callbackを管理', en: 'Manage destinations, events, and callbacks' },
    aliases: ['webhook-gateway', 'webhook gateway', 'webhook'],
  },
  {
    id: 'libral-vault',
    family: 'platform',
    primary: 'Libral Vault',
    secondary: { ja: '暗号化・Vault・鍵管理', en: 'Encryption, vault, and key management' },
    description: { ja: 'Secret・Signature・Keyを安全に管理', en: 'Manage secrets, signatures, and keys securely' },
    aliases: ['libral-vault', 'libral vault', 'vault'],
  },
] as const;

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function holds(record: JsonObject): string[] {
  return stringList(record.hold_reasons ?? record.holdReasons ?? record.runtime_holds ?? record.holds);
}

function matchesApi(api: ApiDefinition, record: JsonObject): boolean {
  const haystack = `${recordText(record, ['target_id', 'target', 'id'])} ${recordText(record, ['display_name', 'name', 'label'])}`.toLowerCase();
  return api.aliases.some((alias) => haystack.includes(alias));
}

function numericValue(record: JsonObject, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export default function DeveloperPage({ route }: { route: RouteMatch }) {
  const { language, text } = useDeveloperText();
  const [catalog] = useResource('/api/developer/catalog');
  const [keys] = useResource('/api/developer/keys');
  const [selectedApiId, setSelectedApiId] = useState<ApiId>('astera.decision-materials');
  const [activeTab, setActiveTab] = useState<DetailTab>('keys');

  useEffect(() => {
    document.documentElement.dataset.developerDedicatedOwner = 'true';
    return () => { delete document.documentElement.dataset.developerDedicatedOwner; };
  }, []);

  const targetItems = catalog.status === 'ready' ? asArray(catalog.data, ['targets', 'catalog', 'items']).map(asRecord) : [];
  const keyItems = keys.status === 'ready' ? asArray(keys.data, ['keys', 'items']).map(asRecord) : [];

  const selectedApi = API_DEFINITIONS.find((api) => api.id === selectedApiId) ?? API_DEFINITIONS[0];
  const selectedKeys = useMemo(() => keyItems.filter((item) => matchesApi(selectedApi, item)), [keyItems, selectedApi]);

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

  const apiStatus = (api: ApiDefinition) => {
    const target = targetItems.find((item) => matchesApi(api, item));
    const raw = target ? recordText(target, ['availability', 'status']) : '';
    const normalized = raw.toLowerCase();
    const tone = ['available', 'active', 'ready'].includes(normalized)
      ? 'is-available'
      : ['unavailable', 'suspended', 'disabled'].includes(normalized)
        ? 'is-unavailable'
        : 'is-unknown';
    return { label: target ? statusLabel(raw) : text('notCataloged'), tone };
  };

  const keysForApi = (api: ApiDefinition) => keyItems.filter((item) => matchesApi(api, item));

  const usageForApi = (api: ApiDefinition): string => {
    const values = keysForApi(api)
      .map((item) => {
        const usage = asRecord(item.usage ?? item.usage_month ?? item.monthly_usage);
        return numericValue(usage, ['requests', 'request_count', 'total_requests', 'count'])
          ?? numericValue(item, ['request_count', 'requests', 'usage_count']);
      })
      .filter((value): value is number => value !== null);
    if (!values.length) return '—';
    return values.reduce((sum, value) => sum + value, 0).toLocaleString();
  };

  const renderApiPanel = (api: ApiDefinition) => {
    const status = apiStatus(api);
    const apiKeys = keysForApi(api);
    const selected = api.id === selectedApiId;
    return <button
      key={api.id}
      className={`developer-api-panel${selected ? ' is-selected' : ''}`}
      type="button"
      aria-pressed={selected}
      onClick={() => {
        setSelectedApiId(api.id);
        setActiveTab('keys');
      }}
    >
      <span className="developer-api-panel-head">
        <span className="developer-api-title-block">
          <strong>{api.primary}</strong>
          <span>{api.secondary[language]}</span>
          <small>{api.description[language]}</small>
        </span>
        <span className={`developer-status ${status.tone}`}><i aria-hidden="true" />{status.label}</span>
      </span>
      <span className="developer-api-summary" aria-label={language === 'ja' ? 'API概要' : 'API summary'}>
        <span><small>{text('apiKeys')}</small><b>{apiKeys.length}</b></span>
        <span><small>Usage</small><b>{usageForApi(api)}</b></span>
        <span><small>Cost</small><b>—</b></span>
        <span className="developer-api-arrow" aria-hidden="true">→</span>
      </span>
    </button>;
  };

  return <ResponsivePageShell route={route} description={language === 'ja' ? 'APIと外部連携を管理' : 'Manage APIs and external integrations'}>
    <div className="developer-console">
      <header className="developer-page-header">
        <div>
          <h1>Developer</h1>
          <p>{language === 'ja' ? 'APIと外部連携を管理' : 'Manage APIs and external integrations'}</p>
        </div>
      </header>

      <section className="developer-family" aria-labelledby="developer-family-astera">
        <div className="developer-family-heading">
          <div>
            <h2 id="developer-family-astera">Astera APIs</h2>
            <p>{language === 'ja' ? 'Astera本体の4種類のAPI' : 'Four Astera core APIs'}</p>
          </div>
          <span>4 APIs</span>
        </div>
        <div className="developer-api-list">
          {API_DEFINITIONS.filter((api) => api.family === 'astera').map(renderApiPanel)}
        </div>
      </section>

      <section className="developer-family" aria-labelledby="developer-family-platform">
        <div className="developer-family-heading">
          <div>
            <h2 id="developer-family-platform">Platform APIs</h2>
            <p>{language === 'ja' ? '外部接続・暗号化基盤' : 'External integration and secure platform APIs'}</p>
          </div>
          <span>2 APIs</span>
        </div>
        <div className="developer-api-list">
          {API_DEFINITIONS.filter((api) => api.family === 'platform').map(renderApiPanel)}
        </div>
      </section>

      <section className="developer-detail-surface" aria-labelledby="developer-selected-api">
        <header className="developer-detail-head">
          <div>
            <span className="developer-detail-eyebrow">Selected API</span>
            <h2 id="developer-selected-api">{selectedApi.primary}</h2>
            <p>{selectedApi.secondary[language]}</p>
            <code>{selectedApi.id}</code>
          </div>
        </header>

        <div className="developer-tabs" role="tablist" aria-label={language === 'ja' ? 'API管理項目' : 'API management'}>
          <button className={activeTab === 'keys' ? 'is-active' : ''} type="button" role="tab" aria-selected={activeTab === 'keys'} onClick={() => setActiveTab('keys')}>{text('apiKeys')}</button>
          <button className={activeTab === 'usage' ? 'is-active' : ''} type="button" role="tab" aria-selected={activeTab === 'usage'} onClick={() => setActiveTab('usage')}>Usage</button>
          <button className={activeTab === 'cost' ? 'is-active' : ''} type="button" role="tab" aria-selected={activeTab === 'cost'} onClick={() => setActiveTab('cost')}>Cost</button>
        </div>

        {activeTab === 'keys' && <div className="developer-detail-body" role="tabpanel">
          <div className="developer-detail-toolbar">
            <div>
              <strong>{text('apiKeys')}</strong>
              <small>{selectedKeys.length} {language === 'ja' ? '件' : selectedKeys.length === 1 ? 'key' : 'keys'}</small>
            </div>
            <button className="platform-button is-primary" type="button" disabled title={language === 'ja' ? '今回は外装確認のみです' : 'Layout preview only'}>
              + {language === 'ja' ? 'APIキーを作成' : 'Create API key'}
            </button>
          </div>

          {selectedKeys.length === 0 ? <div className="developer-empty-state">
            <strong>{language === 'ja' ? '発行済みAPIキーはありません' : 'No issued API keys'}</strong>
            <p>{language === 'ja' ? 'キーが増えても、この領域へ縦1列で追加されます。' : 'New keys will be added here in a single vertical list.'}</p>
          </div> : <div className="developer-key-list">
            {selectedKeys.map((item) => {
              const id = recordText(item, ['key_id', 'id']);
              const scopes = stringList(item.scopes ?? item.scope);
              return <article className="developer-key-row" key={id}>
                <div className="developer-key-main">
                  <div>
                    <strong>{recordText(item, ['label', 'name'], id)}</strong>
                    <code>{recordText(item, ['key_prefix', 'prefix'], text('prefixMissing'))}</code>
                  </div>
                  <span>{effectiveState(item)}</span>
                </div>
                <dl>
                  <div><dt>{text('environment')}</dt><dd>{recordText(item, ['environment'], '—')}</dd></div>
                  <div><dt>{text('scope')}</dt><dd>{scopes.join(', ') || '—'}</dd></div>
                  <div><dt>{text('lastUsed')}</dt><dd>{recordText(item, ['last_used_at', 'last_used'], '—')}</dd></div>
                  <div><dt>Usage</dt><dd>{textValue(item.request_count ?? item.requests ?? item.usage_count, '—')}</dd></div>
                  <div><dt>Cost</dt><dd>—</dd></div>
                </dl>
                <button className="developer-key-menu" type="button" disabled aria-label={language === 'ja' ? 'キー管理メニュー' : 'Key management menu'}>•••</button>
              </article>;
            })}
          </div>}
        </div>}

        {activeTab === 'usage' && <div className="developer-detail-body" role="tabpanel">
          <div className="developer-metric-strip">
            <div><small>{language === 'ja' ? 'リクエスト' : 'Requests'}</small><strong>{usageForApi(selectedApi)}</strong></div>
            <div><small>{language === 'ja' ? 'クレジット使用量' : 'Credit usage'}</small><strong>—</strong></div>
            <div><small>{language === 'ja' ? 'エラー' : 'Errors'}</small><strong>—</strong></div>
          </div>
        </div>}

        {activeTab === 'cost' && <div className="developer-detail-body" role="tabpanel">
          <div className="developer-metric-strip">
            <div><small>{language === 'ja' ? '今月の使用料金' : 'Current month cost'}</small><strong>—</strong></div>
            <div><small>{language === 'ja' ? '使用クレジット' : 'Credits used'}</small><strong>—</strong></div>
            <div><small>{language === 'ja' ? '料金単価' : 'Rate'}</small><strong>—</strong></div>
          </div>
        </div>}
      </section>
    </div>
  </ResponsivePageShell>;
}
