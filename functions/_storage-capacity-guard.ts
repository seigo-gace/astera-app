export function storagePurchaseWithinPlanLimit(
  currentCapacityGb: number,
  pendingCapacityGb: number,
  requestedCapacityGb: number,
  planMaxCapacityGb: number,
): boolean {
  if (
    !Number.isSafeInteger(currentCapacityGb) || currentCapacityGb < 0
    || !Number.isSafeInteger(pendingCapacityGb) || pendingCapacityGb < 0
    || !Number.isSafeInteger(requestedCapacityGb) || requestedCapacityGb < 0
    || !Number.isSafeInteger(planMaxCapacityGb) || planMaxCapacityGb < 0
  ) {
    return false;
  }
  return currentCapacityGb + pendingCapacityGb + requestedCapacityGb <= planMaxCapacityGb;
}
