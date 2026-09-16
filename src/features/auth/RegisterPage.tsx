import { useState, type FormEvent } from 'react';
import { asRecord, queryValue, recordText, textValue } from '../../platform/api-client';
import { authErrorCode } from '../../platform/auth-client';
import { authDisplayError } from '../../platform/auth-display-error';
import { isNativeRuntime, nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import { usePlatformText } from '../../platform/platform-text';
import { safeReturnPath, type RouteMatch } from '../../platform/route-registry';
import { PublicPageFrame } from '../../platform/ResponsivePageShell';
import { AuthCard, Field, FormResult, safeNavigate, submitForm, type SubmitState } from '../../platform/pages/page-kit';

function absoluteAppUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function loginPath(returnTo: string): string {
  const params = new URLSearchParams({ return_to: returnTo });
  return `/login?${params.toString()}`;
}

function nativeOAuthCompleteUrl(returnTo: string): string {
  const endpoint = new URL('/api/auth/native/oauth-complete', window.location.origin);
  endpoint.searchParams.set('return_to', returnTo);
  return endpoint.toString();
}

export default function RegisterPage({ route }: { route: RouteMatch }) {
  const { text } = usePlatformText();
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');

  const signUpEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = textValue(data.get('email'));
    const password = textValue(data.get('password'));
    const confirm = textValue(data.get('password_confirm'));

    if (password !== confirm) {
      setState({ type: 'error', message: text('authPasswordMismatch'), code: 'PASSWORD_MISMATCH' });
      return;
    }

    const payload = await submitForm('/api/auth/sign-up/email', {
      email,
      // Better Auth の内部 user.name 必須互換値。ユーザーへ名前入力は要求しない。
      name: email,
      password,
      callbackURL: absoluteAppUrl(returnTo),
    }, setState, {
      success: text('authVerificationEmailSent'),
      errorMessage: (error) => authDisplayError(error, text, 'authRegisterFailed'),
      idempotent: true,
    });

    if (payload) {
      const params = new URLSearchParams({ email, return_to: returnTo });
      window.setTimeout(() => safeNavigate(`/verify-email?${params.toString()}`), 300);
    }
  };

  const startOAuthRegistration = async (provider: 'google' | 'github') => {
    const nativeComplete = nativeOAuthCompleteUrl(returnTo);
    const callbackURL = isNativeRuntime() ? nativeComplete : absoluteAppUrl(returnTo);
    const nativeCb = nativeCallback('/login');
    const payload = await submitForm('/api/auth/sign-in/social', {
      provider,
      callbackURL,
      errorCallbackURL: absoluteAppUrl(`/register?return_to=${encodeURIComponent(returnTo)}`),
      newUserCallbackURL: isNativeRuntime()
        ? nativeComplete
        : absoluteAppUrl(`/account/password/setup?return_to=${encodeURIComponent(returnTo)}`),
      ...(nativeCb ? { native_callback: nativeCb } : {}),
      disableRedirect: true,
    }, setState, {
      success: provider === 'google' ? text('authGoogleRegisterStarting') : text('authGithubRegisterStarting'),
      errorMessage: (error) => authDisplayError(error, text, 'authOAuthRegisterStartFailed'),
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
        message: authDisplayError(error, text, 'authOAuthRegisterStartFailed'),
        code: authErrorCode(error, 'OAUTH_START_FAILED'),
      });
    }
  };

  return (
    <PublicPageFrame route={route} description={text('authRegisterDescription')}>
      <AuthCard>
        <form className="platform-form" onSubmit={signUpEmail}>
          <Field label={text('authEmail')} name="email" type="email" autoComplete="email" required />
          <Field label={text('authPasswordRange')} name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          <Field label={text('authPasswordConfirm')} name="password_confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{text('authEmailRegister')}</button>
        </form>

        <div className="platform-divider"><span>{text('authOr')}</span></div>
        <div className="platform-stack-actions">
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuthRegistration('google')}>{text('authGoogleRegister')}</button>
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuthRegistration('github')}>{text('authGithubRegister')}</button>
        </div>

        <FormResult state={state} />
        <div className="platform-auth-route-actions" aria-label={text('authLoginActionsAria')}>
          <a className="platform-button" href={loginPath(returnTo)}>{text('authLogin')}</a>
        </div>
      </AuthCard>
    </PublicPageFrame>
  );
}
