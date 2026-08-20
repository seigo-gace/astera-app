import { useCallback, useEffect, useState } from 'react';
import i18n from '../../i18n';
import { apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import { authClient, authErrorMessage } from '../../platform/auth-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import './settings-home.css';

type CreditPreferences = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  policyVersion: string;
  events: string[];
  quietStart: string;
  quietEnd: string;
};

type Feedback = { type: 'idle' | 'working' | 'success' | 'error'; message?: string };

const CREDIT_WARNING_EVENTS = ['credit.low', 'credit.critical', 'credit.insufficient'] as const;

function normalizeLanguage(value: string): 'ja' | 'en' {
  return value.toLowerCase().startsWith('en') ? 'en' : 'ja';
}

function ToggleRow({ label, description, checked, disabled, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-toggle-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export default function SettingsHomePage({ route }: { route: RouteMatch }) {
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<'ja' | 'en'>('ja');
  const [creditWarnings, setCreditWarnings] = useState(true);
  const [updateNotices, setUpdateNotices] = useState(true);
  const [creditPreferences, setCreditPreferences] = useState<CreditPreferences | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });
  const [loggingOut, setLoggingOut] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [generalPayload, creditPayload] = await Promise.all([
        apiRequest('/api/preferences'),
        apiRequest('/api/credit/notification-preferences'),
      ]);
      const generalRoot = asRecord(generalPayload);
      const general = asRecord(generalRoot.preferences ?? generalRoot.data ?? generalRoot);
      const creditRoot = asRecord(creditPayload);
      const credit = asRecord(creditRoot.preferences ?? creditRoot.data ?? creditRoot);
      const events = asArray(credit.events).filter((value): value is string => typeof value === 'string');
      const nextLanguage = normalizeLanguage(recordText(general, ['ui_language'], document.documentElement.lang || 'ja'));
      setLanguage(nextLanguage);
      setUpdateNotices(general.update_notices_enabled !== false);
      setCreditWarnings(CREDIT_WARNING_EVENTS.some((event) => events.includes(event)));
      setCreditPreferences({
        emailEnabled: credit.email_enabled === true,
        pushEnabled: credit.push_enabled === true,
        policyVersion: recordText(credit, ['warning_policy_version']),
        events,
        quietStart: recordText(credit, ['quiet_hours_start']),
        quietEnd: recordText(credit, ['quiet_hours_end']),
      });
      setFeedback({ type: 'idle' });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '設定を取得できませんでした。' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const changeLanguage = async (next: 'ja' | 'en') => {
    if (next === language || feedback.type === 'working') return;
    const previous = language;
    setLanguage(next);
    setFeedback({ type: 'working' });
    try {
      await apiRequest('/api/preferences', {
        method: 'PATCH',
        idempotent: true,
        body: { ui_language: next === 'en' ? 'en-US' : 'ja-JP' },
      });
      localStorage.setItem('astera-language', next);
      document.documentElement.lang = next;
      await i18n.changeLanguage(next);
      setFeedback({ type: 'success', message: '言語を変更しました。' });
    } catch (error) {
      setLanguage(previous);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '言語を変更できませんでした。' });
    }
  };

  const changeCreditWarnings = async (enabled: boolean) => {
    if (!creditPreferences || feedback.type === 'working') return;
    const previous = creditWarnings;
    setCreditWarnings(enabled);
    setFeedback({ type: 'working' });
    try {
      const events = enabled ? [...CREDIT_WARNING_EVENTS] : [];
      const payload = asRecord(await apiRequest('/api/credit/notification-preferences', {
        method: 'PATCH',
        idempotent: true,
        body: {
          in_app_enabled: true,
          email_enabled: creditPreferences.emailEnabled,
          push_enabled: creditPreferences.pushEnabled,
          warning_policy_version: creditPreferences.policyVersion,
          events,
          quiet_hours_start: creditPreferences.quietStart,
          quiet_hours_end: creditPreferences.quietEnd,
        },
      }));
      const saved = asRecord(payload.preferences);
      setCreditPreferences((current) => current ? {
        ...current,
        policyVersion: recordText(saved, ['warning_policy_version'], current.policyVersion),
        events: asArray(saved.events).filter((value): value is string => typeof value === 'string'),
      } : current);
      setFeedback({ type: 'success', message: 'クレジット通知を更新しました。' });
    } catch (error) {
      setCreditWarnings(previous);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'クレジット通知を変更できませんでした。' });
    }
  };

  const changeUpdateNotices = async (enabled: boolean) => {
    if (feedback.type === 'working') return;
    const previous = updateNotices;
    setUpdateNotices(enabled);
    setFeedback({ type: 'working' });
    try {
      await apiRequest('/api/preferences', {
        method: 'PATCH',
        idempotent: true,
        body: { update_notices_enabled: enabled },
      });
      setFeedback({ type: 'success', message: 'アップデートのお知らせ設定を更新しました。' });
    } catch (error) {
      setUpdateNotices(previous);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'お知らせ設定を変更できませんでした。' });
    }
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setFeedback({ type: 'working' });
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(authErrorMessage(result.error, 'ログアウトできませんでした。'));
      window.location.assign('/login');
    } catch (error) {
      setLoggingOut(false);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'ログアウトできませんでした。' });
    }
  };

  return (
    <ResponsivePageShell route={route} description="重い管理は専用ページ、単純な設定はその場で完結させます。オプション、プラン/クレジット、開発者機能はサイドメニューから管理します。">
      <section className="settings-page-links" aria-label="アカウント管理">
        <a className="settings-page-link" href="/account"><span><strong>アカウント</strong><small>登録情報とアカウント状態</small></span><b aria-hidden="true">›</b></a>
        <a className="settings-page-link" href="/account/security"><span><strong>セキュリティ</strong><small>パスワード、Passkey、2段階認証、ログイン連携、端末</small></span><b aria-hidden="true">›</b></a>
      </section>

      <section className="settings-inline-block" id="language" aria-labelledby="settings-language-title">
        <div><strong id="settings-language-title">言語</strong><small>表示言語だけを選択します。</small></div>
        <select aria-label="言語" value={language} disabled={loading || feedback.type === 'working'} onChange={(event) => void changeLanguage(event.target.value === 'en' ? 'en' : 'ja')}>
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
      </section>

      <details className="settings-accordion">
        <summary><span><strong>通知</strong><small>クレジット残量とAsteraの更新情報だけを管理します。</small></span><b aria-hidden="true">⌄</b></summary>
        <div className="settings-accordion-body">
          <ToggleRow label="クレジット残量のお知らせ" description="残量低下・危険域・不足時だけ通知します。" checked={creditWarnings} disabled={loading || !creditPreferences || feedback.type === 'working'} onChange={(checked) => void changeCreditWarnings(checked)} />
          <ToggleRow label="Asteraアップデートのお知らせ" description="重要な機能追加・更新のお知らせを表示します。" checked={updateNotices} disabled={loading || feedback.type === 'working'} onChange={(checked) => void changeUpdateNotices(checked)} />
        </div>
      </details>

      <details className="settings-accordion">
        <summary><span><strong>法務・サポート</strong><small>規約、法定表示、問い合わせを確認します。</small></span><b aria-hidden="true">⌄</b></summary>
        <div className="settings-link-list">
          <a href="/legal/terms"><span>利用規約</span><b aria-hidden="true">›</b></a>
          <a href="/legal/privacy"><span>プライバシーポリシー</span><b aria-hidden="true">›</b></a>
          <a href="/legal/commercial"><span>特定商取引法に基づく表記</span><b aria-hidden="true">›</b></a>
          <a href="/support"><span>問い合わせ・サポート</span><b aria-hidden="true">›</b></a>
          <a href="/status"><span>システム状況</span><b aria-hidden="true">›</b></a>
        </div>
      </details>

      {feedback.type !== 'idle' && <p className={`settings-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.type === 'working' ? '保存しています…' : feedback.message}</p>}

      <section className="settings-logout" aria-label="ログアウト">
        <button className="platform-button" type="button" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? 'ログアウト中…' : 'ログアウト'}</button>
      </section>
    </ResponsivePageShell>
  );
}