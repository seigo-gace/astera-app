import { useEffect, useState, type FormEvent } from 'react';
import { apiUrl, asRecord, queryValue, recordText, textValue } from '../api-client';
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
          setState({ type: 'error', message: 'Email確認に失敗しました。', code: 'EMAIL_VERIFICATION_FAILED' });
        }
      } catch (error) {
        if (active) {
          setState({
            type: 'error',
            message: error instanceof Error ? error.message : 'Email確認に失敗しました。',
            code: 'EMAIL_VERIFICATION_FAILED',
          });
        }
      }
    })();
    return () => { active = false; };
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
      <AuthCard>
        <form className="platform-form" onSubmit={onSubmit}>
          {reset ? <>
            <Field label="新しいPassword" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
            <Field label="Password確認" name="password_confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          </> : <Field label="Email" name="email" type="email" autoComplete="email" required />}
          <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>{reset ? 'Passwordを更新' : '再設定Emailを送信'}</button>
        </form>
        <FormResult state={state} />
        <div className="platform-auth-route-actions" aria-label="Login操作">
          <a className="platform-button" href={loginPath(returnTo)}>Login</a>
        </div>
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
    case 'verify-email': return <VerifyEmailPage route={route} />;
    case 'forgot-password': return <PasswordRequestPage route={route} reset={false} />;
    case 'reset-password': return <PasswordRequestPage route={route} reset />;
    case 'password-setup': return <PasswordSetupPage route={route} />;
    case 'two-factor': return <TwoFactorPage route={route} />;
    default: return null;
  }
}
