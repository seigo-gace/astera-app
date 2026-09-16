import { useMemo, useState, type FormEvent } from 'react';
import { useAppText } from '../../app-text';
import { queryValue, textValue } from '../../platform/api-client';
import { safeReturnPath, type RouteMatch } from '../../platform/route-registry';
import { PublicPageFrame } from '../../platform/ResponsivePageShell';
import { AuthCard, Field, safeNavigate, submitForm, type SubmitState } from '../../platform/pages/page-kit';
import { securityUiText } from '../security/security-ui-text';
import './two-factor-page.css';

type TwoFactorMethod = 'totp' | 'otp';

function availableMethods(): TwoFactorMethod[] {
  const raw = queryValue('methods') ?? '';
  const parsed = raw.split(',').map((value) => value.trim()).filter((value): value is TwoFactorMethod => value === 'totp' || value === 'otp');
  return parsed.length > 0 ? Array.from(new Set(parsed)) : ['totp', 'otp'];
}

function Status({ state, processing }: { state: SubmitState; processing: string }) {
  if (state.type === 'idle') return null;
  if (state.type === 'working') return <div className="platform-form-result" role="status">{processing}</div>;
  return <div className={`platform-form-result is-${state.type}`} role={state.type === 'error' ? 'alert' : 'status'}><strong>{state.message}</strong></div>;
}

export default function TwoFactorPage({ route }: { route: RouteMatch }) {
  const { language } = useAppText();
  const copy = securityUiText(language);
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const methods = useMemo(availableMethods, []);
  const [method, setMethod] = useState<TwoFactorMethod>(methods.includes('totp') ? 'totp' : methods[0]);
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const sendEmailCode = async () => {
    const payload = await submitForm('/api/auth/two-factor/send-otp', { trustDevice: true }, setState, {
      success: copy.emailCodeSent,
      idempotent: true,
    });
    if (payload) setEmailCodeSent(true);
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = textValue(new FormData(event.currentTarget).get('code')).replace(/\s/g, '');
    const endpoint = method === 'otp'
      ? '/api/auth/two-factor/verify-otp'
      : '/api/auth/two-factor/verify-totp';
    const payload = await submitForm(endpoint, { code, trustDevice: true }, setState, {
      success: copy.twoFactorComplete,
      idempotent: true,
    });
    if (payload) safeNavigate(returnTo);
  };

  const verifyBackup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = textValue(new FormData(event.currentTarget).get('backup_code')).trim();
    const payload = await submitForm('/api/auth/two-factor/verify-backup-code', { code, trustDevice: true }, setState, {
      success: copy.backupCodeComplete,
      idempotent: true,
    });
    if (payload) safeNavigate(returnTo);
  };

  const selectMethod = (nextMethod: TwoFactorMethod) => {
    setMethod(nextMethod);
    setState({ type: 'idle' });
    if (nextMethod !== 'otp') setEmailCodeSent(false);
  };

  const working = state.type === 'working';

  return (
    <PublicPageFrame route={route} description={copy.twoFactorLoginDescription}>
      <AuthCard>
        <div className="two-factor-page">
          <section className="two-factor-section" aria-labelledby="two-factor-method-title">
            <div className="two-factor-pill" id="two-factor-method-title">{copy.methodTitle}</div>
            <p className="two-factor-section-copy">{copy.methodDescription}</p>
            <div className="two-factor-method-grid" role="group" aria-label={copy.methodTitle}>
              {methods.includes('totp') && (
                <button
                  className={`two-factor-method${method === 'totp' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={method === 'totp'}
                  disabled={working}
                  onClick={() => selectMethod('totp')}
                >
                  <span className="two-factor-method-copy"><strong>{copy.authenticatorLogin}</strong><small>{copy.authenticatorLoginDescription}</small></span>
                  <span className="two-factor-method-state" aria-hidden="true" />
                </button>
              )}
              {methods.includes('otp') && (
                <button
                  className={`two-factor-method${method === 'otp' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={method === 'otp'}
                  disabled={working}
                  onClick={() => selectMethod('otp')}
                >
                  <span className="two-factor-method-copy"><strong>{copy.emailLogin}</strong><small>{copy.emailLoginDescription}</small></span>
                  <span className="two-factor-method-state" aria-hidden="true" />
                </button>
              )}
            </div>
          </section>

          <section className="two-factor-section">
            <div className="two-factor-pill">{method === 'otp' ? copy.emailLogin : copy.authenticatorLogin}</div>
            <div className="two-factor-action-panel">
              {method === 'otp' && (
                <div className="two-factor-email-actions">
                  <p>{copy.emailSendDescription}</p>
                  <button className="platform-button" type="button" disabled={working} onClick={() => void sendEmailCode()}>
                    {emailCodeSent ? copy.resendEmailCode : copy.sendEmailCode}
                  </button>
                </div>
              )}

              {(method === 'totp' || emailCodeSent) && (
                <form className="platform-form" onSubmit={verify}>
                  <Field
                    label={method === 'otp' ? copy.emailCodeLabel : copy.authenticatorCodeLabel}
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength={16}
                  />
                  <button className="platform-button is-primary" type="submit" disabled={working}>{copy.verifyLogin}</button>
                </form>
              )}
            </div>
            <Status state={state} processing={copy.processing} />
          </section>

          <section className="two-factor-section">
            <div className="two-factor-pill">{copy.emergencyTitle}</div>
            <p className="two-factor-section-copy">{copy.emergencyDescription}</p>
            <button className="platform-button two-factor-recovery-toggle" type="button" aria-expanded={recoveryOpen} onClick={() => setRecoveryOpen((value) => !value)}>
              {copy.useBackupCode}
            </button>
            {recoveryOpen && (
              <div className="two-factor-action-panel">
                <form className="platform-form two-factor-recovery-form" onSubmit={verifyBackup}>
                  <Field label={copy.backupCodeLabel} name="backup_code" autoComplete="one-time-code" required maxLength={64} />
                  <button className="platform-button" type="submit" disabled={working}>{copy.verifyBackupCode}</button>
                </form>
              </div>
            )}
          </section>
        </div>
      </AuthCard>
    </PublicPageFrame>
  );
}
