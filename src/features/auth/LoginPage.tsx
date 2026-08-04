import { useEffect, useState, type FormEvent } from 'react';
import { asRecord, queryValue, recordText, textValue } from '../../platform/api-client';
import { authClient, authErrorMessage } from '../../platform/auth-client';
import { nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import { safeReturnPath, type RouteMatch } from '../../platform/route-registry';
import { PublicPageFrame } from '../../platform/ResponsivePageShell';
import { AuthCard, Field, FormResult, safeNavigate, submitForm, type SubmitState } from '../../platform/pages/page-kit';

function absoluteAppUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
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
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const nativeExchange = queryValue('exchange');

  useEffect(() => {
    if (!nativeExchange) return;
    let active = true;
    void (async () => {
      const payload = await submitForm('/api/auth/native/session-exchange', {
        exchange_token: nativeExchange,
      }, setState, { success: 'Native Sessionを確立しました。', idempotent: true });
      if (active && payload) safeNavigate(continuation(payload, returnTo));
    })();
    return () => { active = false; };
  }, [nativeExchange, returnTo]);

  const signInEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = await submitForm('/api/auth/sign-in/email', {
      email: textValue(data.get('email')),
      password: textValue(data.get('password')),
      rememberMe: true,
      callbackURL: absoluteAppUrl(returnTo),
    }, setState, { success: 'Loginしました。' });
    if (payload) safeNavigate(continuation(payload, returnTo));
  };

  const signInPasskey = async () => {
    setState({ type: 'working' });
    try {
      const response = await authClient.signIn.passkey({ autoFill: false });
      if (response.error) {
        setState({ type: 'error', message: authErrorMessage(response.error, 'Passkey認証に失敗しました。'), code: recordText(asRecord(response.error), ['code'], 'PASSKEY_SIGN_IN_FAILED') });
        return;
      }
      setState({ type: 'success', message: 'Passkeyで認証しました。' });
      safeNavigate(continuation(response.data, returnTo));
    } catch (error) {
      setState({ type: 'error', message: error instanceof Error ? error.message : 'Passkey認証を開始できませんでした。', code: 'PASSKEY_SIGN_IN_FAILED' });
    }
  };

  const startOAuth = async (provider: 'google' | 'github') => {
    const callbackURL = nativeCallback('/login') || absoluteAppUrl(returnTo);
    const payload = await submitForm('/api/auth/sign-in/social', {
      provider,
      callbackURL,
      errorCallbackURL: absoluteAppUrl(`/login?return_to=${encodeURIComponent(returnTo)}`),
      newUserCallbackURL: absoluteAppUrl(`/account/password/setup?return_to=${encodeURIComponent(returnTo)}`),
      disableRedirect: true,
    }, setState, { success: `${provider}認証を開始します。`, idempotent: true });
    if (!payload) return;
    const redirectUrl = recordText(asRecord(asRecord(payload).data ?? payload), ['url', 'redirect']);
    if (!redirectUrl) {
      setState({ type: 'error', message: 'OAuth Redirect URLを受信できませんでした。', code: 'OAUTH_REDIRECT_URL_MISSING' });
      return;
    }
    try {
      await openExternalUrl(redirectUrl);
      setState({ type: 'idle' });
    } catch (error) {
      setState({ type: 'error', message: error instanceof Error ? error.message : 'OAuthを開始できませんでした。', code: 'OAUTH_START_FAILED' });
    }
  };

  return (
    <PublicPageFrame route={route} description="Email、Passkey、Google、GitHubからAstera Accountへ安全にLoginします。">
      <AuthCard footer={<><a href={`/forgot-password?return_to=${encodeURIComponent(returnTo)}`}>Passwordを忘れた場合</a><a href={`/register?return_to=${encodeURIComponent(returnTo)}`}>Accountを作成</a></>}>
        <form className="platform-form" onSubmit={signInEmail}>
          <Field label="Email" name="email" type="email" autoComplete="username webauthn" required />
          <Field label="Password" name="password" type="password" autoComplete="current-password webauthn" required />
          <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>EmailでLogin</button>
        </form>
        <div className="platform-divider"><span>または</span></div>
        <div className="platform-stack-actions">
          <button className="platform-button is-primary" type="button" disabled={state.type === 'working'} onClick={() => void signInPasskey()}>PasskeyでLogin</button>
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuth('google')}>Googleで続ける</button>
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuth('github')}>GitHubで続ける</button>
        </div>
        <FormResult state={state} />
      </AuthCard>
    </PublicPageFrame>
  );
}
