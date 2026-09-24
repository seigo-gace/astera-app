import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import './reward-program-overlays.css';

type OverlayKind = 'coupon' | 'referral' | 'beta' | null;

type Props = {
  open: OverlayKind;
  onClose: () => void;
};

type Milestone = { threshold: number; cumulative: number };

const DEFAULT_MILESTONES: Milestone[] = [
  { threshold: 1, cumulative: 10000 },
  { threshold: 3, cumulative: 30000 },
  { threshold: 5, cumulative: 60000 },
  { threshold: 10, cumulative: 150000 },
];

function numeric(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function OverlayShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  return (
    <div className="reward-overlay-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="reward-overlay" role="dialog" aria-modal="true" aria-label={title}>
        <header className="reward-overlay-header">
          <h2>{title}</h2>
          <button type="button" className="reward-overlay-close" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        <div className="reward-overlay-body">{children}</div>
      </section>
    </div>
  );
}

function CouponOverlay({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [tab, setTab] = useState<'code'|'history'>('code');
  const [state, setState] = useState<{working:boolean; message:string; error:boolean}>({working:false,message:'',error:false});

  const loadHistory = useCallback(async () => {
    try {
      const payload = asRecord(await apiRequest('/api/coupons/redemptions'));
      setHistory(asArray(payload.redemptions ?? payload.items));
    } catch (error) {
      setState({working:false,message:error instanceof Error ? error.message : '利用履歴を取得できませんでした。',error:true});
    }
  }, []);

  const refreshAfterRedeem = useCallback(async (): Promise<number | null> => {
    const [balanceResult, historyResult] = await Promise.allSettled([
      apiRequest('/api/credit/balance'),
      apiRequest('/api/coupons/redemptions'),
    ]);

    let currentBalance: number | null = null;
    if (balanceResult.status === 'fulfilled') {
      const payload = asRecord(balanceResult.value);
      const value = Number(payload.available_balance);
      if (Number.isFinite(value)) {
        currentBalance = value;
        setBalance(value);
      }
    }

    if (historyResult.status === 'fulfilled') {
      const payload = asRecord(historyResult.value);
      setHistory(asArray(payload.redemptions ?? payload.items));
    }

    return currentBalance;
  }, []);

  useEffect(() => { if (tab === 'history') void loadHistory(); }, [tab, loadHistory]);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    setState({working:true,message:'',error:false});
    try {
      const payload = asRecord(await apiRequest('/api/coupons/preview', { method:'POST', body:{ code }, idempotent:false }));
      setPreview(asRecord(payload.preview ?? payload));
      setState({working:false,message:'',error:false});
    } catch (error) {
      setPreview(null);
      setState({working:false,message:error instanceof Error ? error.message : 'コードを確認できませんでした。',error:true});
    }
  };

  const redeem = async () => {
    setState({working:true,message:'',error:false});
    try {
      const requestId = crypto.randomUUID();
      await apiRequest('/api/coupons/redeem', { method:'POST', body:{ code, client_request_id:requestId }, idempotencyKey:requestId });
      const currentBalance = await refreshAfterRedeem();
      setState({
        working:false,
        message: currentBalance === null
          ? 'クーポンは適用されました。最新のCredit残高を確認できなかったため、Credit画面または利用履歴で再確認してください。'
          : `クーポンを適用しました。現在のCredit残高は ${currentBalance.toLocaleString()} Credit です。`,
        error:false,
      });
      setPreview(null);
      setCode('');
    } catch (error) {
      setState({working:false,message:error instanceof Error ? error.message : 'クーポンを適用できませんでした。',error:true});
    }
  };

  return (
    <OverlayShell title="クーポン" onClose={onClose}>
      <div className="reward-tabs" role="tablist">
        <button type="button" className={tab==='code'?'is-active':''} onClick={() => setTab('code')}>コード入力</button>
        <button type="button" className={tab==='history'?'is-active':''} onClick={() => setTab('history')}>利用履歴</button>
      </div>
      {tab === 'code' ? (
        <form className="reward-form" onSubmit={(event) => void check(event)}>
          <label className="reward-field">
            <span>クーポンコード</span>
            <input value={code} onChange={(event) => { setCode(event.target.value); setPreview(null); }} autoComplete="off" spellCheck={false} required placeholder="コードを入力" />
          </label>
          <button className="platform-button is-primary reward-primary" type="submit" disabled={state.working || !code.trim()}>{state.working ? '確認中…' : '確認する'}</button>
          {preview && (
            <section className="reward-preview">
              <div className="reward-section-heading"><span>適用内容</span><strong>{recordText(preview,['title','name'],'特典')}</strong></div>
              {recordText(preview,['description','summary']) && <p>{recordText(preview,['description','summary'])}</p>}
              {numeric(preview.credit_amount) > 0 && <div className="reward-credit-value"><strong>{numeric(preview.credit_amount).toLocaleString()}</strong><span>Credit</span></div>}
              <button className="platform-button is-primary reward-primary" type="button" disabled={state.working} onClick={() => void redeem()}>{state.working ? '適用中…' : '適用する'}</button>
            </section>
          )}
          {state.message && <p className={`reward-message ${state.error?'is-error':'is-success'}`} role={state.error?'alert':'status'}>{state.message}</p>}
          {balance !== null && <div className="reward-credit-value"><strong>{balance.toLocaleString()}</strong><span>現在のCredit残高</span></div>}
        </form>
      ) : (
        <div className="reward-history">
          {history.length === 0 ? <div className="reward-empty"><strong>利用履歴はありません</strong></div> : history.map((item,index) => {
            const row=asRecord(item);
            return <article key={recordText(row,['id'],String(index))}><strong>{recordText(row,['campaign_title','title'],'クーポン')}</strong><span className="reward-status-chip">{recordText(row,['state'],'applied')}</span><small>{recordText(row,['applied_at','created_at'])}</small></article>;
          })}
        </div>
      )}
    </OverlayShell>
  );
}

