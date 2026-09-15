import { useEffect, useState, type FormEvent } from 'react';
import { asRecord, queryValue, recordText, textValue } from '../../platform/api-client';
import { authClient, authErrorCode } from '../../platform/auth-client';
import { authDisplayError } from '../../platform/auth-display-error';
import { isNativeRuntime, nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import { usePlatformText } from '../../platform/platform-text';
import { safeReturnPath, type RouteMatch } from '../../platform/route-registry';
import { PublicPageFrame } from '../../platform/ResponsivePageShell';
import { AuthCard, Field, FormResult, safeNavigate, submitForm, type SubmitState } from '../../platform/pages/page-kit';

function absoluteAppUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function nativeOAuthCompleteUrl(returnTo: string): string {
  const endpoint = new URL('/api/auth/native/oauth-complete', window.location.origin);
  endpoint.searchParams.set('return_to', returnTo);
  return endpoint.toString();
}

function continuation(payload: unknown, returnTo: string): string {
  const root = asRecord(payload);
  const source = { ...asRecord(root.data), ...asRecord(root.user), ...asRecord(root.account), ...root };
  if (source.twoFactorRedirect === true || source.requires_2fa === true || source.auth_stage === 'pending_2fa') {
    return `/auth/2fa?return_to=${encodeURIComponent(returnTo)}`;
  }
  if (source.emailVerified === false || source.account_status === 'pending_email_verification') {
    const params = new URLSearchParams({ return_to: returnTo });
    const email = recordText(source, ['email']);
    if (email) params.set('email', email);
    return `/verify-email?${params.toString()}`;
  }
  if (source.requires_password_setup === true || source.account_status === 'pending_password_setup') {
    return `/account/password/setup?return_to=${encodeURIComponent(returnTo)}`;
  }
  return returnTo;
}

export default function LoginPage({ route }: { route: RouteMatch }) {
  const { text } = usePlatformText();
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const nativeExchange = queryValue('exchange');

  useEffect(() => {
    if (!nativeExchange) return;
    let active = true;
    void (async () => {
      const payload = await submitForm('/api/auth/native/session-exchange', {
        exchange_token: nativeExchange,
      }, setState, {
        success: text('authNativeSessionSuccess'),
        errorMessage: (error) => authDisplayError(error, text, 'authNativeSessionFailed'),
        idempotent: true,
      });
      if (active && payload) safeNavigate(continuation(payload, returnTo));
    })();
    return () => { active = false; };
  }, [nativeExchange, returnTo, text]);

  const signInEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = await submitForm('/api/auth/sign-in/email', {
      email: textValue(data.get('email')),
      password: textValue(data.get('password')),
      rememberMe: true,
      callbackURL: absoluteAppUrl(returnTo),
    }, setState, {
      success: text('authLoginSuccess'),
      errorMessage: (error) => authDisplayError(error, text, 'authLoginFailed'),
    });
    if (payload) safeNavigate(continuation(payload, returnTo));
  };

  const signInPasskey = async () => {
    setState({ type: 'working' });
    try {
      const response = await authClient.signIn.passkey({ autoFill: false });
      if (response.error) {
        setState({
          type: 'error',
          message: authDisplayError(response.error, text, 'authPasskeySignInFailed'),
          code: authErrorCode(response.error, 'PASSKEY_SIGN_IN_FAILED'),
        });
        return;
      }
      setState({ type: 'success', message: text('authPasskeySuccess') });
      safeNavigate(continuation(response.data, returnTo));
    } catch (error) {
      setState({
        type: 'error',
        message: authDisplayError(error, text, 'authPasskeyStartFailed'),
        code: authErrorCode(error, 'PASSKEY_SIGN_IN_FAILED'),
      });
    }
  };

  const startOAuth = async (provider: 'google' | 'github') => {
    const nativeComplete = nativeOAuthCompleteUrl(returnTo);
    const callbackURL = isNativeRuntime() ? nativeComplete : absoluteAppUrl(returnTo);
    const payload = await submitForm('/api/auth/sign-in/social', {
      provider,
      callbackURL,
      errorCallbackURL: absoluteAppUrl(`/login?return_to=${encodeURIComponent(returnTo)}`),
      newUserCallbackURL: isNativeRuntime() ? nativeComplete : absoluteAppUrl(`/account/password/setup?return_to=${encodeURIComponent(returnTo)}`),
      native_callback: nativeCallback('/login'),
      disableRedirect: true,
    }, setState, {
      success: provider === 'google' ? text('authGoogleLoginStarting') : text('authGithubLoginStarting'),
      errorMessage: (error) => authDisplayError(error, text, 'authOAuthStartFailed'),
      idempotent: true,
    });
    if (!payload) return;
    const redirectUrl = recordText(asRecord(asRecord(payload).data ?? payload), ['url', 'redirect']);
    if (!redirectUrl) {
      setState({ type: 'error', message: text('authOAuthRedirectMissing'), code: 'OAUTH_REDIRECT_URL_MISSING' });
      return;
    }
    try {
      await openExternalUrl(redirectUrl);
      setState({ type: 'idle' });
    } catch (error) {
      setState({
        type: 'error',
        message: authDisplayError(error, text, 'authOAuthStartFailed'),
        code: authErrorCode(error, 'OAUTH_START_FAILED'),
      });
    }
  };

  const registerPath = `/register?return_to=${encodeURIComponent(returnTo)}`;
  const forgotPasswordPath = `/forgot-password?return_to=${encodeURIComponent(returnTo)}`;

  return (
    <PublicPageFrame route={route} description={text('authLoginDescription')}>
      <AuthCard>
        <form className="platform-form" onSubmit={signInEmail}>
          <Field label={text('authEmail')} name="email" type="email" autoComplete="username webauthn" required />
          <Field label={text('authPassword')} name="password" type="password" autoComplete="current-password webauthn" required />
          <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{text('authEmailLogin')}</button>
        </form>
        <div className="platform-divider"><span>{text('authOr')}</span></div>
        <div className="platform-stack-actions">
          <button className="platform-button is-primary" type="button" disabled={state.type === 'working'} onClick={() => void signInPasskey()}>{text('authPasskeyLogin')}</button>
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuth('google')}>{text('authGoogleContinue')}</button>
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuth('github')}>{text('authGithubContinue')}</button>
        </div>
        <FormResult state={state} />
        <div className="platform-auth-route-actions" aria-label={text('authAccountActionsAria')}>
          <a className="platform-button" href={forgotPasswordPath}>{text('authForgotPassword')}</a>
          <a className="platform-button" href={registerPath}>{text('authCreateAccount')}</a>
        </div>
      </AuthCard>
    </PublicPageFrame>
  );
}
