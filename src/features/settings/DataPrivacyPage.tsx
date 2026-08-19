import { useEffect } from 'react';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { KeyValueGrid, Panel, useResource } from '../../platform/pages/page-kit';
import './settings-dedicated.css';

export default function DataPrivacyPage({ route }: { route: RouteMatch }) {
  const [policy, reloadPolicy] = useResource('/api/legal/privacy');
  useEffect(() => {
    document.documentElement.dataset.settingsDedicatedOwner = 'true';
    return () => { delete document.documentElement.dataset.settingsDedicatedOwner; };
  }, []);

  return <ResponsivePageShell route={route} description="Private／Normal保存境界、Data Rights、外部Provider送信、Consent／Legal情報を確認します。">
    <div className="privacy-mode-grid">
      <Panel title="Private Mode">
        <ul className="platform-list">
          <li>Composerを開くたび既定ON。恒久OFF設定はありません。</li>
          <li>本文・File・抽出Text・中間物・ResultをAstera側へ永続保存しません。</li>
          <li>History、Project、Astera StorageへPrivate Resultを保存しません。</li>
          <li>成果物は端末DownloadまたはPrivate境界に適合する外部Storage転送で残します。</li>
          <li>安全な秘匿境界を満たせない場合は通常保存へFallbackしません。</li>
        </ul>
      </Panel>
      <Panel title="Normal Mode">
        <ul className="platform-list">
          <li>保存済みResultはHistory／Projectから再確認できます。</li>
          <li>Result編集は元Revisionを上書きせず新しいRevisionとして保存します。</li>
          <li>Shareは保存済みResult／RevisionをSnapshotとして扱います。</li>
          <li>Private Modeで作成した入力やResultをNormal保存へ自動変換しません。</li>
        </ul>
      </Panel>
    </div>

    <Panel title="Data Rights">
      <div className="privacy-rights-grid">
        <div><strong>Data Export</strong><span>Backend Contract未接続</span><button className="platform-button" type="button" disabled aria-disabled="true">Exportを準備</button><small>対象Data範囲・Fresh Session・Export生成契約が確定するまで成功扱いしません。</small></div>
        <div><strong>Account削除Request</strong><span>Backend Contract未接続</span><button className="platform-button" type="button" disabled aria-disabled="true">削除Request</button><small>Retention／取消期限／Legal Hold契約が確定するまで破壊的操作を作りません。</small></div>
      </div>
    </Panel>

    <Panel title="Privacy Policy・外部Provider・Consent">
      {policy.status === 'loading' && <BusyState />}
      {policy.status === 'error' && <ErrorState error={policy.error} onRetry={reloadPolicy} />}
      {policy.status === 'ready' && <KeyValueGrid value={policy.data} />}
      <div className="platform-action-row"><a className="platform-button" href="/legal/privacy">Privacy Policyを開く</a><a className="platform-button" href="/app/settings/options">Option設定を開く</a></div>
      <p className="settings-note">外部Provider送信・保持期間・Consent Versionは、公開されている正本値を取得して表示します。未確定値を画面側でHardcodeしません。</p>
    </Panel>
  </ResponsivePageShell>;
}
