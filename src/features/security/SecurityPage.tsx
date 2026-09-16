import { getAuthenticatorName } from '@better-auth/passkey';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { useAppText } from '../../app-text';
import { ApiError, apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import { previewWithoutAuth } from '../../platform/account-session';
import { authClient, authErrorMessage } from '../../platform/auth-client';
import { BusyState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import type { RouteMatch } from '../../platform/route-registry';
import { securityUiText, type SecurityUiCopy } from './security-ui-text';
import './security-page.css';
import './security-methods.css';
import './security-two-factor-toggle.css';

type PasskeyRecord = {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string;
  createdAt: string;
  aaguid: string;
};
type SessionRecord = { id: string; current: boolean; userAgent: string; updatedAt: string };
type AccountSecurity = {
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  sessionCount: number;
  sessions: SessionRecord[];
};
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
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function deviceAndBrowser(userAgent: string, copy: SecurityUiCopy): string {
  const os = /Android/i.test(userAgent) ? 'Android'
    : /iPhone|iPad/i.test(userAgent) ? 'iPhone / iPad'
      : /Windows/i.test(userAgent) ? 'Windows'
        : /Macintosh|Mac OS/i.test(userAgent) ? 'Mac'
          : copy.device;
  const browser = /Edg\//i.test(userAgent) ? 'Edge'
    : /Chrome\//i.test(userAgent) ? 'Chrome'
      : /Firefox\//i.test(userAgent) ? 'Firefox'
        : /Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent) ? 'Safari'
          : '';
  return browser ? `${os} · ${browser}` : os;
}

function sessionLabel(userAgent: string, current: boolean, copy: SecurityUiCopy): string {
  const device = deviceAndBrowser(userAgent, copy);
  return current ? `${copy.thisDevice} · ${device}` : device;
}

function defaultPasskeyName(copy: SecurityUiCopy): string {
  if (typeof navigator === 'undefined') return copy.thisDevice;
  return deviceAndBrowser(navigator.userAgent, copy);
}

function passkeyStorageLabel(deviceType: string, copy: SecurityUiCopy): string {
  if (deviceType === 'multiDevice') return copy.syncCapablePasskey;
  if (deviceType === 'singleDevice') return copy.singleAuthenticator;
  return copy.passkeyStorageFallback;
}

function passkeyTransportLabel(value: string, copy: SecurityUiCopy): string {
  const raw = value.trim();
  if (!raw) return copy.deviceAuthenticator;
  let values: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    values = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    values = raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return values.map((item) => {
    if (item === 'internal') return copy.builtInAuthenticator;
    if (item === 'hybrid') return copy.crossDevice;
    if (item === 'usb') return 'USB';
    if (item === 'nfc') return 'NFC';
    if (item === 'ble') return 'Bluetooth';
    return item;
  }).join(' · ') || copy.deviceAuthenticator;
}

function passkeyDisplayName(passkey: PasskeyRecord, copy: SecurityUiCopy): string {
  const explicitName = passkey.name.trim();
  if (explicitName && explicitName.toLowerCase() !== 'passkey') return explicitName;
  const authenticator = passkey.aaguid ? getAuthenticatorName(passkey.aaguid) : null;
  if (authenticator) return authenticator;
  return passkey.deviceType === 'multiDevice' ? copy.syncPasskey : copy.devicePasskey;
}

function totpSecret(uri: string): string {
  try { return new URL(uri).searchParams.get('secret')?.trim() ?? ''; }
  catch { return ''; }
}

export default function SecurityPage({ route }: { route: RouteMatch }) {
  const { language, text } = useAppText();
  const local = securityUiText(language);
  const previewMode = previewWithoutAuth();
  const [loading, setLoading] = useState(!previewMode);
  const [loadError, setLoadError] = useState(false);
  const [security, setSecurity] = useState<AccountSecurity>({
    email: '', emailVerified: false, twoFactorEnabled: false, sessionCount: 0, sessions: [],
  });
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [twoFactorSetupOpen, setTwoFactorSetupOpen] = useState(false);
  const [twoFactorDisableOpen, setTwoFactorDisableOpen] = useState(false);
  const [twoFactorPanelEnabled, setTwoFactorPanelEnabled] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');

  const reload = async () => {
    if (previewWithoutAuth()) {
      setSecurity({ email: '', emailVerified: false, twoFactorEnabled: false, sessionCount: 0, sessions: [] });
      setTwoFactorPanelEnabled(false);
      setPasskeys([]); setLoadError(false); setLoading(false); return;
    }
    setLoading(true); setLoadError(false);
    try {
      const securityPayload = await apiRequest('/api/account/security');
      const source = asRecord(asRecord(securityPayload).security ?? securityPayload);
      const sessions = asArray(source.sessions).map((item) => {
        const session = asRecord(item);
        return { id: recordText(session, ['id']), current: session.current === true, userAgent: recordText(session, ['user_agent', 'userAgent']), updatedAt: recordText(session, ['updated_at', 'updatedAt']) } satisfies SessionRecord;
      }).filter((item) => item.id);
      const passkeyItems = asArray(source.passkeys).map((item) => {
        const passkey = asRecord(item);
        return {
          id: recordText(passkey, ['id']), name: recordText(passkey, ['name']), deviceType: recordText(passkey, ['device_type', 'deviceType']),
          backedUp: passkey.backed_up === true || passkey.backedUp === true, transports: recordText(passkey, ['transports']),
          createdAt: recordText(passkey, ['created_at', 'createdAt']), aaguid: recordText(passkey, ['aaguid']),
        } satisfies PasskeyRecord;
      }).filter((item) => item.id);
      const twoFactorEnabled = source.two_factor_enabled === true || source.twoFactorEnabled === true;
      setSecurity({
        email: recordText(source, ['email']), emailVerified: source.email_verified === true || source.emailVerified === true,
        twoFactorEnabled,
        sessionCount: Number(source.session_count ?? source.sessionCount ?? sessions.length) || sessions.length, sessions,
      });
      setTwoFactorPanelEnabled(twoFactorEnabled);
      setTwoFactorDisableOpen(false);
      setPasskeys(passkeyItems);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    let active = true;
    if (!enrollment?.totpURI) { setQrDataUrl(''); return () => { active = false; }; }
    void QRCode.toDataURL(enrollment.totpURI, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setQrDataUrl(url); }).catch(() => { if (active) setQrDataUrl(''); });
    return () => { active = false; };
  }, [enrollment]);

  const addPasskey = async () => {
    if (previewMode) return; setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.passkey.addPasskey({ name: defaultPasskeyName(local) }), text('securityPasskeyAddFailed'));
      setFeedback({ type: 'success', message: text('securityPasskeyAdded') }); await reload();
    } catch (error) { setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityPasskeyAddFailed') }); }
  };

  const deletePasskey = async (id: string) => {
    if (previewMode) return; setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.passkey.deletePasskey({ id }), text('securityPasskeyDeleteFailed'));
      setFeedback({ type: 'success', message: text('securityPasskeyDeleted') }); await reload();
    } catch (error) { setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityPasskeyDeleteFailed') }); }
  };

  const enableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (previewMode) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFeedback({ type: 'working' }); setBackupCodes([]);
    try {
      const payload = betterAuthResult(await authClient.twoFactor.enable({ password, issuer: 'Astera' }), text('securityTwoFactorStartFailed'));
      const source = asRecord(payload);
      const totpURI = recordText(source, ['totpURI', 'totpUri', 'totp_uri']);
      const codes = asArray(source.backupCodes ?? source.backup_codes).map(String);
      if (!totpURI || codes.length === 0) throw new ApiError(text('securityEnrollmentIncomplete'), 502, 'TWO_FACTOR_ENROLLMENT_INCOMPLETE', payload);
      setEnrollment({ totpURI, backupCodes: codes }); setTwoFactorSetupOpen(false); setFeedback({ type: 'idle' }); event.currentTarget.reset();
    } catch (error) { setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTwoFactorStartFailed') }); }
  };

  const verifyTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (previewMode) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s/g, '');
    setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.twoFactor.verifyTotp({ code, trustDevice: true }), text('securityTotpVerifyFailed'));
      setBackupCodes(enrollment?.backupCodes ?? []); setEnrollment(null); setFeedback({ type: 'success', message: text('securityTwoFactorEnabled') });
      event.currentTarget.reset(); await reload();
    } catch (error) { setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTotpVerifyFailed') }); }
  };

  const disableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (previewMode) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? ''); setFeedback({ type: 'working' });
    try {
      betterAuthResult(await authClient.twoFactor.disable({ password }), text('securityTwoFactorDisableFailed'));
      setEnrollment(null); setBackupCodes([]); setTwoFactorPanelEnabled(false); setTwoFactorDisableOpen(false);
      setFeedback({ type: 'success', message: text('securityTwoFactorDisabled') }); event.currentTarget.reset(); await reload();
    } catch (error) { setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTwoFactorDisableFailed') }); }
  };

  const regenerateBackupCodes = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (previewMode) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? ''); setFeedback({ type: 'working' });
    try {
      const payload = betterAuthResult(await authClient.twoFactor.generateBackupCodes({ password }), text('securityBackupGenerateFailed'));
      const source = asRecord(payload); const codes = asArray(source.backupCodes ?? source.backup_codes).map(String);
      if (codes.length === 0) throw new ApiError(text('securityBackupMissing'), 502, 'BACKUP_CODES_MISSING', payload);
      setBackupCodes(codes); setFeedback({ type: 'success', message: text('securityBackupRegenerated') }); event.currentTarget.reset();
    } catch (error) { setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityBackupGenerateFailed') }); }
  };

  const copyValue = async (value: string, success: string) => {
    try { await navigator.clipboard.writeText(value); setFeedback({ type: 'success', message: success }); }
    catch { setFeedback({ type: 'error', message: text('securityClipboardFailed') }); }
  };

  const revokeSession = async (sessionId: string) => {
    if (previewMode) return; setFeedback({ type: 'working' });
    try { await apiRequest(`/api/account/security/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }); setFeedback({ type: 'success', message: local.deviceSignedOut }); await reload(); }
    catch (error) { setFeedback({ type: 'error', message: error instanceof Error ? error.message : local.deviceSignOutFailed }); }
  };

  const changeTwoFactorToggle = (checked: boolean) => {
    if (checked) {
      setTwoFactorPanelEnabled(true);
      setTwoFactorDisableOpen(false);
      if (!security.twoFactorEnabled) setTwoFactorSetupOpen(true);
      return;
    }
    setTwoFactorPanelEnabled(false);
    setTwoFactorSetupOpen(false);
    setEnrollment(null);
    setBackupCodes([]);
    if (security.twoFactorEnabled) setTwoFactorDisableOpen(true);
  };

  const cancelDisableTwoFactor = () => {
    setTwoFactorDisableOpen(false);
    setTwoFactorPanelEnabled(true);
  };

  const manualSecret = useMemo(() => enrollment ? totpSecret(enrollment.totpURI) : '', [enrollment]);
  if (loading) return <BusyState label={text('securityLoading')} />;

  return (
    <ResponsivePageShell route={route} eyebrow="">
      <div className="security-page">
        {loadError && <div className="security-load-error" role="alert"><span>{local.loadFailed}</span><button className="platform-button" type="button" onClick={() => void reload()}>{local.retry}</button></div>}
        {feedback.type !== 'idle' && <div className={`security-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}><strong>{feedback.type === 'working' ? text('securityWorking') : feedback.message}</strong></div>}

        <section className="security-card">
          <div className="security-card-head"><div><h2>{text('securityPasskey')}</h2><p>{local.passkeyDescription}</p></div><span className="security-status">{passkeys.length}{text('securityCountSuffix')}</span></div>
          <div className="security-card-action"><button className="platform-button is-primary" type="button" onClick={() => void addPasskey()} disabled={feedback.type === 'working' || previewMode}>{local.addPasskey}</button></div>
          {passkeys.length === 0 ? <p className="security-empty">{text('securityNoPasskeys')}</p> : (
            <ul className="security-list security-passkey-list">{passkeys.map((passkey) => (
              <li key={passkey.id}><div className="security-passkey-main"><strong>{passkeyDisplayName(passkey, local)}</strong><div className="security-passkey-meta">
                <span><b>{local.passkeyStorage}</b>{passkeyStorageLabel(passkey.deviceType, local)}</span><span><b>{local.passkeyBackup}</b>{passkey.backedUp ? local.passkeyBackedUp : local.passkeyNotBackedUp}</span>
                <span><b>{local.passkeyAuthMethod}</b>{passkeyTransportLabel(passkey.transports, local)}</span>{passkey.createdAt && <span><b>{local.passkeyCreated}</b>{formatDate(passkey.createdAt, language)}</span>}
              </div></div><button className="platform-button" type="button" onClick={() => void deletePasskey(passkey.id)} disabled={feedback.type === 'working' || previewMode}>{text('securityDelete')}</button></li>
            ))}</ul>
          )}
        </section>

        <section className="security-card">
          <div className="security-card-head">
            <div><h2>{text('securityTwoFactor')}</h2></div>
            <label className="security-two-factor-switch">
              <input type="checkbox" checked={twoFactorPanelEnabled} onChange={(event) => changeTwoFactorToggle(event.currentTarget.checked)} disabled={feedback.type === 'working' || previewMode} aria-label={local.twoFactorToggle} />
              <span className="security-two-factor-switch-track" aria-hidden="true" />
              <span className="security-two-factor-switch-state">{twoFactorPanelEnabled ? 'ON' : 'OFF'}</span>
            </label>
          </div>

          {twoFactorPanelEnabled && <>
            <div className="security-method-list">
              <div className="security-method-row">
                <div><strong>{local.emailMethod}</strong><span>{security.email || local.emailNeedsSetup}</span><small>{local.emailMethodDescription}</small></div>
                <div className="security-method-action">
                  <span className={`security-method-state${security.emailVerified && security.email ? ' is-ready' : ''}`}>{security.emailVerified && security.email ? local.emailReady : local.emailNeedsSetup}</span>
                  {(!security.email || !security.emailVerified) && <a className="platform-button" href="/account">{local.manageEmail}</a>}
                </div>
              </div>
              <div className="security-method-row">
                <div><strong>{local.authenticatorMethod}</strong><span>{security.twoFactorEnabled ? local.authenticatorReady : local.authenticatorNotReady}</span><small>{local.authenticatorDescription}</small></div>
                <div className="security-method-action">
                  <span className={`security-method-state${security.twoFactorEnabled ? ' is-ready' : ''}`}>{security.twoFactorEnabled ? local.authenticatorReady : local.authenticatorNotReady}</span>
                </div>
              </div>
            </div>

            {!security.twoFactorEnabled && !enrollment && twoFactorSetupOpen && (
              <div className="security-step">
                <div><h3>{local.confirmIdentity}</h3></div>
                <form className="security-form" onSubmit={enableTwoFactor}>
                  <label><span>{text('securityCurrentPassword')}</span><input name="password" type="password" autoComplete="current-password" required minLength={6} maxLength={128} disabled={previewMode} /></label>
                  <div className="security-form-actions"><button className="platform-button" type="button" onClick={() => { setTwoFactorPanelEnabled(false); setTwoFactorSetupOpen(false); }}>{local.cancel}</button><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityStartTwoFactor')}</button></div>
                </form>
              </div>
            )}

            {enrollment && <div className="security-enrollment"><div className="security-enrollment-qr"><h3>{local.scanTitle}</h3><p>{local.scanDescription}</p><div className="security-qr-frame">{qrDataUrl ? <img src={qrDataUrl} alt={local.scanTitle} /> : <span>{local.qrLoading}</span>}</div>
              {manualSecret && <details className="security-manual-setup"><summary>{local.manualSetup}</summary><div><span>{local.setupKey}</span><code>{manualSecret}</code><button className="platform-button" type="button" onClick={() => void copyValue(manualSecret, local.keyCopied)}>{local.copyKey}</button></div></details>}
            </div><div className="security-enrollment-code"><h3>{local.codeTitle}</h3><form className="security-form" onSubmit={verifyTwoFactor}><label><span>{text('securitySixDigitCode')}</span><input className="security-code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} required disabled={previewMode} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityVerifyEnable')}</button></form></div></div>}

            {security.twoFactorEnabled && <details className="security-management-details"><summary>{local.manageTwoFactor}</summary><div className="security-two-factor-actions">
              <form className="security-form" onSubmit={regenerateBackupCodes}><label><span>{text('securityBackupPassword')}</span><input name="password" type="password" autoComplete="current-password" required minLength={6} maxLength={128} disabled={previewMode} /></label><button className="platform-button" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityRegenerateBackup')}</button></form>
            </div></details>}
          </>}

          {twoFactorDisableOpen && <div className="security-step security-two-factor-off-confirm">
            <div><h3>{local.turnOffTwoFactor}</h3></div>
            <form className="security-form is-danger" onSubmit={disableTwoFactor}>
              <label><span>{text('securityCurrentPassword')}</span><input name="password" type="password" autoComplete="current-password" required minLength={6} maxLength={128} disabled={previewMode} /></label>
              <div className="security-form-actions"><button className="platform-button" type="button" onClick={cancelDisableTwoFactor}>{local.cancel}</button><button className="platform-button" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityDisableTwoFactor')}</button></div>
            </form>
          </div>}
        </section>

        {backupCodes.length > 0 && <section className="security-card security-backup-codes"><div className="security-card-head"><div><h2>{text('securityBackupCodes')}</h2><p>{text('securityBackupCodesDescription')}</p></div><button type="button" className="platform-button" onClick={() => void copyValue(backupCodes.join('\n'), text('securityBackupCopied'))}>{text('securityCopyAll')}</button></div><ol>{backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol><button type="button" className="platform-button" onClick={() => setBackupCodes([])}>{text('securityCloseAfterSave')}</button></section>}

        <section className="security-card">
          <div className="security-card-head"><div><h2>{local.signedInDevices}</h2><p>{local.signedInDevicesDescription}</p></div><span className="security-status">{security.sessionCount}{text('securityCountSuffix')}</span></div>
          {security.sessions.length > 0 ? <ul className="security-session-list">{security.sessions.map((session) => <li key={session.id}><div className="security-session-main"><strong>{sessionLabel(session.userAgent, session.current, local)}</strong>{session.updatedAt && <span>{local.lastUsed} {formatDate(session.updatedAt, language)}</span>}</div>{!session.current && <button className="platform-button security-session-revoke" type="button" onClick={() => void revokeSession(session.id)} disabled={feedback.type === 'working' || previewMode}>{local.signOutDevice}</button>}</li>)}</ul> : !loadError ? <p className="security-empty">{local.devicesUnavailable}</p> : null}
        </section>
      </div>
    </ResponsivePageShell>
  );
}
