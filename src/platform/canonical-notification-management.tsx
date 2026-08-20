import { useCallback, useEffect, useState } from 'react';
import { apiRequest, asArray, asRecord, recordText } from './api-client';
import type { RouteMatch } from './route-registry';
import { ResponsivePageShell } from './ResponsivePageShell';
import './canonical-notification-management.css';

type Prefs = {
  in_app_enabled: boolean;
  email_enabled: boolean;
  push_enabled: boolean;
  warning_policy_version: string;
  events: string[];
  quiet_hours_start: string;
  quiet_hours_end: string;
};
type Policy = { version: string; low_threshold: number | null; critical_threshold: number | null };
type Feedback = { type: 'idle' | 'working' | 'success' | 'error'; message?: string };

const EVENT_LABELS: Record<string, string> = {
  'credit.low': '残高低下',
  'credit.critical': '残高が危険域',
  'credit.insufficient': 'クレジット不足で停止',
  'credit.purchase_pending': '支払い確認中',
  'credit.credited': 'クレジット反映完了',
  'credit.resume_available': '再実行可能',
  'credit.resume_blocked': '別の停止理由で継続停止',
};

function NotificationSurface() {
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [policy, setPolicy] = useState<Policy>({ version: '', low_threshold: null, critical_threshold: null });
  const [supported, setSupported] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const payload = asRecord(await apiRequest('/api/credit/notification-preferences'));
      const p = asRecord(payload.preferences);
      const pol = asRecord(payload.policy);
      setPrefs({
        in_app_enabled: true,
        email_enabled: p.email_enabled === true,
        push_enabled: p.push_enabled === true,
        warning_policy_version: recordText(p, ['warning_policy_version']),
        events: asArray(p.events).filter((value): value is string => typeof value === 'string'),
        quiet_hours_start: recordText(p, ['quiet_hours_start']),
        quiet_hours_end: recordText(p, ['quiet_hours_end']),
      });
      setPolicy({
        version: recordText(pol, ['version']),
        low_threshold: typeof pol.low_threshold === 'number' ? pol.low_threshold : null,
        critical_threshold: typeof pol.critical_threshold === 'number' ? pol.critical_threshold : null,
      });
      setSupported(asArray(payload.supported_events).filter((value): value is string => typeof value === 'string'));
      setFeedback({ type: 'idle' });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '通知設定を取得できませんでした。' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const save = async () => {
    if (!prefs || feedback.type === 'working') return;
    setFeedback({ type: 'working' });
    try {
      const payload = asRecord(await apiRequest('/api/credit/notification-preferences', {
        method: 'PATCH',
        idempotent: true,
        body: { ...prefs, in_app_enabled: true },
      }));
      const p = asRecord(payload.preferences);
      setPrefs({
        ...prefs,
        email_enabled: p.email_enabled === true,
        push_enabled: p.push_enabled === true,
        warning_policy_version: recordText(p, ['warning_policy_version']),
        events: asArray(p.events).filter((value): value is string => typeof value === 'string'),
        quiet_hours_start: recordText(p, ['quiet_hours_start']),
        quiet_hours_end: recordText(p, ['quiet_hours_end']),
      });
      setFeedback({ type: 'success', message: '通知・クレジット警告設定を保存しました。' });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '設定を保存できませんでした。' });
    }
  };

  if (loading && !prefs) return <section className="notification-management"><p>通知設定を読み込んでいます…</p></section>;
  if (!prefs) return <section className="notification-management"><button className="platform-button" type="button" onClick={() => void reload()}>再取得</button>{feedback.message && <p role="alert">{feedback.message}</p>}</section>;

  const toggleEvent = (event: string) => setPrefs((current) => current ? {
    ...current,
    events: current.events.includes(event) ? current.events.filter((value) => value !== event) : [...current.events, event],
  } : current);

  return (
    <section className="notification-management" data-canon-notification-management="true">
      <header>
        <div><h2>通知・クレジット警告</h2><p>警告の基準値はアプリへ固定せず、現在のサーバー設定を表示します。</p></div>
        <button className="platform-button" type="button" onClick={() => void reload()}>再読込</button>
      </header>
      {feedback.type !== 'idle' && <div className={`notification-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.type === 'working' ? '保存しています…' : feedback.message}</div>}
      <section className="notification-policy">
        <div><small>ポリシー版</small><strong>{policy.version || '未設定'}</strong></div>
        <div><small>低残高</small><strong>{policy.low_threshold ?? '未設定'}</strong></div>
        <div><small>危険域</small><strong>{policy.critical_threshold ?? '未設定'}</strong></div>
      </section>
      <section className="notification-card">
        <h3>通知方法</h3>
        <label className="notification-toggle"><span><strong>アプリ内通知</strong><small>安全状態通知のため常時ON</small></span><input type="checkbox" checked disabled /></label>
        <label className="notification-toggle"><span><strong>メール</strong><small>任意</small></span><input type="checkbox" checked={prefs.email_enabled} onChange={(event) => setPrefs({ ...prefs, email_enabled: event.target.checked })} /></label>
        <label className="notification-toggle"><span><strong>プッシュ通知</strong><small>端末許可がない場合はアプリ内通知へ切り替えます</small></span><input type="checkbox" checked={prefs.push_enabled} onChange={(event) => setPrefs({ ...prefs, push_enabled: event.target.checked })} /></label>
      </section>
      <section className="notification-card">
        <h3>任意通知の種類</h3>
        <div className="notification-events">{supported.map((event) => <label key={event}><input type="checkbox" checked={prefs.events.includes(event)} onChange={() => toggleEvent(event)} /><span><strong>{EVENT_LABELS[event] || event}</strong><small>{event}</small></span></label>)}</div>
      </section>
      <section className="notification-card">
        <h3>通知を抑える時間帯</h3>
        <p>低残高・危険域の通知だけに適用します。クレジット不足などの停止通知は遅延させません。</p>
        <div className="notification-times">
          <label><span>開始</span><input type="time" value={prefs.quiet_hours_start} onChange={(event) => setPrefs({ ...prefs, quiet_hours_start: event.target.value })} /></label>
          <label><span>終了</span><input type="time" value={prefs.quiet_hours_end} onChange={(event) => setPrefs({ ...prefs, quiet_hours_end: event.target.value })} /></label>
        </div>
      </section>
      <button className="platform-button is-primary" type="button" onClick={() => void save()} disabled={feedback.type === 'working'}>保存</button>
      <section className="notification-card is-muted"><h3>配信機能の実装状態</h3><p>設定保存は接続済みです。メール・プッシュ配信、複数端末の既読同期、通知からの復帰動作は別途実機検証が必要です。</p></section>
    </section>
  );
}

export function NotificationSettingsPage({ route }: { route: RouteMatch }) {
  return (
    <ResponsivePageShell route={route} description="通知方法、クレジット残量警告、通知を抑える時間帯を管理します。">
      <NotificationSurface />
    </ResponsivePageShell>
  );
}
