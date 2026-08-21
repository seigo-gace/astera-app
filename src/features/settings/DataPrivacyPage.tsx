import { useEffect } from 'react';
import { useAppText } from '../../app-text';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { KeyValueGrid, useResource } from '../../platform/pages/page-kit';
import './settings-dedicated.css';

export default function DataPrivacyPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  const [policy, reloadPolicy] = useResource('/api/legal/privacy');

  useEffect(() => {
    document.documentElement.dataset.settingsDedicatedOwner = 'true';
    return () => { delete document.documentElement.dataset.settingsDedicatedOwner; };
  }, []);

  return (
    <ResponsivePageShell route={route} description={text('privacyDescription')}>
      <div className="settings-privacy-page">
        <section className="settings-privacy-section">
          <h2>{text('privacyPrivateModeTitle')}</h2>
          <ul className="platform-list">
            <li>{text('privacyPrivateModeItem1')}</li>
            <li>{text('privacyPrivateModeItem2')}</li>
            <li>{text('privacyPrivateModeItem3')}</li>
            <li>{text('privacyPrivateModeItem4')}</li>
            <li>{text('privacyPrivateModeItem5')}</li>
          </ul>
        </section>
        <div className="settings-surface-separator" role="separator" />
        <section className="settings-privacy-section">
          <h2>{text('privacyNormalModeTitle')}</h2>
          <ul className="platform-list">
            <li>{text('privacyNormalModeItem1')}</li>
            <li>{text('privacyNormalModeItem2')}</li>
            <li>{text('privacyNormalModeItem3')}</li>
            <li>{text('privacyNormalModeItem4')}</li>
          </ul>
        </section>
        <div className="settings-surface-separator" role="separator" />
        <section className="settings-privacy-section">
          <h2>{text('privacyRightsTitle')}</h2>
          <div className="settings-privacy-rights">
            <div className="settings-privacy-right">
              <strong>{text('privacyExportTitle')}</strong>
              <span>{text('privacyExportUnavailable')}</span>
              <button className="platform-button" type="button" disabled aria-disabled="true">{text('privacyExportAction')}</button>
              <small>{text('privacyExportNote')}</small>
            </div>
            <div className="settings-privacy-right">
              <strong>{text('privacyDeleteTitle')}</strong>
              <span>{text('privacyDeleteUnavailable')}</span>
              <button className="platform-button" type="button" disabled aria-disabled="true">{text('privacyDeleteAction')}</button>
              <small>{text('privacyDeleteNote')}</small>
            </div>
          </div>
        </section>
        <div className="settings-surface-separator" role="separator" />
        <section className="settings-privacy-section">
          <h2>{text('privacyPolicySectionTitle')}</h2>
          {policy.status === 'loading' && <BusyState />}
          {policy.status === 'error' && <ErrorState error={policy.error} onRetry={reloadPolicy} />}
          {policy.status === 'ready' && <KeyValueGrid value={policy.data} />}
          <div className="platform-action-row">
            <a className="platform-button" href="/legal/privacy">{text('privacyPolicyLink')}</a>
            <a className="platform-button" href="/app/settings/options">{text('privacyOptionsLink')}</a>
          </div>
          <p className="settings-note">{text('privacyPolicyNote')}</p>
        </section>
      </div>
    </ResponsivePageShell>
  );
}
