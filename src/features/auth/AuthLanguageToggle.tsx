import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppText } from '../../app-text';
import './auth-language-toggle.css';

const AUTH_LANGUAGE_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/account/password/setup',
  '/auth/2fa',
]);

export function AuthLanguageToggle() {
  const { language, text, setLanguage } = useAppText();
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);
  const routePath = window.location.pathname.replace(/\/+$/, '') || '/';
  const enabled = AUTH_LANGUAGE_PATHS.has(routePath);

  useEffect(() => {
    if (!enabled) {
      setHeaderHost(null);
      return;
    }

    const host = document.querySelector<HTMLElement>('.platform-public-header');
    setHeaderHost(host);
  }, [enabled]);

  if (!enabled || !headerHost) return null;

  const changeLanguage = (next: 'ja' | 'en') => {
    if (next === language) return;
    void setLanguage(next);
  };

  return createPortal(
    <div className="auth-language-toggle" role="group" aria-label={text('languageSelect')}>
      <button
        type="button"
        className={language === 'ja' ? 'is-active' : undefined}
        aria-pressed={language === 'ja'}
        onClick={() => changeLanguage('ja')}
      >
        {text('japanese')}
      </button>
      <button
        type="button"
        className={language === 'en' ? 'is-active' : undefined}
        aria-pressed={language === 'en'}
        onClick={() => changeLanguage('en')}
      >
        {text('english')}
      </button>
    </div>,
    headerHost,
  );
}
