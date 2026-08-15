import type { D1Database } from './_account-projection';

export type StorageActor = { userId: string; tenantId: string };
export type StorageContract = { capacityBytes: number; writeAllowed: boolean; state: string };
export type StorageObjectRow = {
  id:string; tenant_id:string; user_id:string; project_id:string|null; folder_id:string|null;
  topic_id:string|null; message_id:string|null; file_name:string; mime_type:string; file_size:number;
  checksum_sha256:string|null; checksum_verified_at:string|null; encryption_profile:string|null;
  retention_policy:string|null; source_result_id:string|null; version:number;
  contract_capacity_bytes_snapshot:number; status:string; error_code:string|null;
  deleted_at:string|null; restored_at:string|null; primary_deleted_at:string|null;
  created_at:string; updated_at:string;
};
export class StorageStoreError extends Error {
  constructor(public status:number, public code:string, message:string, public details?:unknown){ super(message); this.name='StorageStoreError'; }
}
function payload(row:StorageObjectRow){return{
  id:row.id,object_id:row.id,project_id:row.project_id,folder_id:row.folder_id,file_name:row.file_name,
  mime_type:row.mime_type,file_size:Number(row.file_size),checksum_sha256:row.checksum_sha256,
  checksum_verified_at:row.checksum_verified_at,encryption_profile:row.encryption_profile,
  retention_policy:row.retention_policy,source_result_id:row.source_result_id,version:Number(row.version),
  status:row.status,error_code:row.error_code,deleted_at:row.deleted_at,restored_at:row.restored_at,
  primary_deleted_at:row.primary_deleted_at,created_at:row.created_at,updated_at:row.updated_at,
};}
async function owned(db:D1Database,actor:StorageActor,id:string):Promise<StorageObjectRow>{const row=await db.prepare(`SELECT id,tenant_id,user_id,project_id,folder_id,topic_id,message_id,file_name,mime_type,file_size,checksum_sha256,checksum_verified_at,encryption_profile,retention_policy,source_result_id,version,contract_capacity_bytes_snapshot,status,error_code,deleted_at,restored_at,primary_deleted_at,created_at,updated_at FROM astera_storage_objects WHERE id=?1 AND tenant_id=?2 AND user_id=?3 LIMIT 1`).bind(id,actor.tenantId,actor.userId).first<StorageObjectRow>();if(!row)throw new StorageStoreError(404,'ASTERA_STORAGE_OBJECT_NOT_FOUND','Storage objectが見つかりません。');return row;}
export async function usage(db:D1Database,actor:StorageActor,contract:StorageContract){const row=await db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='stored' THEN file_size ELSE 0 END),0) AS used,COALESCE(SUM(CASE WHEN status='pending' THEN file_size ELSE 0 END),0) AS reserved,COALESCE(SUM(CASE WHEN status IN ('soft_deleted','deleting') THEN file_size ELSE 0 END),0) AS pending_deletion FROM astera_storage_objects WHERE tenant_id=?1 AND user_id=?2`).bind(actor.tenantId,actor.userId).first<{used:number;reserved:number;pending_deletion:number}>();const used=Number(row?.used??0),reserved=Number(row?.reserved??0),pending=Number(row?.pending_deletion??0),occupied=used+reserved+pending;if(![used,reserved,pending,occupied].every(Number.isSafeInteger))throw new StorageStoreError(500,'ASTERA_STORAGE_USAGE_OVERFLOW','Storage usageを安全に表現できません。');return{capacity_bytes:contract.capacityBytes,used_bytes:used,reserved_bytes:reserved,pending_deletion_bytes:pending,remaining_bytes:Math.max(0,contract.capacityBytes-occupied),state:contract.state,write_allowed:contract.writeAllowed};}
export async function getObject(db:D1Database,actor:StorageActor,id:string){return{object:payload(await owned(db,actor,id))};}
export async function softDelete(db:D1Database,actor:StorageActor,id:string){const current=await owned(db,actor,id);if(current.status==='soft_deleted')return{object:payload(current),undo_available:true};if(!['stored','corrupt'].includes(current.status))throw new StorageStoreError(409,'ASTERA_STORAGE_OBJECT_NOT_DELETABLE','Storage objectは現在削除できません。');const now=new Date().toISOString();await db.prepare(`UPDATE astera_storage_objects SET status='soft_deleted',deleted_at=?1,updated_at=?1 WHERE id=?2 AND tenant_id=?3 AND user_id=?4 AND status IN ('stored','corrupt')`).bind(now,id,actor.tenantId,actor.userId).run();return{object:payload(await owned(db,actor,id)),undo_available:true};}
export async function undoDelete(db:D1Database,actor:StorageActor,id:string){const current=await owned(db,actor,id);if(current.status!=='soft_deleted')throw new StorageStoreError(404,'ASTERA_STORAGE_OBJECT_NOT_RESTORABLE','Storage objectは復元可能状態ではありません。');const now=new Date().toISOString(),next=current.error_code?'corrupt':'stored';await db.prepare(`UPDATE astera_storage_objects SET status=?1,deleted_at=NULL,restored_at=?2,updated_at=?2 WHERE id=?3 AND tenant_id=?4 AND user_id=?5 AND status='soft_deleted'`).bind(next,now,id,actor.tenantId,actor.userId).run();return{object:payload(await owned(db,actor,id))};}
