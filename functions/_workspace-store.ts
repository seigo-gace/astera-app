import type { D1Database } from './_account-projection';

export type WorkspaceActor = { userId: string; tenantId: string };
export class WorkspaceStoreError extends Error {
  constructor(public status:number, public code:string, message:string, public details?:unknown){ super(message); this.name='WorkspaceStoreError'; }
}
function record(value:unknown):Record<string,unknown>{ return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}; }
function text(value:unknown):string{ return typeof value==='string'?value.trim():''; }
function parseObject(value:string|undefined|null):Record<string,string|number|boolean|null>{
  if(!value)return{}; try{const p=JSON.parse(value);return p&&typeof p==='object'&&!Array.isArray(p)?p:{};}catch{return{};}
}
function scalarPatch(value:unknown):Record<string,string|number|boolean|null>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new WorkspaceStoreError(422,'PREFERENCE_BODY_INVALID','PreferenceはObjectで指定してください。');
  const entries=Object.entries(value as Record<string,unknown>); if(entries.length>100)throw new WorkspaceStoreError(422,'PREFERENCE_KEY_LIMIT_EXCEEDED','Preference項目数が上限を超えています。');
  const out:Record<string,string|number|boolean|null>={};
  for(const[key,item]of entries){
    if(!/^[a-zA-Z0-9_.-]{1,80}$/.test(key))throw new WorkspaceStoreError(422,'PREFERENCE_KEY_INVALID',`Preference Keyが不正です: ${key}`);
    if(typeof item==='string')out[key]=item.slice(0,2000); else if(typeof item==='number'&&Number.isFinite(item))out[key]=item; else if(typeof item==='boolean'||item===null)out[key]=item; else throw new WorkspaceStoreError(422,'PREFERENCE_VALUE_INVALID',`Preference ValueはScalarのみ対応します: ${key}`);
  }
  return out;
}
function escapeLike(value:string):string{return value.replace(/[\\%_]/g,(m)=>`\\${m}`);}

export async function listProjects(db:D1Database,actor:WorkspaceActor):Promise<Record<string,unknown>>{
  const rows=(await db.prepare(`SELECT p.id,p.name,p.description,p.owner_user_id,pm.role,
    COUNT(r.id) AS result_count,p.updated_at,p.created_at
    FROM projects p JOIN project_members pm ON pm.project_id=p.id AND pm.tenant_id=p.tenant_id AND pm.user_id=?2
    LEFT JOIN results r ON r.project_id=p.id AND r.tenant_id=p.tenant_id AND r.deleted_at IS NULL
    WHERE p.tenant_id=?1 AND p.archived_at IS NULL
    GROUP BY p.id,p.name,p.description,p.owner_user_id,pm.role,p.updated_at,p.created_at
    ORDER BY p.updated_at DESC`).bind(actor.tenantId,actor.userId).all<Record<string,unknown>>()).results??[];
  return {projects:rows.map((row)=>({id:String(row.id),project_id:String(row.id),name:String(row.name),description:String(row.description??''),owner_user_id:String(row.owner_user_id),role:String(row.role),result_count:Number(row.result_count??0),file_count:0,created_at:String(row.created_at),updated_at:String(row.updated_at)}))};
}

export async function createProject(db:D1Database,actor:WorkspaceActor,value:unknown):Promise<Record<string,unknown>>{
  const body=record(value),name=text(body.name),description=text(body.description);
  if(!name||[...name].length>120)throw new WorkspaceStoreError(422,'PROJECT_NAME_INVALID','Project名は1〜120文字です。');
  if([...description].length>2000)throw new WorkspaceStoreError(422,'PROJECT_DESCRIPTION_TOO_LONG','Project説明は2,000文字以内です。');
  const existing=await db.prepare(`SELECT id FROM projects WHERE tenant_id=?1 AND name=?2 LIMIT 1`).bind(actor.tenantId,name).first<{id:string}>();
  if(existing)throw new WorkspaceStoreError(409,'PROJECT_NAME_CONFLICT','同じProject名が存在します。');
  const id=crypto.randomUUID(),now=new Date().toISOString();
  try{await db.batch([
    db.prepare(`INSERT INTO projects(id,tenant_id,name,description,owner_user_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)`).bind(id,actor.tenantId,name,description,actor.userId,now),
    db.prepare(`INSERT INTO project_members(project_id,tenant_id,user_id,role,created_at) VALUES(?1,?2,?3,'owner',?4)`).bind(id,actor.tenantId,actor.userId,now),
  ]);}catch(error){const msg=error instanceof Error?error.message:String(error);if(/UNIQUE|constraint/i.test(msg))throw new WorkspaceStoreError(409,'PROJECT_NAME_CONFLICT','同じProject名が存在します。');throw error;}
  return {project:{id,project_id:id,name,description,owner_user_id:actor.userId,role:'owner',result_count:0,file_count:0,created_at:now,updated_at:now}};
}

