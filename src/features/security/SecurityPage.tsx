import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAppText } from '../../app-text';
import { ApiError, apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import { previewWithoutAuth } from '../../platform/account-session';
import { authClient, authErrorMessage } from '../../platform/auth-client';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import type { RouteMatch } from '../../platform/route-registry';
import './security-page.css';

type PasskeyRecord = { id: string; name: string; deviceType: string; backedUp: boolean; createdAt: string };
type AccountSecurity = { twoFactorEnabled: boolean; sessionId: string; sessionExpiresAt: string };
type Enrollment = { totpURI: string; backupCodes: string[] };
type Feedback = { type: 'idle' | 'working' | 'success' | 'error'; message?: string; code?: string };

function betterAuthResult<T>(value: { data?: T | null; error?: unknown }, fallback: string): T {
  if (value.error) throw new ApiError(authErrorMessage(value.error, fallback), 400, recordText(asRecord(value.error), ['code'], 'AUTH_OPERATION_FAILED'), value.error);
  if (value.data == null) throw new ApiError(fallback, 502, 'AUTH_RESPONSE_EMPTY');
  return value.data;
}

export default function SecurityPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  const previewMode = previewWithoutAuth();
  const [loading, setLoading] = useState(!previewMode);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [security, setSecurity] = useState<AccountSecurity>({ twoFactorEnabled: false, sessionId: '', sessionExpiresAt: '' });
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

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
      setSecurity({ twoFactorEnabled: false, sessionId: '', sessionExpiresAt: '' });
      setPasskeys([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [accountPayload, passkeyPayload] = await Promise.all([apiRequest('/api/account'), authClient.passkey.listUserPasskeys()]);
      const account = asRecord(asRecord(accountPayload).account ?? accountPayload);
      setSecurity({
        twoFactorEnabled: account.two_factor_enabled === true || account.twoFactorEnabled === true,
        sessionId: recordText(account, ['session_id', 'sessionId']),
        sessionExpiresAt: recordText(account, ['session_expires_at', 'sessionExpiresAt']),
      });
      setPasskeys(normalizePasskeys(betterAuthResult(passkeyPayload, text('securityPasskeyListFailed'))));
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [normalizePasskeys, text]);

  useEffect(() => { void reload(); }, [reload]);

  const addPasskey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.passkey.addPasskey({ name: name || undefined, authenticatorAttachment: 'platform' }), text('securityPasskeyAddFailed'));
      event.currentTarget.reset();
      setFeedback({ type: 'success', message: text('securityPasskeyAdded') });
      await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityPasskeyAddFailed'), code: error instanceof ApiError ? error.code : 'PASSKEY_ADD_FAILED' });
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
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityPasskeyDeleteFailed'), code: error instanceof ApiError ? error.code : 'PASSKEY_DELETE_FAILED' });
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
      setFeedback({ type: 'success', message: text('securityAuthenticatorReady') });
      event.currentTarget.reset();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTwoFactorStartFailed'), code: error instanceof ApiError ? error.code : 'TWO_FACTOR_ENABLE_FAILED' });
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
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTotpVerifyFailed'), code: error instanceof ApiError ? error.code : 'TWO_FACTOR_VERIFY_FAILED' });
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
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTwoFactorDisableFailed'), code: error instanceof ApiError ? error.code : 'TWO_FACTOR_DISABLE_FAILED' });
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
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityBackupGenerateFailed'), code: error instanceof ApiError ? error.code : 'BACKUP_CODES_GENERATE_FAILED' });
    }
  };

  const copySecret = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ type: 'success', message: success });
    } catch {
      setFeedback({ type: 'error', message: text('securityClipboardFailed'), code: 'CLIPBOARD_WRITE_FAILED' });
    }
  };

  if (loading) return <BusyState label={text('securityLoading')} />;
  if (loadError) return <ErrorState error={loadError} onRetry={() => void reload()} />;

  return (
    <ResponsivePageShell route={route} description={text('securityPageDescription')}>
      {feedback.type !== 'idle' && <div className={`security-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}><strong>{feedback.type === 'working' ? text('securityWorking') : feedback.message}</strong>{feedback.code && <code>{feedback.code}</code>}</div>}

      <section className="security-panel">
        <div className="security-panel-head"><div><h2>{text('securityPasskey')}</h2><p>{text('securityPasskeyDescription')}</p></div><span>{passkeys.length}{text('securityCountSuffix')}</span></div>
        <form className="security-inline-form" onSubmit={addPasskey}><label><span>{text('securityDisplayNameOptional')}</span><input name="name" maxLength={80} placeholder={text('securityDisplayNamePlaceholder')} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityAddThisDevice')}</button></form>
        {passkeys.length === 0 ? <p className="security-empty">{text('securityNoPasskeys')}</p> : <ul className="security-list">{passkeys.map((passkey) => <li key={passkey.id}><div><strong>{passkey.name}</strong><span>{passkey.deviceType} / {passkey.backedUp ? text('securitySynced') : text('securityDeviceStored')}</span><small>{passkey.createdAt || passkey.id}</small></div><button className="platform-button" type="button" onClick={() => void deletePasskey(passkey.id)} disabled={feedback.type === 'working' || previewMode}>{text('securityDelete')}</button></li>)}</ul>}
      </section>

      <section className="security-panel">
        <div className="security-panel-head"><div><h2>{text('securityTwoFactor')}</h2><p>{text('securityTwoFactorDescription')}</p></div><span className={security.twoFactorEnabled ? 'is-enabled' : ''}>{security.twoFactorEnabled ? text('securityEnabled') : text('securityDisabled')}</span></div>
        {!security.twoFactorEnabled && !enrollment && <form className="security-inline-form" onSubmit={enableTwoFactor}><label><span>{text('securityCurrentPassword')}</span><input name="password" type="password" autoComplete="current-password" required disabled={previewMode} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityStartTwoFactor')}</button></form>}
        {enrollment && <div className="security-enrollment"><h3>{text('securityAuthenticatorEnrollment')}</h3><p>{text('securityAuthenticatorInstruction')}</p><code>{enrollment.totpURI}</code><button type="button" className="platform-button" onClick={() => void copySecret(enrollment.totpURI, text('securityTotpCopied'))}>{text('securityCopyUri')}</button><form className="security-inline-form" onSubmit={verifyTwoFactor}><label><span>{text('securitySixDigitCode')}</span><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required disabled={previewMode} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityVerifyEnable')}</button></form></div>}
        {security.twoFactorEnabled && <div className="security-two-factor-actions"><form className="security-inline-form" onSubmit={regenerateBackupCodes}><label><span>{text('securityBackupPassword')}</span><input name="password" type="password" autoComplete="current-password" required disabled={previewMode} /></label><button className="platform-button" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityRegenerateBackup')}</button></form><form className="security-inline-form is-danger" onSubmit={disableTwoFactor}><label><span>{text('securityDisablePassword')}</span><input name="password" type="password" autoComplete="current-password" required disabled={previewMode} /></label><button className="platform-button" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityDisableTwoFactor')}</button></form></div>}
      </section>

      {backupCodes.length > 0 && <section className="security-panel security-backup-codes"><div className="security-panel-head"><div><h2>{text('securityBackupCodes')}</h2><p>{text('securityBackupCodesDescription')}</p></div><button type="button" className="platform-button" onClick={() => void copySecret(backupCodes.join('\n'), text('securityBackupCopied'))}>{text('securityCopyAll')}</button></div><ol>{backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol><button type="button" className="platform-button" onClick={() => setBackupCodes([])}>{text('securityCloseAfterSave')}</button></section>}

      <section className="security-panel"><div className="security-panel-head"><div><h2>{text('securityCurrentSession')}</h2><p>{text('securityCurrentSessionDescription')}</p></div></div><dl className="security-session"><div><dt>{text('securitySession')}</dt><dd>{security.sessionId ? `${security.sessionId.slice(0, 8)}…` : text('securityUnavailable')}</dd></div><div><dt>{text('securityExpiresAt')}</dt><dd>{security.sessionExpiresAt || text('securityUnavailable')}</dd></div></dl></section>
    </ResponsivePageShell>
  );
}
