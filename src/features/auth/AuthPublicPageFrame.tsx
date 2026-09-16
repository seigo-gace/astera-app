import type { ReactNode } from 'react';
import { useAppText } from '../../app-text';
import type { RouteMatch } from '../../platform/route-registry';
import { PublicPageFrame } from '../../platform/ResponsivePageShell';
import './auth-language-switch.css';

function AuthLanguageSwitch() {
  const { language, text, setLanguage } = useAppText();

  return (
    <label className="auth-language-switch">
      <span className="sr-only">{text('languageSelect')}</span>
      <select
        aria-label={text('languageSelect')}
        value={language}
        onChange={(event) => void setLanguage(event.target.value as 'ja' | 'en')}
      >
        <option value="ja">{text('japanese')}</option>
        <option value="en">{text('english')}</option>
      </select>
    </label>
  );
}

export function AuthPublicPageFrame({ route, children, description }: {
  route: RouteMatch;
  children: ReactNode;
  description?: string;
}) {
  return (
    <PublicPageFrame route={route} description={description}>
      <AuthLanguageSwitch />
      {children}
    </PublicPageFrame>
  );
}
