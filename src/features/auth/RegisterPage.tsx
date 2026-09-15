import { useState, type FormEvent } from 'react';
import { asRecord, queryValue, recordText, textValue } from '../../platform/api-client';
import { isNativeRuntime, nativeCallback, openExternalUrl } from '../../platform/external-navigation';
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
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');

  const signUpEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = textValue(data.get('email'));
    const password = textValue(data.get('password'));
    const confirm = textValue(data.get('password_confirm'));

    if (password !== confirm) {
      setState({ type: 'error', message: 'Passwordが一致しません。', code: 'PASSWORD_MISMATCH' });
      return;
    }

    const payload = await submitForm('/api/auth/sign-up/email', {
      email,
      // Better Auth の内部 user.name 必須互換値。ユーザーへ名前入力は要求しない。
      name: email,
      password,
      callbackURL: absoluteAppUrl(returnTo),
    }, setState, { success: '確認Emailを送信しました。', idempotent: true });

    if (payload) {
      const params = new URLSearchParams({ email, return_to: returnTo });
      window.setTimeout(() => safeNavigate(`/verify-email?${params.toString()}`), 300);
    }
  };

  const startOAuthRegistration = async (provider: 'google' | 'github') => {
    const nativeComplete = nativeOAuthCompleteUrl(returnTo);
    const callbackURL = isNativeRuntime() ? nativeComplete : absoluteAppUrl(returnTo);
    const payload = await submitForm('/api/auth/sign-in/social', {
      provider,
      callbackURL,
      errorCallbackURL: absoluteAppUrl(`/register?return_to=${encodeURIComponent(returnTo)}`),
      newUserCallbackURL: isNativeRuntime()
        ? nativeComplete
        : absoluteAppUrl(`/account/password/setup?return_to=${encodeURIComponent(returnTo)}`),
      // Native OAuth の既存・検証済み Login deep-link 経路を再利用する。
      native_callback: nativeCallback('/login'),
      disableRedirect: true,
    }, setState, { success: `${provider}登録を開始します。`, idempotent: true });

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
      setState({
        type: 'error',
        message: error instanceof Error ? error.message : 'OAuth登録を開始できませんでした。',
        code: 'OAUTH_START_FAILED',
      });
    }
  };

  return (
    <PublicPageFrame route={route} description="Email、Google、GitHubからAstera Accountを作成します。">
      <AuthCard>
        <form className="platform-form" onSubmit={signUpEmail}>
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Field label="Password（12〜128文字）" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          <Field label="Password確認" name="password_confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>EmailでAccount登録</button>
        </form>

        <div className="platform-divider"><span>または</span></div>
        <div className="platform-stack-actions">
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuthRegistration('google')}>Googleアカウントで登録</button>
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuthRegistration('github')}>GitHubで登録</button>
        </div>

        <FormResult state={state} />
        <div className="platform-auth-route-actions" aria-label="Login操作">
          <a className="platform-button" href={loginPath(returnTo)}>Login</a>
        </div>
      </AuthCard>
    </PublicPageFrame>
  );
}
