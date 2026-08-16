import type { RuntimeConfig } from './config.js';
import { constantTimeTokenEqual } from './config.js';
import { TgserverStorageError } from './tgserver-storage-client.js';
import { StorageObjectCryptoError } from './storage-object-crypto.js';
import { StorageApiError } from './storage-api-types.js';

export const correlationId=(h:Headers):string=>h.get('x-correlation-id')?.trim()||h.get('x-request-id')?.trim()||crypto.randomUUID();
export function responseError(error:unknown,requestId:string):Response{
  const e=error instanceof StorageApiError?error:error instanceof TgserverStorageError?new StorageApiError(error.status,error.code,error.code):error instanceof StorageObjectCryptoError?new StorageApiError(500,error.code,'Storage cryptographic operation failed.'):new StorageApiError(500,'ASTERA_STORAGE_FAILED','Astera Storage operation failed.');
  return Response.json({error:{code:e.code,message:e.message,correlation_id:requestId,retryable:e.status>=500}},{status:e.status,headers:{'Cache-Control':'no-store','X-Correlation-ID':requestId}});
}
export function internalAuthorized(h:Headers,c:RuntimeConfig):boolean{
  const a=h.get('authorization')||'',t=a.startsWith('Bearer ')?a.slice(7).trim():'';
  return Boolean(t&&constantTimeTokenEqual(t,c.internalServiceToken));
}