function ReferralOverlay({ onClose }: { onClose: () => void }) {
  const [resource,setResource] = useState<Record<string,unknown>|null>(null);
  const [input,setInput] = useState('');
  const [message,setMessage] = useState('');
  const [error,setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setResource(asRecord(await apiRequest('/api/referral')));
      setError(false);
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error?e.message:'紹介情報を取得できませんでした。');
    }
  },[]);

  useEffect(() => { void load(); },[load]);

  const root = asRecord(resource?.referral ?? resource ?? {});
  const ownCode = recordText(root,['code','referral_code']);
  const qualified = numeric(root.qualified_count ?? root.qualifiedCount);
  const rawMilestones = asArray(root.milestones ?? root.policy_milestones).map(asRecord);
  const milestones: Milestone[] = rawMilestones.length
    ? rawMilestones.map((item) => ({ threshold:numeric(item.threshold), cumulative:numeric(item.cumulative_credit ?? item.credit) })).filter((item) => item.threshold > 0 && item.cumulative > 0).sort((a,b)=>a.threshold-b.threshold)
    : DEFAULT_MILESTONES;
  const achieved = milestones.filter((item)=>qualified>=item.threshold).at(-1);
  const next = milestones.find((item)=>qualified<item.threshold);
  const currentCredit = achieved?.cumulative ?? 0;
  const nextRemaining = next ? Math.max(0, next.threshold - qualified) : 0;

  const bind = async (event:FormEvent) => {
    event.preventDefault();
    setMessage('');
    try {
      await apiRequest('/api/referral',{method:'POST',body:{action:'bind',code:input},idempotent:true});
      setInput('');
      setError(false);
      setMessage('紹介コードを登録しました。');
      void load();
    } catch(e) {
      setError(true);
      setMessage(e instanceof Error?e.message:'紹介コードを登録できませんでした。');
    }
  };

  return (
    <OverlayShell title="友達紹介" onClose={onClose}>
      <div className="reward-stack reward-stack-simple">
        <section>
          <span className="reward-label">あなたの紹介コード</span>
          {ownCode ? <div className="reward-copy-row"><code>{ownCode}</code><button type="button" className="platform-button" onClick={() => void navigator.clipboard.writeText(ownCode)}>コピー</button></div> : <p>取得中…</p>}
        </section>
        <section className="reward-referral-simple">
          <div><span>成立</span><strong>{qualified}人</strong></div>
          <div><span>獲得済み</span><strong>{currentCredit.toLocaleString()} Credit</strong></div>
          <div><span>次</span><strong>{next ? `${next.threshold}人で ${next.cumulative.toLocaleString()} Credit` : '全段階達成'}</strong></div>
          {next && <small>あと{nextRemaining}人</small>}
        </section>
        <section>
          <form className="reward-form compact" onSubmit={(event)=>void bind(event)}>
            <label className="reward-field"><span>紹介コードを使う</span><input value={input} onChange={(event)=>setInput(event.target.value)} autoComplete="off" required placeholder="紹介コードを入力" /></label>
            <button type="submit" className="platform-button is-primary reward-primary" disabled={!input.trim()}>登録する</button>
          </form>
        </section>
        {message && <p className={`reward-message ${error?'is-error':'is-success'}`}>{message}</p>}
      </div>
    </OverlayShell>
  );
}

