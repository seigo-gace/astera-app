function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordText(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

export type StoragePack = {
  productId: string;
  displayName: string;
  capacityGb: number;
  priceJpy: number;
  canPurchase: boolean;
};

export type StorageProjection = {
  planId: string;
  planMaxCapacityGb: number;
  currentCapacityGb: number;
  remainingPurchaseCapacityGb: number;
  usedBytes: number;
  remainingBytes: number;
  state: string;
  writeAllowed: boolean;
  overPlanLimit: boolean;
  packs: StoragePack[];
};

function requireNumber(record: Record<string, unknown>, keys: string[], label: string): number {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    throw new Error(`Storage projection field ${label} must be a number`);
  }
  throw new Error(`Storage projection missing required field ${label}`);
}

function requireBoolean(record: Record<string, unknown>, keys: string[], label: string): boolean {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    if (typeof value === 'boolean') return value;
    throw new Error(`Storage projection field ${label} must be a boolean`);
  }
  throw new Error(`Storage projection missing required field ${label}`);
}

function normalizePlanId(value: string): string {
  return value.trim().toLowerCase();
}

export function storageFromPayload(payload: unknown): StorageProjection {
  const root = asRecord(payload);
  const usage = asRecord(root.usage);
  if (!('usage' in root) || typeof root.usage !== 'object' || root.usage === null || Array.isArray(root.usage)) {
    throw new Error('Storage projection missing usage object');
  }
  const packsRaw = root.packs;
  if (!Array.isArray(packsRaw)) {
    throw new Error('Storage projection missing packs array');
  }
  const packs = packsRaw.map((item, index) => {
    const pack = asRecord(item);
    const productId = recordText(pack, ['product_id', 'productId']);
    if (!productId) throw new Error(`Storage pack ${index} missing product_id`);
    return {
      productId,
      displayName: recordText(pack, ['display_name', 'displayName'], 'Storage'),
      capacityGb: requireNumber(pack, ['capacity_gb', 'capacityGb'], `packs[${index}].capacity_gb`),
      priceJpy: requireNumber(pack, ['price_jpy', 'priceJpy'], `packs[${index}].price_jpy`),
      canPurchase: requireBoolean(pack, ['can_purchase', 'canPurchase'], `packs[${index}].can_purchase`),
    };
  });
  return {
    planId: normalizePlanId(recordText(root, ['plan_id', 'planId'], 'free')),
    planMaxCapacityGb: requireNumber(root, ['plan_max_capacity_gb', 'planMaxCapacityGb'], 'plan_max_capacity_gb'),
    currentCapacityGb: requireNumber(root, ['current_capacity_gb', 'currentCapacityGb'], 'current_capacity_gb'),
    remainingPurchaseCapacityGb: requireNumber(
      root,
      ['remaining_purchase_capacity_gb', 'remainingPurchaseCapacityGb'],
      'remaining_purchase_capacity_gb',
    ),
    usedBytes: requireNumber(usage, ['used_bytes', 'usedBytes'], 'usage.used_bytes'),
    remainingBytes: requireNumber(usage, ['remaining_bytes', 'remainingBytes'], 'usage.remaining_bytes'),
    state: (() => {
      if (!('state' in root)) throw new Error('Storage projection missing required field state');
      const value = recordText(root, ['state']);
      if (!value) throw new Error('Storage projection field state must be a non-empty string');
      return value;
    })(),
    writeAllowed: requireBoolean(root, ['write_allowed', 'writeAllowed'], 'write_allowed'),
    overPlanLimit: requireBoolean(root, ['over_plan_limit', 'overPlanLimit'], 'over_plan_limit'),
    packs,
  };
}
