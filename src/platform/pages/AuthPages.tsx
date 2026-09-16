import { useEffect, useState, type FormEvent } from 'react';
import { apiUrl, asRecord, queryValue, recordText, textValue } from '../api-client';
import { authDisplayError } from '../auth-display-error';
import { usePlatformText } from '../platform-text';
import { safeReturnPath, type RouteMatch } from '../route-registry';
import { PublicPageFrame } from '../ResponsivePageShell';
import { AuthCard, Field, FormResult, safeNavigate, submitForm, type SubmitState } from './page-kit';

function loginPath(returnTo: string): string {
  const params = new URLSearchParams({ return_to: returnTo });
  return `/login?${params.toString()}`;
}

function absoluteAppUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function navigateFromApiRedirect(location: string): void {
  try {
    const url = new URL(location, window.location.origin);
    if (url.origin !== window.location.origin) {
      safeNavigate(safeReturnPath(location, '/app/new'));
      return;
    }
    safeNavigate(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    safeNavigate(safeReturnPath(location, '/app/new'));
  }
}

function VerifyEmailPage({ route }: { route: RouteMatch }) {
  const { text } = usePlatformText();
  const token = queryValue('token');
  const initialEmail = queryValue('email');
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<SubmitState>({ type: token ? 'working' : 'idle' });

  useEffect(() => {
    if (!token) return;
    let active = true;
    void (async () => {
      const endpoint = new URL(apiUrl('/api/auth/verify-email'));
      endpoint.searchParams.set('token', token);
      endpoint.searchParams.set('callbackURL', absoluteAppUrl(loginPath(returnTo)));
      try {
        const response = await fetch(endpoint.toString(), { method: 'GET', credentials: 'include', redirect: 'manual' });
        const location = response.headers.get('Location') ?? response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          if (active) navigateFromApiRedirect(location);
          return;
        }
        if (response.ok) {
          const payload = await response.json().catch(() => null);
          const redirect = recordText(asRecord(payload), ['redirect', 'location', 'url']);
          if (redirect) {
            if (active) navigateFromApiRedirect(redirect);
            return;
          }
        }
        if (active) {
          setState({ type: 'error', message: text('authVerifyEmailFailed'), code: 'EMAIL_VERIFICATION_FAILED' });
        }
      } catch {
        if (active) {
          setState({ type: 'error', message: text('authVerifyEmailFailed'), code: 'EMAIL_VERIFICATION_FAILED' });
        }
      }
    })();
    return () => { active = false; };
  }, [returnTo, text, token]);

  const resend = async (event: FormEvent) => {
    event.preventDefault();
    await submitForm('/api/auth/send-verification-email', { email, callbackURL: absoluteAppUrl(returnTo) }, setState, {
      success: text('authVerificationEmailResent'),
      errorMessage: (error) => authDisplayError(error, text, 'authVerifyEmailResendFailed'),
      idempotent: true,
    });
  };

  return (
    <PublicPageFrame route={route} description={text('authVerifyEmailDescription')}>
      <AuthCard>
        {token ? <FormResult state={state} /> : (
          <form className="platform-form" onSubmit={resend}>
            <Field label={text('authEmail')} name="email" type="email" value={email} onChange={setEmail} required />
            <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{text('authVerificationEmailResend')}</button>
            <FormResult state={state} />
          </form>
        )}
      </AuthCard>
    </PublicPageFrame>
  );
}

