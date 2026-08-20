import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import { previewWithoutAuth } from '../../platform/account-session';
import { authClient, authErrorMessage } from '../../platform/auth-client';
import { AccountSecurityManagementSurface } from '../../platform/canonical-account-security-management';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import type { RouteMatch } from '../../platform/route-registry';
import './security-page.css';

type PasskeyRecord = {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
};

type AccountSecurity = {
  twoFactorEnabled: boolean;
};

type Enrollment = {
  totpURI: string;
  backupCodes: string[];
};

type Feedback = { type: 'idle' | 'working' | 'success' | 'error'; message?: string; code?: string };

function betterAuthResult<T>(value: { data?: T | null; error?: unknown }, fallback: string): T {
  if (value.error) throw new ApiError(authErrorMessage(value.error, fallback), 400, recordText(asRecord(value.error), ['code'], 'AUTH_OPERATION_FAILED'), value.error);
  if (value.data == null) throw new ApiError(fallback, 502, 'AUTH_RESPONSE_EMPTY');
  return value.data;
}

function normalizePasskeys(payload: unknown): PasskeyRecord[] {
  return asArray(payload, ['passkeys', 'items']).map((item) => {
    const source = asRecord(item);
    return {
      id: recordText(source, ['id']),
      name: recordText(source, ['name'], 'Passkey'),
      deviceType: recordText(source, ['deviceType', 'device_type'], 'unknown'),
      backedUp: source.backedUp === true || source.backed_up === true,
      createdAt: recordText(source, ['createdAt', 'created_at']),
    };
  }).filter((item) => item.id);
}

