import type { Pool } from 'pg';

export const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
export const INTEGRITY_ERROR_CODES = new Set([
  'STORAGE_GCM_AUTH_FAILED','STORAGE_SHA256_MISMATCH','STORAGE_PLAINTEXT_SIZE_MISMATCH',
  'STORAGE_WRAPPED_DEK_BINDING_MISMATCH','STORAGE_WRAPPED_DEK_INVALID','STORAGE_CONTENT_IV_INVALID','STORAGE_AUTH_TAG_INVALID',
]);
export type StorageActor = { userId: string; tenantId: string };
export type StorageObjectRow = {
  id:string; tenant_id:string; user_id:string; project_id:string|null; folder_id:string|null;
  topic_id:string|number|null; message_id:string|number|null; file_name:string; mime_type:string; file_size:string|number;
  checksum_sha256:string|null; checksum_verified_at:Date|null; encryption_profile:string|null;
  dek_wrap_ciphertext:string|null; dek_wrap_iv:string|null; content_iv_base64:string|null; auth_tag_base64:string|null; encrypted_at:Date|null;
  retention_policy:string|null; source_result_id:string|null; version:number; contract_capacity_bytes_snapshot:string|number;
  status:string; error_code:string|null; deleted_at:Date|null; restored_at:Date|null; primary_deleted_at:Date|null; created_at:Date; updated_at:Date;
};
export class StorageApiError extends Error {
  constructor(public readonly status:number, public readonly code:string, message:string){super(message);this.name='StorageApiError'}
}
export async function ownedObject(pool:Pool,actor:StorageActor,objectId:string):Promise<StorageObjectRow>{
  const result=await pool.query<StorageObjectRow>(`SELECT * FROM astera_storage_objects WHERE id=$1 AND tenant_id=$2 AND user_id=$3 LIMIT 1`,[objectId,actor.tenantId,actor.userId]);
  const row=result.rows[0];
  if(!row)throw new StorageApiError(404,'ASTERA_STORAGE_OBJECT_NOT_FOUND','Storage object not found.');
  return row;
}
