export function storagePurchaseWithinPlanLimit(
  currentCapacityGb: number,
  pendingCapacityGb: number,
  requestedCapacityGb: number,
  planMaxCapacityGb: number,
): boolean {
  if (
    !Number.isSafeInteger(currentCapacityGb) || currentCapacityGb < 0
    || !Number.isSafeInteger(pendingCapacityGb) || pendingCapacityGb < 0
    || !Number.isSafeInteger(requestedCapacityGb) || requestedCapacityGb <= 0
    || !Number.isSafeInteger(planMaxCapacityGb) || planMaxCapacityGb < 0
  ) {
    return false;
  }
  // Compatibility name retained for the existing handler. The plan value is now
  // the plan-included/base Storage capacity, not a ceiling for buy-once packs.
  // Paid plans may add any number of valid Storage packs; pending purchases are
  // still validated/idempotent separately by the intent/payment chain.
  return planMaxCapacityGb > 0;
}
