import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { useAppText } from '../../app-text';
import { ApiError, apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import { previewWithoutAuth } from '../../platform/account-session';
import { authClient, authErrorMessage } from '../../platform/auth-client';
import { BusyState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import type { RouteMatch } from '../../platform/route-registry';
import './security-page.css';

type PasskeyRecord = { id: string; name: string; deviceType: string; backedUp: boolean; createdAt: string };
type SessionRecord = { id: string; current: boolean; userAgent: string; updatedAt: string };
type AccountSecurity = { passwordConfigured: boolean; twoFactorEnabled: boolean; sessionCount: number; sessions: SessionRecord[] };
type Enrollment = { totpURI: string; backupCodes: string[] };
type Feedback = { type: 'idle' | 'working' | 'success' | 'error'; message?: string };

function betterAuthResult<T>(value: { data?: T | null; error?: unknown }, fallback: string): T {
  if (value.error) throw new ApiError(authErrorMessage(value.error, fallback), 400, recordText(asRecord(value.error), ['code'], 'AUTH_OPERATION_FAILED'), value.error);
  if (value.data == null) throw new ApiError(fallback, 502, 'AUTH_RESPONSE_EMPTY');
  return value.data;
}

function formatDate(value: string, language: 'ja' | 'en'): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function sessionLabel(userAgent: string, current: boolean, language: 'ja' | 'en'): string {
  if (current) return language === 'en' ? 'This device' : 'この端末';
  const os = /Android/i.test(userAgent) ? 'Android'
    : /iPhone|iPad/i.test(userAgent) ? 'iPhone / iPad'
      : /Windows/i.test(userAgent) ? 'Windows'
        : /Macintosh|Mac OS/i.test(userAgent) ? 'Mac'
          : language === 'en' ? 'Signed-in device' : 'ログイン端末';
  const browser = /Edg\//i.test(userAgent) ? 'Edge'
    : /Chrome\//i.test(userAgent) ? 'Chrome'
      : /Firefox\//i.test(userAgent) ? 'Firefox'
        : /Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent) ? 'Safari'
          : '';
  return browser ? `${os} · ${browser}` : os;
}

function totpSecret(uri: string): string {
  try { return new URL(uri).searchParams.get('secret')?.trim() ?? ''; }
  catch { return ''; }
}

export default function SecurityPage({ route }: { route: RouteMatch }) {
  const { language, text } = useAppText();
  const previewMode = previewWithoutAuth();
  const [loading, setLoading] = useState(!previewMode);
  const [loadError, setLoadError] = useState(false);
  const [security, setSecurity] = useState<AccountSecurity>({ passwordConfigured: false, twoFactorEnabled: false, sessionCount: 0, sessions: [] });
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [twoFactorSetupOpen, setTwoFactorSetupOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');

  const local = language === 'en'
    ? {
      loadFailed: 'Security information could not be loaded.',
      retry: 'Retry',
      passkeyDescription: 'Sign in with your device unlock method such as fingerprint, face, or PIN.',
      addPasskey: 'Add passkey',
      twoFactorDescription: 'Use a verification code from an authenticator app after signing in with a password.',
      setupTwoFactor: 'Set up',
      providerManaged: 'This login method does not use an Astera password. Two-step verification for Google or GitHub sign-in is managed by that provider.',
      confirmIdentity: 'Confirm your identity',
      confirmIdentityDescription: 'Enter your current Astera password to continue.',
      cancel: 'Cancel',
      scanTitle: 'Scan the QR code',
      scanDescription: 'Open your authenticator app and scan this QR code.',
      qrLoading: 'Creating QR code…',
      manualSetup: 'Can’t scan the QR code?',
      setupKey: 'Setup key',
      copyKey: 'Copy key',
      keyCopied: 'Setup key copied.',
      codeTitle: 'Enter the 6-digit code',
      manageTwoFactor: 'Manage two-factor authentication',
      signedInDevices: 'Signed-in devices',
      signedInDevicesDescription: 'Devices with an active Astera session.',
      lastUsed: 'Last used',
      passkeyCreated: 'Created',
    }
    : {
      loadFailed: 'セキュリティ情報を取得できませんでした。',
      retry: '再試行',
      passkeyDescription: '指紋・顔認証・端末のPINなど、端末のロック解除方法でログインできます。',
      addPasskey: 'Passkeyを追加',
      twoFactorDescription: 'パスワードでログインした後、認証アプリの確認コードを使用します。',
      setupTwoFactor: '設定する',
      providerManaged: 'このログイン方法ではAstera用パスワードを使用しません。Google / GitHubログインの2段階認証は各サービス側で管理します。',
      confirmIdentity: '本人確認',
      confirmIdentityDescription: '続行するには現在のAstera用パスワードを入力してください。',
      cancel: 'キャンセル',
      scanTitle: 'QRコードを読み取る',
      scanDescription: '認証アプリを開き、このQRコードを読み取ってください。',
      qrLoading: 'QRコードを作成しています…',
      manualSetup: 'QRコードを読み取れない場合',
      setupKey: 'セットアップキー',
      copyKey: 'キーをコピー',
      keyCopied: 'セットアップキーをコピーしました。',
      codeTitle: '6桁のコードを入力',
      manageTwoFactor: '2段階認証を管理',
      signedInDevices: 'ログイン中の端末',
      signedInDevicesDescription: '現在Asteraへログインしている端末です。',
      lastUsed: '最終利用',
      passkeyCreated: '作成',
    };

  const normalizePasskeys = useCallback((payload: unknown): PasskeyRecord[] => asArray(payload, ['passkeys', 'items']).map((item) => {
    const source = asRecord(item);
    return {
      id: recordText(source, ['id']),
      name: recordText(source, ['name'], text('securityPasskeyDefaultName')),
      deviceType: recordText(source, ['deviceType', 'device_type'], text('securityUnknownDevice')),
      backedUp: source.backedUp === true || source.backed_up === true,
      createdAt: recordText(source, ['createdAt', 'created_at']),
    };
  }).filter((item) => item.id), [text]);

  const reload = useCallback(async () => {
    if (previewWithoutAuth()) {
      setSecurity({ passwordConfigured: false, twoFactorEnabled: false, sessionCount: 0, sessions: [] });
      setPasskeys([]);
      setLoadError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const [securityPayload, passkeyPayload] = await Promise.all([
        apiRequest('/api/account/security'),
        authClient.passkey.listUserPasskeys(),
      ]);
      const source = asRecord(asRecord(securityPayload).security ?? securityPayload);
      const sessions = asArray(source.sessions).map((item) => {
        const session = asRecord(item);
        return {
          id: recordText(session, ['id']),
          current: session.current === true,
          userAgent: recordText(session, ['user_agent', 'userAgent']),
          updatedAt: recordText(session, ['updated_at', 'updatedAt']),
        } satisfies SessionRecord;
      }).filter((item) => item.id);
      setSecurity({
        passwordConfigured: source.password_configured === true || source.passwordConfigured === true,
        twoFactorEnabled: source.two_factor_enabled === true || source.twoFactorEnabled === true,
        sessionCount: Number(source.session_count ?? source.sessionCount ?? sessions.length) || sessions.length,
        sessions,
      });
      setPasskeys(normalizePasskeys(betterAuthResult(passkeyPayload, text('securityPasskeyListFailed'))));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [normalizePasskeys, text]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    let active = true;
    if (!enrollment?.totpURI) {
      setQrDataUrl('');
      return () => { active = false; };
    }
    void QRCode.toDataURL(enrollment.totpURI, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setQrDataUrl(url); })
      .catch(() => { if (active) setQrDataUrl(''); });
    return () => { active = false; };
  }, [enrollment]);

  const addPasskey = async () => {
    if (previewMode) return;
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.passkey.addPasskey({}), text('securityPasskeyAddFailed'));
      setFeedback({ type: 'success', message: text('securityPasskeyAdded') });
      await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityPasskeyAddFailed') });
    }
  };

  const deletePasskey = async (id: string) => {
    if (previewMode) return;
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.passkey.deletePasskey({ id }), text('securityPasskeyDeleteFailed'));
      setFeedback({ type: 'success', message: text('securityPasskeyDeleted') });
      await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityPasskeyDeleteFailed') });
    }
  };

  const enableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFeedback({ type: 'working' });
    setBackupCodes([]);
    try {
      const payload = betterAuthResult(await authClient.twoFactor.enable({ password, issuer: 'Astera' }), text('securityTwoFactorStartFailed'));
      const source = asRecord(payload);
      const totpURI = recordText(source, ['totpURI', 'totpUri', 'totp_uri']);
      const codes = asArray(source.backupCodes ?? source.backup_codes).map(String);
      if (!totpURI || codes.length === 0) throw new ApiError(text('securityEnrollmentIncomplete'), 502, 'TWO_FACTOR_ENROLLMENT_INCOMPLETE', payload);
      setEnrollment({ totpURI, backupCodes: codes });
      setTwoFactorSetupOpen(false);
      setFeedback({ type: 'idle' });
      event.currentTarget.reset();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTwoFactorStartFailed') });
    }
  };

  const verifyTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s/g, '');
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.twoFactor.verifyTotp({ code, trustDevice: true }), text('securityTotpVerifyFailed'));
      setBackupCodes(enrollment?.backupCodes ?? []);
      setEnrollment(null);
      setFeedback({ type: 'success', message: text('securityTwoFactorEnabled') });
      event.currentTarget.reset();
      await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTotpVerifyFailed') });
    }
  };

  const disableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.twoFactor.disable({ password }), text('securityTwoFactorDisableFailed'));
      setEnrollment(null);
      setBackupCodes([]);
      setFeedback({ type: 'success', message: text('securityTwoFactorDisabled') });
      event.currentTarget.reset();
      await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTwoFactorDisableFailed') });
    }
  };

  const regenerateBackupCodes = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFeedback({ type: 'working' });
    try {
      const payload = betterAuthResult(await authClient.twoFactor.generateBackupCodes({ password }), text('securityBackupGenerateFailed'));
      const source = asRecord(payload);
      const codes = asArray(source.backupCodes ?? source.backup_codes).map(String);
      if (codes.length === 0) throw new ApiError(text('securityBackupMissing'), 502, 'BACKUP_CODES_MISSING', payload);
      setBackupCodes(codes);
      setFeedback({ type: 'success', message: text('securityBackupRegenerated') });
      event.currentTarget.reset();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityBackupGenerateFailed') });
    }
  };

  const copyValue = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ type: 'success', message: success });
    } catch {
      setFeedback({ type: 'error', message: text('securityClipboardFailed') });
    }
  };

  const manualSecret = useMemo(() => enrollment ? totpSecret(enrollment.totpURI) : '', [enrollment]);

  if (loading) return <BusyState label={text('securityLoading')} />;

  return (
    <ResponsivePageShell route={route} description={text('securityDescription')}>
      <div className="security-page">
        {loadError && (
          <div className="security-load-error" role="alert">
            <span>{local.loadFailed}</span>
            <button className="platform-button" type="button" onClick={() => void reload()}>{local.retry}</button>
          </div>
        )}

        {feedback.type !== 'idle' && (
          <div className={`security-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
            <strong>{feedback.type === 'working' ? text('securityWorking') : feedback.message}</strong>
          </div>
        )}

        <section className="security-card">
          <div className="security-card-head">
            <div>
              <h2>{text('securityPasskey')}</h2>
              <p>{local.passkeyDescription}</p>
            </div>
            <span className="security-status">{passkeys.length}{text('securityCountSuffix')}</span>
          </div>
          <div className="security-card-action">
            <button className="platform-button is-primary" type="button" onClick={() => void addPasskey()} disabled={feedback.type === 'working' || previewMode}>{local.addPasskey}</button>
          </div>
          {passkeys.length === 0 ? <p className="security-empty">{text('securityNoPasskeys')}</p> : (
            <ul className="security-list">
              {passkeys.map((passkey) => (
                <li key={passkey.id}>
                  <div>
                    <strong>{passkey.name || text('securityPasskeyDefaultName')}</strong>
                    <span>{passkey.deviceType}{passkey.backedUp ? ` · ${text('securitySynced')}` : ''}</span>
                    {passkey.createdAt && <small>{local.passkeyCreated} {formatDate(passkey.createdAt, language)}</small>}
                  </div>
                  <button className="platform-button" type="button" onClick={() => void deletePasskey(passkey.id)} disabled={feedback.type === 'working' || previewMode}>{text('securityDelete')}</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="security-card">
          <div className="security-card-head">
            <div>
              <h2>{text('securityTwoFactor')}</h2>
              <p>{local.twoFactorDescription}</p>
            </div>
            <span className={`security-status${security.twoFactorEnabled ? ' is-enabled' : ''}`}>{security.twoFactorEnabled ? text('securityEnabled') : text('securityDisabled')}</span>
          </div>

          {!security.twoFactorEnabled && !enrollment && security.passwordConfigured && !twoFactorSetupOpen && (
            <div className="security-card-action">
              <button className="platform-button is-primary" type="button" onClick={() => setTwoFactorSetupOpen(true)} disabled={feedback.type === 'working' || previewMode}>{local.setupTwoFactor}</button>
            </div>
          )}

          {!security.twoFactorEnabled && !enrollment && !security.passwordConfigured && (
            <p className="security-note">{local.providerManaged}</p>
          )}

          {!security.twoFactorEnabled && !enrollment && security.passwordConfigured && twoFactorSetupOpen && (
            <div className="security-step">
              <div>
                <h3>{local.confirmIdentity}</h3>
                <p>{local.confirmIdentityDescription}</p>
              </div>
              <form className="security-form" onSubmit={enableTwoFactor}>
                <label>
                  <span>{text('securityCurrentPassword')}</span>
                  <input name="password" type="password" autoComplete="current-password" required disabled={previewMode} />
                </label>
                <div className="security-form-actions">
                  <button className="platform-button" type="button" onClick={() => setTwoFactorSetupOpen(false)}>{local.cancel}</button>
                  <button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityStartTwoFactor')}</button>
                </div>
              </form>
            </div>
          )}

          {enrollment && (
            <div className="security-enrollment">
              <div className="security-enrollment-qr">
                <h3>{local.scanTitle}</h3>
                <p>{local.scanDescription}</p>
                <div className="security-qr-frame">
                  {qrDataUrl ? <img src={qrDataUrl} alt={local.scanTitle} /> : <span>{local.qrLoading}</span>}
                </div>
                {manualSecret && (
                  <details className="security-manual-setup">
                    <summary>{local.manualSetup}</summary>
                    <div>
                      <span>{local.setupKey}</span>
                      <code>{manualSecret}</code>
                      <button className="platform-button" type="button" onClick={() => void copyValue(manualSecret, local.keyCopied)}>{local.copyKey}</button>
                    </div>
                  </details>
                )}
              </div>
              <div className="security-enrollment-code">
                <h3>{local.codeTitle}</h3>
                <form className="security-form" onSubmit={verifyTwoFactor}>
                  <label>
                    <span>{text('securitySixDigitCode')}</span>
                    <input className="security-code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} required disabled={previewMode} />
                  </label>
                  <button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityVerifyEnable')}</button>
                </form>
              </div>
            </div>
          )}

          {security.twoFactorEnabled && security.passwordConfigured && (
            <details className="security-management-details">
              <summary>{local.manageTwoFactor}</summary>
              <div className="security-two-factor-actions">
                <form className="security-form" onSubmit={regenerateBackupCodes}>
                  <label>
                    <span>{text('securityBackupPassword')}</span>
                    <input name="password" type="password" autoComplete="current-password" required disabled={previewMode} />
                  </label>
                  <button className="platform-button" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityRegenerateBackup')}</button>
                </form>
                <form className="security-form is-danger" onSubmit={disableTwoFactor}>
                  <label>
                    <span>{text('securityDisablePassword')}</span>
                    <input name="password" type="password" autoComplete="current-password" required disabled={previewMode} />
                  </label>
                  <button className="platform-button" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityDisableTwoFactor')}</button>
                </form>
              </div>
            </details>
          )}
        </section>

        {backupCodes.length > 0 && (
          <section className="security-card security-backup-codes">
            <div className="security-card-head">
              <div>
                <h2>{text('securityBackupCodes')}</h2>
                <p>{text('securityBackupCodesDescription')}</p>
              </div>
              <button type="button" className="platform-button" onClick={() => void copyValue(backupCodes.join('\n'), text('securityBackupCopied'))}>{text('securityCopyAll')}</button>
            </div>
            <ol>{backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
            <button type="button" className="platform-button" onClick={() => setBackupCodes([])}>{text('securityCloseAfterSave')}</button>
          </section>
        )}

        <section className="security-card">
          <div className="security-card-head">
            <div>
              <h2>{local.signedInDevices}</h2>
              <p>{local.signedInDevicesDescription}</p>
            </div>
            <span className="security-status">{security.sessionCount}{text('securityCountSuffix')}</span>
          </div>
          {security.sessions.length > 0 && (
            <ul className="security-session-list">
              {security.sessions.map((session) => (
                <li key={session.id}>
                  <strong>{sessionLabel(session.userAgent, session.current, language)}</strong>
                  {session.updatedAt && <span>{local.lastUsed} {formatDate(session.updatedAt, language)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ResponsivePageShell>
  );
}
