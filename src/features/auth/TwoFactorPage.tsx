import { useMemo, useState, type FormEvent } from 'react';
import { queryValue, textValue } from '../../platform/api-client';
import { safeReturnPath, type RouteMatch } from '../../platform/route-registry';
import { PublicPageFrame } from '../../platform/ResponsivePageShell';
import { AuthCard, Field, safeNavigate, submitForm, type SubmitState } from '../../platform/pages/page-kit';

type TwoFactorMethod = 'totp' | 'otp';

function availableMethods(): TwoFactorMethod[] {
  const raw = queryValue('methods') ?? '';
  const parsed = raw.split(',').map((value) => value.trim()).filter((value): value is TwoFactorMethod => value === 'totp' || value === 'otp');
  return parsed.length > 0 ? Array.from(new Set(parsed)) : ['totp', 'otp'];
}

function Status({ state }: { state: SubmitState }) {
  if (state.type === 'idle') return null;
  if (state.type === 'working') return <div className="platform-form-result" role="status">処理しています…</div>;
  return <div className={`platform-form-result is-${state.type}`} role={state.type === 'error' ? 'alert' : 'status'}><strong>{state.message}</strong></div>;
}

export default function TwoFactorPage({ route }: { route: RouteMatch }) {
  const returnTo = safeReturnPath(queryValue('return_to'), '/app/new');
  const methods = useMemo(availableMethods, []);
  const [method, setMethod] = useState<TwoFactorMethod>(methods.includes('totp') ? 'totp' : methods[0]);
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const sendEmailCode = async () => {
    const payload = await submitForm('/api/auth/two-factor/send-otp', { trustDevice: true }, setState, {
      success: 'Account登録メールへ確認コードを送信しました。',
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
      success: '2段階認証が完了しました。',
      idempotent: true,
    });
    if (payload) safeNavigate(returnTo);
  };

  const verifyBackup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = textValue(new FormData(event.currentTarget).get('backup_code')).trim();
    const payload = await submitForm('/api/auth/two-factor/verify-backup-code', { code, trustDevice: true }, setState, {
      success: 'Backup Codeで認証しました。',
      idempotent: true,
    });
    if (payload) safeNavigate(returnTo);
  };

  const working = state.type === 'working';

  return (
    <PublicPageFrame route={route} description="認証方法を選んでLoginを完了します。">
      <AuthCard>
        <div className="platform-stack-actions" role="group" aria-label="2段階認証の方法">
          {methods.includes('totp') && (
            <button className={`platform-button${method === 'totp' ? ' is-primary' : ''}`} type="button" disabled={working} onClick={() => { setMethod('totp'); setState({ type: 'idle' }); }}>
              認証アプリ
            </button>
          )}
          {methods.includes('otp') && (
            <button className={`platform-button${method === 'otp' ? ' is-primary' : ''}`} type="button" disabled={working} onClick={() => { setMethod('otp'); setState({ type: 'idle' }); }}>
              メール
            </button>
          )}
        </div>

        {method === 'otp' && (
          <div className="platform-form">
            <p>Accountに登録済みのメールアドレスへ確認コードを送ります。別のメールアドレス登録は不要です。</p>
            <button className="platform-button" type="button" disabled={working} onClick={() => void sendEmailCode()}>
              {emailCodeSent ? '確認コードを再送' : 'メールで確認コードを受け取る'}
            </button>
          </div>
        )}

        <form className="platform-form" onSubmit={verify}>
          <Field
            label={method === 'otp' ? 'メールに届いた確認コード' : '認証アプリの確認コード'}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={16}
          />
          <button className="platform-button is-primary" type="submit" disabled={working || (method === 'otp' && !emailCodeSent)}>認証してLogin</button>
        </form>

        <Status state={state} />

        <div className="platform-divider"><span>非常用</span></div>
        <button className="platform-button" type="button" aria-expanded={recoveryOpen} onClick={() => setRecoveryOpen((value) => !value)}>
          Backup Codeを使う
        </button>
        {recoveryOpen && (
          <form className="platform-form" onSubmit={verifyBackup}>
            <Field label="Backup Code" name="backup_code" autoComplete="one-time-code" required maxLength={64} />
            <button className="platform-button" type="submit" disabled={working}>Backup Codeで認証</button>
          </form>
        )}
      </AuthCard>
    </PublicPageFrame>
  );
}