function PasswordRequestPage({ route, reset }: { route: RouteMatch; reset: boolean }) {
  const { text } = usePlatformText();
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const token = queryValue('token');
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (reset) {
      if (!token) {
        setState({ type: 'error', message: text('authResetTokenMissing'), code: 'RESET_TOKEN_REQUIRED' });
        return;
      }
      const password = textValue(data.get('password'));
      const confirm = textValue(data.get('password_confirm'));
      if (password !== confirm) {
        setState({ type: 'error', message: text('authPasswordMismatch'), code: 'PASSWORD_MISMATCH' });
        return;
      }
      await submitForm('/api/auth/reset-password', { token, newPassword: password }, setState, {
        success: text('authPasswordUpdated'),
        errorMessage: (error) => authDisplayError(error, text, 'authPasswordResetFailed'),
        navigateTo: loginPath(returnTo),
        idempotent: true,
      });
      return;
    }
    await submitForm('/api/auth/request-password-reset', {
      email: textValue(data.get('email')),
      redirectTo: absoluteAppUrl(`/reset-password?return_to=${encodeURIComponent(returnTo)}`),
    }, setState, {
      success: text('authResetEmailSent'),
      errorMessage: (error) => authDisplayError(error, text, 'authPasswordResetRequestFailed'),
      idempotent: true,
    });
  };
  return (
    <PublicPageFrame route={route} description={reset ? text('authResetPasswordDescription') : text('authForgotPasswordDescription')}>
      <AuthCard>
        <form className="platform-form" onSubmit={onSubmit}>
          {reset ? <>
            <Field label={text('authNewPassword')} name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
            <Field label={text('authPasswordConfirm')} name="password_confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          </> : <Field label={text('authEmail')} name="email" type="email" autoComplete="email" required />}
          <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{reset ? text('authPasswordUpdate') : text('authResetEmailSend')}</button>
        </form>
        <FormResult state={state} />
        <div className="platform-auth-route-actions" aria-label={text('authLoginActionsAria')}>
          <a className="platform-button" href={loginPath(returnTo)}>{text('authLogin')}</a>
        </div>
      </AuthCard>
    </PublicPageFrame>
  );
}

function PasswordSetupPage({ route }: { route: RouteMatch }) {
  const { text } = usePlatformText();
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = textValue(data.get('password'));
    const confirm = textValue(data.get('password_confirm'));
    if (password !== confirm) {
      setState({ type: 'error', message: text('authPasswordMismatch'), code: 'PASSWORD_MISMATCH' });
      return;
    }
    await submitForm('/api/auth/set-password', { newPassword: password }, setState, {
      success: text('authAsteraPasswordSet'),
      errorMessage: (error) => authDisplayError(error, text, 'authPasswordSetupFailed'),
      navigateTo: returnTo,
      idempotent: true,
    });
  };
  return (
    <PublicPageFrame route={route} description={text('authPasswordSetupDescription')}>
      <AuthCard><form className="platform-form" onSubmit={onSubmit}>
        <Field label={text('authAsteraPassword')} name="password" type="password" autoComplete="new-password" required minLength={6} maxLength={128} />
        <Field label={text('authPasswordConfirm')} name="password_confirm" type="password" autoComplete="new-password" required minLength={6} maxLength={128} />
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{text('authPasswordSetupContinue')}</button>
      </form><FormResult state={state} /></AuthCard>
    </PublicPageFrame>
  );
}

function TwoFactorPage({ route }: { route: RouteMatch }) {
  const { text } = usePlatformText();
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const method = textValue(data.get('method')) || 'totp';
    const code = textValue(data.get('code')).replace(/\s/g, '');
    const endpoint = method === 'backup' ? '/api/auth/two-factor/verify-backup-code' : '/api/auth/two-factor/verify-totp';
    const payload = await submitForm(endpoint, { code, trustDevice: true }, setState, {
      success: text('authTwoFactorSuccess'),
      errorMessage: (error) => authDisplayError(error, text, 'authTwoFactorFailed'),
      idempotent: true,
    });
    if (payload) safeNavigate(returnTo);
  };
  return (
    <PublicPageFrame route={route} description={text('authTwoFactorDescription')}>
      <AuthCard><form className="platform-form" onSubmit={onSubmit}>
        <label className="platform-field"><span>{text('authTwoFactorMethod')}</span><select name="method" defaultValue="totp"><option value="totp">{text('authTwoFactorTotp')}</option><option value="backup">{text('authTwoFactorBackup')}</option></select></label>
        <Field label={text('authTwoFactorCode')} name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={64} />
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{text('authTwoFactorSubmit')}</button>
      </form><FormResult state={state} /></AuthCard>
    </PublicPageFrame>
  );
}

export function AuthPage({ route }: { route: RouteMatch }) {
  switch (route.id) {
    case 'verify-email': return <VerifyEmailPage route={route} />;
    case 'forgot-password': return <PasswordRequestPage route={route} reset={false} />;
    case 'reset-password': return <PasswordRequestPage route={route} reset />;
    case 'password-setup': return <PasswordSetupPage route={route} />;
    case 'two-factor': return <TwoFactorPage route={route} />;
    default: return null;
  }
}
