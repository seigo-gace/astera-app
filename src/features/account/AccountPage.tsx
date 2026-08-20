import { asRecord, recordText } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { Panel, useResource } from '../../platform/pages/page-kit';

function yesNo(value: unknown): string {
  return value === true ? '確認済み' : value === false ? '未確認' : '—';
}

export default function AccountPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/account');
  const account = resource.status === 'ready' ? asRecord(asRecord(resource.data).account ?? asRecord(resource.data).data ?? resource.data) : {};

  return (
    <ResponsivePageShell route={route} description="登録情報とAsteraアカウント状態を確認します。セキュリティ、プラン、クレジットはそれぞれ別画面で管理します。">
      <Panel title="アカウント情報">
        {resource.status === 'loading' && <BusyState />}
        {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
        {resource.status === 'ready' && (
          <dl className="platform-kv-grid">
            <div><dt>メールアドレス</dt><dd>{recordText(account, ['email'], '—')}</dd></div>
            <div><dt>メール確認</dt><dd>{yesNo(account.email_verified)}</dd></div>
            <div><dt>アカウント状態</dt><dd>{recordText(account, ['account_status', 'auth_stage'], '—')}</dd></div>
            <div><dt>アカウントID</dt><dd>{recordText(account, ['user_id', 'id'], '—')}</dd></div>
          </dl>
        )}
      </Panel>
      <div className="platform-action-row">
        <a className="platform-button" href="/account/security">セキュリティを開く</a>
        <a className="platform-button" href="/app/settings">設定へ戻る</a>
      </div>
    </ResponsivePageShell>
  );
}