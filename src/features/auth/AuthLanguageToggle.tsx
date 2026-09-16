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
  const routePath = window.location.pathname.replace(/\/+$/, '') || '/';

  if (!AUTH_LANGUAGE_PATHS.has(routePath)) return null;

  return (
    <div className="auth-language-toggle" role="group" aria-label={text('languageSelect')}>
      <button
        type="button"
        className={language === 'ja' ? 'is-active' : undefined}
        aria-pressed={language === 'ja'}
        onClick={() => void setLanguage('ja')}
      >
        {text('japanese')}
      </button>
      <button
        type="button"
        className={language === 'en' ? 'is-active' : undefined}
        aria-pressed={language === 'en'}
        onClick={() => void setLanguage('en')}
      >
        {text('english')}
      </button>
    </div>
  );
}
