import { useEffect, useState, type FormEvent } from 'react';
import { apiUrl, asRecord, queryValue, recordText, textValue } from '../api-client';
import { isNativeRuntime, openExternalUrl } from '../external-navigation';
import { safeReturnPath, type RouteMatch } from '../route-registry';
import { PublicPageFrame } from '../ResponsivePageShell';
import { AuthCard, Field, FormResult, safeNavigate, submitForm, type SubmitState } from './page-kit';

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
      const root = asRecord(payload);
      const data = asRecord(root.data ?? root);
      if (data.requires_password_setup === true) {
        safeNavigate(`/account/password/setup?return_to=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (data.requires_2fa === true) {
        const challenge = recordText(data, ['challenge_id', 'challenge']);
        const params = new URLSearchParams({ return_to: returnTo });
        if (challenge) params.set('challenge', challenge);
        safeNavigate(`/auth/2fa?${params.toString()}`);
        return;
      }
      safeNavigate(returnTo);
    })();
    return () => { active = false; };
  }, [nativeExchange, returnTo]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = await submitForm('/api/auth/login', {
      email: textValue(data.get('email')),
      password: textValue(data.get('password')),
      return_to: returnTo,
    }, setState, { success: 'Loginしました。' });
    if (payload) safeNavigate(returnTo);
  };

  const startOAuth = async (provider: 'google' | 'github') => {
    setState({ type: 'working' });
    try {
      const params = new URLSearchParams({ return_to: returnTo });
      if (isNativeRuntime()) {
        params.set('native_callback', 'jp.asterav8.app://open/login');
      }
      await openExternalUrl(apiUrl(`/api/auth/oauth/${provider}?${params.toString()}`));
      setState({ type: 'idle' });
    } catch (error) {
      setState({
        type: 'error',
        message: error instanceof Error ? error.message : 'OAuthを開始できませんでした。',
        code: 'OAUTH_START_FAILED',
      });
    }
  };

  return (
    <PublicPageFrame route={route} description="Astera Accountへ安全にLoginします。">
      <AuthCard footer={<><a href="/forgot-password">Passwordを忘れた場合</a><a href="/register">Accountを作成</a></>}>
        <form className="platform-form" onSubmit={onSubmit}>
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
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
    const payload = await submitForm('/api/auth/register', {
      email,
      nickname: textValue(data.get('nickname')),
      password,
    }, setState, { success: '確認Emailを送信しました。', idempotent: true });
    if (payload) window.setTimeout(() => safeNavigate(`/verify-email?email=${encodeURIComponent(email)}`), 300);
  };
  return (
    <PublicPageFrame route={route} description="Email確認が完了するまで決済や実行は開始しません。">
      <AuthCard footer={<a href="/login">既にAccountがある場合</a>}>
        <form className="platform-form" onSubmit={onSubmit}>
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Field label="Nickname" name="nickname" autoComplete="nickname" required />
          <Field label="Password（12〜128文字）" name="password" type="password" autoComplete="new-password" required minLength={12} />
          <Field label="Password確認" name="password_confirm" type="password" autoComplete="new-password" required minLength={12} />
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
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<SubmitState>({ type: token ? 'working' : 'idle' });

  useEffect(() => {
    if (!token) return;
    void submitForm('/api/auth/email/verify', { token }, setState, {
      success: 'Emailを確認しました。',
      navigateTo: '/login',
      idempotent: true,
    });
  }, [token]);

  const resend = async (event: FormEvent) => {
    event.preventDefault();
    await submitForm('/api/auth/email/resend', { email }, setState, { success: '確認Emailを再送しました。', idempotent: true });
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
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (reset) {
      const password = textValue(data.get('password'));
      const confirm = textValue(data.get('password_confirm'));
      if (password !== confirm) {
        setState({ type: 'error', message: 'Passwordが一致しません。', code: 'PASSWORD_MISMATCH' });
        return;
      }
      await submitForm('/api/account/password/reset', { token, password }, setState, {
        success: 'Passwordを更新しました。', navigateTo: '/login', idempotent: true,
      });
      return;
    }
    await submitForm('/api/account/password/forgot', { email: textValue(data.get('email')) }, setState, {
      success: '該当Accountがある場合、再設定Emailを送信しました。', idempotent: true,
    });
  };
  return (
    <PublicPageFrame route={route} description={reset ? '有効なTokenで新しいPasswordを設定します。' : 'Accountの存在を第三者へ露出せず再設定を開始します。'}>
      <AuthCard footer={<a href="/login">Loginへ戻る</a>}>
        <form className="platform-form" onSubmit={onSubmit}>
          {reset ? <>
            <Field label="新しいPassword" name="password" type="password" autoComplete="new-password" required minLength={12} />
            <Field label="Password確認" name="password_confirm" type="password" autoComplete="new-password" required minLength={12} />
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
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = textValue(data.get('password'));
    const confirm = textValue(data.get('password_confirm'));
    if (password !== confirm) {
      setState({ type: 'error', message: 'Passwordが一致しません。', code: 'PASSWORD_MISMATCH' });
      return;
    }
    await submitForm('/api/account/password/setup', { password }, setState, {
      success: 'Astera用Passwordを設定しました。', navigateTo: safeReturnPath(queryValue('return_to'), '/app/new'), idempotent: true,
    });
  };
  return (
    <PublicPageFrame route={route} description="Google／GitHubのPasswordは取得せず、Astera専用Passwordを設定します。">
      <AuthCard><form className="platform-form" onSubmit={onSubmit}>
        <Field label="Astera用Password" name="password" type="password" autoComplete="new-password" required minLength={12} />
        <Field label="Password確認" name="password_confirm" type="password" autoComplete="new-password" required minLength={12} />
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>設定して続ける</button>
      </form><FormResult state={state} /></AuthCard>
    </PublicPageFrame>
  );
}

function TwoFactorPage({ route }: { route: RouteMatch }) {
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = await submitForm('/api/auth/2fa/verify', {
      code: textValue(data.get('code')).replace(/\s/g, ''),
      challenge_id: queryValue('challenge'),
    }, setState, { success: '認証しました。', idempotent: true });
    if (payload) safeNavigate(safeReturnPath(queryValue('return_to'), '/app/new'));
  };
  return (
    <PublicPageFrame route={route} description="Authenticator CodeまたはBackup Codeを検証します。">
      <AuthCard><form className="platform-form" onSubmit={onSubmit}>
        <Field label="認証Code" name="code" inputMode="numeric" required />
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
