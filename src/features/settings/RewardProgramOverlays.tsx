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

function OverlayShell({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  return <div className="reward-overlay-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="reward-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <header className="reward-overlay-header">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className="reward-overlay-close" onClick={onClose} aria-label="閉じる">×</button>
      </header>
      <div className="reward-overlay-body">{children}</div>
    </section>
  </div>;
}

function CouponOverlay({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [tab, setTab] = useState<'code'|'history'>('code');
  const [state, setState] = useState<{working:boolean; message:string; error:boolean}>({working:false,message:'',error:false});
  const loadHistory = useCallback(async () => {
    try { const payload = asRecord(await apiRequest('/api/coupons/redemptions')); setHistory(asArray(payload.redemptions ?? payload.items)); }
    catch (error) { setState({working:false,message:error instanceof Error ? error.message : '利用履歴を取得できませんでした。',error:true}); }
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
      setState({working:false,message:'クーポンを適用しました。Credit・特典へ反映されています。',error:false});
      setPreview(null);
      setCode('');
    } catch (error) {
      setState({working:false,message:error instanceof Error ? error.message : 'クーポンを適用できませんでした。',error:true});
    }
  };
  return <OverlayShell title="クーポン" subtitle="コードを確認してから適用します。確認だけでは特典は消費されません。" onClose={onClose}>
    <div className="reward-tabs" role="tablist"><button type="button" className={tab==='code'?'is-active':''} onClick={() => setTab('code')}>コード入力</button><button type="button" className={tab==='history'?'is-active':''} onClick={() => setTab('history')}>利用履歴</button></div>
    {tab === 'code' ? <form className="reward-form" onSubmit={(event) => void check(event)}>
      <div className="reward-flow" aria-label="クーポン適用手順"><span className="is-current">1 コード入力</span><span className={preview ? 'is-current' : ''}>2 内容確認</span><span>3 適用</span></div>
      <label className="reward-field"><span>クーポンコード</span><input value={code} onChange={(event) => { setCode(event.target.value); setPreview(null); }} autoComplete="off" spellCheck={false} required placeholder="コードを入力" /></label>
      <button className="platform-button is-primary reward-primary" type="submit" disabled={state.working || !code.trim()}>{state.working ? '確認中…' : '確認する'}</button>
      {preview && <section className="reward-preview"><div className="reward-section-heading"><span>適用内容</span><strong>{recordText(preview,['title','name'],'特典')}</strong></div><p>{recordText(preview,['description','summary'],'このクーポンの特典内容を確認してください。')}</p>{numeric(preview.credit_amount) > 0 && <div className="reward-credit-value"><strong>{numeric(preview.credit_amount).toLocaleString()}</strong><span>Credit</span></div>}<button className="platform-button is-primary reward-primary" type="button" disabled={state.working} onClick={() => void redeem()}>{state.working ? '適用中…' : '適用する'}</button></section>}
      {state.message && <p className={`reward-message ${state.error?'is-error':'is-success'}`} role={state.error?'alert':'status'}>{state.message}</p>}
    </form> : <div className="reward-history">{history.length === 0 ? <div className="reward-empty"><strong>利用履歴はありません</strong><span>適用したクーポンはここに表示されます。</span></div> : history.map((item,index) => { const row=asRecord(item); return <article key={recordText(row,['id'],String(index))}><strong>{recordText(row,['campaign_title','title'],'クーポン')}</strong><span className="reward-status-chip">{recordText(row,['state'],'applied')}</span><small>{recordText(row,['applied_at','created_at'])}</small></article>; })}</div>}
  </OverlayShell>;
}

function ReferralOverlay({ onClose }: { onClose: () => void }) {
  const [resource,setResource] = useState<Record<string,unknown>|null>(null);
  const [input,setInput] = useState('');
  const [message,setMessage] = useState('');
  const [error,setError] = useState(false);
  const load = useCallback(async () => { try { setResource(asRecord(await apiRequest('/api/referral'))); setError(false); } catch (e) { setError(true); setMessage(e instanceof Error?e.message:'紹介情報を取得できませんでした。'); } },[]);
  useEffect(() => { void load(); },[load]);
  const root = asRecord(resource?.referral ?? resource ?? {});
  const ownCode = recordText(root,['code','referral_code']);
  const qualified = numeric(root.qualified_count ?? root.qualifiedCount);
  const rawMilestones = asArray(root.milestones ?? root.policy_milestones).map(asRecord);
  const milestones: Milestone[] = rawMilestones.length ? rawMilestones.map((item) => ({ threshold:numeric(item.threshold), cumulative:numeric(item.cumulative_credit ?? item.credit) })).filter((item) => item.threshold > 0 && item.cumulative > 0).sort((a,b)=>a.threshold-b.threshold) : DEFAULT_MILESTONES;
  const achieved = milestones.filter((item)=>qualified>=item.threshold).at(-1);
  const next = milestones.find((item)=>qualified<item.threshold);
  const currentCredit = achieved?.cumulative ?? 0;
  const nextDelta = next ? next.cumulative - currentCredit : 0;
  const nextRemaining = next ? Math.max(0, next.threshold - qualified) : 0;
  const progressMax = next?.threshold ?? milestones.at(-1)?.threshold ?? 10;
  const progress = Math.min(100, Math.max(0, (qualified / Math.max(1, progressMax)) * 100));
  const bind = async (event:FormEvent) => {
    event.preventDefault();
    setMessage('');
    try { await apiRequest('/api/referral',{method:'POST',body:{action:'bind',code:input},idempotent:true}); setInput(''); setError(false); setMessage('紹介コードを登録しました。条件達成後に双方へCreditが付与されます。'); void load(); }
    catch(e){setError(true);setMessage(e instanceof Error?e.message:'紹介コードを登録できませんでした。');}
  };
  return <OverlayShell title="友達紹介" subtitle="紹介が成立した人数に応じて、紹介した方のRewardが段階的に増えます。" onClose={onClose}>
    <div className="reward-stack">
      <section className="reward-hero-card"><div className="reward-section-heading"><span>あなたの紹介コード</span><strong>友達へ送る</strong></div>{ownCode ? <div className="reward-copy-row"><code>{ownCode}</code><button type="button" className="platform-button" onClick={() => void navigator.clipboard.writeText(ownCode)}>コピー</button></div> : <p>紹介コードを取得しています。</p>}</section>
      <section><div className="reward-section-heading"><span>紹介状況</span><strong>{qualified}人 成立</strong></div><div className="reward-referral-summary"><div><span>獲得済み</span><strong>{currentCredit.toLocaleString()} Credit</strong></div><div><span>次のReward</span><strong>{next ? `+${nextDelta.toLocaleString()} Credit` : '全段階達成'}</strong></div></div>{next && <><div className="reward-progress" aria-label={`次のRewardまであと${nextRemaining}人`}><span style={{width:`${progress}%`}} /></div><p className="reward-next-copy">あと <strong>{nextRemaining}人</strong> で累計 <strong>{next.cumulative.toLocaleString()} Credit</strong></p></>}</section>
      <section><div className="reward-section-heading"><span>Reward段階</span><strong>紹介した方</strong></div><div className="reward-milestones">{milestones.map((item)=><div key={item.threshold} className={qualified>=item.threshold?'is-achieved':''}><span>{qualified>=item.threshold?'✓':'○'} {item.threshold}人以上</span><strong>{item.cumulative.toLocaleString()} Credit</strong></div>)}</div><p className="reward-note">紹介された方は成立時に常に1人目相当の10,000 Creditです。紹介元の段階が上がっても追加増額はありません。</p></section>
      <section><div className="reward-section-heading"><span>紹介された方</span><strong>コード登録</strong></div><form className="reward-form compact" onSubmit={(event)=>void bind(event)}><label className="reward-field"><span>紹介コード</span><input value={input} onChange={(event)=>setInput(event.target.value)} autoComplete="off" required placeholder="紹介コードを入力" /></label><button type="submit" className="platform-button is-primary reward-primary" disabled={!input.trim()}>登録する</button></form></section>
      <section className="reward-policy-card"><strong>不正利用対策</strong><p>同一人物の複数Account、同一端末・回線だけに依存しない複数Signal、実利用状況、登録タイミング等を組み合わせて判定します。疑いだけで自動拒否せず、高Riskのみ保留・確認します。</p></section>
      {message && <p className={`reward-message ${error?'is-error':'is-success'}`}>{message}</p>}
    </div>
  </OverlayShell>;
}

function BetaOverlay({ onClose }: { onClose: () => void }) {
  const [resource,setResource] = useState<Record<string,unknown>|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [reportOpen,setReportOpen] = useState(false);
  const [reportCategory,setReportCategory] = useState('LAYOUT');
  const [reportBody,setReportBody] = useState('');
  const load=useCallback(async()=>{try{const p=asRecord(await apiRequest('/api/beta'));setResource(asRecord(p.beta??p));setMessage('');}catch(e){setMessage(e instanceof Error?e.message:'Beta状態を取得できませんでした。');}},[]);
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
  const mutate=async(body:Record<string,unknown>)=>{setBusy(true);setMessage('');try{await apiRequest('/api/beta',{method:'POST',body,idempotent:true});await load();}catch(e){setMessage(e instanceof Error?e.message:'操作できませんでした。');}finally{setBusy(false);}};
  const submitReport=async(event:FormEvent)=>{event.preventDefault();if(!reportBody.trim()||busy)return;setBusy(true);setMessage('');try{await apiRequest('/api/beta/report',{method:'POST',body:{category:reportCategory,body:reportBody},idempotent:true});setReportBody('');setReportOpen(false);setMessage('問題報告を送信しました。');}catch(e){setMessage(e instanceof Error?e.message:'問題報告を送信できませんでした。');}finally{setBusy(false);}};
  return <OverlayShell title="βテスト" subtitle="Beta LabはSubscriptionとは独立した参加プログラムです。" onClose={onClose}><div className="reward-stack">
    {!state ? <><section className="reward-hero-card"><div className="reward-section-heading"><span>Beta Lab</span><strong>参加前</strong></div><div className="reward-beta-hero"><div><span>月次Reward</span><strong>{monthlyCredit.toLocaleString()} Credit</strong></div><div><span>最低参加期間</span><strong>{minimumDays}日</strong></div></div><p>新機能を先行利用し、技術Telemetryと月次アンケート・感想を提供します。条件達成後に同額のBeta Creditを付与します。</p></section><section className="reward-policy-card"><strong>参加前に確認</strong><ul><li>最低{minimumDays}日間は通常終了できません。</li><li>終了後は再参加できません。</li><li>Telemetryを停止すると参加終了となります。</li><li>入力本文・会話本文は技術Telemetryとして自動収集しません。</li></ul><button type="button" className="platform-button is-primary reward-primary" disabled={busy} onClick={()=>void mutate({action:'join'})}>{busy?'処理中…':'参加する'}</button></section></> : <>
      <section className="reward-hero-card"><div className="reward-section-heading"><span>参加状態</span><strong>{state}</strong></div><div className="reward-beta-hero"><div><span>今月のReward</span><strong>{monthlyCredit.toLocaleString()} Credit</strong></div><div><span>最低参加期限</span><strong>{commitmentUntil ? new Date(commitmentUntil).toLocaleDateString() : `${minimumDays}日`}</strong></div></div></section>
      <section><div className="reward-section-heading"><span>今月の条件</span><strong>{usageOk&&telemetryOk&&periodOk&&surveyOk&&feedbackOk?'達成':'進行中'}</strong></div><div className="reward-condition-list"><span className={usageOk?'is-done':''}>{usageOk?'✓':'○'} Beta機能を利用</span><span className={telemetryOk?'is-done':''}>{telemetryOk?'✓':'○'} Telemetry提供</span><span className={periodOk?'is-done':''}>{periodOk?'✓':'○'} 資格期間完了</span><span className={surveyOk?'is-done':''}>{surveyOk?'✓':'○'} 月次アンケート</span><span className={feedbackOk?'is-done':''}>{feedbackOk?'✓':'○'} 改善点・感想送信</span></div></section>
      <section><div className="reward-section-heading"><span>Beta機能</span><strong>{features.length}件</strong></div>{features.length===0?<div className="reward-empty"><strong>現在公開中のBeta機能はありません</strong><span>新しいBeta機能が公開されるとここに表示されます。</span></div>:features.map((feature)=><label className="reward-toggle-row" key={recordText(feature,['feature_id'])}><span><strong>{recordText(feature,['title'],'Beta機能')}</strong><small>{recordText(feature,['version'])}</small></span><input type="checkbox" checked={feature.enabled===true} disabled={busy||feature.configurable===false} onChange={(event)=>void mutate({action:'feature',feature_id:recordText(feature,['feature_id']),enabled:event.target.checked})}/></label>)}</section>
      <section><div className="reward-section-heading"><span>問題を報告</span><strong>任意</strong></div><p className="reward-note">表示崩れ・操作しにくさ・分かりにくさ・不具合・遅さなどを発見した時だけ送れます。月次Credit条件とは別です。</p><button type="button" className="platform-button" onClick={()=>setReportOpen((value)=>!value)}>{reportOpen?'閉じる':'問題を報告'}</button>{reportOpen&&<form className="reward-form reward-report-form" onSubmit={(event)=>void submitReport(event)}><label className="reward-field"><span>種類</span><select value={reportCategory} onChange={(event)=>setReportCategory(event.target.value)}><option value="LAYOUT">表示が崩れている</option><option value="USABILITY">操作しにくい</option><option value="UNDERSTANDING">分かりにくい</option><option value="BUG">動かない</option><option value="PERFORMANCE">遅い</option><option value="OTHER">その他</option></select></label><label className="reward-field"><span>内容</span><textarea value={reportBody} onChange={(event)=>setReportBody(event.target.value)} required maxLength={4000} placeholder="発生した内容を入力" /></label><button type="submit" className="platform-button is-primary reward-primary" disabled={busy||!reportBody.trim()}>{busy?'送信中…':'送信する'}</button></form>}</section>
      <section><div className="reward-section-heading"><span>参加終了</span><strong>再参加不可</strong></div><p className="reward-note">Telemetryを停止すると参加は即時終了し、未確定Rewardは無効になります。通常終了は最低参加期間後のみ可能です。</p><div className="reward-actions"><button type="button" className="platform-button" disabled={busy} onClick={()=>void mutate({action:'stop_telemetry'})}>Telemetryを停止して終了</button><button type="button" className="platform-button" disabled={busy || (!!commitmentUntil && Date.now()<Date.parse(commitmentUntil))} onClick={()=>void mutate({action:'exit'})}>βテストを終了</button></div></section>
    </>}
    {message&&<p className={`reward-message ${message.includes('送信しました')?'is-success':'is-error'}`}>{message}</p>}
  </div></OverlayShell>;
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
    ['referral','友達紹介','紹介コード・成立人数・段階Reward'],
    ['beta','βテスト','参加状態・月次条件・Beta機能・問題報告'],
  ] as const,[]);
  return <>{items.map(([kind,title,description])=><button key={kind} type="button" className="settings-surface-row reward-settings-row" onClick={()=>onOpen(kind)}><span className="settings-surface-row-copy"><strong>{title}</strong><small>{description}</small></span><span className="settings-surface-chevron" aria-hidden="true">›</span></button>)}</>;
}
