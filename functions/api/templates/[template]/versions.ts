import { FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor, type AsteraFunctionEnv } from '../../../_account-projection';
import { listTemplateVersions, TemplateStoreError } from '../../../_template-store';
type C={request:Request;env:AsteraFunctionEnv;params:{template?:string}};
const norm=(error:unknown)=>error instanceof TemplateStoreError?new FunctionHttpError(error.status,error.code,error.message,error.details):error;
function templateId(c:C){const id=c.params.template?.trim();if(!id)throw new FunctionHttpError(400,'TEMPLATE_ID_REQUIRED','Template IDが必要です。');return id;}
export async function onRequestGet(c:C){const cid=requestCorrelationId(c.request);try{const a=await requireAsteraActor(c.request,c.env);return Response.json(await listTemplateVersions(c.env.ASTERA_DB,{userId:a.user.id,tenantId:a.profile.tenant_id},templateId(c)),{headers:{'Cache-Control':'no-store','X-Correlation-ID':cid}});}catch(error){return functionErrorResponse(norm(error),cid);}}
export function onRequest(c:C){return c.request.method==='GET'?onRequestGet(c):Promise.resolve(Response.json({error:{code:'METHOD_NOT_ALLOWED',message:'GETのみ対応しています。'}},{status:405}));}
