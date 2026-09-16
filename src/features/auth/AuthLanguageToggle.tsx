import { useAppText } from '../../app-text';
import './auth-language-toggle.css';

export function AuthLanguageToggle() {
  const { language, text, setLanguage } = useAppText();

  const changeLanguage = (next: 'ja' | 'en') => {
    if (next === language) return;
    void setLanguage(next);
  };

  return (
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
    </div>
  );
}
