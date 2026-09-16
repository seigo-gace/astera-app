import { FunctionHttpError, type D1Database } from './_account-projection';
import { loadStorageCommerceProjection } from './_storage-commerce';

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
  purchasedCapacityGb: number;
  planMaxCapacityGb: number;
  overPlanLimit: boolean;
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
const ALLOWED_STATES = new Set<StorageContractState>(['active', 'save_suspended', 'grace_period', 'ending']);

function capacityBytes(capacityGb: number): number {
  if (!Number.isSafeInteger(capacityGb) || capacityGb < 0) {
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
    const [legacy, commerce] = await Promise.all([
      db.prepare(
        `SELECT capacity_gb, state, catalog_version, next_charge_at, grace_ends_at, deletion_scheduled_at
         FROM astera_storage_contracts
         WHERE tenant_id = ?1
         LIMIT 1`,
      ).bind(tenantId).first<StorageContractRow>(),
      loadStorageCommerceProjection(db, tenantId),
    ]);

    if (legacy && !ALLOWED_STATES.has(legacy.state)) {
      throw new FunctionHttpError(503, 'ASTERA_STORAGE_CONTRACT_INVALID', 'Astera Storage契約状態が不正です。');
    }

    const totalCapacityGb = commerce.currentCapacityGb;
    const planMaxCapacityGb = commerce.planMaxCapacityGb;
    const overPlanLimit = totalCapacityGb > planMaxCapacityGb;
    const entitled = totalCapacityGb > 0 && planMaxCapacityGb > 0;
    const effectiveCapacityGb = entitled ? Math.min(totalCapacityGb, planMaxCapacityGb) : 0;
    const legacyState = legacy?.state ?? 'active';
    const state: StorageContractState | 'inactive' = !entitled
      ? 'inactive'
      : overPlanLimit
        ? 'save_suspended'
        : legacyState;
    const writeAllowed = entitled && !overPlanLimit && state === 'active';

    return {
      entitled,
      capacityGb: entitled ? effectiveCapacityGb : null,
      capacityBytes: capacityBytes(effectiveCapacityGb),
      state,
      writeAllowed,
      catalogVersion: commerce.catalogVersion,
      nextChargeAt: legacy?.next_charge_at ?? null,
      graceEndsAt: legacy?.grace_ends_at ?? null,
      deletionScheduledAt: legacy?.deletion_scheduled_at ?? null,
      purchasedCapacityGb: totalCapacityGb,
      planMaxCapacityGb,
      overPlanLimit,
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
