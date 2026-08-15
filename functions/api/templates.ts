import { FunctionHttpError,functionErrorResponse,requestCorrelationId,requireAsteraActor,type AsteraFunctionEnv } from '../_account-projection';
import { createTemplate,listTemplates,WorkspaceStoreError } from '../_workspace-store';
type C={request:Request;env:AsteraFunctionEnv}; const norm=(e:unknown)=>e instanceof WorkspaceStoreError?new FunctionHttpError(e.status,e.code,e.message,e.details):e;
async function actor(c:C){const a=await requireAsteraActor(c.request,c.env);return{userId:a.user.id,tenantId:a.profile.tenant_id};}
export async function onRequestGet(c:C){const id=requestCorrelationId(c.request);try{return Response.json(await listTemplates(c.env.ASTERA_DB,await actor(c)),{headers:{'Cache-Control':'no-store','X-Correlation-ID':id}});}catch(e){return functionErrorResponse(norm(e),id);}}
export async function onRequestPost(c:C){const id=requestCorrelationId(c.request);try{return Response.json(await createTemplate(c.env.ASTERA_DB,await actor(c),await c.request.json().catch(()=>null)),{status:201,headers:{'Cache-Control':'no-store','X-Correlation-ID':id}});}catch(e){return functionErrorResponse(norm(e),id);}}
export function onRequest(c:C){if(c.request.method==='GET')return onRequestGet(c);if(c.request.method==='POST')return onRequestPost(c);return Promise.resolve(Response.json({error:{code:'METHOD_NOT_ALLOWED',message:'GET/POSTのみ対応しています。'}},{status:405}));}
