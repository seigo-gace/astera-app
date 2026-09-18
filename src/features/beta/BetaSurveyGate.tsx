import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { apiRequest, asRecord, recordText } from '../../platform/api-client';
import './beta-survey-gate.css';

type GateState = { checking: boolean; required: boolean; targetMonth: string };
type ScaleValue = 1|2|3|4|5;

const SCALE_QUESTIONS = [
  ['q1_usability','全体的な使いやすさ'],
  ['q2_clarity','操作の分かりやすさ'],
  ['q3_layout','表示・レイアウトの見やすさ'],
  ['q4_speed','処理速度の体感'],
] as const;

export default function BetaSurveyGate({ children }: { children: ReactNode }) {
  const [gate,setGate]=useState<GateState>({checking:true,required:false,targetMonth:''});
  const [answers,setAnswers]=useState<Record<string,unknown>>({});
  const [improvement,setImprovement]=useState('');
  const [feedback,setFeedback]=useState('');
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    apiRequest('/api/beta').then((payload)=>{
      if(!active)return;
      const beta=asRecord(asRecord(payload).beta??payload);
      setGate({checking:false,required:beta.survey_required===true,targetMonth:recordText(beta,['target_month'])});
    }).catch(()=>{ if(active)setGate({checking:false,required:false,targetMonth:''}); });
    return()=>{active=false;};
  },[]);

  useEffect(()=>{
    if(!gate.required)return;
    const onKey=(event:KeyboardEvent)=>{ if(event.key==='Escape'){event.preventDefault();event.stopPropagation();} };
    const onPop=()=>{ history.pushState(null,'',location.href); };
    history.pushState(null,'',location.href);
    window.addEventListener('keydown',onKey,true);
    window.addEventListener('popstate',onPop);
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{window.removeEventListener('keydown',onKey,true);window.removeEventListener('popstate',onPop);document.body.style.overflow=previous;};
  },[gate.required]);

  const valid=useMemo(()=>{
    const scales=SCALE_QUESTIONS.every(([key])=>Number(answers[key])>=1&&Number(answers[key])<=5);
    const binaries=['q5_layout_issue','q6_usability_issue','q7_bug'].every((key)=>answers[key]==='yes'||answers[key]==='no');
    const q8=answers.q8_continue==='yes'||answers.q8_continue==='no';
    const detailsOk=['q5_layout_issue','q6_usability_issue','q7_bug'].every((key)=>answers[key]!=='yes'||String(answers[`${key}_detail`]??'').trim().length>0);
    return scales&&binaries&&q8&&detailsOk&&improvement.trim().length>0&&feedback.trim().length>0;
  },[answers,improvement,feedback]);

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    if(!valid||working)return;
    setWorking(true);setError('');
    try{
      await apiRequest('/api/beta/survey',{method:'POST',body:{target_month:gate.targetMonth,answers,improvement_text:improvement,feedback_text:feedback},idempotent:true});
      setGate((current)=>({...current,required:false}));
    }catch(e){setError(e instanceof Error?e.message:'送信できませんでした。入力内容は保持されています。再度送信してください。');}
    finally{setWorking(false);}
  };

  return <>{children}{gate.required&&<div className="beta-survey-gate" role="presentation"><section className="beta-survey-panel" role="dialog" aria-modal="true" aria-labelledby="beta-survey-title"><header><p>Beta Lab / {gate.targetMonth}</p><h2 id="beta-survey-title">月次使用感アンケート</h2><span>送信が完了するまで通常画面へ戻れません。</span></header><form onSubmit={(event)=>void submit(event)}>
    {SCALE_QUESTIONS.map(([key,label])=><fieldset key={key}><legend>{label}</legend><div className="beta-scale">{([1,2,3,4,5] as ScaleValue[]).map((value)=><label key={value}><input type="radio" name={key} checked={answers[key]===value} onChange={()=>setAnswers((a)=>({...a,[key]:value}))}/><span>{value}</span></label>)}</div></fieldset>)}
    {[['q5_layout_issue','表示崩れ・見切れ・重なり等がありましたか'],['q6_usability_issue','操作しにくい・分かりにくい箇所がありましたか'],['q7_bug','不具合・異常挙動を体験しましたか']] .map(([key,label])=><fieldset key={key}><legend>{label}</legend><div className="beta-binary"><label><input type="radio" checked={answers[key]==='no'} onChange={()=>setAnswers((a)=>({...a,[key]:'no'}))}/>なし</label><label><input type="radio" checked={answers[key]==='yes'} onChange={()=>setAnswers((a)=>({...a,[key]:'yes'}))}/>あり</label></div>{answers[key]==='yes'&&<textarea value={String(answers[`${key}_detail`]??'')} onChange={(e)=>setAnswers((a)=>({...a,[`${key}_detail`]:e.target.value}))} placeholder="該当箇所を簡潔に入力" required/>}</fieldset>)}
    <fieldset><legend>正式版でも継続して使いたいβ機能がありますか</legend><div className="beta-binary"><label><input type="radio" checked={answers.q8_continue==='no'} onChange={()=>setAnswers((a)=>({...a,q8_continue:'no'}))}/>なし</label><label><input type="radio" checked={answers.q8_continue==='yes'} onChange={()=>setAnswers((a)=>({...a,q8_continue:'yes'}))}/>あり</label></div>{answers.q8_continue==='yes'&&<input type="text" value={String(answers.q8_features??'')} onChange={(e)=>setAnswers((a)=>({...a,q8_features:e.target.value}))} placeholder="機能名を入力"/>}</fieldset>
    <label className="beta-text"><span>改善してほしい点</span><textarea value={improvement} onChange={(e)=>setImprovement(e.target.value)} required maxLength={4000}/></label>
    <label className="beta-text"><span>今月使用した感想</span><textarea value={feedback} onChange={(e)=>setFeedback(e.target.value)} required maxLength={8000}/></label>
    {error&&<p className="beta-survey-error" role="alert">{error}</p>}
    <div className="beta-survey-submit"><button type="submit" className="platform-button is-primary" disabled={!valid||working}>{working?'送信中…':'送信する'}</button></div>
  </form></section></div>}</>;
}
