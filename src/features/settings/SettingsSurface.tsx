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
  const optionDescription = language === 'en'
    ? 'Manage the existing Astera execution options.'
    : 'Asteraの既存実行オプションを管理します。';

  const links: SettingsLink[] = [
    { href: '/account', title: text('accountTitle'), description: text('accountDescription') },
    { href: '/account/security', title: text('securityTitle'), description: text('securityDescription') },
    { href: '/app/settings/options', title: text('navOptions'), description: optionDescription },
    { href: '/app/settings/language', title: text('languageTitle'), description: text('languageDescription') },
    { href: '/app/settings/notifications', title: text('notificationsTitle'), description: text('notificationsDescription') },
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