export async function listHistory(db:D1Database,actor:WorkspaceActor,q='',limit=50):Promise<Record<string,unknown>>{
  const safeLimit=Math.min(100,Math.max(1,Number.isInteger(limit)?limit:50));
  const query=q.trim().slice(0,200); const pattern=`%${escapeLike(query)}%`;
  const rows=(await db.prepare(`SELECT DISTINCT r.id,r.job_id,r.project_id,r.title,r.purpose,r.completion_state,r.current_revision,r.created_at,r.updated_at
    FROM results r
    LEFT JOIN project_members pm ON pm.project_id=r.project_id AND pm.tenant_id=r.tenant_id AND pm.user_id=?2
    WHERE r.tenant_id=?1 AND r.deleted_at IS NULL
      AND ((r.project_id IS NULL AND r.created_by_user_id=?2) OR (r.project_id IS NOT NULL AND pm.user_id IS NOT NULL))
      AND (?3='' OR r.title LIKE ?4 ESCAPE '\\' OR COALESCE(r.purpose,'') LIKE ?4 ESCAPE '\\' OR EXISTS(
        SELECT 1 FROM result_revisions rr JOIN result_sections rs ON rs.revision_id=rr.id
        WHERE rr.result_id=r.id AND rr.revision_number=r.current_revision AND rs.content LIKE ?4 ESCAPE '\\'))
    ORDER BY r.created_at DESC LIMIT ?5`).bind(actor.tenantId,actor.userId,query,pattern,safeLimit).all<Record<string,unknown>>()).results??[];
  return {history:rows.map((row)=>({id:String(row.id),result_id:String(row.id),job_id:String(row.job_id),project_id:row.project_id?String(row.project_id):null,title:String(row.title),purpose:row.purpose?String(row.purpose):null,status:String(row.completion_state),completion_state:String(row.completion_state),current_revision:Number(row.current_revision),created_at:String(row.created_at),updated_at:String(row.updated_at)}))};
}

export async function getPreferences(db:D1Database,actor:WorkspaceActor,namespace='general'):Promise<Record<string,unknown>>{
  const row=await db.prepare(`SELECT values_json,version,updated_at FROM user_preferences WHERE tenant_id=?1 AND user_id=?2 AND namespace=?3 LIMIT 1`).bind(actor.tenantId,actor.userId,namespace).first<{values_json:string;version:number;updated_at:string}>();
  return {preferences:parseObject(row?.values_json),namespace,version:Number(row?.version??0),updated_at:row?.updated_at??null};
}
export async function patchPreferences(db:D1Database,actor:WorkspaceActor,value:unknown,namespace='general'):Promise<Record<string,unknown>>{
  const patch=scalarPatch(value),current=await getPreferences(db,actor,namespace),currentValues=record(current.preferences) as Record<string,string|number|boolean|null>,currentVersion=Number(current.version??0),nextValues={...currentValues,...patch},now=new Date().toISOString(),nextVersion=currentVersion+1;
  if(currentVersion===0){
    try{await db.prepare(`INSERT INTO user_preferences(tenant_id,user_id,namespace,values_json,version,created_at,updated_at) VALUES(?1,?2,?3,?4,1,?5,?5)`).bind(actor.tenantId,actor.userId,namespace,JSON.stringify(nextValues),now).run();}
    catch(error){const msg=error instanceof Error?error.message:String(error);if(!/UNIQUE|constraint/i.test(msg))throw error;}
  }else{
    await db.prepare(`UPDATE user_preferences SET values_json=?1,version=?2,updated_at=?3 WHERE tenant_id=?4 AND user_id=?5 AND namespace=?6 AND version=?7`).bind(JSON.stringify(nextValues),nextVersion,now,actor.tenantId,actor.userId,namespace,currentVersion).run();
  }
  const saved=await getPreferences(db,actor,namespace);
  if(Number(saved.version)!==nextVersion)throw new WorkspaceStoreError(409,'PREFERENCE_VERSION_CONFLICT','Preferenceが別端末で更新されています。再取得してください。',{current_version:saved.version});
  return saved;
}

export async function listTemplates(db:D1Database,actor:WorkspaceActor):Promise<Record<string,unknown>>{
  const rows=(await db.prepare(`SELECT id,title,content,version,created_at,updated_at FROM personal_templates WHERE tenant_id=?1 AND user_id=?2 AND archived_at IS NULL ORDER BY updated_at DESC`).bind(actor.tenantId,actor.userId).all<Record<string,unknown>>()).results??[];
  return {templates:rows.map((row)=>({id:String(row.id),title:String(row.title),content:String(row.content),version:Number(row.version),created_at:String(row.created_at),updated_at:String(row.updated_at)}))};
}
export async function createTemplate(db:D1Database,actor:WorkspaceActor,value:unknown):Promise<Record<string,unknown>>{
  const body=record(value),title=text(body.title??body.name),content=text(body.content??body.body);
  if(!title||[...title].length>120)throw new WorkspaceStoreError(422,'TEMPLATE_TITLE_INVALID','Template名は1〜120文字です。');
  if(!content||[...content].length>200000)throw new WorkspaceStoreError(422,'TEMPLATE_CONTENT_INVALID','Template本文は1〜200,000文字です。');
  const id=crypto.randomUUID(),now=new Date().toISOString();
  await db.prepare(`INSERT INTO personal_templates(id,tenant_id,user_id,title,content,version,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)`).bind(id,actor.tenantId,actor.userId,title,content,now).run();
  return {template:{id,title,content,version:1,created_at:now,updated_at:now}};
}
