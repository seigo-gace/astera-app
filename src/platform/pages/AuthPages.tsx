import { useEffect, useState, type FormEvent } from 'react';
import { apiUrl, asRecord, queryValue, recordText, textValue, type JsonObject } from '../api-client';
import { nativeCallback, openExternalUrl } from '../external-navigation';
import { safeReturnPath, type RouteMatch } from '../route-registry';
import { PublicPageFrame } from '../ResponsivePageShell';
import { AuthCard, Field, FormResult, safeNavigate, submitForm, type SubmitState } from './page-kit';

function authenticationState(payload: unknown): JsonObject {
  const root = asRecord(payload);
  const data = asRecord(root.data ?? root);
  return {
    ...data,
    ...asRecord(data.user),
    ...asRecord(data.account),
    ...asRecord(root.user),
    ...asRecord(root.account),
  };
}

function requiredAuthenticationPath(payload: unknown, returnTo: string): string | null {
  const state = authenticationState(payload);
  if (state.requires_password_setup === true || state.account_status === 'pending_password_setup') {
    return `/account/password/setup?return_to=${encodeURIComponent(returnTo)}`;
  }
  if (state.twoFactorRedirect === true || state.requires_2fa === true || state.auth_stage === 'pending_2fa') {
    return `/auth/2fa?return_to=${encodeURIComponent(returnTo)}`;
  }
  if (state.emailVerified === false || state.account_status === 'pending_email_verification') {
    const params = new URLSearchParams({ return_to: returnTo });
    const email = recordText(state, ['email']);
    if (email) params.set('email', email);
    return `/verify-email?${params.toString()}`;
  }
  return null;
}

function loginPath(returnTo: string): string {
  const params = new URLSearchParams({ return_to: returnTo });
  return `/login?${params.toString()}`;
}

function absoluteAppUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function LoginPage({ route }: { route: RouteMatch }) {
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
      if (!active || !payload) return;
      safeNavigate(requiredAuthenticationPath(payload, returnTo) ?? returnTo);
    })();
    return () => { active = false; };
  }, [nativeExchange, returnTo]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = await submitForm('/api/auth/sign-in/email', {
      email: textValue(data.get('email')),
      password: textValue(data.get('password')),
      rememberMe: true,
      callbackURL: absoluteAppUrl(returnTo),
    }, setState, { success: 'Loginしました。' });
    if (payload) safeNavigate(requiredAuthenticationPath(payload, returnTo) ?? returnTo);
  };

  const startOAuth = async (provider: 'google' | 'github') => {
    const callback = nativeCallback('/login');
    const callbackURL = callback || absoluteAppUrl(returnTo);
    const payload = await submitForm('/api/auth/sign-in/social', {
      provider,
      callbackURL,
      errorCallbackURL: absoluteAppUrl(loginPath(returnTo)),
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
    <PublicPageFrame route={route} description="Astera Accountへ安全にLoginします。">
      <AuthCard footer={<><a href={`/forgot-password?return_to=${encodeURIComponent(returnTo)}`}>Passwordを忘れた場合</a><a href={`/register?return_to=${encodeURIComponent(returnTo)}`}>Accountを作成</a></>}>
        <form className="platform-form" onSubmit={onSubmit}>
          <Field label="Email" name="email" type="email" autoComplete="username webauthn" required />
          <Field label="Password" name="password" type="password" autoComplete="current-password webauthn" required />
          <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>Login</button>
        </form>
        <div className="platform-divider"><span>または</span></div>
        <div className="platform-stack-actions">
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuth('google')}>Googleで続ける</button>
          <button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void startOAuth('github')}>GitHubで続ける</button>
        </div>
        <FormResult state={state} />
      </AuthCard>
    </PublicPageFrame>
  );
}

function RegisterPage({ route }: { route: RouteMatch }) {
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
      name: textValue(data.get('nickname')),
      password,
      callbackURL: absoluteAppUrl(returnTo),
    }, setState, { success: '確認Emailを送信しました。', idempotent: true });
    if (payload) {
      const params = new URLSearchParams({ email, return_to: returnTo });
      window.setTimeout(() => safeNavigate(`/verify-email?${params.toString()}`), 300);
    }
  };
  return (
    <PublicPageFrame route={route} description="Email確認が完了するまで決済や実行は開始しません。">
      <AuthCard footer={<a href={loginPath(returnTo)}>既にAccountがある場合</a>}>
        <form className="platform-form" onSubmit={onSubmit}>
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Field label="Nickname" name="nickname" autoComplete="nickname" required />
          <Field label="Password（12〜128文字）" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          <Field label="Password確認" name="password_confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>Account登録</button>
        </form>
        <FormResult state={state} />
      </AuthCard>
    </PublicPageFrame>
  );
}

