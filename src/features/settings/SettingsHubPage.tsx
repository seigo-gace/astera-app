import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAppText } from '../../app-text';
import { asArray, asRecord, recordText } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, Panel, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';

const SETTINGS_LINKS = [
  ['/account', 'accountTitle', 'accountDescription'],
  ['/account/security', 'securityTitle', 'securityDescription'],
  ['/app/settings/language', 'languageTitle', 'languageDescription'],
  ['/app/settings/notifications', 'notificationsTitle', 'notificationsDescription'],
  ['/app/settings/data-privacy', 'privacyTitle', 'privacyDescription'],
  ['/app/settings/legal-support', 'legalSupportTitle', 'legalSupportDescription'],
] as const;

export function SettingsIndexPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  return (
    <ResponsivePageShell route={route} description={text('settingsDescription')}>
      <div className="platform-card-grid">
        {SETTINGS_LINKS.map(([href, title, description]) => (
          <a className="platform-link-card" href={href} key={href}>
            <strong>{text(title)}</strong><span>{text(description)}</span><b>›</b>
          </a>
        ))}
      </div>
    </ResponsivePageShell>
  );
}

export function LanguageSettingsPage({ route }: { route: RouteMatch }) {
  const { language, setLanguage, text } = useAppText();
  const [value, setValue] = useState<'ja' | 'en'>(language);
  const [saved, setSaved] = useState(false);
  useEffect(() => setValue(language), [language]);
  const apply = async (event: FormEvent) => {
    event.preventDefault();
    await setLanguage(value);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };
  return (
    <ResponsivePageShell route={route} description={text('languageDescription')}>
      <Panel title={text('languageTitle')}>
        <form className="platform-form" onSubmit={(event) => void apply(event)}>
          <label className="platform-field"><span>{text('languageSelect')}</span><select value={value} onChange={(event) => setValue(event.target.value as 'ja' | 'en')}><option value="ja">{text('japanese')}</option><option value="en">{text('english')}</option></select></label>
          <button className="platform-button is-primary" type="submit">{text('save')}</button>
          {saved && <p className="platform-form-result is-success" role="status">{text('saved')}</p>}
        </form>
      </Panel>
    </ResponsivePageShell>
  );
}

type CreditEvent = 'credit.low' | 'credit.critical' | 'credit.insufficient' | 'credit.purchase_pending' | 'credit.credited' | 'credit.resume_available' | 'credit.resume_blocked';
const CREDIT_EVENTS: readonly CreditEvent[] = ['credit.low','credit.critical','credit.insufficient','credit.purchase_pending','credit.credited','credit.resume_available','credit.resume_blocked'];

export function NotificationSettingsPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  const [resource, reload] = useResource('/api/credit/notification-preferences');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const source = resource.status === 'ready' ? asRecord(asRecord(resource.data).preferences ?? asRecord(resource.data).data ?? resource.data) : {};
  const [email, setEmail] = useState(false);
  const [push, setPush] = useState(false);
  const [events, setEvents] = useState<CreditEvent[]>([...CREDIT_EVENTS]);
  const policyVersion = recordText(source, ['warning_policy_version']);

  useEffect(() => {
    if (resource.status !== 'ready') return;
    setEmail(source.email_enabled === true);
    setPush(source.push_enabled === true);
    const supported = asArray(source.events).filter((item): item is CreditEvent => typeof item === 'string' && CREDIT_EVENTS.includes(item as CreditEvent));
    setEvents(supported.length ? supported : [...CREDIT_EVENTS]);
  }, [resource.status, resource.status === 'ready' ? resource.data : null]);

  const eventLabel = (event: CreditEvent) => ({
    'credit.low': text('creditLow'),
    'credit.critical': text('creditCritical'),
    'credit.insufficient': text('creditInsufficient'),
    'credit.purchase_pending': text('creditPurchasePending'),
    'credit.credited': text('creditCredited'),
    'credit.resume_available': text('creditResume'),
    'credit.resume_blocked': text('creditResume'),
  })[event];

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (resource.status !== 'ready') return;
    await submitForm('/api/credit/notification-preferences', {
      in_app_enabled: true,
      email_enabled: email,
      push_enabled: push,
      events,
      warning_policy_version: policyVersion,
      quiet_hours_start: '',
      quiet_hours_end: '',
    }, setState, { method: 'PATCH', success: text('saved'), idempotent: true });
    reload();
  };

  return (
    <ResponsivePageShell route={route} description={text('notificationsDescription')}>
      {resource.status === 'loading' && <BusyState />}
      {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
      {resource.status === 'ready' && <form className="platform-settings-form" onSubmit={(event) => void save(event)}>
        <Panel title={text('notificationCredit')}>
          {CREDIT_EVENTS.map((item) => <label className="platform-toggle-row" key={item}><span><strong>{eventLabel(item)}</strong></span><input type="checkbox" checked={events.includes(item)} onChange={(event) => setEvents((current) => event.target.checked ? [...new Set([...current, item])] : current.filter((value) => value !== item))} /></label>)}
        </Panel>
        <Panel title={text('notificationChannel')}>
          <label className="platform-toggle-row"><span><strong>{text('appNotice')}</strong></span><input type="checkbox" checked disabled /></label>
          <label className="platform-toggle-row"><span><strong>{text('emailNotice')}</strong></span><input type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} /></label>
          <label className="platform-toggle-row"><span><strong>{text('pushNotice')}</strong></span><input type="checkbox" checked={push} onChange={(event) => setPush(event.target.checked)} /></label>
        </Panel>
        <Panel title={text('notificationSystem')}>
          <div className="platform-card-grid"><div className="platform-link-card"><strong>{text('updateNotice')}</strong><span>{text('notificationsDescription')}</span></div><div className="platform-link-card"><strong>{text('importantNotice')}</strong><span>{text('notificationsDescription')}</span></div></div>
        </Panel>
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{text('save')}</button><FormResult state={state} />
      </form>}
    </ResponsivePageShell>
  );
}

export function LegalSupportSettingsPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  const links = [
    ['/legal/terms', text('legalTerms')],
    ['/legal/privacy', text('legalPrivacy')],
    ['/legal/commercial', text('legalCommerce')],
    ['/support', text('contact')],
    ['/support', text('help')],
  ] as const;
  return (
    <ResponsivePageShell route={route} description={text('legalSupportDescription')}>
      <Panel title={text('legalSupportTitle')}>
        <div className="platform-card-grid">{links.map(([href, label], index) => <a className="platform-link-card" href={href} key={`${href}-${index}`}><strong>{label}</strong><b>›</b></a>)}</div>
      </Panel>
    </ResponsivePageShell>
  );
}