export default function SecurityPage({ route }: { route: RouteMatch }) {
  const previewMode = previewWithoutAuth();
  const [loading, setLoading] = useState(!previewMode);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [security, setSecurity] = useState<AccountSecurity>({ twoFactorEnabled: false });
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const reload = useCallback(async () => {
    if (previewWithoutAuth()) {
      setSecurity({ twoFactorEnabled: false });
      setPasskeys([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [accountPayload, passkeyPayload] = await Promise.all([
        apiRequest('/api/account'),
        authClient.passkey.listUserPasskeys(),
      ]);
      const account = asRecord(asRecord(accountPayload).account ?? accountPayload);
      setSecurity({
        twoFactorEnabled: account.two_factor_enabled === true || account.twoFactorEnabled === true,
      });
      setPasskeys(normalizePasskeys(betterAuthResult(passkeyPayload, 'Passkey一覧を取得できませんでした。')));
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addPasskey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.passkey.addPasskey({
        name: name || undefined,
        authenticatorAttachment: 'platform',
      }), 'Passkeyを追加できませんでした。');
      event.currentTarget.reset();
      setFeedback({ type: 'success', message: 'Passkeyを追加しました。' });
      await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Passkeyを追加できませんでした。', code: error instanceof ApiError ? error.code : 'PASSKEY_ADD_FAILED' });
    }
  };

  const deletePasskey = async (id: string) => {
    if (previewMode) return;
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.passkey.deletePasskey({ id }), 'Passkeyを削除できませんでした。');
      setFeedback({ type: 'success', message: 'Passkeyを削除しました。' });
      await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Passkeyを削除できませんでした。', code: error instanceof ApiError ? error.code : 'PASSKEY_DELETE_FAILED' });
    }
  };

  const enableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFeedback({ type: 'working' });
    setBackupCodes([]);
    try {
      const payload = betterAuthResult(await authClient.twoFactor.enable({ password, issuer: 'Astera' }), '2FAを開始できませんでした。');
      const source = asRecord(payload);
      const totpURI = recordText(source, ['totpURI', 'totpUri', 'totp_uri']);
      const codes = asArray(source.backupCodes ?? source.backup_codes).map(String);
      if (!totpURI || codes.length === 0) throw new ApiError('TOTP URIまたはBackup Codeを受信できませんでした。', 502, 'TWO_FACTOR_ENROLLMENT_INCOMPLETE', payload);
      setEnrollment({ totpURI, backupCodes: codes });
      setFeedback({ type: 'success', message: 'Authenticatorへ登録し、表示されたCodeで確認してください。' });
      event.currentTarget.reset();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '2FAを開始できませんでした。', code: error instanceof ApiError ? error.code : 'TWO_FACTOR_ENABLE_FAILED' });
    }
  };

  const verifyTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s/g, '');
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.twoFactor.verifyTotp({ code, trustDevice: true }), 'TOTP Codeを確認できませんでした。');
      setBackupCodes(enrollment?.backupCodes ?? []);
      setEnrollment(null);
      setFeedback({ type: 'success', message: '2FAを有効化しました。Backup Codeを今すぐ安全な場所へ保存してください。' });
      event.currentTarget.reset();
      await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'TOTP Codeを確認できませんでした。', code: error instanceof ApiError ? error.code : 'TWO_FACTOR_VERIFY_FAILED' });
    }
  };

  const disableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.twoFactor.disable({ password }), '2FAを無効化できませんでした。');
      setEnrollment(null);
      setBackupCodes([]);
      setFeedback({ type: 'success', message: '2FAを無効化しました。' });
      event.currentTarget.reset();
      await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '2FAを無効化できませんでした。', code: error instanceof ApiError ? error.code : 'TWO_FACTOR_DISABLE_FAILED' });
    }
  };

  const regenerateBackupCodes = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFeedback({ type: 'working' });
    try {
      const payload = betterAuthResult(await authClient.twoFactor.generateBackupCodes({ password }), 'Backup Codeを再発行できませんでした。');
      const source = asRecord(payload);
      const codes = asArray(source.backupCodes ?? source.backup_codes).map(String);
      if (codes.length === 0) throw new ApiError('Backup Codeを受信できませんでした。', 502, 'BACKUP_CODES_MISSING', payload);
      setBackupCodes(codes);
      setFeedback({ type: 'success', message: '古いBackup Codeを無効化し、新しいCodeを発行しました。' });
      event.currentTarget.reset();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Backup Codeを再発行できませんでした。', code: error instanceof ApiError ? error.code : 'BACKUP_CODES_GENERATE_FAILED' });
    }
  };

  const copySecret = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ type: 'success', message: success });
    } catch {
      setFeedback({ type: 'error', message: 'Clipboardへコピーできませんでした。', code: 'CLIPBOARD_WRITE_FAILED' });
    }
  };

  if (loading) return <BusyState label="Security状態を確認しています…" />;
  if (loadError) return <ErrorState error={loadError} onRetry={() => void reload()} />;

  return (
    <ResponsivePageShell route={route} description="Password、Passkey、2段階認証、Backup Code、Google/GitHub Login連携、ログイン中の端末を1つのSecurity専用Pageで管理します。">
      {feedback.type !== 'idle' && (
        <div className={`security-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
          <strong>{feedback.type === 'working' ? '処理しています…' : feedback.message}</strong>
          {feedback.code && <code>{feedback.code}</code>}
        </div>
      )}

      <section className="security-panel">
        <div className="security-panel-head"><div><h2>Passkey</h2><p>端末の生体認証、PIN、Security Keyを利用できます。</p></div><span>{passkeys.length}件</span></div>
        <form className="security-inline-form" onSubmit={addPasskey}>
          <label><span>表示名（任意）</span><input name="name" maxLength={80} placeholder="例: Pixel Passkey" /></label>
          <button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>この端末へ追加</button>
        </form>
        {passkeys.length === 0 ? <p className="security-empty">登録済みPasskeyはありません。</p> : <ul className="security-list">{passkeys.map((passkey) => <li key={passkey.id}><div><strong>{passkey.name}</strong><span>{passkey.deviceType} / {passkey.backedUp ? '同期済み' : '端末保存'}</span><small>{passkey.createdAt || passkey.id}</small></div><button className="platform-button" type="button" onClick={() => void deletePasskey(passkey.id)} disabled={feedback.type === 'working' || previewMode}>削除</button></li>)}</ul>}
      </section>

      <section className="security-panel">
        <div className="security-panel-head"><div><h2>2段階認証</h2><p>AuthenticatorのTOTPと一度だけ使えるBackup Codeを使用します。</p></div><span className={security.twoFactorEnabled ? 'is-enabled' : ''}>{security.twoFactorEnabled ? '有効' : '無効'}</span></div>
        {!security.twoFactorEnabled && !enrollment && <form className="security-inline-form" onSubmit={enableTwoFactor}><label><span>現在のPassword</span><input name="password" type="password" autoComplete="current-password" required disabled={previewMode} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>2FA設定を開始</button></form>}
        {enrollment && <div className="security-enrollment"><h3>Authenticator登録</h3><p>次の`otpauth://` URIをAuthenticatorへ登録し、6桁Codeを入力してください。</p><code>{enrollment.totpURI}</code><button type="button" className="platform-button" onClick={() => void copySecret(enrollment.totpURI, 'TOTP URIをコピーしました。')}>URIをコピー</button><form className="security-inline-form" onSubmit={verifyTwoFactor}><label><span>6桁Code</span><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required disabled={previewMode} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>確認して有効化</button></form></div>}
        {security.twoFactorEnabled && <div className="security-two-factor-actions"><form className="security-inline-form" onSubmit={regenerateBackupCodes}><label><span>Backup Code再発行用Password</span><input name="password" type="password" autoComplete="current-password" required disabled={previewMode} /></label><button className="platform-button" type="submit" disabled={feedback.type === 'working' || previewMode}>Backup Codeを再発行</button></form><form className="security-inline-form is-danger" onSubmit={disableTwoFactor}><label><span>2FA無効化用Password</span><input name="password" type="password" autoComplete="current-password" required disabled={previewMode} /></label><button className="platform-button" type="submit" disabled={feedback.type === 'working' || previewMode}>2FAを無効化</button></form></div>}
      </section>

      {backupCodes.length > 0 && <section className="security-panel security-backup-codes"><div className="security-panel-head"><div><h2>Backup Code</h2><p>この表示を閉じると再表示しません。安全な場所へ保存してください。</p></div><button type="button" className="platform-button" onClick={() => void copySecret(backupCodes.join('\n'), 'Backup Codeをコピーしました。')}>全てコピー</button></div><ol>{backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol><button type="button" className="platform-button" onClick={() => setBackupCodes([])}>保存したので閉じる</button></section>}

      <AccountSecurityManagementSurface disabled={previewMode} />
    </ResponsivePageShell>
  );
}