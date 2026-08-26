import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAppText, type AppTextKey } from '../../app-text';
import { asRecord } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, Panel, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './settings-dedicated.css';

type OptionKey = 'translation' | 'agent_mode' | 'storage_transfer';
type OptionDefinition = { key: OptionKey; labelKey: AppTextKey; descriptionKey: AppTextKey };

const OPTION_DEFS: ReadonlyArray<OptionDefinition> = [
  { key: 'translation', labelKey: 'optionTranslation', descriptionKey: 'optionTranslationDescription' },
  { key: 'agent_mode', labelKey: 'optionAgentMode', descriptionKey: 'optionAgentModeDescription' },
  { key: 'storage_transfer', labelKey: 'optionStorageTransfer', descriptionKey: 'optionStorageTransferDescription' },
];

function Info({ label, body, ariaSuffix }: { label: string; body: string; ariaSuffix: string }) {
  return <details className="settings-info"><summary aria-label={`${label}${ariaSuffix}`}>?</summary><p>{body}</p></details>;
}

export default function OptionSettingsPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  const [resource, reload] = useResource('/api/preferences');
  const defaults = useMemo<Record<OptionKey, boolean>>(() => ({ translation: true, agent_mode: true, storage_transfer: true }), []);
  const [values, setValues] = useState<Record<OptionKey, boolean>>(defaults);
  const [state, setState] = useState<SubmitState>({ type: 'idle' });

  useEffect(() => {
    document.documentElement.dataset.settingsDedicatedOwner = 'true';
    return () => { delete document.documentElement.dataset.settingsDedicatedOwner; };
  }, []);
  useEffect(() => {
    if (resource.status !== 'ready') return;
    const root = asRecord(resource.data);
    const preferences = asRecord(root.preferences ?? root.data ?? root);
    setValues({ translation: preferences.translation !== false, agent_mode: preferences.agent_mode !== false, storage_transfer: preferences.storage_transfer !== false });
  }, [defaults, resource]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (resource.status !== 'ready') {
      setState({ type: 'error', message: text('optionSourceUnavailable'), code: 'PREFERENCE_SOURCE_NOT_READY' });
      return;
    }
    const response = await submitForm('/api/preferences', values, setState, { method: 'PATCH', success: text('optionSaved'), idempotent: true });
    if (response) reload();
  };

  return <ResponsivePageShell route={route} description={text('optionPageDescription')}>
    <Panel title={text('optionExecutionCandidates')}>
      {resource.status === 'loading' && <BusyState />}
      {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
      {resource.status === 'ready' && <form className="settings-option-list" onSubmit={save}>
        {OPTION_DEFS.map((item) => {
          const label = text(item.labelKey);
          return <div className="settings-option-row" key={item.key}><div><strong>{label}</strong><Info label={label} body={text(item.descriptionKey)} ariaSuffix={text('optionInfoAriaSuffix')} /></div><label className="settings-switch"><input type="checkbox" checked={values[item.key]} onChange={(event) => setValues((current) => ({ ...current, [item.key]: event.target.checked }))} /><span aria-hidden="true" /></label></div>;
        })}
        <p className="settings-note">{text('optionToggleNote')}</p>
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{text('save')}</button>
        <FormResult state={state} />
      </form>}
    </Panel>
    <Panel title={text('optionIndependentFeatures')}>
      <div className="settings-management-list">
        <a className="settings-management-card" href="/app/new"><span><strong>{text('optionPrivateMode')}</strong><Info label={text('optionPrivateMode')} body={text('optionPrivateModeDescription')} ariaSuffix={text('optionInfoAriaSuffix')} /></span><b>{text('optionManageInComposer')}</b></a>
        <a className="settings-management-card" href="/app/settings/astera-storage"><span><strong>{text('optionAsteraStorage')}</strong><small>{text('optionAsteraStorageDescription')}</small></span><b>{text('optionOpenSettings')}</b></a>
        <div className="settings-management-card is-static"><span><strong>{text('optionVaultProtection')}</strong><Info label={text('developerVault')} body={text('optionVaultProtectionDescription')} ariaSuffix={text('optionInfoAriaSuffix')} /></span><b>{text('optionAlwaysProtected')}</b></div>
      </div>
    </Panel>
  </ResponsivePageShell>;
}
