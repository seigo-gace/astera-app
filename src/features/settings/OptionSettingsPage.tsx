import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { asRecord } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, Panel, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './settings-dedicated.css';

type OptionKey = 'translation' | 'agent_mode' | 'document' | 'storage_transfer';

const OPTION_DEFS: ReadonlyArray<{ key: OptionKey; label: string; description: string }> = [
  { key: 'translation', label: '高精度翻訳', description: '本文を翻訳する実行オプションです。要約・改善・校正・再構成は追加せず、翻訳先は入力欄の「@」から選びます。' },
  { key: 'agent_mode', label: 'エージェントモード', description: '実行ごとに低／中／高を選ぶオプションです。ここでは候補へ表示するかだけを設定します。' },
  { key: 'document', label: '書類作成', description: 'Astera公式テンプレート／個別テンプレートを使う書類作成オプションです。具体的なテンプレートは「@」から選びます。' },
  { key: 'storage_transfer', label: '外部ストレージ転送', description: '接続済みの利用者ストレージへ成果物を送る有料実行オプションです。接続だけでは課金せず、実行時のServer Estimate／Quoteを正本としてCreditを確定します。転送先は「@」から選びます。' },
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
      setState({ type: 'error', message: '現在の設定を取得できていないため、上書きを停止しました。', code: 'PREFERENCE_SOURCE_NOT_READY' });
      return;
    }
    const response = await submitForm('/api/preferences', values, setState, {
      method: 'PATCH',
      success: 'オプション候補の表示設定を保存しました。',
      idempotent: true,
    });
    if (response) reload();
  };

  return <ResponsivePageShell route={route} description="実行オプションと、それに関係するデータ・保存・テンプレート機能をここでまとめて管理します。">
    <Panel title="実行オプション候補">
      {resource.status === 'loading' && <BusyState />}
      {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
      {resource.status === 'ready' && <form className="settings-option-list" onSubmit={save}>
        {OPTION_DEFS.map((item) => <div className="settings-option-row" key={item.key}>
          <div><strong>{item.label}</strong><Info label={item.label} text={item.description} /></div>
          <label className="settings-switch"><input type="checkbox" checked={values[item.key]} onChange={(event) => setValues((current) => ({ ...current, [item.key]: event.target.checked }))} /><span aria-hidden="true" /></label>
        </div>)}
        <p className="settings-note">この切替は候補へ表示する／しないだけを制御します。ここで実行や課金は行いません。</p>
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>保存</button>
        <FormResult state={state} />
      </form>}
    </Panel>

    <Panel title="オプション関連の管理">
      <div className="settings-management-list">
        <a className="settings-management-card" href="/app/settings/data-privacy"><span><strong>データ・プライバシー</strong><small>保存、履歴、Export、削除、プライバシー境界</small></span><b>開く ›</b></a>
        <a className="settings-management-card" href="/app/settings/templates"><span><strong>個別テンプレート管理</strong><small>書類作成で使う個別テンプレート</small></span><b>開く ›</b></a>
        <a className="settings-management-card" href="/app/settings/storage-destinations"><span><strong>外部ストレージ接続</strong><small>接続・再認証・転送先管理だけを行います。実際の転送は有料Optionです。</small></span><b>開く ›</b></a>
        <a className="settings-management-card" href="/app/settings/astera-storage"><span><strong>Asteraストレージ</strong><small>容量、保存Object、Grace等を管理</small></span><b>開く ›</b></a>
        <a className="settings-management-card" href="/app/new"><span><strong>プライベートモード</strong><Info label="プライベートモード" text="入力画面を開くたび既定ONです。恒久OFF設定は設けません。本文・File・中間物・ResultをAstera側へ永続保存しません。" /></span><b>入力画面で管理 ›</b></a>
        <div className="settings-management-card is-static"><span><strong>暗号化・鍵管理（Libral Vault）</strong><Info label="Libral Vault" text="HTTPS/TLSと内部Secret保護を含む暗号化境界は常時有効です。暗号化OFF Toggleは作りません。" /></span><b>常時保護</b></div>
      </div>
    </Panel>
  </ResponsivePageShell>;
}