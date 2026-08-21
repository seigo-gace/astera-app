import { useEffect, useState } from 'react';
import { useAppText } from '../../app-text';
import { asArray, asRecord, recordText } from '../../platform/api-client';
import { submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './settings-dedicated.css';

type SettingsSurfaceProps = {
  variant?: 'overlay' | 'page';
  onNavigate?: () => void;
};

const LEGAL_LINKS = [
  ['/legal/terms', 'legalTerms'],
  ['/legal/privacy', 'legalPrivacy'],
  ['/legal/commercial', 'legalCommerce'],
  ['/support', 'contact'],
  ['/support', 'help'],
] as const;

export function SettingsSurface({ variant = 'page', onNavigate }: SettingsSurfaceProps) {
  const { language, setLanguage, text } = useAppText();
  const [languageValue, setLanguageValue] = useState<'ja' | 'en'>(language);
  const [resource, reload] = useResource('/api/credit/notification-preferences');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [policyVersion, setPolicyVersion] = useState('');
  const [notifyState, setNotifyState] = useState<SubmitState>({ type: 'idle' });

  useEffect(() => setLanguageValue(language), [language]);

  useEffect(() => {
    if (resource.status !== 'ready') return;
    const payload = asRecord(asRecord(resource.data).preferences ?? asRecord(resource.data).data ?? resource.data);
    setEmailEnabled(payload.email_enabled === true);
    setPushEnabled(payload.push_enabled === true);
    setPolicyVersion(recordText(payload, ['warning_policy_version']));
    setEvents(asArray(payload.events).map(String));
  }, [resource]);

  const navigate = () => { onNavigate?.(); };

  const applyLanguage = async (next: 'ja' | 'en') => {
    setLanguageValue(next);
    await setLanguage(next);
  };

  const patchNotifications = async (nextEmail: boolean, nextPush: boolean) => {
    if (resource.status !== 'ready') return;
    setEmailEnabled(nextEmail);
    setPushEnabled(nextPush);
    await submitForm('/api/credit/notification-preferences', {
      in_app_enabled: true,
      email_enabled: nextEmail,
      push_enabled: nextPush,
      events,
      warning_policy_version: policyVersion,
      quiet_hours_start: '',
      quiet_hours_end: '',
    }, setNotifyState, { method: 'PATCH', success: text('saved'), idempotent: true });
    reload();
  };

  return (
    <div className={`settings-surface${variant === 'overlay' ? ' is-overlay' : ''}`}>
      <a className="settings-surface-row is-link" href="/account" onClick={navigate}>
        <span>{text('accountTitle')}</span>
        <span className="settings-surface-chevron" aria-hidden="true">›</span>
      </a>
      <div className="settings-surface-separator" role="separator" />
      <a className="settings-surface-row is-link" href="/account/security" onClick={navigate}>
        <span>{text('securityTitle')}</span>
        <span className="settings-surface-chevron" aria-hidden="true">›</span>
      </a>
      <div className="settings-surface-separator" role="separator" />
      <div className="settings-surface-row is-control">
        <span>{text('languageTitle')}</span>
        <select
          className="settings-surface-select"
          aria-label={text('languageSelect')}
          value={languageValue}
          onChange={(event) => void applyLanguage(event.target.value as 'ja' | 'en')}
        >
          <option value="ja">{text('japanese')}</option>
          <option value="en">{text('english')}</option>
        </select>
      </div>
      <div className="settings-surface-separator" role="separator" />
      <div className="settings-surface-row is-stack">
        <div className="settings-surface-row-head">
          <span>{text('notificationsTitle')}</span>
          {resource.status === 'loading' && <span className="settings-surface-meta">{text('recentLoading')}</span>}
          {resource.status === 'error' && <button type="button" className="settings-surface-inline-action" onClick={reload}>{text('retry')}</button>}
        </div>
        {resource.status === 'ready' && (
          <div className="settings-surface-toggle-group">
            <label className="settings-surface-toggle">
              <span>{text('emailNotice')}</span>
              <span className="settings-switch"><input type="checkbox" checked={emailEnabled} disabled={notifyState.type === 'working'} onChange={(event) => void patchNotifications(event.target.checked, pushEnabled)} /><span aria-hidden="true" /></span>
            </label>
            <label className="settings-surface-toggle">
              <span>{text('pushNotice')}</span>
              <span className="settings-switch"><input type="checkbox" checked={pushEnabled} disabled={notifyState.type === 'working'} onChange={(event) => void patchNotifications(emailEnabled, event.target.checked)} /><span aria-hidden="true" /></span>
            </label>
            {notifyState.type === 'error' && <p className="settings-surface-feedback is-error" role="alert">{notifyState.message}</p>}
            {notifyState.type === 'success' && <p className="settings-surface-feedback is-success" role="status">{notifyState.message}</p>}
          </div>
        )}
      </div>
      <div className="settings-surface-separator" role="separator" />
      <a className="settings-surface-row is-link" href="/app/settings/data-privacy" onClick={navigate}>
        <span>{text('privacyTitle')}</span>
        <span className="settings-surface-chevron" aria-hidden="true">›</span>
      </a>
      <div className="settings-surface-separator" role="separator" />
      <details className="settings-surface-accordion">
        <summary>{text('legalSupportTitle')}</summary>
        <div className="settings-surface-accordion-body">
          {LEGAL_LINKS.map(([href, labelKey], index) => (
            <a key={`${href}-${labelKey}-${index}`} className="settings-surface-row is-link is-nested" href={href} onClick={navigate}>
              <span>{text(labelKey)}</span>
              <span className="settings-surface-chevron" aria-hidden="true">›</span>
            </a>
          ))}
        </div>
      </details>
    </div>
  );
}