function VerifyEmailPage({ route }: { route: RouteMatch }) {
  const token = queryValue('token');
  const initialEmail = queryValue('email');
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<SubmitState>({ type: token ? 'working' : 'idle' });

  useEffect(() => {
    if (!token) return;
    const endpoint = new URL(apiUrl('/api/auth/verify-email'));
    endpoint.searchParams.set('token', token);
    endpoint.searchParams.set('callbackURL', absoluteAppUrl(loginPath(returnTo)));
    window.location.replace(endpoint.toString());
  }, [returnTo, token]);

  const resend = async (event: FormEvent) => {
    event.preventDefault();
    await submitForm('/api/auth/send-verification-email', { email, callbackURL: absoluteAppUrl(returnTo) }, setState, { success: '確認Emailを再送しました。', idempotent: true });
  };

  return (
    <PublicPageFrame route={route} description="確認Tokenを検証し、Accountを有効化します。">
      <AuthCard>
        {token ? <FormResult state={state} /> : (
          <form className="platform-form" onSubmit={resend}>
            <Field label="Email" name="email" type="email" value={email} onChange={setEmail} required />
            <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>確認Emailを再送</button>
            <FormResult state={state} />
          </form>
        )}
      </AuthCard>
    </PublicPageFrame>
  );
}

function PasswordRequestPage({ route, reset }: { route: RouteMatch; reset: boolean }) {
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const token = queryValue('token');
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (reset) {
      if (!token) {
        setState({ type: 'error', message: 'Password再設定Tokenがありません。', code: 'RESET_TOKEN_REQUIRED' });
        return;
      }
      const password = textValue(data.get('password'));
      const confirm = textValue(data.get('password_confirm'));
      if (password !== confirm) {
        setState({ type: 'error', message: 'Passwordが一致しません。', code: 'PASSWORD_MISMATCH' });
        return;
      }
      await submitForm('/api/auth/reset-password', { token, newPassword: password }, setState, {
        success: 'Passwordを更新しました。', navigateTo: loginPath(returnTo), idempotent: true,
      });
      return;
    }
    await submitForm('/api/auth/request-password-reset', {
      email: textValue(data.get('email')),
      redirectTo: absoluteAppUrl(`/reset-password?return_to=${encodeURIComponent(returnTo)}`),
    }, setState, { success: '該当Accountがある場合、再設定Emailを送信しました。', idempotent: true });
  };
  return (
    <PublicPageFrame route={route} description={reset ? '有効なTokenで新しいPasswordを設定します。' : 'Accountの存在を第三者へ露出せず再設定を開始します。'}>
      <AuthCard footer={<a href={loginPath(returnTo)}>Loginへ戻る</a>}>
        <form className="platform-form" onSubmit={onSubmit}>
          {reset ? <>
            <Field label="新しいPassword" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
            <Field label="Password確認" name="password_confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          </> : <Field label="Email" name="email" type="email" autoComplete="email" required />}
          <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{reset ? 'Passwordを更新' : '再設定Emailを送信'}</button>
        </form>
        <FormResult state={state} />
      </AuthCard>
    </PublicPageFrame>
  );
}

function PasswordSetupPage({ route }: { route: RouteMatch }) {
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = textValue(data.get('password'));
    const confirm = textValue(data.get('password_confirm'));
    if (password !== confirm) {
      setState({ type: 'error', message: 'Passwordが一致しません。', code: 'PASSWORD_MISMATCH' });
      return;
    }
    await submitForm('/api/auth/set-password', { newPassword: password }, setState, {
      success: 'Astera用Passwordを設定しました。', navigateTo: returnTo, idempotent: true,
    });
  };
  return (
    <PublicPageFrame route={route} description="Google／GitHubのPasswordは取得せず、Astera専用Passwordを設定します。">
      <AuthCard><form className="platform-form" onSubmit={onSubmit}>
        <Field label="Astera用Password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
        <Field label="Password確認" name="password_confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>設定して続ける</button>
      </form><FormResult state={state} /></AuthCard>
    </PublicPageFrame>
  );
}

function TwoFactorPage({ route }: { route: RouteMatch }) {
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const method = textValue(data.get('method')) || 'totp';
    const code = textValue(data.get('code')).replace(/\s/g, '');
    const endpoint = method === 'backup' ? '/api/auth/two-factor/verify-backup-code' : '/api/auth/two-factor/verify-totp';
    const payload = await submitForm(endpoint, { code, trustDevice: true }, setState, { success: '認証しました。', idempotent: true });
    if (payload) safeNavigate(returnTo);
  };
  return (
    <PublicPageFrame route={route} description="Authenticator CodeまたはBackup Codeを検証します。">
      <AuthCard><form className="platform-form" onSubmit={onSubmit}>
        <label className="platform-field"><span>認証方式</span><select name="method" defaultValue="totp"><option value="totp">Authenticator Code</option><option value="backup">Backup Code</option></select></label>
        <Field label="認証Code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={64} />
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>認証</button>
      </form><FormResult state={state} /></AuthCard>
    </PublicPageFrame>
  );
}

export function AuthPage({ route }: { route: RouteMatch }) {
  switch (route.id) {
    case 'login': return <LoginPage route={route} />;
    case 'register': return <RegisterPage route={route} />;
    case 'verify-email': return <VerifyEmailPage route={route} />;
    case 'forgot-password': return <PasswordRequestPage route={route} reset={false} />;
    case 'reset-password': return <PasswordRequestPage route={route} reset />;
    case 'password-setup': return <PasswordSetupPage route={route} />;
    case 'two-factor': return <TwoFactorPage route={route} />;
    default: return null;
  }
}
