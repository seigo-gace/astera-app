import { useAppText } from '../../app-text';
import './settings-dedicated.css';

type SettingsSurfaceProps = {
  variant?: 'overlay' | 'page';
  onNavigate?: () => void;
};

type SettingsLink = {
  href: string;
  title: string;
  description: string;
};

export function SettingsSurface({ variant = 'page', onNavigate }: SettingsSurfaceProps) {
  const { language, text } = useAppText();
  const local = language === 'en'
    ? {
      astera: 'Astera settings',
      asteraDescription: 'Language and Astera behavior settings.',
      connections: 'Connected services',
      connectionsDescription: 'Manage Google Drive, Google Sheets, and storage connections.',
    }
    : {
      astera: 'Astera設定',
      asteraDescription: '表示言語とAstera機能の設定を管理します。',
      connections: '接続サービス',
      connectionsDescription: 'Google Drive、Google Sheets、Storage接続を管理します。',
    };

  const links: SettingsLink[] = [
    { href: '/account', title: text('accountTitle'), description: text('accountDescription') },
    { href: '/account/security', title: text('securityTitle'), description: text('securityDescription') },
    { href: '/app/plan-credit', title: text('planCreditTitle'), description: text('planCreditDescription') },
    { href: '/app/settings/options', title: local.astera, description: local.asteraDescription },
    { href: '/app/settings/notifications', title: text('notificationsTitle'), description: text('notificationsDescription') },
    { href: '/app/settings/storage-destinations', title: local.connections, description: local.connectionsDescription },
    { href: '/app/settings/data-privacy', title: text('privacyTitle'), description: text('privacyDescription') },
    { href: '/app/settings/legal-support', title: text('legalSupportTitle'), description: text('legalSupportDescription') },
  ];

  return (
    <nav className={`settings-surface${variant === 'overlay' ? ' is-overlay' : ''}`} aria-label={text('settingsTitle')}>
      {links.map((item) => (
        <a className="settings-surface-row" href={item.href} key={item.href} onClick={onNavigate}>
          <span className="settings-surface-row-copy">
            <strong>{item.title}</strong>
            <small>{item.description}</small>
          </span>
          <span className="settings-surface-chevron" aria-hidden="true">›</span>
        </a>
      ))}
    </nav>
  );
}
