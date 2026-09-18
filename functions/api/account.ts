import { createAuth } from '../_auth';
import type { CreditRow, D1Database, SessionPayload, SessionUser, UserProfileRow } from '../_account-projection';
import { applyDueCouponSchedules } from '../_coupon-reward-schedules';
import type { CouponProgramEnv } from '../_coupon-program';

type Env = CouponProgramEnv;
type PagesContext = { request: Request; env: Env };

function correlationId(request: Request): string { return request.headers.get('X-Request-ID')?.trim() || crypto.randomUUID(); }
function errorResponse(status:number,code:string,message:string,requestId:string,details?:unknown):Response{return Response.json({error:{code,message,correlation_id:requestId,retryable:status>=500,details}},{status,headers:{'Cache-Control':'no-store','X-Correlation-ID':requestId}});}
const PROTECTED_ACCOUNT_STATUSES=new Set(['security_hold','suspended','deletion_scheduled','deleted']);
async function hasPasswordCredential(db:D1Database,userId:string):Promise<boolean>{const credential=await db.prepare('SELECT id FROM "account" WHERE "userId"=?1 AND "providerId"=?2 AND password IS NOT NULL AND length(password)>0 LIMIT 1').bind(userId,'credential').first<{id:string}>();return Boolean(credential?.id);}
function accountStatus(user:SessionUser,existing:UserProfileRow|null,passwordConfigured:boolean):string{if(existing&&PROTECTED_ACCOUNT_STATUSES.has(existing.account_status))return existing.account_status;if(existing?.account_status==='active')return 'active';if(user.emailVerified===false)return 'pending_email_verification';return passwordConfigured?'active':'pending_password_setup';}
async function ensureAsteraAccount(db:D1Database,user:SessionUser):Promise<{profile:UserProfileRow;credit:CreditRow}>{
  const now=new Date().toISOString();const tenantId=`personal:${user.id}`;const creditId=`credit:${tenantId}`;
  const existingProfile=await db.prepare(`SELECT user_id,tenant_id,nickname,account_status,ui_language,created_at,updated_at FROM user_profiles WHERE user_id=?1 LIMIT 1`).bind(user.id).first<UserProfileRow>();
  const passwordConfigured=await hasPasswordCredential(db,user.id);const desiredStatus=accountStatus(user,existingProfile,passwordConfigured);const nickname=user.name?.trim()||user.email.split('@')[0]||'Astera User';
  await db.batch([
    db.prepare(`INSERT INTO tenants (id,kind,display_name,created_at,updated_at) VALUES (?1,'personal',?2,?3,?3) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at`).bind(tenantId,nickname,now),
    db.prepare(`INSERT INTO user_profiles (user_id,tenant_id,nickname,account_status,ui_language,created_at,updated_at) VALUES (?1,?2,?3,?4,'ja-JP',?5,?5) ON CONFLICT(user_id) DO UPDATE SET tenant_id=excluded.tenant_id,nickname=CASE WHEN user_profiles.nickname='' THEN excluded.nickname ELSE user_profiles.nickname END,account_status=excluded.account_status,updated_at=excluded.updated_at`).bind(user.id,tenantId,nickname,desiredStatus,now),
    db.prepare(`INSERT INTO credit_accounts (id,tenant_id,available_balance,reserved_balance,version,updated_at) VALUES (?1,?2,0,0,0,?3) ON CONFLICT(tenant_id) DO NOTHING`).bind(creditId,tenantId,now),
  ]);
  const profile=await db.prepare(`SELECT user_id,tenant_id,nickname,account_status,ui_language,created_at,updated_at FROM user_profiles WHERE user_id=?1 LIMIT 1`).bind(user.id).first<UserProfileRow>();
  const credit=await db.prepare(`SELECT id,tenant_id,available_balance,reserved_balance,version,updated_at FROM credit_accounts WHERE tenant_id=?1 LIMIT 1`).bind(tenantId).first<CreditRow>();
  if(!profile||!credit)throw new Error('ASTERA_ACCOUNT_PROJECTION_FAILED');return{profile,credit};
}
async function refreshedCredit(db:D1Database,tenantId:string):Promise<CreditRow>{const credit=await db.prepare(`SELECT id,tenant_id,available_balance,reserved_balance,version,updated_at FROM credit_accounts WHERE tenant_id=?1 LIMIT 1`).bind(tenantId).first<CreditRow>();if(!credit)throw new Error('ASTERA_ACCOUNT_PROJECTION_FAILED');return credit;}

export async function onRequestGet(context:PagesContext):Promise<Response>{
  const requestId=correlationId(context.request);
  try{
    const auth=createAuth(context.env);const session=await auth.api.getSession({headers:context.request.headers}) as SessionPayload|null;const user=session?.user;
    if(!user?.id||!user.email)return errorResponse(401,'SESSION_REQUIRED','Loginが必要です。',requestId);
    const {profile,credit:initialCredit}=await ensureAsteraAccount(context.env.ASTERA_DB,user);let credit=initialCredit;
    if(profile.account_status==='active'){
      await applyDueCouponSchedules(context.env,{user,session:session?.session,profile,credit:initialCredit});
      credit=await refreshedCredit(context.env.ASTERA_DB,profile.tenant_id);
    }
    return Response.json({account:{user_id:user.id,tenant_id:profile.tenant_id,email:user.email,email_verified:user.emailVerified!==false,nickname:profile.nickname,display_name:profile.nickname,account_status:profile.account_status,auth_stage:profile.account_status==='active'?'authenticated':profile.account_status,requires_password_setup:profile.account_status==='pending_password_setup',ui_language:profile.ui_language,image:user.image??null,two_factor_enabled:user.twoFactorEnabled===true,session_id:session?.session?.id??null,session_expires_at:session?.session?.expiresAt??null,credit:{available:Number(credit.available_balance),reserved:Number(credit.reserved_balance),version:Number(credit.version),updated_at:credit.updated_at}}},{headers:{'Cache-Control':'no-store','X-Correlation-ID':requestId}});
  }catch(error){const message=error instanceof Error?error.message:String(error);const migrationMissing=/no such table|D1_ERROR|ASTERA_ACCOUNT_PROJECTION_FAILED/i.test(message);return errorResponse(migrationMissing?503:500,migrationMissing?'ASTERA_ACCOUNT_SCHEMA_NOT_READY':'ACCOUNT_SESSION_PROJECTION_FAILED',migrationMissing?'認証・Account・Credit用D1 Migrationが適用されていません。':'Account状態を取得できませんでした。',requestId,message);}
}
export function onRequest(context:PagesContext):Promise<Response>{if(context.request.method!=='GET'){const requestId=correlationId(context.request);return Promise.resolve(errorResponse(405,'METHOD_NOT_ALLOWED','このRouteはGETのみ対応しています。',requestId));}return onRequestGet(context);}
