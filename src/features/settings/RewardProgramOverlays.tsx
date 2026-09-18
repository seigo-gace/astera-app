import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import './reward-program-overlays.css';

type OverlayKind = 'coupon' | 'referral' | 'beta' | null;

type Props = {
  open: OverlayKind;
  onClose: () => void;
};

function numeric(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function OverlayShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  return <div className="reward-overlay-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="reward-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button type="button" className="reward-overlay-close" onClick={onClose} aria-label="閉じる">×</button></header>
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
    try { const payload = asRecord(await apiRequest('/api/coupons/preview', { method:'POST', body:{ code }, idempotent:false })); setPreview(asRecord(payload.preview ?? payload)); setState({working:false,message:'',error:false}); }
    catch (error) { setPreview(null); setState({working:false,message:error instanceof Error ? error.message : 'コードを確認できませんでした。',error:true}); }
  };
  const redeem = async () => {
    setState({working:true,message:'',error:false});
    try { const requestId = crypto.randomUUID(); await apiRequest('/api/coupons/redeem', { method:'POST', body:{ code, client_request_id:requestId }, idempotencyKey:requestId }); setState({working:false,message:'クーポンを適用しました。Credit・特典へ反映されています。',error:false}); setPreview(null); setCode(''); }
    catch (error) { setState({working:false,message:error instanceof Error ? error.message : 'クーポンを適用できませんでした。',error:true}); }
  };
  return <OverlayShell title="クーポン" onClose={onClose}>
    <div className="reward-tabs" role="tablist"><button type="button" className={tab==='code'?'is-active':''} onClick={() => setTab('code')}>コード入力</button><button type="button" className={tab==='history'?'is-active':''} onClick={() => setTab('history')}>利用履歴</button></div>
    {tab === 'code' ? <form className="reward-form" onSubmit={(event) => void check(event)}>
      <label><span>クーポンコード</span><input value={code} onChange={(event) => { setCode(event.target.value); setPreview(null); }} autoComplete="off" spellCheck={false} required /></label>
      <button className="platform-button is-primary" type="submit" disabled={state.working || !code.trim()}>確認する</button>
      {preview && <div className="reward-preview"><strong>{recordText(preview,['title','name'],'適用される特典')}</strong><p>{recordText(preview,['description','summary'],'このクーポンの特典内容を確認してください。')}</p>{numeric(preview.credit_amount) > 0 && <p><b>{numeric(preview.credit_amount).toLocaleString()} Credit</b></p>}<button className="platform-button is-primary" type="button" disabled={state.working} onClick={() => void redeem()}>適用する</button></div>}
      {state.message && <p className={`reward-message ${state.error?'is-error':'is-success'}`} role={state.error?'alert':'status'}>{state.message}</p>}
    </form> : <div className="reward-history">{history.length === 0 ? <p>利用履歴はありません。</p> : history.map((item,index) => { const row=asRecord(item); return <article key={recordText(row,['id'],String(index))}><strong>{recordText(row,['campaign_title','title'],'クーポン')}</strong><span>{recordText(row,['state'],'applied')}</span><small>{recordText(row,['applied_at','created_at'])}</small></article>; })}</div>}
  </OverlayShell>;
}

function ReferralOverlay({ onClose }: { onClose: () => void }) {
  const [resource,setResource] = useState<Record<string,unknown>|null>(null);
  const [input,setInput] = useState('');
  const [message,setMessage] = useState('');
  const [error,setError] = useState(false);
  const load = useCallback(async () => { try { setResource(asRecord(await apiRequest('/api/referral'))); } catch (e) { setError(true); setMessage(e instanceof Error?e.message:'紹介情報を取得できませんでした。'); } },[]);
  useEffect(() => { void load(); },[load]);
  const root = asRecord(resource?.referral ?? resource ?? {});
  const ownCode = recordText(root,['code','referral_code']);
  const qualified = numeric(root.qualified_count ?? root.qualifiedCount);
  const milestones = asArray(root.milestones ?? root.policy_milestones).map(asRecord);
  const bind = async (event:FormEvent) => { event.preventDefault(); setMessage(''); try { await apiRequest('/api/referral',{method:'POST',body:{action:'bind',code:input},idempotent:true}); setInput(''); setError(false); setMessage('紹介コードを登録しました。条件達成後にCreditが付与されます。'); void load(); } catch(e){setError(true);setMessage(e instanceof Error?e.message:'紹介コードを登録できませんでした。');} };
  return <OverlayShell title="友達紹介" onClose={onClose}>
    <div className="reward-stack">
      <section><h3>あなたの紹介コード</h3>{ownCode ? <div className="reward-copy-row"><code>{ownCode}</code><button type="button" className="platform-button" onClick={() => void navigator.clipboard.writeText(ownCode)}>コピー</button></div> : <p>紹介コードを準備しています。</p>}</section>
      <section><h3>紹介実績</h3><p>条件達成済み <strong>{qualified}人</strong></p><div className="reward-milestones">{milestones.length ? milestones.map((item,index)=><div key={index}><span>{numeric(item.threshold)}人</span><strong>{numeric(item.cumulative_credit ?? item.credit).toLocaleString()} Credit</strong></div>) : <><div><span>1人</span><strong>10,000 Credit</strong></div><div><span>3人</span><strong>30,000 Credit</strong></div><div><span>5人</span><strong>60,000 Credit</strong></div><div><span>10人</span><strong>150,000 Credit</strong></div></>}</div></section>
      <form className="reward-form" onSubmit={(event)=>void bind(event)}><label><span>紹介された方：紹介コードを入力</span><input value={input} onChange={(event)=>setInput(event.target.value)} autoComplete="off" required /></label><button type="submit" className="platform-button is-primary" disabled={!input.trim()}>登録する</button></form>
      <p className="reward-note">同一人物による複数Account等の不正利用は複数Signalで判定し、疑いだけで自動確定しません。</p>
      {message && <p className={`reward-message ${error?'is-error':'is-success'}`}>{message}</p>}
    </div>
  </OverlayShell>;
}

