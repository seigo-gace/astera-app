import { useCallback, useEffect, useState } from 'react';
import { apiRequest, asArray, asRecord, recordText } from './api-client';
import type { RouteMatch } from './route-registry';
import { ResponsivePageShell } from './ResponsivePageShell';
import '../features/settings/settings-home.css';
import './canonical-notification-management.css';

type CreditPreferences = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  policyVersion: string;
  events: string[];
  quietStart: string;
  quietEnd: string;
};
type Policy = { version: string; low: number | null; critical: number | null };
type Feedback = { type: 'idle' | 'working' | 'success' | 'error'; message?: string };

const CREDIT_WARNING_EVENTS = ['credit.low', 'credit.critical', 'credit.insufficient'] as const;

export function NotificationSettingsPage({ route }: { route: RouteMatch }) {
  const [loading, setLoading] = useState(true);
  const [creditWarnings, setCreditWarnings] = useState(true);
  const [updateNotices, setUpdateNotices] = useState(true);
  const [creditPreferences, setCreditPreferences] = useState<CreditPreferences | null>(null);
  const [policy, setPolicy] = useState<Policy>({ version: '', low: null, critical: null });
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });

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
      const policyRoot = asRecord(creditRoot.policy);
      const events = asArray(credit.events).filter((value): value is string => typeof value === 'string');
      setCreditWarnings(CREDIT_WARNING_EVENTS.some((event) => events.includes(event)));
      setUpdateNotices(general.update_notices_enabled !== false);
      setCreditPreferences({
        emailEnabled: credit.email_enabled === true,
        pushEnabled: credit.push_enabled === true,
        policyVersion: recordText(credit, ['warning_policy_version']),
        events,
        quietStart: recordText(credit, ['quiet_hours_start']),
        quietEnd: recordText(credit, ['quiet_hours_end']),
      });
      setPolicy({
        version: recordText(policyRoot, ['version']),
        low: typeof policyRoot.low_threshold === 'number' ? policyRoot.low_threshold : null,
        critical: typeof policyRoot.critical_threshold === 'number' ? policyRoot.critical_threshold : null,
      });
      setFeedback({ type: 'idle' });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '通知設定を取得できませんでした。' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

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

  return (
    <ResponsivePageShell route={route} description="Asteraの通知はクレジット残量と重要なアップデート情報に絞ります。実行完了通知は扱いません。">
      <section className="settings-inline-block">
        <div><strong>クレジット警告基準</strong><small>判定値はFrontendへ固定せずServer Policyを使用します。</small></div>
        <span>{policy.version || '未設定'} / Low {policy.low ?? '—'} / Critical {policy.critical ?? '—'}</span>
      </section>

      <section className="settings-accordion" aria-label="通知設定">
        <div className="settings-accordion-body" style={{ borderTop: 0 }}>
          <label className="settings-toggle-row"><span><strong>クレジット残量のお知らせ</strong><small>残量低下・危険域・不足時だけ通知します。</small></span><input type="checkbox" checked={creditWarnings} disabled={loading || !creditPreferences || feedback.type === 'working'} onChange={(event) => void changeCreditWarnings(event.target.checked)} /></label>
          <label className="settings-toggle-row"><span><strong>Asteraアップデートのお知らせ</strong><small>重要な機能追加・更新のお知らせを表示します。</small></span><input type="checkbox" checked={updateNotices} disabled={loading || feedback.type === 'working'} onChange={(event) => void changeUpdateNotices(event.target.checked)} /></label>
        </div>
      </section>

      {feedback.type !== 'idle' && <p className={`settings-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.type === 'working' ? '保存しています…' : feedback.message}</p>}
      <div className="platform-action-row"><button className="platform-button" type="button" onClick={() => void reload()} disabled={loading}>再読込</button><a className="platform-button" href="/app/settings">設定へ戻る</a></div>
    </ResponsivePageShell>
  );
}