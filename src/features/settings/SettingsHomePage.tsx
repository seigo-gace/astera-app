import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';

const ACCOUNT_SETTINGS = [
  {
    href: '/account',
    title: 'アカウント',
    description: 'プロフィール、アカウント状態、基本情報を確認します。',
  },
  {
    href: '/account/security',
    title: 'セキュリティ',
    description: 'パスワード、Passkey、2段階認証、ログイン状態を管理します。',
  },
] as const;

const APP_SETTINGS = [
  {
    href: '/app/settings/language',
    title: '表示・言語',
    description: '表示テーマ、言語、文字表示、動作を設定します。',
  },
  {
    href: '/app/settings/notifications',
    title: '通知・クレジット警告',
    description: 'アプリ内通知、メール、Push、クレジット残量警告を設定します。',
  },
] as const;

function SettingsGroup({ title, items }: { title: string; items: ReadonlyArray<{ href: string; title: string; description: string }> }) {
  return (
    <section className="platform-settings-group" aria-label={title}>
      <h2>{title}</h2>
      <div className="platform-card-grid">
        {items.map((item) => (
          <a className="platform-link-card" href={item.href} key={item.href}>
            <strong>{item.title}</strong>
            <span>{item.description}</span>
            <b aria-hidden="true">›</b>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function SettingsHomePage({ route }: { route: RouteMatch }) {
  return (
    <ResponsivePageShell route={route} description="アカウントとアプリ本体の設定を管理します。実行オプション、プラン/クレジット、開発者機能は各専用ページから管理します。">
      <SettingsGroup title="アカウント" items={ACCOUNT_SETTINGS} />
      <SettingsGroup title="アプリ設定" items={APP_SETTINGS} />
    </ResponsivePageShell>
  );
}
