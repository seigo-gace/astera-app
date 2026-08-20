import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';

const SETTINGS = [
  {
    href: '/app/settings/language',
    title: '表示・言語',
    description: '表示テーマ、言語、文字表示、動作の設定',
  },
  {
    href: '/app/settings/notifications',
    title: '通知・クレジット警告',
    description: 'アプリ内通知、メール、Push、クレジット残量警告',
  },
] as const;

export default function SettingsHomePage({ route }: { route: RouteMatch }) {
  return (
    <ResponsivePageShell route={route} description="アプリ全体に関する設定だけを管理します。実行オプションやプラン、開発者機能は各専用ページから管理します。">
      <div className="platform-card-grid" aria-label="設定項目">
        {SETTINGS.map((item) => (
          <a className="platform-link-card" href={item.href} key={item.href}>
            <strong>{item.title}</strong>
            <span>{item.description}</span>
            <b aria-hidden="true">›</b>
          </a>
        ))}
      </div>
    </ResponsivePageShell>
  );
}
