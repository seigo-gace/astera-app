import { useEffect, useState } from 'react';
import { useDeveloperText } from '../../developer-text';
import { asArray, asRecord, recordText, type JsonObject } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { useResource } from '../../platform/pages/page-kit';
import './developer-page.css';

type DetailTab = 'keys' | 'usage' | 'cost';

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

function matchesApi(api: ApiDefinition, record: JsonObject): boolean {
  const haystack = `${recordText(record, ['target_id', 'target', 'id'])} ${recordText(record, ['display_name', 'name', 'label'])}`.toLowerCase();
  return api.aliases.some((alias) => haystack.includes(alias));
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

export default function DeveloperPage({ route }: { route: RouteMatch }) {
  const { language, text } = useDeveloperText();
  const isJapanese = language !== 'en';
  const [catalog] = useResource('/api/developer/catalog');
  const [keys] = useResource('/api/developer/keys');
  const [selectedId, setSelectedId] = useState('astera.decision-materials');
  const [tab, setTab] = useState<DetailTab>('keys');

  useEffect(() => {
    document.documentElement.dataset.developerDedicatedOwner = 'true';
    return () => { delete document.documentElement.dataset.developerDedicatedOwner; };
  }, []);

  const targets = catalog.status === 'ready' ? asArray(catalog.data, ['targets', 'catalog', 'items']).map(asRecord) : [];
  const keyItems = keys.status === 'ready' ? asArray(keys.data, ['keys', 'items']).map(asRecord) : [];
  const selectedApi = APIS.find((api) => api.id === selectedId) || APIS[0];
  if (!selectedApi) return null;
  const selectedKeys = keyItems.filter((item) => matchesApi(selectedApi, item));

  const statusFor = (api: ApiDefinition): string => {
    const target = targets.find((item) => matchesApi(api, item));
    if (!target) return text('notCataloged');
    return recordText(target, ['availability', 'status'], text('statusUnknown'));
  };

  const keyCountFor = (api: ApiDefinition): number => keyItems.filter((item) => matchesApi(api, item)).length;

  const renderPanel = (api: ApiDefinition) => {
    const selected = api.id === selectedId;
    return (
      <button
        key={api.id}
        className={`developer-api-panel${selected ? ' is-selected' : ''}`}
        type="button"
        aria-pressed={selected}
        onClick={() => { setSelectedId(api.id); setTab('keys'); }}
      >
        <span className="developer-api-panel-head">
          <span className="developer-api-title-block">
            <strong>{api.name}</strong>
            <span>{isJapanese ? api.ja : api.en}</span>
            <small>{isJapanese ? api.descriptionJa : api.descriptionEn}</small>
          </span>
          <span className="developer-status"><i aria-hidden="true" />{statusFor(api)}</span>
        </span>
        <span className="developer-api-summary">
          <span><small>{text('apiKeys')}</small><b>{keyCountFor(api)}</b></span>
          <span><small>Usage</small><b>—</b></span>
          <span><small>Cost</small><b>—</b></span>
          <span className="developer-api-arrow" aria-hidden="true">→</span>
        </span>
      </button>
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
          <div className="developer-family-heading"><div><h2 id="developer-family-astera">Astera APIs</h2><p>{isJapanese ? 'Astera本体の4種類のAPI' : 'Four Astera core APIs'}</p></div><span>4 APIs</span></div>
          <div className="developer-api-list">{APIS.filter((api) => api.family === 'astera').map(renderPanel)}</div>
        </section>

        <section className="developer-family" aria-labelledby="developer-family-platform">
          <div className="developer-family-heading"><div><h2 id="developer-family-platform">Platform APIs</h2><p>{isJapanese ? '外部接続・暗号化基盤' : 'External integration and secure platform APIs'}</p></div><span>2 APIs</span></div>
          <div className="developer-api-list">{APIS.filter((api) => api.family === 'platform').map(renderPanel)}</div>
        </section>

        <section className="developer-detail-surface" aria-labelledby="developer-selected-api">
          <header className="developer-detail-head"><div><span className="developer-detail-eyebrow">Selected API</span><h2 id="developer-selected-api">{selectedApi.name}</h2><p>{isJapanese ? selectedApi.ja : selectedApi.en}</p><code>{selectedApi.id}</code></div></header>
          <div className="developer-tabs" role="tablist" aria-label={isJapanese ? 'API管理項目' : 'API management'}>
            <button className={tab === 'keys' ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === 'keys'} onClick={() => setTab('keys')}>{text('apiKeys')}</button>
            <button className={tab === 'usage' ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === 'usage'} onClick={() => setTab('usage')}>Usage</button>
            <button className={tab === 'cost' ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === 'cost'} onClick={() => setTab('cost')}>Cost</button>
          </div>

          {tab === 'keys' && <div className="developer-detail-body" role="tabpanel">
            <div className="developer-detail-toolbar"><div><strong>{text('apiKeys')}</strong><small>{selectedKeys.length} {isJapanese ? '件' : 'keys'}</small></div><button className="platform-button is-primary" type="button" disabled title={isJapanese ? '今回は外装確認のみです' : 'Layout preview only'}>+ {isJapanese ? 'APIキーを作成' : 'Create API key'}</button></div>
            {selectedKeys.length === 0 ? <div className="developer-empty-state"><strong>{isJapanese ? '発行済みAPIキーはありません' : 'No issued API keys'}</strong><p>{isJapanese ? 'キーが増えても、この領域へ縦1列で追加されます。' : 'New keys will be added here in a single vertical list.'}</p></div> : <div className="developer-key-list">{selectedKeys.map((item) => {
              const id = recordText(item, ['key_id', 'id']);
              const scopes = stringList(item.scopes ?? item.scope);
              return <article className="developer-key-row" key={id}><div className="developer-key-main"><div><strong>{recordText(item, ['label', 'name'], id)}</strong><code>{recordText(item, ['key_prefix', 'prefix'], text('prefixMissing'))}</code></div><span>{recordText(item, ['control_status', 'controlStatus', 'status'], text('stateActive'))}</span></div><dl><div><dt>{text('environment')}</dt><dd>{recordText(item, ['environment'], '—')}</dd></div><div><dt>{text('scope')}</dt><dd>{scopes.join(', ') || '—'}</dd></div><div><dt>{text('lastUsed')}</dt><dd>{recordText(item, ['last_used_at', 'last_used'], '—')}</dd></div><div><dt>Usage</dt><dd>—</dd></div><div><dt>Cost</dt><dd>—</dd></div></dl><button className="developer-key-menu" type="button" disabled aria-label={isJapanese ? 'キー管理メニュー' : 'Key management menu'}>•••</button></article>;
            })}</div>}
          </div>}

          {tab === 'usage' && <div className="developer-detail-body" role="tabpanel"><div className="developer-metric-strip"><div><small>{isJapanese ? 'リクエスト' : 'Requests'}</small><strong>—</strong></div><div><small>{isJapanese ? 'クレジット使用量' : 'Credit usage'}</small><strong>—</strong></div><div><small>{isJapanese ? 'エラー' : 'Errors'}</small><strong>—</strong></div></div></div>}
          {tab === 'cost' && <div className="developer-detail-body" role="tabpanel"><div className="developer-metric-strip"><div><small>{isJapanese ? '今月の使用料金' : 'Current month cost'}</small><strong>—</strong></div><div><small>{isJapanese ? '使用クレジット' : 'Credits used'}</small><strong>—</strong></div><div><small>{isJapanese ? '料金単価' : 'Rate'}</small><strong>—</strong></div></div></div>}
        </section>
      </div>
    </ResponsivePageShell>
  );
}
