import { FunctionHttpError, type D1Database } from './_account-projection';

export type StorageContractState = 'active' | 'save_suspended' | 'grace_period' | 'ending';

export type StorageContractProjection = {
  entitled: boolean;
  capacityGb: number | null;
  capacityBytes: number;
  state: StorageContractState | 'inactive';
  writeAllowed: boolean;
  catalogVersion: string | null;
  nextChargeAt: string | null;
  graceEndsAt: string | null;
  deletionScheduledAt: string | null;
};

type StorageContractRow = {
  capacity_gb: number;
  state: StorageContractState;
  catalog_version: string;
  next_charge_at: string | null;
  grace_ends_at: string | null;
  deletion_scheduled_at: string | null;
};

const BYTES_PER_GIB = 1024 ** 3;
const ALLOWED_CAPACITIES = new Set([1, 10, 50, 100, 500, 1000]);
const ALLOWED_STATES = new Set<StorageContractState>(['active', 'save_suspended', 'grace_period', 'ending']);

function capacityBytes(capacityGb: number): number {
  if (!Number.isSafeInteger(capacityGb) || !ALLOWED_CAPACITIES.has(capacityGb)) {
    throw new FunctionHttpError(503, 'ASTERA_STORAGE_CONTRACT_INVALID', 'Astera Storage契約容量が不正です。');
  }
  const bytes = capacityGb * BYTES_PER_GIB;
  if (!Number.isSafeInteger(bytes)) {
    throw new FunctionHttpError(503, 'ASTERA_STORAGE_CONTRACT_INVALID', 'Astera Storage契約容量を安全に計算できません。');
  }
  return bytes;
}

export async function loadStorageContractProjection(db: D1Database, tenantId: string): Promise<StorageContractProjection> {
  try {
    const row = await db.prepare(
      `SELECT capacity_gb, state, catalog_version, next_charge_at, grace_ends_at, deletion_scheduled_at
       FROM astera_storage_contracts
       WHERE tenant_id = ?1
       LIMIT 1`,
    ).bind(tenantId).first<StorageContractRow>();

    if (!row) {
      return {
        entitled: false,
        capacityGb: null,
        capacityBytes: 0,
        state: 'inactive',
        writeAllowed: false,
        catalogVersion: null,
        nextChargeAt: null,
        graceEndsAt: null,
        deletionScheduledAt: null,
      };
    }
    if (!ALLOWED_STATES.has(row.state)) {
      throw new FunctionHttpError(503, 'ASTERA_STORAGE_CONTRACT_INVALID', 'Astera Storage契約状態が不正です。');
    }

    return {
      entitled: true,
      capacityGb: Number(row.capacity_gb),
      capacityBytes: capacityBytes(Number(row.capacity_gb)),
      state: row.state,
      writeAllowed: row.state === 'active',
      catalogVersion: row.catalog_version,
      nextChargeAt: row.next_charge_at,
      graceEndsAt: row.grace_ends_at,
      deletionScheduledAt: row.deletion_scheduled_at,
    };
  } catch (error) {
    if (error instanceof FunctionHttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|D1_ERROR/i.test(message)) {
      throw new FunctionHttpError(503, 'ASTERA_STORAGE_SCHEMA_NOT_READY', 'Astera Storage契約用D1 Migrationが適用されていません。', message);
    }
    throw new FunctionHttpError(500, 'ASTERA_STORAGE_CONTRACT_READ_FAILED', 'Astera Storage契約状態を取得できませんでした。', message);
  }
}