function BetaOverlay({ onClose }: { onClose: () => void }) {
  const [resource,setResource] = useState<Record<string,unknown>|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [reportOpen,setReportOpen] = useState(false);
  const [reportCategory,setReportCategory] = useState('LAYOUT');
  const [reportBody,setReportBody] = useState('');

  const load=useCallback(async()=>{
    try {
      const p=asRecord(await apiRequest('/api/beta'));
      setResource(asRecord(p.beta??p));
      setMessage('');
    } catch(e) {
      setMessage(e instanceof Error?e.message:'Beta状態を取得できませんでした。');
    }
  },[]);

  useEffect(()=>{void load();},[load]);

  const participant=asRecord(resource?.participant);
  const policy=asRecord(resource?.policy);
  const features=asArray(resource?.features).map(asRecord);
  const state=recordText(participant,['state']);
  const monthlyCredit=numeric(policy.monthly_credit,30000);
  const minimumDays=numeric(policy.minimum_commitment_days,90);
  const usageOk=numeric(resource?.usage_count)>0;
  const telemetryOk=bool(participant.telemetry_enabled);
  const periodOk=resource?.qualification_period_complete===true || resource?.period_complete===true;
  const surveyOk=resource?.survey_submitted===true;
  const feedbackOk=resource?.feedback_submitted===true || surveyOk;
  const commitmentUntil=recordText(participant,['commitment_until']);

  const mutate=async(body:Record<string,unknown>)=>{
    setBusy(true);
    setMessage('');
    try {
      await apiRequest('/api/beta',{method:'POST',body,idempotent:true});
      await load();
    } catch(e) {
      setMessage(e instanceof Error?e.message:'操作できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const submitReport=async(event:FormEvent)=>{
    event.preventDefault();
    if(!reportBody.trim()||busy)return;
    setBusy(true);
    setMessage('');
    try {
      await apiRequest('/api/beta/report',{method:'POST',body:{category:reportCategory,body:reportBody},idempotent:true});
      setReportBody('');
      setReportOpen(false);
      setMessage('問題報告を送信しました。');
    } catch(e) {
      setMessage(e instanceof Error?e.message:'問題報告を送信できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayShell title="βテスト" onClose={onClose}>
      <div className="reward-stack">
        {!state ? <>
          <section className="reward-hero-card">
            <div className="reward-beta-hero"><div><span>月次Reward</span><strong>{monthlyCredit.toLocaleString()} Credit</strong></div><div><span>最低参加期間</span><strong>{minimumDays}日</strong></div></div>
            <p>新機能を先行利用し、月次アンケートに回答します。</p>
          </section>
          <section className="reward-policy-card">
            <ul><li>最低{minimumDays}日間は通常終了できません。</li><li>終了後は再参加できません。</li><li>Telemetry停止で参加終了になります。</li></ul>
            <button type="button" className="platform-button is-primary reward-primary" disabled={busy} onClick={()=>void mutate({action:'join'})}>{busy?'処理中…':'参加する'}</button>
          </section>
        </> : <>
          <section className="reward-hero-card"><div className="reward-section-heading"><span>参加状態</span><strong>{state}</strong></div><div className="reward-beta-hero"><div><span>今月のReward</span><strong>{monthlyCredit.toLocaleString()} Credit</strong></div><div><span>最低参加期限</span><strong>{commitmentUntil ? new Date(commitmentUntil).toLocaleDateString() : `${minimumDays}日`}</strong></div></div></section>
          <section><div className="reward-section-heading"><span>今月の条件</span><strong>{usageOk&&telemetryOk&&periodOk&&surveyOk&&feedbackOk?'達成':'進行中'}</strong></div><div className="reward-condition-list"><span className={usageOk?'is-done':''}>{usageOk?'✓':'○'} Beta機能を利用</span><span className={telemetryOk?'is-done':''}>{telemetryOk?'✓':'○'} Telemetry提供</span><span className={periodOk?'is-done':''}>{periodOk?'✓':'○'} 資格期間完了</span><span className={surveyOk?'is-done':''}>{surveyOk?'✓':'○'} 月次アンケート</span><span className={feedbackOk?'is-done':''}>{feedbackOk?'✓':'○'} 改善点・感想送信</span></div></section>
          <section><div className="reward-section-heading"><span>Beta機能</span><strong>{features.length}件</strong></div>{features.length===0?<div className="reward-empty"><strong>現在公開中のBeta機能はありません</strong></div>:features.map((feature)=><label className="reward-toggle-row" key={recordText(feature,['feature_id'])}><span><strong>{recordText(feature,['title'],'Beta機能')}</strong><small>{recordText(feature,['version'])}</small></span><input type="checkbox" checked={feature.enabled===true} disabled={busy||feature.configurable===false} onChange={(event)=>void mutate({action:'feature',feature_id:recordText(feature,['feature_id']),enabled:event.target.checked})}/></label>)}</section>
          <section><div className="reward-section-heading"><span>問題を報告</span><strong>任意</strong></div><button type="button" className="platform-button" onClick={()=>setReportOpen((value)=>!value)}>{reportOpen?'閉じる':'問題を報告'}</button>{reportOpen&&<form className="reward-form reward-report-form" onSubmit={(event)=>void submitReport(event)}><label className="reward-field"><span>種類</span><select value={reportCategory} onChange={(event)=>setReportCategory(event.target.value)}><option value="LAYOUT">表示が崩れている</option><option value="USABILITY">操作しにくい</option><option value="UNDERSTANDING">分かりにくい</option><option value="BUG">動かない</option><option value="PERFORMANCE">遅い</option><option value="OTHER">その他</option></select></label><label className="reward-field"><span>内容</span><textarea value={reportBody} onChange={(event)=>setReportBody(event.target.value)} required maxLength={4000} placeholder="発生した内容を入力" /></label><button type="submit" className="platform-button is-primary reward-primary" disabled={busy||!reportBody.trim()}>{busy?'送信中…':'送信する'}</button></form>}</section>
          <section><div className="reward-section-heading"><span>参加終了</span><strong>再参加不可</strong></div><div className="reward-actions"><button type="button" className="platform-button" disabled={busy} onClick={()=>void mutate({action:'stop_telemetry'})}>Telemetryを停止して終了</button><button type="button" className="platform-button" disabled={busy || (!!commitmentUntil && Date.now()<Date.parse(commitmentUntil))} onClick={()=>void mutate({action:'exit'})}>βテストを終了</button></div></section>
        </>}
        {message&&<p className={`reward-message ${message.includes('送信しました')?'is-success':'is-error'}`}>{message}</p>}
      </div>
    </OverlayShell>
  );
}

export function RewardProgramOverlays({ open, onClose }: Props) {
  if (open === 'coupon') return <CouponOverlay onClose={onClose}/>;
  if (open === 'referral') return <ReferralOverlay onClose={onClose}/>;
  if (open === 'beta') return <BetaOverlay onClose={onClose}/>;
  return null;
}

export function RewardProgramSettingsRows({ onOpen }: { onOpen: (kind: Exclude<OverlayKind,null>) => void }) {
  const items = useMemo(() => [
    ['coupon','クーポン','コードの確認・適用・利用履歴'],
    ['referral','友達紹介','紹介コード・成立人数・Reward'],
    ['beta','βテスト','参加状態・月次条件・Beta機能'],
  ] as const,[]);
  return <>{items.map(([kind,title,description])=><button key={kind} type="button" className="settings-surface-row reward-settings-row" onClick={()=>onOpen(kind)}><span className="settings-surface-row-copy"><strong>{title}</strong><small>{description}</small></span><span className="settings-surface-chevron" aria-hidden="true">›</span></button>)}</>;
}
