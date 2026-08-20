import { useEffect, useState } from 'react';
import i18n from '../../i18n';
import { apiRequest, asRecord, recordText } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';

function normalizeLanguage(value: string): 'ja' | 'en' {
  return value.toLowerCase().startsWith('en') ? 'en' : 'ja';
}

export default function LanguageSettingsPage({ route }: { route: RouteMatch }) {
  const [language, setLanguage] = useState<'ja' | 'en'>('ja');
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void apiRequest('/api/preferences').then((payload) => {
      if (!active) return;
      const root = asRecord(payload);
      const preferences = asRecord(root.preferences ?? root.data ?? root);
      setLanguage(normalizeLanguage(recordText(preferences, ['ui_language'], document.documentElement.lang || 'ja')));
      setState('idle');
    }).catch((error) => {
      if (!active) return;
      setState('error');
      setMessage(error instanceof Error ? error.message : '言語設定を取得できませんでした。');
    });
    return () => { active = false; };
  }, []);

  const changeLanguage = async (next: 'ja' | 'en') => {
    const previous = language;
    setLanguage(next);
    setState('saving');
    setMessage('');
    try {
      await apiRequest('/api/preferences', {
        method: 'PATCH',
        idempotent: true,
        body: { ui_language: next === 'en' ? 'en-US' : 'ja-JP' },
      });
      localStorage.setItem('astera-language', next);
      document.documentElement.lang = next;
      await i18n.changeLanguage(next);
      setState('idle');
      setMessage('言語を変更しました。');
    } catch (error) {
      setLanguage(previous);
      setState('error');
      setMessage(error instanceof Error ? error.message : '言語を変更できませんでした。');
    }
  };

  return (
    <ResponsivePageShell route={route} description="表示言語だけを選択します。ThemeやMotionなど別の設定はここへ混在させません。">
      <section className="settings-inline-block" aria-label="言語設定">
        <div><strong>言語</strong><small>Astera Appの表示言語</small></div>
        <select aria-label="言語" value={language} disabled={state === 'loading' || state === 'saving'} onChange={(event) => void changeLanguage(event.target.value === 'en' ? 'en' : 'ja')}>
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
      </section>
      {message && <p className={`settings-feedback${state === 'error' ? ' is-error' : ''}`} role={state === 'error' ? 'alert' : 'status'}>{message}</p>}
      <a className="platform-button" href="/app/settings">設定へ戻る</a>
    </ResponsivePageShell>
  );
}