function BetaOverlay({ onClose }: { onClose: () => void }) {
  const [resource,setResource] = useState<Record<string,unknown>|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const load=useCallback(async()=>{try{const p=asRecord(await apiRequest('/api/beta'));setResource(asRecord(p.beta??p));}catch(e){setMessage(e instanceof Error?e.message:'Beta状態を取得できませんでした。');}},[]);
  useEffect(()=>{void load();},[load]);
  const participant=asRecord(resource?.participant);
  const policy=asRecord(resource?.policy);
  const features=asArray(resource?.features).map(asRecord);
  const state=recordText(participant,['state']);
  const mutate=async(body:Record<string,unknown>)=>{setBusy(true);setMessage('');try{await apiRequest('/api/beta',{method:'POST',body,idempotent:true});await load();}catch(e){setMessage(e instanceof Error?e.message:'操作できませんでした。');}finally{setBusy(false);}};
  const commitmentUntil=recordText(participant,['commitment_until']);
  return <OverlayShell title="βテスト" onClose={onClose}><div className="reward-stack">
    {!state ? <section><h3>Beta Lab</h3><p>新機能の実利用・技術Telemetry・月次アンケートでAsteraAPPを改善する継続プログラムです。</p><p>月次条件達成：<strong>{numeric(policy.monthly_credit||30000).toLocaleString()} Credit</strong> / 最低参加期間：<strong>{numeric(policy.minimum_commitment_days||90)}日</strong></p><button type="button" className="platform-button is-primary" disabled={busy} onClick={()=>void mutate({action:'join'})}>参加する</button></section> : <>
      <section><h3>参加状態</h3><p>{state}</p>{commitmentUntil && <p>最低参加期間：{new Date(commitmentUntil).toLocaleString()}</p>}<p>今月のBeta Credit：{numeric(policy.monthly_credit).toLocaleString()} Credit</p></section>
      <section><h3>今月の条件</h3><div className="reward-condition-list"><span>{numeric(resource?.usage_count)>0?'✓':'○'} Beta機能を利用</span><span>{participant.telemetry_enabled===1||participant.telemetry_enabled===true?'✓':'○'} Telemetry提供</span><span>{resource?.survey_submitted===true?'✓':'○'} 使用感アンケート・感想</span></div></section>
      <section><h3>Beta機能</h3>{features.length===0?<p>現在公開中のBeta機能はありません。</p>:features.map((feature)=><label className="reward-toggle-row" key={recordText(feature,['feature_id'])}><span><strong>{recordText(feature,['title'])}</strong><small>{recordText(feature,['version'])}</small></span><input type="checkbox" checked={feature.enabled===true} disabled={busy||feature.configurable===false} onChange={(event)=>void mutate({action:'feature',feature_id:recordText(feature,['feature_id']),enabled:event.target.checked})}/></label>)}</section>
      <section><h3>参加終了</h3><p className="reward-note">Telemetryを停止すると参加は即時終了し、再参加できません。通常終了も最低参加期間後のみ可能で、終了後は再参加できません。</p><div className="reward-actions"><button type="button" className="platform-button" disabled={busy} onClick={()=>void mutate({action:'stop_telemetry'})}>Telemetryを停止して終了</button><button type="button" className="platform-button" disabled={busy || (!!commitmentUntil && Date.now()<Date.parse(commitmentUntil))} onClick={()=>void mutate({action:'exit'})}>βテストを終了</button></div></section>
    </>}
    {message&&<p className="reward-message is-error">{message}</p>}
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
    ['coupon','クーポン','クーポンコードの確認・適用・利用履歴'],
    ['referral','友達紹介','紹介コード・紹介実績・紹介された方の登録'],
    ['beta','βテスト','Beta Lab参加・機能・月次条件・問題報告'],
  ] as const,[]);
  return <>{items.map(([kind,title,description])=><button key={kind} type="button" className="settings-surface-row reward-settings-row" onClick={()=>onOpen(kind)}><span className="settings-surface-row-copy"><strong>{title}</strong><small>{description}</small></span><span className="settings-surface-chevron" aria-hidden="true">›</span></button>)}</>;
}
