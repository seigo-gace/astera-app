import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { asRecord } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, Panel, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './settings-dedicated.css';

type OptionKey = 'translation' | 'agent_mode' | 'document' | 'storage_transfer';

const OPTION_DEFS: ReadonlyArray<{ key: OptionKey; label: string; description: string }> = [
  { key: 'translation', label: '高精度翻訳', description: '本文を翻訳する実行Optionです。要約・改善・校正・再構成は追加せず、翻訳先はComposerの「@」から選びます。' },
  { key: 'agent_mode', label: 'Agent Mode', description: '実行ごとにエージェント低／中／高を選ぶModeです。設定Toggleは候補表示だけを制御します。' },
  { key: 'document', label: '書類作成', description: 'Google Sheets固定書式を対象に、Astera公式Template／個別Templateを「@」から選びます。' },
  { key: 'storage_transfer', label: '外部Storage転送', description: '接続済みの利用者Storageへ成果物を転送します。Destinationは「@」から選びます。' },
];

function Info({ label, text }: { label: string; text: string }) {
  return <details className="settings-info"><summary aria-label={`${label}の説明`}>?</summary><p>{text}</p></details>;
}

export default function OptionSettingsPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/preferences');
  const defaults = useMemo<Record<OptionKey, boolean>>(() => ({ translation: true, agent_mode: true, document: true, storage_transfer: true }), []);
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
    setValues({
      translation: preferences.translation !== false,
      agent_mode: preferences.agent_mode !== false,
      document: preferences.document !== false,
      storage_transfer: preferences.storage_transfer !== false,
    });
  }, [defaults, resource]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (resource.status !== 'ready') {
      setState({ type: 'error', message: '現在設定を取得できていないため上書きを停止しました。', code: 'PREFERENCE_SOURCE_NOT_READY' });
      return;
    }
    const response = await submitForm('/api/preferences', values, setState, {
      method: 'PATCH',
      success: 'Option候補表示を保存しました。',
      idempotent: true,
    });
    if (response) reload();
  };

  return <ResponsivePageShell route={route} description="Composerの「＋／@」へ表示する4実行Option候補と、独立機能の管理導線を設定します。">
    <Panel title="実行Option候補">
      {resource.status === 'loading' && <BusyState />}
      {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
      {resource.status === 'ready' && <form className="settings-option-list" onSubmit={save}>
        {OPTION_DEFS.map((item) => <div className="settings-option-row" key={item.key}>
          <div><strong>{item.label}</strong><Info label={item.label} text={item.description} /></div>
          <label className="settings-switch"><input type="checkbox" checked={values[item.key]} onChange={(event) => setValues((current) => ({ ...current, [item.key]: event.target.checked }))} /><span aria-hidden="true" /></label>
        </div>)}
        <p className="settings-note">このToggleは候補へ表示する／しないだけを制御します。ここで実行・課金は行いません。</p>
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>保存</button>
        <FormResult state={state} />
      </form>}
    </Panel>

    <Panel title="独立機能">
      <div className="settings-management-list">
        <a className="settings-management-card" href="/app/new"><span><strong>Private Mode</strong><Info label="Private Mode" text="Composerを開くたび既定ONです。恒久OFF設定は設けません。本文・File・中間物・ResultをAstera側へ永続保存しません。" /></span><b>Composerで管理 ›</b></a>
        <a className="settings-management-card" href="/app/settings/astera-storage"><span><strong>Astera Storage</strong><small>容量・Object・Grace等を管理</small></span><b>設定を開く ›</b></a>
        <div className="settings-management-card is-static"><span><strong>暗号化・鍵管理（Libral Vault）</strong><Info label="Libral Vault" text="HTTPS/TLSと内部Secret保護を含む暗号化境界は常時有効です。暗号化OFF Toggleは作りません。" /></span><b>常時保護</b></div>
      </div>
    </Panel>
  </ResponsivePageShell>;
}
