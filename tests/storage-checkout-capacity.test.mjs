import assert from 'node:assert/strict';
import test from 'node:test';

function storagePurchaseWithinPlanLimit(current, pending, requested, planMax) {
  if (
    !Number.isSafeInteger(current) || current < 0
    || !Number.isSafeInteger(pending) || pending < 0
    || !Number.isSafeInteger(requested) || requested < 0
    || !Number.isSafeInteger(planMax) || planMax < 0
  ) {
    return false;
  }
  return current + pending + requested <= planMax;
}

test('Basic 5GB plan rejects +10GB pack at 0 used', () => {
  assert.equal(storagePurchaseWithinPlanLimit(0, 0, 10, 5), false);
});

test('Pro with 15GB used rejects +10GB when plan max is 20GB', () => {
  assert.equal(storagePurchaseWithinPlanLimit(15, 0, 10, 20), false);
});

test('Pro with 10GB used allows +10GB when plan max is 20GB', () => {
  assert.equal(storagePurchaseWithinPlanLimit(10, 0, 10, 20), true);
});

test('pending capacity counts toward plan max', () => {
  assert.equal(storagePurchaseWithinPlanLimit(5, 5, 10, 20), true);
  assert.equal(storagePurchaseWithinPlanLimit(5, 6, 10, 20), false);
});
