import { asArray, asRecord, recordText } from '../api-client';
import type { RouteMatch } from '../route-registry';
import { BusyState, EmptyState, ErrorState, PublicPageFrame, ResponsivePageShell } from '../ResponsivePageShell';
import { KeyValueGrid, Panel, RecordList, useResource } from './page-kit';

function ShareViewerPage({ route, isPublic }: { route: RouteMatch; isPublic: boolean }) {
  const identifier = isPublic ? route.params.token : route.params.id;
  const endpoint = isPublic ? `/api/shares/public/${encodeURIComponent(identifier)}` : `/api/shares/${encodeURIComponent(identifier)}`;
  const Frame = isPublic ? PublicPageFrame : ResponsivePageShell;
  const [resource, reload] = useResource(endpoint);
  return <Frame route={route} description={isPublic ? '公開Snapshotを閲覧します。' : '指定AccountだけがPrivate Snapshotを閲覧できます。'}>{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <><Panel title="共有Result"><KeyValueGrid value={asRecord(resource.data).share ?? asRecord(resource.data).data ?? resource.data} /></Panel><RecordList items={asArray(asRecord(resource.data).sections ?? asRecord(resource.data).result, ['sections'])} titleKeys={['title', 'key']} subtitleKeys={['body', 'content']} /></>}</Frame>;
}

function SharesPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/shares');
  return <ResponsivePageShell route={route} description="Public／Private Share、期限、Revokeを管理します。"><Panel title="共有中のResult">{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <RecordList items={asArray(resource.data, ['shares', 'items'])} titleKeys={['title', 'share_id', 'id']} subtitleKeys={['visibility', 'expires_at', 'status']} link={(record) => { const id = recordText(record, ['share_id', 'id']); const visibility = recordText(record, ['visibility']); return id ? visibility === 'public' ? `/s/${encodeURIComponent(id)}` : `/share/${encodeURIComponent(id)}` : null; }} />}</Panel></ResponsivePageShell>;
}

function AboutPage({ route }: { route: RouteMatch }) {
  const hp = (import.meta.env.VITE_ASTERA_HP_URL as string | undefined) ?? 'https://asterav8.jp/';
  return <ResponsivePageShell route={route} description="製品説明は公式HP正本を参照し、AppではVersionと接続情報を表示します。"><Panel title="Astera App"><dl className="platform-kv-grid"><div><dt>Frontend</dt><dd>React / TypeScript / Vite</dd></div><div><dt>Platforms</dt><dd>Web / Android / iOS</dd></div><div><dt>Application ID</dt><dd>jp.asterav8.app</dd></div></dl></Panel><a className="platform-button" href={hp}>公式HPを開く</a></ResponsivePageShell>;
}

const legalDocuments: Record<string, { endpoint: string; description: string }> = {
  legal: { endpoint: '/api/legal', description: '現在有効な法務文書のVersionと公開状態を確認します。' },
  'legal-terms': { endpoint: '/api/legal/terms', description: 'Astera App利用規約の現在Versionです。' },
  'legal-privacy': { endpoint: '/api/legal/privacy', description: '個人情報と利用Dataの取扱いを確認します。' },
  'legal-commercial': { endpoint: '/api/legal/commercial', description: '販売条件と事業者情報を確認します。' },
  'legal-api-terms': { endpoint: '/api/legal/api-terms', description: 'Developer API利用条件を確認します。' },
};

function LegalPage({ route }: { route: RouteMatch }) {
  const document = legalDocuments[route.id] ?? legalDocuments.legal;
  const [resource, reload] = useResource(document.endpoint);
  return <PublicPageFrame route={route} description={document.description}>{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <article className="platform-legal-document"><KeyValueGrid value={resource.data} /></article>}</PublicPageFrame>;
}

function StatusPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/status');
  const offline = route.id === 'offline' || !navigator.onLine;
  return <PublicPageFrame route={route} description="Web、Android、iOSで同じSystem状態を表示します。"><Panel title="接続状態"><dl className="platform-kv-grid"><div><dt>Browser / WebView</dt><dd>{navigator.onLine ? 'Online' : 'Offline'}</dd></div><div><dt>Route</dt><dd>{route.id}</dd></div></dl></Panel>{offline ? <EmptyState>Networkへ接続後、再確認してください。入力中Dataは自動送信しません。</EmptyState> : resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <Panel title="Astera System"><KeyValueGrid value={resource.data} /></Panel>}</PublicPageFrame>;
}

function SupportPage({ route }: { route: RouteMatch }) {
  const hp = (import.meta.env.VITE_ASTERA_HP_URL as string | undefined) ?? 'https://asterav8.jp/';
  return <PublicPageFrame route={route} description="Customer AIと正式な問い合わせ導線を使用します。"><div className="platform-card-grid"><a className="platform-link-card" href={`${hp.replace(/\/$/, '')}/support`}><strong>Support Center</strong><span>操作説明・問い合わせ</span><b>↗</b></a><a className="platform-link-card" href="/status"><strong>System Status</strong><span>障害・Maintenance確認</span><b>›</b></a></div></PublicPageFrame>;
}

function NotFoundPage({ route }: { route: RouteMatch }) {
  return <PublicPageFrame route={route} description="指定されたPageはCanonical Route Registryにありません。"><EmptyState><p>{window.location.pathname}</p><a className="platform-button is-primary" href="/app/new">Astera Appへ戻る</a></EmptyState></PublicPageFrame>;
}

export function PublicPlatformPage({ route }: { route: RouteMatch }) {
  switch (route.id) {
    case 'public-share': return <ShareViewerPage route={route} isPublic />;
    case 'private-share': return <ShareViewerPage route={route} isPublic={false} />;
    case 'shares': return <SharesPage route={route} />;
    case 'about': return <AboutPage route={route} />;
    case 'legal': case 'legal-terms': case 'legal-privacy': case 'legal-commercial': case 'legal-api-terms': return <LegalPage route={route} />;
    case 'status': case 'offline': case 'maintenance': return <StatusPage route={route} />;
    case 'support': return <SupportPage route={route} />;
    default: return <NotFoundPage route={route} />;
  }
}
