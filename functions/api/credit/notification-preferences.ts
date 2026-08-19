import { FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor, type AsteraFunctionEnv } from '../../_account-projection';

const EVENTS = [
  'credit.low',
  'credit.critical',
  'credit.insufficient',
  'credit.purchase_pending',
  'credit.credited',
  'credit.resume_available',
  'credit.resume_blocked',
] as const;
type CreditEvent = (typeof EVENTS)[number];
type Context = { request: Request; env: AsteraFunctionEnv };
type PrefRow = { email_enabled:number; push_enabled:number; warning_policy_version:string; quiet_hours_json:string|null; events_json:string|null; updated_at:string };
type PolicyRow = { version:string; low_threshold:number; critical_threshold:number };

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function bool(value: unknown, name: string): boolean { if (typeof value !== 'boolean') throw new FunctionHttpError(422, 'NOTIFICATION_PREFERENCE_INVALID', `${name}はbooleanで指定してください。`); return value; }
function time(value: unknown): string { if (value === undefined || value === null || value === '') return ''; if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new FunctionHttpError(422, 'QUIET_HOURS_INVALID', 'Quiet HoursはHH:MMで指定してください。'); return value; }
function eventList(value: unknown): CreditEvent[] {
  if (!Array.isArray(value)) throw new FunctionHttpError(422, 'NOTIFICATION_EVENTS_INVALID', '通知Eventは配列で指定してください。');
  const items = value.filter((item): item is string => typeof item === 'string');
  if (items.length !== value.length || items.some((item) => !EVENTS.includes(item as CreditEvent))) throw new FunctionHttpError(422, 'NOTIFICATION_EVENTS_INVALID', '未対応のCredit通知Eventが含まれています。');
  return [...new Set(items)] as CreditEvent[];
}
function parseObject(value: string | null): Record<string, unknown> { if (!value) return {}; try { const parsed=JSON.parse(value); return record(parsed); } catch { return {}; } }
function parseEvents(value: string | null): CreditEvent[] { if (!value) return [...EVENTS]; try { const parsed=JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is CreditEvent => typeof item === 'string' && EVENTS.includes(item as CreditEvent)) : [...EVENTS]; } catch { return [...EVENTS]; } }

async function activePolicy(context: Context): Promise<PolicyRow> {
  const row = await context.env.ASTERA_DB.prepare(`SELECT version, low_threshold, critical_threshold FROM credit_policies WHERE status = 'active' LIMIT 1`).first<PolicyRow>();
  if (!row) throw new FunctionHttpError(503, 'ACTIVE_CREDIT_POLICY_NOT_PUBLISHED', 'Active Credit Policyが公開されていません。');
  return row;
}

export async function onRequestGet(context: Context): Promise<Response> {
  const requestId=requestCorrelationId(context.request);
  try {
    const actor=await requireAsteraActor(context.request,context.env);
    const [row, policy]=await Promise.all([
      context.env.ASTERA_DB.prepare(`SELECT email_enabled, push_enabled, warning_policy_version, quiet_hours_json, events_json, updated_at FROM credit_notification_preferences WHERE tenant_id = ?1 LIMIT 1`).bind(actor.profile.tenant_id).first<PrefRow>(),
      activePolicy(context),
    ]);
    const quiet=parseObject(row?.quiet_hours_json ?? null);
    return Response.json({ preferences:{ in_app_enabled:true, email_enabled:Boolean(row?.email_enabled), push_enabled:Boolean(row?.push_enabled), warning_policy_version:row?.warning_policy_version || policy.version, events:parseEvents(row?.events_json ?? null), quiet_hours_start:typeof quiet.start==='string'?quiet.start:'', quiet_hours_end:typeof quiet.end==='string'?quiet.end:'' }, policy:{ version:policy.version, low_threshold:Number(policy.low_threshold), critical_threshold:Number(policy.critical_threshold) }, supported_events:EVENTS, updated_at:row?.updated_at ?? null },{headers:{'Cache-Control':'no-store','X-Correlation-ID':requestId}});
  } catch(error){ return functionErrorResponse(error,requestId); }
}

export async function onRequestPatch(context: Context): Promise<Response> {
  const requestId=requestCorrelationId(context.request);
  try {
    const actor=await requireAsteraActor(context.request,context.env);
    const source=record(await context.request.json().catch(()=>null));
    if (source.in_app_enabled === false) throw new FunctionHttpError(422, 'IN_APP_NOTIFICATION_REQUIRED', 'App内安全通知は無効化できません。');
    const email=bool(source.email_enabled,'email_enabled');
    const push=bool(source.push_enabled,'push_enabled');
    const events=eventList(source.events);
    const start=time(source.quiet_hours_start); const end=time(source.quiet_hours_end);
    if (Boolean(start)!==Boolean(end)) throw new FunctionHttpError(422,'QUIET_HOURS_INCOMPLETE','Quiet Hoursは開始と終了を両方指定してください。');
    const policy=await activePolicy(context);
    const requested=typeof source.warning_policy_version==='string'?source.warning_policy_version.trim():'';
    if (requested && requested!==policy.version) throw new FunctionHttpError(409,'CREDIT_POLICY_CHANGED','Credit警告Policyが更新されています。再取得してください。',{active_policy_version:policy.version});
    const now=new Date().toISOString();
    const quiet= start ? JSON.stringify({start,end,applies_to:['credit.low','credit.critical']}) : null;
    await context.env.ASTERA_DB.prepare(`INSERT INTO credit_notification_preferences (tenant_id, app_enabled, email_enabled, push_enabled, warning_policy_version, quiet_hours_json, events_json, updated_at) VALUES (?1,1,?2,?3,?4,?5,?6,?7) ON CONFLICT(tenant_id) DO UPDATE SET app_enabled=1,email_enabled=excluded.email_enabled,push_enabled=excluded.push_enabled,warning_policy_version=excluded.warning_policy_version,quiet_hours_json=excluded.quiet_hours_json,events_json=excluded.events_json,updated_at=excluded.updated_at`).bind(actor.profile.tenant_id,email?1:0,push?1:0,policy.version,quiet,JSON.stringify(events),now).run();
    return onRequestGet(context);
  } catch(error){ return functionErrorResponse(error,requestId); }
}

export function onRequest(context: Context): Promise<Response> { if(context.request.method==='GET') return onRequestGet(context); if(context.request.method==='PATCH') return onRequestPatch(context); return Promise.resolve(Response.json({error:{code:'METHOD_NOT_ALLOWED',message:'GET/PATCHのみ対応しています。'}},{status:405})); }
