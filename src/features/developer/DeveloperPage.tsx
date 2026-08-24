import { useEffect, useState, type FormEvent } from 'react';
import { useDeveloperText } from '../../developer-text';
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

function matchesApi(api: ApiDefinition, record: JsonObject): boolean {
  const haystack = `${recordText(record, ['target_id', 'target', 'id'])} ${recordText(record, ['display_name', 'name', 'label'])}`.toLowerCase();
  return api.aliases.some((alias) => haystack.includes(alias));
}

function targetCanIssue(record: JsonObject): boolean {
  const availability = recordText(record, ['availability', 'status']).toLowerCase();
  if (record.key_issuance_allowed === false) return false;
  return availability === 'available' || availability === 'active' || availability === 'ready';
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
  const [overlayApiId, setOverlayApiId] = useState<string | null>(null);
  const [issueName, setIssueName] = useState('');
  const [issuedSecret, setIssuedSecret] = useState('');
  const [issueState, setIssueState] = useState<SubmitState>({ type: 'idle' });
  const [localNames, setLocalNames] = useState<Record<string, string>>({});

  useEffect(() => {
    document.documentElement.dataset.developerDedicatedOwner = 'true';
    return () => { delete document.documentElement.dataset.developerDedicatedOwner; };
  }, []);

  useEffect(() => {
    if (!overlayApiId) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && issueState.type !== 'working') {
        setOverlayApiId(null);
        setIssueName('');
        setIssuedSecret('');
        setIssueState({ type: 'idle' });
      }
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [overlayApiId, issueState.type]);

  const targets = catalog.status === 'ready' ? asArray(catalog.data, ['targets', 'catalog', 'items']).map(asRecord) : [];
  const keyItems = keys.status === 'ready' ? asArray(keys.data, ['keys', 'items']).map(asRecord) : [];
  const overlayApi = overlayApiId ? APIS.find((api) => api.id === overlayApiId) ?? null : null;

  const openIssueOverlay = (api: ApiDefinition) => {
    setOverlayApiId(api.id);
    setIssueName('');
    setIssuedSecret('');
    setIssueState({ type: 'idle' });
  };

  const closeIssueOverlay = () => {
    if (issueState.type === 'working') return;
    setOverlayApiId(null);
    setIssueName('');
    setIssuedSecret('');
    setIssueState({ type: 'idle' });
  };

  const issueKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!overlayApi) return;
    const keyName = issueName.trim();
    if (!keyName) return;

    const target = targets.find((item) => matchesApi(overlayApi, item));
    const targetId = target ? recordText(target, ['target_id', 'id']) : '';
    if (!target || !targetId || !targetCanIssue(target)) {
      setIssueState({ type: 'error', message: text('targetUnavailable'), code: 'DEVELOPER_TARGET_UNAVAILABLE' });
      return;
    }

    const payload = await submitForm(
      `/api/developer/targets/${encodeURIComponent(targetId)}/keys`,
      { label: keyName, environment: 'sandbox', scopes: ['execute', 'read:usage'] },
      setIssueState,
      { success: text('sandboxIssued'), idempotent: true },
    );
    if (!payload) return;

    const root = asRecord(payload);
    const issued = asRecord(root.data ?? (typeof root.key === 'object' ? root.key : root));
    const secret = recordText(root, ['api_key', 'secret', 'key']) || recordText(issued, ['api_key', 'secret', 'key']);
    if (!secret) {
      setIssueState({ type: 'error', message: text('secretMissing'), code: 'API_KEY_SECRET_MISSING' });
      return;
    }

    const issuedId = recordText(issued, ['key_id', 'id']) || recordText(root, ['key_id', 'id']);
    if (issuedId) setLocalNames((current) => ({ ...current, [issuedId]: keyName }));
    setIssuedSecret(secret);
    reloadKeys();
  };

  const renderKeyRow = (item: JsonObject, api: ApiDefinition, index: number) => {
    const id = recordText(item, ['key_id', 'id']);
    const name = (id && localNames[id]) || recordText(item, ['label', 'name', 'display_name']) || (isJapanese ? `名称未設定 ${index + 1}` : `Unnamed key ${index + 1}`);
    const usage = nestedMetric(item, ['usage', 'usage_month', 'monthly_usage'], ['requests', 'request_count', 'total_requests', 'usage_count', 'credits_used', 'credit_used', 'used']);
    const cost = nestedMetric(item, ['cost', 'billing', 'charges', 'monthly_cost'], ['amount', 'total', 'cost', 'current_cost', 'usage_cost', 'charged_amount']);

    return (
      <div className="developer-key-row" key={`${api.id}-${id || index}`}>
        <div className="developer-key-cell developer-key-name">{name}</div>
        <div className="developer-key-cell developer-key-usage">{usage}</div>
        <div className="developer-key-cell developer-key-cost">{cost}</div>
        <div className="developer-key-actions">
          <button className="platform-button" type="button" disabled title={text('lifecycleUnavailable')}>{isJapanese ? '更新' : 'Update'}</button>
          <button className="platform-button" type="button" disabled title={text('productionDeleteUnavailable')}>{isJapanese ? '削除' : 'Delete'}</button>
        </div>
      </div>
    );
  };

  const renderApiCard = (api: ApiDefinition) => {
    const apiKeys = keyItems.filter((item) => matchesApi(api, item));
    const hasOverflow = apiKeys.length > 2;
    const isEmpty = apiKeys.length === 0;
    return (
      <article className="developer-api-card" key={api.id}>
        <header className="developer-api-card-head">
          <div className="developer-api-title-block">
            <strong>{api.name}</strong>
            <span>{isJapanese ? api.ja : api.en}</span>
            <small>{isJapanese ? api.descriptionJa : api.descriptionEn}</small>
          </div>
          <button
            className="platform-button is-primary developer-card-issue"
            type="button"
            onClick={() => openIssueOverlay(api)}
            aria-label={isJapanese ? `${api.name} APIキーを発行` : `Issue ${api.name} API key`}
          >
            + {isJapanese ? 'APIキー発行' : 'Issue API key'}
          </button>
        </header>

        <section className="developer-card-section" aria-label={isJapanese ? `${api.name} APIキー管理` : `${api.name} API key management`}>
          <div className={`developer-key-table${hasOverflow ? ' has-overflow' : ''}${isEmpty ? ' is-empty' : ''}`} aria-label={isJapanese ? `${api.name} APIキー一覧` : `${api.name} API key list`}>
            <div className="developer-key-table-head">
              <span>{isJapanese ? 'APIキー名' : 'API key name'}</span>
              <span>{isJapanese ? '使用量' : 'Usage'}</span>
              <span>{isJapanese ? '料金' : 'Cost'}</span>
              <span>{isJapanese ? '更新' : 'Update'}</span>
              <span>{isJapanese ? '削除' : 'Delete'}</span>
            </div>
            <div className="developer-key-table-body" tabIndex={hasOverflow ? 0 : -1}>
              {keys.status === 'ready' && apiKeys.map((item, index) => renderKeyRow(item, api, index))}
            </div>
          </div>
        </section>
      </article>
    );
  };

  return (
    <ResponsivePageShell route={route}>
      <div className="developer-console">
        <section className="developer-family" aria-labelledby="developer-family-astera">
          <div className="developer-family-heading"><h2 id="developer-family-astera">Astera APIs</h2><p>{isJapanese ? 'Astera本体の4 API' : 'Four Astera core APIs'}</p></div>
          <div className="developer-api-list">{APIS.filter((api) => api.family === 'astera').map(renderApiCard)}</div>
        </section>

        <section className="developer-family" aria-labelledby="developer-family-platform">
          <div className="developer-family-heading"><h2 id="developer-family-platform">Platform APIs</h2><p>Webhook Gateway / Libral Vault</p></div>
          <div className="developer-api-list">{APIS.filter((api) => api.family === 'platform').map(renderApiCard)}</div>
        </section>
      </div>

      {overlayApi && (
        <div className="developer-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeIssueOverlay(); }}>
          <section className="developer-overlay-dialog" role="dialog" aria-modal="true" aria-labelledby="developer-overlay-title">
            {!issuedSecret ? (
              <form className="developer-overlay-form" onSubmit={issueKey}>
                <header className="developer-overlay-head">
                  <div>
                    <h2 id="developer-overlay-title">{isJapanese ? 'APIキーを発行' : 'Issue API key'}</h2>
                    <p>{overlayApi.name}</p>
                  </div>
                  <button className="developer-overlay-close" type="button" onClick={closeIssueOverlay} disabled={issueState.type === 'working'} aria-label={isJapanese ? '閉じる' : 'Close'}>×</button>
                </header>
                <label className="developer-overlay-field">
                  <span>{isJapanese ? 'APIキー名' : 'API key name'}</span>
                  <input autoFocus required maxLength={80} value={issueName} onChange={(event) => setIssueName(event.target.value)} placeholder={isJapanese ? '例：Production Search' : 'e.g. Production Search'} />
                </label>
                <FormResult state={issueState} />
                <div className="developer-overlay-actions">
                  <button className="platform-button" type="button" onClick={closeIssueOverlay} disabled={issueState.type === 'working'}>{isJapanese ? 'キャンセル' : 'Cancel'}</button>
                  <button className="platform-button is-primary" type="submit" disabled={!issueName.trim() || issueState.type === 'working'}>{isJapanese ? '発行' : 'Issue'}</button>
                </div>
              </form>
            ) : (
              <div className="developer-overlay-form">
                <header className="developer-overlay-head">
                  <div>
                    <h2 id="developer-overlay-title">{isJapanese ? 'APIキーを発行しました' : 'API key issued'}</h2>
                    <p>{overlayApi.name}</p>
                  </div>
                </header>
                <div className="developer-overlay-secret">
                  <div><span>{isJapanese ? 'APIキー名' : 'API key name'}</span><strong>{issueName.trim()}</strong></div>
                  <div><span>API Key</span><code>{issuedSecret}</code></div>
                </div>
                <p className="developer-overlay-warning">{isJapanese ? 'このAPI KeyはこのOVERLAYを閉じると再表示されません。必要な場所へコピーしてください。' : 'This API key will not be shown again after this overlay is closed. Copy it now.'}</p>
                <div className="developer-overlay-actions">
                  <button className="platform-button" type="button" onClick={() => void navigator.clipboard.writeText(issuedSecret)}>{text('copy')}</button>
                  <button className="platform-button is-primary" type="button" onClick={closeIssueOverlay}>{isJapanese ? '閉じる' : 'Close'}</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </ResponsivePageShell>
  );
}
