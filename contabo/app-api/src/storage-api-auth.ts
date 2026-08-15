import type { RuntimeConfig } from './config.js';
import { constantTimeTokenEqual } from './config.js';
import { TgserverStorageError } from './tgserver-storage-client.js';
import { StorageObjectCryptoError } from './storage-object-crypto.js';
import { StorageApiError, type StorageActor } from './storage-api-types.js';

const STATES = new Set(['active','save_suspended','grace_period','ending']);
export function actorFromHeaders(h:Headers):StorageActor{
  if(h.get('x-astera-internal-authenticated')!=='1')throw new StorageApiError(401,'TRUSTED_ACTOR_CONTEXT_REQUIRED','Trusted actor is required.');
  const userId=h.get('x-astera-user-id')?.trim()||'',tenantId=h.get('x-astera-tenant-id')?.trim()||'',status=h.get('x-astera-account-status')?.trim()||'';
  if(!userId||!tenantId||status!=='active')throw new StorageApiError(403,'TRUSTED_ACTOR_CONTEXT_INVALID','Actor is invalid.');
  return{userId,tenantId};
}
export const correlationId=(h:Headers):string=>h.get('x-correlation-id')?.trim()||h.get('x-request-id')?.trim()||crypto.randomUUID();
export function responseError(error:unknown,requestId:string):Response{
  const e=error instanceof StorageApiError?error:error instanceof TgserverStorageError?new StorageApiError(error.status,error.code,error.code):error instanceof StorageObjectCryptoError?new StorageApiError(500,error.code,'Storage cryptographic operation failed.'):new StorageApiError(500,'ASTERA_STORAGE_FAILED','Astera Storage operation failed.');
  return Response.json({error:{code:e.code,message:e.message,correlation_id:requestId,retryable:e.status>=500}},{status:e.status,headers:{'Cache-Control':'no-store','X-Correlation-ID':requestId}});
}
export function storageCapacity(h:Headers,write=false):number{
  if(h.get('x-astera-storage-entitled')!=='1')throw new StorageApiError(403,'ASTERA_STORAGE_ENTITLEMENT_REQUIRED','Astera Storage contract is required.');
  const n=Number(h.get('x-astera-storage-capacity-bytes')),state=h.get('x-astera-storage-state')?.trim()||'';
  if(!Number.isSafeInteger(n)||n<=0)throw new StorageApiError(403,'ASTERA_STORAGE_CAPACITY_REQUIRED','Astera Storage capacity is not active.');
  if(!STATES.has(state))throw new StorageApiError(403,'ASTERA_STORAGE_STATE_INVALID','Astera Storage state is invalid.');
  if(write&&(state!=='active'||h.get('x-astera-storage-write-allowed')!=='1'))throw new StorageApiError(409,'ASTERA_STORAGE_SAVE_SUSPENDED','Astera Storage is read-only for the current contract state.');
  return n;
}
export function internalAuthorized(h:Headers,c:RuntimeConfig):boolean{
  const a=h.get('authorization')||'',t=a.startsWith('Bearer ')?a.slice(7).trim():'';
  return Boolean(t&&constantTimeTokenEqual(t,c.internalServiceToken));
}
