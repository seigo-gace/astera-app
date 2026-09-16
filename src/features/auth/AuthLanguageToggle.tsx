import { useAppText } from '../../app-text';
import './auth-language-toggle.css';

export function AuthLanguageToggle() {
  const { language, text, setLanguage } = useAppText();

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
